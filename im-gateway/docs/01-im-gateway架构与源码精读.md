# im-gateway 架构与源码精读

> 目标：读完这份，你能说清楚**「为什么 IM 要单独拆一个网关进程」**，并且能指着 `im-gateway` 里任意一个类，讲出它在整条消息链路上负责哪一段。
> 全程用本模块的真实代码当教材，不讲抽象理论。

---

## 一、先看全景：这个模块在整个仓库的哪个位置

RBAC-Server 是 Maven 多模块 monorepo，根 `pom.xml` 是 parent（`packaging=pom`）：

```
RBAC-Server/
├── pom.xml           ← parent，<modules> 声明 backend + im-gateway
├── backend/          RBAC 主应用 + im-logic（com.rbac.im 包）   :8080  context-path /api
├── im-gateway/       本模块：Netty WebSocket 长连接网关          :9001（WS）
├── frontend/         Vue3 后台管理
└── deploy/           docker-compose：MySQL / Redis / Kafka / MongoDB / MinIO
```

一句话定位：

> **im-gateway 只管长连接的"收发字节"，不碰任何业务逻辑。**

业务逻辑（定序、落库、扇出、权限校验）全在 `backend` 的 `com.rbac.im` 包里，两边**只通过 Kafka 通信**，互相不引用对方的 jar。

---

## 二、为什么要单独拆一个进程？（这是本模块存在的全部理由）

如果直接在 backend 里用 Spring 的 `@ServerEndpoint` / STOMP 也能做 WebSocket，为什么非要多起一个进程？三个理由，按重要性排序：

### 理由 1：资源模型冲突

| | 普通 HTTP 请求 | IM 长连接 |
|---|---|---|
| 生命周期 | 毫秒级，用完即走 | 小时～天级，一直挂着 |
| 单机瓶颈 | CPU / 线程池 | **文件描述符（FD）+ 内存** |
| 线程模型 | 一请求一线程（Tomcat）也够用 | 必须 IO 多路复用（epoll），否则 10 万连接 = 10 万线程 = 直接爆炸 |
| 内存 | 堆内为主 | 大量**堆外内存**（每连接的读写缓冲区） |

10 万个空闲连接对 Tomcat 是灾难，对 Netty 是日常。这两种负载塞在同一个 JVM 里，GC 参数、线程池、内存配比根本没法同时调好。

### 理由 2：无状态 → 可水平扩展

网关**不持有任何业务数据**：

- 连接对象（`Channel`）在本机内存 —— 进程没了就没了，无所谓，客户端会重连
- 「哪个用户挂在哪台网关上」这个**路由信息放在 Redis** —— 全局共享

所以网关是无状态的，扩容 = 加机器。设计目标里的「50 万在线」≈ 5 台 × 10 万，而不是把一台机器堆到 50 万。

### 理由 3：解耦与独立部署

网关 ↔ im-logic 之间只有 Kafka 两个 topic。改业务逻辑不用重启网关（**重启网关 = 所有人掉线**，这个代价很大）；网关扩容也不会把整个 RBAC 业务系统跟着复制一份。

### 代价（诚实地说）

拆成两个进程不是白拿的，代价写在源码注释里：

```java
/** ... 字段须与 backend 侧 com.rbac.im.protocol.Envelope 完全一致。 */
```

`Envelope` 和 `OutboundPacket` 两个协议类在两个模块里各存了一份，靠**注释 + 人的自觉**保持一致。改一边忘另一边 → Jackson 反序列化静默丢字段，不报错，只是消息里少了个字段。这是当前设计的已知脆弱点（改进方向见第九节）。

---

## 三、依赖清单：验证"轻量"这件事

打开 `im-gateway/pom.xml`，注意**没有什么**比有什么更重要：

| 依赖 | 用途 |
|------|------|
| `spring-boot-starter` | 只要 IoC 容器和配置，**不是** starter-web —— 没有 Tomcat |
| `spring-boot-starter-data-redis` | 校验 session、写路由表 |
| `spring-kafka` | 上下行消息队列 |
| `netty-all` | 长连接主角 |
| `jjwt-api/impl/jackson` | 自己验 JWT 签名 |
| `jackson-databind` | JSON 序列化 |

**没有** MyBatis-Plus、没有 MySQL 驱动、没有 Spring Security、没有 backend 模块依赖。网关连数据库长什么样都不知道 —— 这正是"不碰业务"的物理保证。

> 🔍 观察点：`application.yml` 里写了 `server.port: 8090  # 仅供 actuator`，但 pom 里没有 `spring-boot-starter-web`，所以实际上**不会启动任何 HTTP 服务器**，actuator 端点当前是访问不到的。要暴露连接数指标，得补 web starter。这是个待办。

---

## 四、目录地图

```
com.rbac.im.gateway
├── ImGatewayApplication.java     启动类
├── auth/                         ① 你是谁
│   ├── GatewayJwtVerifier.java     验签 + 查 Redis session
│   └── AuthResult.java             record，验证结果
├── netty/                        ② 连接怎么建、帧怎么收
│   ├── NettyWebSocketServer.java   启动/关闭 Netty 服务器
│   ├── WebSocketChannelInitializer.java  定义处理链（pipeline）
│   ├── HandshakeAuthHandler.java   握手前鉴权
│   └── ImFrameHandler.java         业务帧处理 + 心跳 + 断线清理
├── registry/                     ③ 谁在线、在哪台机器
│   ├── ChannelRegistry.java        本机内存连接表
│   └── RouteService.java           Redis 全局路由表
├── kafka/                        ④ 和 im-logic 通信
│   ├── InboundProducer.java        上行：WS → Kafka
│   └── OutboundConsumer.java       下行：Kafka → WS
└── protocol/                     ⑤ 消息格式（与 backend 双份）
    ├── Envelope.java
    └── OutboundPacket.java
```

五个包，正好对应网关的五件事。记住这个分层，看代码就不会迷路。

---

## 五、Netty 部分精读

### 5.1 服务器怎么起来的

`NettyWebSocketServer.java` 用了一个很典型的"Spring 托管 Netty"写法：

```java
@EventListener(ApplicationReadyEvent.class)   // Spring 全部 Bean 就绪后再启动 Netty
public void start() throws InterruptedException {
    boss = new NioEventLoopGroup(1);          // 老板：只负责 accept 新连接，1 个线程够了
    worker = new NioEventLoopGroup();         // 工人：负责所有连接的读写，默认 CPU核数×2
    ...
    channelFuture = b.bind(port).sync();
}

@PreDestroy                                    // 进程关闭时优雅停机
public void stop() { ... shutdownGracefully(); }
```

**boss / worker 两个线程组的类比**：boss 是餐厅门口的迎宾，只负责把客人领进门（accept）；worker 是服务员，被领进来的客人后续所有点单、上菜（读写）都归他。一个迎宾能应付几万人进门，但服务员要多几个。

为什么用 `ApplicationReadyEvent` 而不是构造函数里直接启动？因为 Netty handler 里要用到 `GatewayJwtVerifier`、`ChannelRegistry` 这些 Spring Bean，必须等容器装配完。

### 5.2 pipeline：一条流水线，顺序就是一切

`WebSocketChannelInitializer.initChannel()` 是整个网关最该背下来的地方：

```java
ch.pipeline()
    .addLast(new HttpServerCodec())                       // ① 字节 ↔ HTTP 对象
    .addLast(new HttpObjectAggregator(65536))             // ② 把分片的 HTTP 拼成完整请求
    .addLast(new HandshakeAuthHandler(...))               // ③ 【自定义】升级前鉴权
    .addLast(new WebSocketServerProtocolHandler("/im"))   // ④ 完成 HTTP→WS 升级
    .addLast(new IdleStateHandler(idleSeconds, 0, 0))     // ⑤ 心跳超时检测
    .addLast(new ImFrameHandler(...));                    // ⑥ 【自定义】业务帧处理
```

理解 pipeline 的关键：**数据像流水线上的产品，从上到下依次经过每个工位**，每个工位加工一点。

| 工位 | 进来的是 | 出去的是 |
|------|---------|---------|
| ① HttpServerCodec | 一堆字节 | `HttpRequest` 对象 |
| ② HttpObjectAggregator | 可能被拆成好几段的 HTTP | 一个完整的 `FullHttpRequest`（上限 64KB） |
| ③ HandshakeAuthHandler | `HttpRequest` | 校验通过就放行，不通过直接 401 关连接 |
| ④ WebSocketServerProtocolHandler | HTTP 升级请求 | 握手完成，之后的数据变成 `WebSocketFrame` |
| ⑤ IdleStateHandler | 什么都不改 | 60 秒没读到数据就往下发一个 `IdleStateEvent` |
| ⑥ ImFrameHandler | `TextWebSocketFrame` | 转成 `Envelope` 丢进 Kafka |

**为什么鉴权必须放在 ④ 之前？** 因为一旦握手完成，连接就正式建立了 —— 无效 token 的客户端已经占用了一个 FD 和一份内存。放在前面，非法请求在 HTTP 阶段就被 401 打掉，网关不为它付出任何长连接成本。这在抗攻击层面很重要。

### 5.3 HandshakeAuthHandler：三个细节都有坑

```java
protected void channelRead0(ChannelHandlerContext ctx, HttpRequest req) {
    Map<String, String> q = parseQuery(req.uri());        // 从 /im?token=xx&deviceId=yy 取参数
    AuthResult r = verifier.verify(q.get("token"));
    if (!r.ok()) { reject(ctx); return; }                 // 401 + close

    String deviceId = q.getOrDefault("deviceId", "default");
    ctx.channel().attr(USER_ID).set(r.userId());          // 细节 A：身份挂到 Channel 上
    ctx.channel().attr(DEVICE_ID).set(deviceId);
    registry.add(r.userId(), deviceId, ctx.channel());    // 登记本机连接表
    routeService.register(r.userId(), deviceId);          // 登记 Redis 全局路由

    req.setUri(URI.create(req.uri()).getPath());          // 细节 B：uri 洗回纯路径
    ctx.pipeline().remove(this);                          // 细节 C：把自己从流水线拆掉
    ctx.fireChannelRead(ReferenceCountUtil.retain(req));  // 把请求交给下一个工位
}
```

**细节 A：`AttributeKey` 是什么？**

```java
public static final AttributeKey<Long> USER_ID = AttributeKey.valueOf("imUserId");
```

`AttributeKey` 是 Netty 给 `Channel` 提供的**类型安全的附件槽位**。可以把 `Channel` 想成一个快递包裹，`AttributeKey` 就是往包裹上贴的标签 —— 贴的时候写 `AttributeKey<Long>`，取的时候拿回来就是 `Long`，不用强转、不会 ClassCastException。

它解决的问题很实际：**HTTP 是无状态的，但长连接是有状态的。**鉴权只在握手时做一次，可这条连接接下来几小时收到的每一帧，都得知道"这是谁发的"。总不能每帧都重新验一次 JWT（慢，而且 token 会过期）。所以握手时把 userId 钉在 Channel 上，后面 `ImFrameHandler` 直接读：

```java
Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
```

这是 Netty 版的"session"。和 HTTP Session 的区别是：它的生命周期就是这条 TCP 连接的生命周期，连接断了自动消失，不需要过期清理。

> 用 `AttributeKey.valueOf("imUserId")` 时注意：这个 key 是**全局注册**的，字符串相同就是同一个 key。所以名字要带业务前缀（这里的 `im` 前缀），避免和第三方 handler 撞车。

**细节 B：为什么要把 uri 洗回纯路径？**

客户端连的是 `/im?token=eyJhbGc...&deviceId=phone`，但下一个工位 `WebSocketServerProtocolHandler("/im")` 是**按路径精确匹配**的，看到带 query 的 uri 会匹配失败，握手不了。所以这里用 `URI.create(uri).getPath()` 剥掉 query，只留 `/im` 再往下传。

这是 Netty 握手鉴权的经典写法，第一次自己写基本都会在这卡住。

**细节 C：`pipeline().remove(this)` —— 用完就拆**

鉴权只需要发生一次。留着它，后续每个 HTTP 对象都会再进一遍（虽然握手后就没有 HTTP 对象了，但白占内存）。Netty 的 pipeline 是**每条连接一份**的，10 万连接就是 10 万条 pipeline，省一个 handler 就是省 10 万份对象。

顺带一提 `ReferenceCountUtil.retain(req)`：Netty 用引用计数管理堆外内存，`channelRead0` 方法结束时会自动 release 一次。这里要把 req 传给下一个工位继续用，所以先手动 +1，否则下游拿到的是已经被释放的对象。

### 5.4 ImFrameHandler：一条安全红线

```java
if ("SEND".equals(env.getOp())) {
    env.setSenderId(userId);       // 以连接身份为准，忽略客户端伪造
    env.setDeviceId(deviceId);
    inboundProducer.send(env);
    // 立即回执：告诉客户端服务器已接收（seq 稍后由推送带回）
    ...ACK...
}
```

`env.setSenderId(userId)` 这一行是**安全红线的落地点**：客户端 JSON 里写 `"senderId": 999`（别人的 id）也没用，会被握手时验过的真实身份直接覆盖。

> 通用原则：**凡是客户端能填的身份字段，服务端一律不信，一律用连接/会话身份覆盖。**

另外两个方法：

```java
public void userEventTriggered(ctx, evt) {
    if (evt instanceof IdleStateEvent) ctx.close();   // 60 秒没消息 → 判定死连接，关掉
}

public void channelInactive(ctx) {                     // 连接断开（主动/被动）
    registry.remove(userId, deviceId);                 // 清本机表
    routeService.unregister(userId, deviceId);         // 清 Redis 路由
}
```

`channelInactive` 是**资源回收的兜底**。不清理的话，Redis 路由表里会留下指向已死连接的记录，im-logic 会一直往这台网关投递消息，投了也送不到 —— 消息黑洞。

---

## 六、两张表：本机表 vs 全局路由表

这是初学者最容易混淆的地方。**它们不是一回事，也不能互相替代。**

| | `ChannelRegistry` | `RouteService` |
|---|---|---|
| 存在哪 | **本进程 JVM 内存** | **Redis** |
| 存什么 | `userId → {deviceId → Channel}` | `route:user:<uid>` Hash：`{deviceId → gatewayId}` |
| 谁看得到 | 只有本网关 | 所有网关 + im-logic |
| 能不能序列化 | 不能（`Channel` 是本机 socket 的句柄，跨进程毫无意义） | 能（就是字符串） |
| 有没有过期 | 没有，靠 `channelInactive` 清理 | **TTL 120 秒** |

**为什么必须有两张？** 因为 im-logic 要给用户 A 推消息时，它面对的问题分两步：

1. "A 现在挂在哪台网关上？" → 查 Redis 路由表，得到 `gw3`
2. "gw3 上 A 的那条 socket 是哪个？" → 这个只有 gw3 自己的内存里有

Redis 只能存"地址"（gatewayId 这个字符串），存不了 socket 本身。所以必然是两级寻址。

**TTL 120 秒是干嘛的？** 容灾。如果网关进程被 `kill -9`，`channelInactive` 根本来不及执行，Redis 里就会留下永久的脏路由。加了 TTL 之后，最多 120 秒这些记录自动消失，系统自愈。

```java
public void register(long userId, String deviceId) {
    redis.opsForHash().put(key, deviceId, gatewayId);
    redis.expire(key, TTL_SECONDS, TimeUnit.SECONDS);   // 每次注册都重置 TTL
}
```

> ⚠️ **当前的一个真实缺口**：`RouteService.renew()` 方法定义了，但**全项目没有任何地方调用它**。`ImFrameHandler` 收到心跳超时事件是直接 `ctx.close()`，正常心跳帧也没有触发续期。
>
> 后果：一条连接如果 120 秒内没有新的 `register`，Redis 路由就过期了 —— 连接明明还活着，im-logic 却认为这人离线，消息不推给他，只能等他重连后 `pull` 拉取。功能上不会丢消息（有增量拉取兜底），但实时性完全失效。
>
> 修法思路：在 `ImFrameHandler.channelRead0` 里，每收到一帧（或专门的 PING 帧）就调一次 `routeService.renew(userId)`。

---

## 七、Kafka：网关和 im-logic 唯一的通道

### 7.1 上行 InboundProducer —— key 的选择是关键

```java
private static final String TOPIC = "im-inbound";

/** key = cid 保证同会话进同一分区、分区内有序。 */
public void send(Envelope env) {
    kafka.send(TOPIC, env.getCid(), mapper.writeValueAsString(env));
}
```

这行注释信息量很大。Kafka 的顺序保证规则是：

- **同一分区内**的消息，消费顺序 = 生产顺序（严格有序）
- **跨分区**没有任何顺序保证
- 相同 key 的消息，一定进同一分区

所以用 `cid`（会话 id）当 key，就意味着**同一个会话里的所有消息天然有序**，而不同会话之间可以并行处理（分散在不同分区、被不同消费者线程处理）。

这是"既要有序、又要吞吐"的标准解法：**把有序性的粒度缩小到业务真正需要的范围**。IM 只需要"同一个聊天窗口里的消息不乱序"，不需要"全世界的消息严格有序"。

### 7.2 下行 OutboundConsumer —— 广播 + 本地过滤

```java
@KafkaListener(topics = "im-outbound", groupId = "im-gateway-${im.gateway.id}")
public void onOutbound(String json) throws Exception {
    OutboundPacket packet = mapper.readValue(json, OutboundPacket.class);
    if (!gatewayId.equals(packet.getGatewayId())) {
        return;   // 不是发给本网关的
    }
    Channel ch = registry.find(packet.getTargetUserId(), packet.getDeviceId());
    if (ch != null && ch.isActive()) {
        ch.writeAndFlush(new TextWebSocketFrame(mapper.writeValueAsString(packet.getEnvelope())));
    }
}
```

注意 `groupId = "im-gateway-${im.gateway.id}"` —— **每个网关实例一个独立的消费组**。

Kafka 的规则是：同一消费组内，一条消息只被一个消费者消费；不同消费组之间，每组都能收到全量消息。

所以这里的效果是：**每台网关都收到全部下行消息，然后各自扔掉不属于自己的**。

> 🔍 **可优化点**：N 台网关就有 (N-1)/N 的消息是白读的。50 万连接的 5 台网关规模下，80% 的下行消息被读进来又丢掉，浪费网络和反序列化 CPU。
>
> 更优解：让 `im-outbound` 按 gatewayId 分区，网关只订阅自己那个分区；或者干脆每个网关一个 topic（`im-outbound-gw1`）。设计文档里提到用 gatewayId 作 key（这一步 `OutboundDispatcher.send()` 已经做了），但消费端还没利用起来。这是从"能跑"到"能扩"之间要补的一课。

---

## 八、端到端：一条消息的完整旅程

把前面所有零件串起来。用户 A 在会话 `c_1_2` 里给 B 发一条 "hi"：

```
A 的客户端
  │ WS 帧: {"op":"SEND","cid":"c_1_2","type":"TEXT",
  │         "body":{"text":"hi"},"clientMsgId":"x1"}
  ▼
┌─────────────── im-gateway（本模块）────────────────┐
│ ImFrameHandler                                     │
│   ├─ 从 Channel attr 取出真实 userId               │
│   ├─ 覆盖 env.senderId（防伪造）                    │
│   ├─ InboundProducer → Kafka「im-inbound」key=cid   │
│   └─ 立刻回 ACK 给 A（"服务器收到了"，但还没有 seq）│
└────────────────────────────────────────────────────┘
  ▼
┌─────────────── backend / im-logic ─────────────────┐
│ InboundMessageConsumer  @KafkaListener(im-inbound) │
│   ├─ 幂等：senderId + clientMsgId 已存在 → return   │
│   ├─ 成员校验：非会话成员 → 回 ERROR/NOT_MEMBER     │
│   ├─ 禁言校验：被禁言 → 回 ERROR/MUTED              │
│   ▼                                                │
│ MessageAppender.append()                           │
│   ├─ SeqService: Redis INCR im:conv:<cid>:seq ←定序│
│   ├─ 写 MongoDB（im_message 集合）                  │
│   ├─ 更新 MySQL 会话摘要 last_msg_seq / preview     │
│   ▼                                                │
│ OutboundDispatcher.dispatch()                      │
│   ├─ 查会话成员列表（MySQL）                        │
│   ├─ 每个成员查 Redis route:user:<uid>              │
│   ├─ 查不到 = 离线 → 跳过不推（等上线后 pull）      │
│   └─ 有路由 → Kafka「im-outbound」key=gatewayId     │
└────────────────────────────────────────────────────┘
  ▼
┌─────────────── im-gateway（本模块）────────────────┐
│ OutboundConsumer                                   │
│   ├─ packet.gatewayId 不是我 → 丢弃                 │
│   └─ 是我 → ChannelRegistry.find(uid, deviceId)     │
│              → ch.writeAndFlush(PUSH 帧)            │
└────────────────────────────────────────────────────┘
  ▼
B 的客户端收到 PUSH（这次带 seq 了）
```

**注意 ACK 和 PUSH 的区别**：

| | 谁发的 | 什么时候 | 带 seq 吗 | 含义 |
|---|---|---|---|---|
| ACK | 网关 | 收到帧立刻 | ❌ 没有 | "服务器收到你的请求了" |
| PUSH | im-logic 经网关 | 定序落库后 | ✅ 有 | "消息已经正式入库，编号是 N" |

发送者 A 自己也是会话成员，所以 A 也会收到自己那条消息的 PUSH —— 客户端靠 `clientMsgId` 把 PUSH 和本地那条"发送中"的消息对上号，然后把状态改成"已发送"并填入 seq。

> 💡 思考题：如果 ACK 收到了但 PUSH 迟迟不来，客户端应该怎么办？（提示：`clientMsgId` 的幂等设计就是为重发准备的）

---

## 九、跨模块的支点：seq

虽然 seq 是 im-logic 生成的，但不理解它就看不懂网关为什么可以"离线就不推"。

**seq = 每个会话内单调递增的序号**，由 `Redis INCR im:conv:<cid>:seq` 生成。

它一个东西同时解决了四个问题：

| 问题 | 用 seq 怎么解 |
|------|--------------|
| 消息时序 | 按 seq 排序，不依赖不可靠的客户端时间戳 |
| 离线消息 | 上线时 `pull(cid, sinceSeq)` 拉 `seq > sinceSeq` 的 |
| 多端同步 | 同上 —— 另一台设备也是拉增量，**代码完全一样** |
| 未读数 | `maxSeq(cid) - last_read_seq` |

**"离线消息"和"多端同步"在这个模型里根本不是两个功能，是同一套代码。**这是整个 IM 方案里最值得学的抽象。

正因为有这个兜底，网关侧才敢采取「路由查不到就直接跳过」的简单策略 —— 消息不会丢，只是晚一点通过拉取到达。

---

## 十、安全红线在网关侧的落地

对照 `CLAUDE.md` 的安全红线，看网关做了什么：

| 红线 | 网关的落地 |
|------|-----------|
| 登出后旧 Token 必须失效 | `GatewayJwtVerifier` 除了验签，**还查 Redis `auth:access:<jti>`**。登出时 backend 删这个 key，网关握手立刻拒绝 |
| 敏感操作后端必须再鉴权 | 网关只做"你是谁"（认证），"你能不能在这个会话发言"（授权）由 im-logic 的 `isMember` / `isGroupMuted` 再查一次 |
| 客户端数据不可信 | `env.setSenderId(userId)` 强制覆盖 |
| 密钥不硬编码 | `rbac.jwt.secret: ${RBAC_JWT_SECRET:...}`，走环境变量，且**必须与 backend 一致** |

**为什么验签还不够、非要查一次 Redis？**因为 JWT 是自包含的 —— 签名有效就有效，服务端无法"撤销"一个还没到期的 JWT。加一层 Redis session 检查，等于给无状态 token 加了个状态开关，登出/改密/强制下线才能立即生效。代价是每次握手多一次 Redis 查询（但握手是低频操作，可接受）。

**注意认证与授权的分工**：网关只回答"你是谁"，不回答"你能干什么"。这是它保持"不碰业务"的边界 —— 一旦网关开始查会话成员表，它就需要 MySQL 依赖，就不轻量了。

---

## 十一、已知缺口与可深挖的点

按优先级：

| # | 问题 | 影响 | 方向 |
|---|------|------|------|
| 1 | `RouteService.renew()` 无调用方 | 连接活着但路由 120s 后过期，实时推送失效，退化成靠拉取 | 收到帧/PING 时调 `renew` |
| 2 | 协议类双份复制 | 改一边忘另一边 → 字段静默丢失 | 抽 `im-protocol` 公共 module，两边都依赖 |
| 3 | 下行广播 + 本地过滤 | N 台网关浪费 (N-1)/N 带宽和 CPU | 按 gatewayId 分区订阅，或每网关独立 topic |
| 4 | 没有 web starter，actuator 不可达 | 拿不到连接数/收发速率指标，压测时是黑盒 | 补 `spring-boot-starter-web` + micrometer |
| 5 | `ObjectMapper` 每个类 new 一个 | 轻微浪费（它是线程安全的，本可共享） | 提成 `@Bean` 注入 |
| 6 | 无背压/限流 | 单个客户端狂发能打爆 Kafka producer | 加令牌桶 + `Channel.isWritable()` 判断 |
| 7 | 只处理 `op=SEND` | PING/PULL/READ 等指令走不了 WS，只能走 REST | 补 op 分发 |

---

## 十二、本地跑起来

```bash
# 1. 起中间件（MySQL/Redis/Kafka/MongoDB/MinIO）
cd deploy && docker compose --profile im --profile full up -d

# 2. 起业务（含 im-logic）
mvn -f backend/pom.xml spring-boot:run

# 3. 起网关（另开终端）
mvn -f im-gateway/pom.xml spring-boot:run

# 4. 起第二台网关验证集群路由：改 im.gateway.id 和 ws-port
mvn -f im-gateway/pom.xml spring-boot:run \
    -Dspring-boot.run.arguments="--im.gateway.id=gw2 --im.gateway.ws-port=9002"
```

连接地址：`ws://localhost:9001/im?token=<accessToken>&deviceId=phone`
（accessToken 从 `POST /api/auth/login` 拿）

**跑起来后建议自己验证的几件事**（比读代码有用得多）：

1. 用错 token 连 → 应该收到 401，连接立刻断
2. 正常连上后，去 Redis 里 `HGETALL route:user:<你的userId>` → 应该看到 `phone → gw1`
3. **等 120 秒再查一次** → 会发现 key 没了。这就是第十一节缺口 #1 的现场
4. 同一账号用两个 deviceId 连两条 → 发消息两端都收到（多端同步）
5. 起 gw1 + gw2，A 连 gw1、B 连 gw2，A 发消息 B 能收到 → 验证跨网关路由

---

## 十三、一句话总结

> im-gateway 是一个**无状态、不碰业务、只管长连接收发**的接入层。
> 它用 **Netty pipeline** 处理连接，用 **AttributeKey** 记住连接身份，
> 用**本机内存表 + Redis 路由表**两级寻址定位一条 socket，
> 用 **Kafka 两个 topic** 和业务逻辑彻底解耦 ——
> 这四件事凑齐，才有了"加机器就能扩到 50 万连接"的可能性。

---

## 相关文档

- 总体设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`
- 分阶段计划：`docs/superpowers/plans/` 下的 phase1~4
- Spring Boot 基础：`docs/learning-spring-boot/`
