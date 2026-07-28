# 阶段 2 · WebSocket 握手与连接生命周期（从一次 HTTP Upgrade 到断连清理）

> 目标：这一章只追一条连接，不追消息怎样落库。
>
> 你会从 TCP 连接和 HTTP Upgrade 请求开始，依次经过 Netty pipeline、JWT 与 Redis 双重鉴权、
> Channel 身份属性、本机连接注册、PING/PONG、读空闲关闭，最后走到 `channelInactive` 清理。
>
> 读完后，你应该能明确区分“JWT 认证成功”“WebSocket 升级成功”“连接仍然活跃”和“用户仍有下行路由”四种状态。

---

## 一、先看真正的 WebSocket 握手长什么样

客户端连接：

```text
ws://localhost:9001/im?token=<accessToken>&deviceId=web-1
```

在 WebSocket 建立之前，网络上先出现的仍是一份 HTTP 请求：

```http
GET /im?token=<accessToken>&deviceId=web-1 HTTP/1.1
Host: localhost:9001
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
```

认证和协议升级都成功后，服务端返回类似：

```http
HTTP/1.1 101 Switching Protocols
Connection: upgrade
Upgrade: websocket
Sec-WebSocket-Accept: <根据客户端 key 计算的值>
```

从这一刻起，同一条 TCP 连接不再交换普通 HTTP 请求/响应，而是交换 WebSocket Frame：

```text
TextWebSocketFrame   → SEND / PING / ACK / PUSH
Ping/Pong Frame      → WebSocket 协议自带控制帧
CloseWebSocketFrame  → 关闭握手
```

本项目业务心跳使用的是 JSON 文本帧：

```json
{ "op": "PING", "ts": 1785200000000 }
```

而不是客户端直接构造 WebSocket 协议层的 Ping Frame。后面会解释这两者为什么不能混着看。

先记住完整边界：

```text
TCP 已连接
  ≠ JWT 已认证
  ≠ HTTP 已升级为 WebSocket
  ≠ Redis 中一直存在可用下行路由
```

---

## 二、9001 是怎样开始监听的

源码入口是 [`NettyWebSocketServer`](../../im-gateway/src/main/java/com/rbac/im/gateway/netty/NettyWebSocketServer.java)。它不是 Spring MVC Controller，也不依赖内嵌 Tomcat。

### 2.1 Spring 先启动，Netty 后绑定端口

`NettyWebSocketServer.start()` 标记了：

```java
@EventListener(ApplicationReadyEvent.class)
```

因此顺序是：

```text
Spring Boot 创建 Bean
  → Redis/Kafka 等自动配置初始化
  → 发布 ApplicationReadyEvent
  → NettyWebSocketServer.start()
  → bind(9001).sync()
  → 打印“网关已监听端口 9001”
```

看到 Spring Boot 的启动 banner，不等于 9001 已经绑定成功。真正的证据是 Netty 监听日志，或者操作系统里出现 LISTEN：

```bash
lsof -nP -iTCP:9001 -sTCP:LISTEN
```

阶段 0 已经确认，网关配置中的 `server.port: 8090` 当前没有 HTTP Web Server 依赖支撑；本章所有握手都发生在 Netty 显式绑定的 9001。

### 2.2 boss 和 worker 各做什么

服务端创建两个事件循环组：

```java
boss = new NioEventLoopGroup(1);
worker = new NioEventLoopGroup();
```

职责可以画成：

```text
客户端 TCP connect
        │
        ▼
boss EventLoop（1 个线程）
  只负责 accept 新连接
        │
        ▼
worker EventLoopGroup
  把每条已连接 Channel 分配给某个 EventLoop
  处理该连接的读、写和 pipeline 事件
```

一个 worker 线程可以管理很多 Channel，并不是“一条 WebSocket 开一个线程”。这正是 Netty 能承载大量长连接的基础。

同一 Channel 的事件通常由绑定的 EventLoop 串行执行，因此 handler 不需要为这条连接的每次入站帧新建线程。但跨连接共享的结构，例如 `ChannelRegistry.table`，仍然会被不同 EventLoop 并发访问，所以使用 `ConcurrentHashMap`。

### 2.3 三个启动参数分别约束什么

```java
.channel(NioServerSocketChannel.class)
.option(ChannelOption.SO_BACKLOG, 1024)
.childOption(ChannelOption.SO_KEEPALIVE, true)
.childHandler(initializer);
```

| 配置 | 作用对象 | 本章需要的理解 |
|---|---|---|
| `NioServerSocketChannel` | 监听 Channel | 使用 Java NIO 接受 TCP 连接 |
| `SO_BACKLOG=1024` | 服务端监听 socket | 控制待 accept 连接队列的容量上限意图 |
| `SO_KEEPALIVE=true` | 每条子连接 | 启用 TCP 层 keepalive，不等于业务 PING/PONG |
| `childHandler(initializer)` | 每条子连接 | 给新 SocketChannel 安装完整 pipeline |

TCP keepalive 的探测周期由操作系统控制，通常不适合直接承担 60 秒级业务在线判定。本项目仍然需要 `IdleStateHandler` 和应用层 PING。

### 2.4 进程停止时关闭什么

`@PreDestroy` 会执行：

```text
关闭服务端监听 Channel
  → boss.shutdownGracefully()
  → worker.shutdownGracefully()
```

关闭监听 Channel 后不再接受新连接；停止 EventLoopGroup 才会结束处理已有 Channel 的事件线程。这里的代码发起 graceful shutdown，但没有对返回的 future 再 `sync()` 等待，所以它表达的是“通知 Netty 优雅停机”，不是一套带最长等待时间和逐连接下线通知的完整发布流程。

---

## 三、每条新连接都会安装一条 pipeline

源码入口是 [`WebSocketChannelInitializer`](../../im-gateway/src/main/java/com/rbac/im/gateway/netty/WebSocketChannelInitializer.java)。每接受一个 `SocketChannel`，`initChannel()` 都会按顺序加入六个工位：

```text
网络字节
  │
  ▼
HttpServerCodec
  │
  ▼
HttpObjectAggregator(65536)
  │
  ▼
HandshakeAuthHandler
  │
  ▼
WebSocketServerProtocolHandler("/im")
  │
  ▼
IdleStateHandler(idleSeconds, 0, 0)
  │
  ▼
ImFrameHandler
```

### 3.1 `HttpServerCodec`：字节和 HTTP 对象之间翻译

握手请求刚到达时只是网络字节。`HttpServerCodec` 把入站字节解码成 `HttpRequest`、`HttpContent` 等对象，也负责把出站 HTTP Response 编码回字节。

### 3.2 `HttpObjectAggregator(65536)`：把分片拼成完整请求

HTTP 解码器可能产生一段请求头和多段内容。聚合器把它们拼成可一次处理的完整 HTTP 请求，并把允许聚合的最大内容限制为 65536 字节。

WebSocket GET 握手通常没有大正文，但后续 handler 希望看到一个完整请求，而不是自己维护 HTTP 分片状态。

### 3.3 `HandshakeAuthHandler`：只负责升级前身份门禁

它读取 URI query 中的 token/deviceId，验证失败就返回 401 并关闭；验证成功则把用户身份写进 Channel，并把请求继续交给下一站。

它不负责计算 `Sec-WebSocket-Accept`，也不负责返回 101。

### 3.4 `WebSocketServerProtocolHandler("/im")`：完成协议升级

这个 Netty 内置 handler 检查 WebSocket Upgrade 请求与路径，完成握手，并在升级后处理 WebSocket 协议相关细节。路径配置是精确的 `/im`。

因此认证成功还不等于升级成功：请求可能有合法 token，却缺少 Upgrade 头、WebSocket 版本不支持，或路径不是 `/im`。

### 3.5 `IdleStateHandler(idleSeconds, 0, 0)`：观察读空闲

三个参数依次是读空闲、写空闲、全部空闲。本项目只配置第一个：默认连续 60 秒没有任何入站读取，就触发 `IdleStateEvent`。

它只产生事件，不主动决定关闭连接。真正调用 `ctx.close()` 的是后面的 `ImFrameHandler.userEventTriggered()`。

### 3.6 `ImFrameHandler`：只接收文本业务帧

它继承：

```java
SimpleChannelInboundHandler<TextWebSocketFrame>
```

所以它处理的是升级完成后的文本帧：解析 Envelope、回复应用层 PONG、覆盖发送者身份、向 Kafka 投递 SEND，并在连接失效时清理状态。

入站事件按 pipeline 从前向后传播；出站写操作会沿相反方向经过能处理它的出站 handler，最后编码为网络字节。

---

## 四、认证和 WebSocket 升级是两道不同的门

源码入口是 [`HandshakeAuthHandler`](../../im-gateway/src/main/java/com/rbac/im/gateway/netty/HandshakeAuthHandler.java)。一份请求在这里经历：

```text
/im?token=...&deviceId=web-1
  → 解析 query
  → GatewayJwtVerifier.verify(token)
  → 失败：HTTP 401 + close
  → 成功：写 Channel 属性
  → 登记本机连接表
  → 登记 Redis 路由
  → URI 改回 /im
  → 移除自身
  → retain 后交给 WebSocketServerProtocolHandler
```

### 4.1 为什么 token 放在 query

浏览器原生 `WebSocket` 构造器不能像普通 `fetch` 那样随意设置 `Authorization` 请求头，因此当前协议采用：

```text
?token=<JWT>&deviceId=<设备标识>
```

这让浏览器、React Native 等客户端都容易接入，但 token 出现在 URL 中，可能进入代理访问日志、调试记录或错误上报。生产环境至少要做到：

- 使用 `wss://`，避免明文链路暴露 token；
- 代理和应用日志不要记录完整 query；
- 不把完整握手 URL复制到工单、截图或聊天记录；
- 保持 access token 短有效期，并保留 Redis 撤销能力。

当前代码实现的是 query token；本章不擅自把它改成其他传递方式。

### 4.2 deviceId 缺省时发生什么

```java
String deviceId = q.getOrDefault("deviceId", "default");
```

没传 deviceId 时，同一用户的连接都会落到 `default` 这个设备槽位。当前代码也没有检查空字符串、长度或字符集。

设备标识决定本机连接表和 Redis 路由中的 field。客户端若希望手机和网页同时在线，应为两端提供不同且稳定的 deviceId。它不是用户身份，也不能替代 JWT。

### 4.3 为什么先把身份挂到 Channel

认证成功后：

```java
ctx.channel().attr(USER_ID).set(r.userId());
ctx.channel().attr(DEVICE_ID).set(deviceId);
```

Channel 属性像绑定在这条连接上的类型化标签。以后每个文本帧都能从当前 Channel 取回身份：

```java
Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
String deviceId = ctx.channel().attr(HandshakeAuthHandler.DEVICE_ID).get();
```

这样客户端不需要每帧重复认证，网关也不会相信 Envelope 内自报的 senderId/deviceId。

`AttributeKey.valueOf("imUserId")` 和 `AttributeKey.valueOf("imDeviceId")` 提供稳定 key。属性值属于具体 Channel，不是存到一个全局当前用户变量里；不同连接可以拥有不同身份。

### 4.4 为什么还要登记两张连接表

认证成功时紧接着执行：

```java
registry.add(userId, deviceId, channel);
routeService.register(userId, deviceId);
```

| 位置 | 保存内容 | 谁使用 | 为什么需要 |
|---|---|---|---|
| 本机 `ChannelRegistry` | userId → deviceId → Channel 对象 | 当前网关 | 真正向 socket 写帧 |
| Redis `route:user:<uid>` | deviceId → gatewayId | backend/所有网关 | 跨进程找到 Channel 所在网关 |

Redis 不能保存可跨 JVM 使用的 Channel。Channel 包含 socket、EventLoop 和 pipeline 等本机运行时对象；序列化一个 channelId 到 Redis 也不能让 backend 直接调用它。

### 4.5 为什么必须剥掉 URI query

后面的 handler 配置的是：

```java
new WebSocketServerProtocolHandler("/im")
```

认证 handler 收到的原始 URI 是：

```text
/im?token=...&deviceId=web-1
```

因此它执行：

```java
req.setUri(URI.create(req.uri()).getPath());
```

把 URI 改回纯路径 `/im`，使协议 handler 能按预期匹配。query 已经完成认证使命，不应继续干扰 WebSocket 路径判断。

### 4.6 为什么移除自己

```java
ctx.pipeline().remove(this);
```

`HandshakeAuthHandler` 是一次性门禁：只应处理升级前的 HTTP 请求。认证通过后把它从该 Channel 的 pipeline 移除，连接进入长期 WebSocket 帧阶段，不再重复执行握手鉴权逻辑。

这不是把用户身份删掉。身份已经保存在 Channel 属性中，移除的是 handler 节点。

### 4.7 为什么转交前必须 `retain(req)`

`HandshakeAuthHandler` 继承 `SimpleChannelInboundHandler<HttpRequest>`。这个基类在 `channelRead0()` 返回后会自动释放它接受的引用计数对象。

但当前代码还要把同一个 request 交给后面的协议 handler：

```java
ctx.fireChannelRead(ReferenceCountUtil.retain(req));
```

`retain()` 先把引用计数加一，抵消当前 handler 返回时的自动 release，使下一个 handler 仍能安全读取请求。

如果直接 `fireChannelRead(req)`，请求可能在后续异步使用前已经被释放，典型结果是 `IllegalReferenceCountException`。如果只 retain 却没有下游最终 release，又会形成内存泄漏。Netty 的引用计数必须按所有权转移理解，不能按普通 Java 对象引用理解。

---

## 五、GatewayJwtVerifier 到底验证了什么

源码入口是 [`GatewayJwtVerifier`](../../im-gateway/src/main/java/com/rbac/im/gateway/auth/GatewayJwtVerifier.java)。它没有调用 backend HTTP 接口，而是在网关本地验 JWT，再直接查询共享 Redis。

### 5.1 四层验证顺序

```text
token 是否存在
  → HMAC 签名与标准时间声明是否有效
  → typ 是否为 access
  → Redis 是否存在 auth:access:<jti>
  → sub 能否转换为 userId
```

对应代码职责：

| 检查 | 失败含义 |
|---|---|
| token 非空 | 客户端确实提交了凭据 |
| `parseSignedClaims` | 令牌格式、签名或过期时间无效 |
| `typ=access` | refresh token 不能拿来建业务连接 |
| Redis key 存在 | 登录会话尚未撤销或过期 |
| `sub → Long` | 令牌主体能解释为本项目用户 id |

成功后返回：

```text
AuthResult(ok=true, userId, jti, reason=null)
```

失败原因只保存在内部 `AuthResult`，握手响应统一是空 body 的 HTTP 401，没有把异常类型或具体原因返回给未认证客户端。

### 5.2 JWT 与 Redis 缺一不可

backend 登录时同时产生：

```text
access JWT：包含 jti、sub、typ、iat、exp，并用共享 secret 签名
Redis：auth:access:<jti> = LoginUser，TTL 与 access token 对齐
```

网关本地验签解决“这个 token 是不是本系统签发、内容有没有被篡改”；Redis key 解决“这次登录现在是否仍有效”。

若只验 JWT，用户登出后在 exp 之前仍能建连。若只查 Redis，攻击者可以伪造一个 jti 和 userId。两步组合才形成当前认证边界。

### 5.3 backend 与 gateway 的 secret 必须一致

backend 签名、gateway 验签。若两个进程的 `rbac.jwt.secret` 不同，REST 登录会成功，拿到的 token 却会在 WebSocket 握手时被判定为签名无效。

排查“REST 正常但 WS 总是 401”时，至少核对：

```text
两个进程实际读取的 RBAC_JWT_SECRET
access token 而不是 refresh token
Redis 是否是同一实例
auth:access:<jti> 是否仍存在
token 是否已过期
query 是否被正确 URL 编码
```

### 5.4 401 只能证明门禁拒绝，不能直接定位原因

下面情况在客户端看来都可能只是 HTTP 401：

- 没传 token；
- JWT 被截断或签名错误；
- token 已过期；
- 把 refresh token 当 access token；
- 用户已经登出，Redis access session 被删除；
- gateway 连错 Redis；
- backend 与 gateway secret 不一致。

所以排错时要从 token 类型、网关配置和 Redis key 三边取证，不能看到 401 就只检查密码。

---

## 六、认证成功不等于升级成功

用状态机看最清楚：

```text
[TCP_CONNECTED]
       │ 收到 HTTP Upgrade
       ▼
[AUTH_CHECK]
  │失败                 │成功
  ▼                     ▼
401 + CLOSE       写属性 + 注册连接/路由
                        │
                        ▼
                 [WS_PROTOCOL_HANDSHAKE]
                   │失败       │成功
                   ▼           ▼
                 非 101      101 Switching Protocols
                               │
                               ▼
                        [WEBSOCKET_ACTIVE]
```

当前实现有一个重要时序：本机连接和 Redis 路由在 `WebSocketServerProtocolHandler` 返回 101 之前就注册了。

也就是说，短时间内可能出现：

```text
JWT 已通过
连接表/路由已写入
但 WebSocket 升级尚未成功
```

若后续握手失败并关闭 Channel，`channelInactive` 应承担清理。判断“在线”时仍不能只看刚写入的 Redis field，还要考虑 Channel 是否活跃以及路由 TTL。

### 6.1 失败矩阵

| 请求情况 | 认证 handler | 协议 handler | 最终结果 |
|---|---|---|---|
| 无 token | 拒绝 | 不会收到请求 | 401 后关闭 |
| refresh token | 拒绝 | 不会收到请求 | 401 后关闭 |
| access token 但 Redis 会话已删 | 拒绝 | 不会收到请求 | 401 后关闭 |
| 合法 token，但不是 WebSocket Upgrade | 可能认证成功 | 升级失败 | 不会得到有效 WS |
| 合法 token，路径最终为 `/im`，Upgrade 头正确 | 认证成功 | 升级成功 | 返回 101 |

`101` 才是 HTTP → WebSocket 切换成功的证据。仅看到 Redis 中出现 deviceId，不足以证明客户端已经进入可收发帧状态。

---

## 七、ChannelRegistry 为什么只能在网关本机

源码入口是 [`ChannelRegistry`](../../im-gateway/src/main/java/com/rbac/im/gateway/registry/ChannelRegistry.java)：

```text
Map<Long, Map<String, Channel>>
 userId       deviceId    socket/pipeline/EventLoop
```

例如：

```text
7
├── iphone-15 → Channel A
└── chrome-mac → Channel B
```

### 7.1 Channel 不是一条普通数据记录

一个 Channel 关联：

- 当前 JVM 中的 socket；
- 分配给它的 EventLoop；
- 这条连接自己的 pipeline；
- 本机内存中的属性与缓冲区；
- 当前连接是否 active、writable。

把它序列化到 Redis 没有意义。另一个进程即使读到对象字段，也不能获得原 JVM 的文件描述符和事件循环。

因此下行要分两跳：

```text
backend 查 Redis：用户设备在哪个 gatewayId
  → Kafka 把 OutboundPacket 送到目标网关
  → 目标网关查本机 ChannelRegistry
  → channel.writeAndFlush(TextWebSocketFrame)
```

### 7.2 为什么使用两层 ConcurrentHashMap

外层按 userId 找设备表，内层按 deviceId 找 Channel。不同 worker EventLoop 可能同时为不同连接执行 add/remove/find，所以两层都使用并发 Map。

`find(userId)` 返回该用户本机所有设备 Channel；`find(userId, deviceId)` 精确找一个设备。下行 `OutboundConsumer` 使用第二种。

### 7.3 同一 deviceId 重连的当前边界

`add()` 使用 `put(deviceId, newChannel)`，所以同一用户、同一 deviceId 新连接会覆盖旧 Channel 的映射，但当前代码没有在覆盖时主动关闭旧 Channel。

随后若旧 Channel 才触发 `channelInactive`，它调用的是：

```java
registry.remove(userId, deviceId);
routeService.unregister(userId, deviceId);
```

remove 没有校验“当前映射是否仍是这个旧 Channel”。因此存在这样的竞争窗口：

```text
旧连接 A 已登记 d1
  → 新连接 B 覆盖 d1
  → 旧连接 A 随后断开
  → A 的清理把 B 的本机映射和 Redis 路由一起删除
```

本章只记录这个生命周期事实，不在文档生成任务中修改实现。设计稳定的重连策略时，应让移除操作带上期望 Channel/连接代次，或在注册新连接时明确关闭并有序替换旧连接。

---

## 八、心跳：保持连接可读，不等于刷新所有在线状态

### 8.1 默认 60 秒检查的是读空闲

配置：

```yaml
im:
  gateway:
    heartbeat-idle-seconds: 60
```

pipeline 使用：

```java
new IdleStateHandler(idleSeconds, 0, 0)
```

只要服务端读到任何入站数据，读空闲计时就会重置，不仅限于业务 PING。活跃发送 SEND 的连接也不会因为没单独发 PING 而立即被判读空闲。

客户端在长期没有业务消息时仍应周期发送 PING，例如接口文档建议的约 25 秒一次：

```text
t=0s   PING → PONG
t=25s  PING → PONG
t=50s  PING → PONG
```

### 8.2 PONG 做两件事

`ImFrameHandler` 收到 `op=PING` 后返回：

```json
{
  "op": "PONG",
  "ts": 1785200000123
}
```

第一，入站 PING 让服务端的读空闲计时归零；第二，客户端收到 PONG，可以确认从客户端到服务端再返回客户端的应用数据路径仍然可用。

若只有 TCP socket 状态，没有应用层应答，客户端可能无法及时识别 NAT、网络切换或半开连接。

### 8.3 读空闲事件怎样关闭连接

连续 `idleSeconds` 没有入站读取后：

```text
IdleStateHandler
  → pipeline 传播 IdleStateEvent
  → ImFrameHandler.userEventTriggered()
  → ctx.close()
  → Channel 失效
  → channelInactive()
  → 清理本机连接与 Redis 路由
```

`IdleStateHandler` 不直接删路由，`userEventTriggered` 也不直接删路由。统一从 Channel 关闭走到 `channelInactive`，能让客户端主动断开、服务端超时关闭和网络异常尽量共用同一清理出口。

### 8.4 当前 PING 没有续期 Redis 路由

[`RouteService`](../../im-gateway/src/main/java/com/rbac/im/gateway/registry/RouteService.java) 注册路由时给整个用户 Hash 设置 120 秒 TTL，并提供：

```java
public void renew(long userId) {
    redis.expire("route:user:" + userId, 120, TimeUnit.SECONDS);
}
```

但当前源码中没有任何地方调用 `routeService.renew(...)`。`ImFrameHandler` 的 PING 分支只回复 PONG。

因此当前真实行为是：

```text
t=0s    握手：注册 route:user:7，TTL=120
t=25s   PING/PONG：Channel 活跃，但没有刷新 TTL
t=50s   PING/PONG：Channel 活跃，但没有刷新 TTL
...
t≈120s  Redis 路由过期
        本机 ChannelRegistry 仍可能保留活跃 Channel
```

结果是连接还能向上发送，网关本机也仍知道 Channel，但 backend 查不到用户位于哪台网关，新的下行 PUSH 可能无法生成对应投递。

所以本章要区分：

```text
应用层心跳正常
  ≠ Redis 在线路由仍存在
```

路线 M3 会继续分析 TTL 加在整个用户 Hash 上带来的多端影响；本章先把“续期方法存在但未接线”作为当前实现差异记录下来。

### 8.5 应用 PING 与 WebSocket Ping Frame

本项目 `ImFrameHandlerTest` 验证的是：

```text
TextWebSocketFrame({"op":"PING"})
  → TextWebSocketFrame({"op":"PONG"})
```

它不是 Netty 的 `PingWebSocketFrame → PongWebSocketFrame` 测试。`WebSocketServerProtocolHandler` 可能处理协议控制帧，但客户端业务层状态机仍应按本项目约定监听 JSON PONG，不能把两种心跳响应当成同一种对象。

---

## 九、断开时为什么必须清两处

`ImFrameHandler.channelInactive()` 读取 Channel 属性：

```java
Long userId = channel.attr(USER_ID).get();
String deviceId = channel.attr(DEVICE_ID).get();
```

属性都存在时执行：

```java
registry.remove(userId, deviceId);
routeService.unregister(userId, deviceId);
```

### 9.1 只清本机表会怎样

Redis 仍声明 `web-1 → gw1`。backend 会继续向 gw1 生成 OutboundPacket；gw1 查不到 Channel，只能丢掉实时下行，直到 TTL 过期。

### 9.2 只清 Redis 会怎样

本机 Map 仍持有失效 Channel 引用，形成陈旧连接状态和潜在内存占用。若某段本机逻辑按 registry.find() 遍历，还会不断遇到 inactive Channel。

### 9.3 为什么清理前检查属性非空

未通过鉴权的连接没有写 USER_ID/DEVICE_ID。它收到 401 后关闭时，不应该拿 null 拼 Redis key，也没有本机身份映射需要删除。

### 9.4 哪些路径最终会进入 `channelInactive`

常见路径包括：

- 客户端正常关闭；
- 服务端因读空闲调用 `ctx.close()`；
- 网络断开导致 Channel 失效；
- 网关进程停止时关闭连接；
- 握手阶段拒绝并关闭。

`channelInactive` 是连接生命周期事件，不只属于心跳超时。因此把清理集中在这里比在每个关闭分支复制 remove/unregister 更稳妥。

---

## 十、JWT 过期或登出后，已有连接当前会怎样

这是“握手鉴权”和“持续会话鉴权”的边界。

### 10.1 当前只在握手时验证一次

`GatewayJwtVerifier.verify()` 只由 `HandshakeAuthHandler` 调用。握手成功后，该 handler 被移出 pipeline；后续 PING 和 SEND 不再解析 token，也不再查询 `auth:access:<jti>`。

因此：

```text
已有 WebSocket 已通过握手
  → access token 后来过期
  或用户调用 logout 删除 Redis access session
  → 当前连接不会因此被主动关闭
  → 仍可继续收发，直到主动断开、网络异常或读空闲超时
```

登出后用旧 token 发起**新握手**会失败，因为 Redis key 已删除；但“旧 token 不能继续维持已经建立的连接”在当前实现中尚未闭环。

### 10.2 为什么不能把 Channel 属性当作动态登录态

Channel 上的 USER_ID 是握手时认证结果的快照。它不会随着 Redis session 删除而自动消失，也不会在 JWT exp 到达时自动变化。

如果产品要求强制登出立即踢掉长连接，需要额外机制，例如：

- 网关周期复核 session；
- backend 发布踢线事件到目标网关；
- 把 jti 与 Channel 建立索引，撤销时精确关闭；
- 连接按短周期主动重建并重新认证。

这些是后续设计选项，不是当前代码已经具备的行为。

---

## 十一、把一次连接完整复述出来

### 11.1 成功路径

```text
1. 客户端 TCP 连接 9001
2. boss accept，worker 接管 SocketChannel
3. initializer 安装六个 pipeline handler
4. HttpServerCodec 解码 HTTP Upgrade 请求
5. aggregator 形成完整 HttpRequest
6. HandshakeAuthHandler 解析 token/deviceId
7. GatewayJwtVerifier 验签、验 typ/exp、查 Redis access session
8. 身份写入 Channel Attribute
9. 本机 ChannelRegistry 和 Redis route 注册
10. URI 从 /im?... 改回 /im
11. 移除一次性认证 handler，retain 后转交请求
12. WebSocketServerProtocolHandler 完成升级，返回 101
13. 客户端与 ImFrameHandler 交换 TextWebSocketFrame
14. 入站活动持续重置 60 秒读空闲计时
15. 客户端断开或超时，Channel 关闭
16. channelInactive 清本机 registry 与 Redis route field
```

### 11.2 认证失败路径

```text
HTTP Upgrade 请求
  → token 缺失/无效/非 access/会话已撤销
  → DefaultFullHttpResponse(401)
  → writeAndFlush 完成后 close
  → 没有 USER_ID/DEVICE_ID
  → channelInactive 不执行身份清理
```

### 11.3 心跳超时路径

```text
WebSocket 已建立
  → 连续 60 秒没有任何入站读取
  → IdleStateEvent
  → ctx.close()
  → channelInactive
  → registry.remove + routeService.unregister
```

---

## 十二、动手实验

### 12.1 先跑不依赖 Redis mock 的两个测试

```bash
mvn -pl im-gateway \
  -Dtest=ChannelRegistryTest,ImFrameHandlerTest test
```

它们验证：

- 本机连接能按 userId/deviceId 添加、查询和删除；
- JSON 文本 PING 能收到 JSON 文本 PONG。

注意它们没有覆盖完整握手、URI 清洗、引用计数、IdleStateEvent、channelInactive 清理和路由续期。

### 12.2 再跑 JWT 验证测试

```bash
mvn -pl im-gateway \
  -Dtest=GatewayJwtVerifierTest test
```

测试用自签 token 和 mock Redis 覆盖：

- 合法 access + 存活 Redis session 通过；
- Redis session 被撤销时失败；
- refresh 类型与坏签名失败。

当前 Homebrew JDK 21 环境可能在断言前触发 Mockito inline / Byte Buddy 无法自附加。这是测试运行器初始化问题，不是 `GatewayJwtVerifier` 的业务失败。

### 12.3 静态验证 route renew 是否接线

```bash
rg -n 'routeService\.renew|\.renew\(' \
  im-gateway/src/main/java \
  im-gateway/src/test
```

当前不会找到调用方。再查看方法定义：

```bash
rg -n 'void renew|TTL_SECONDS|expire\(' \
  im-gateway/src/main/java/com/rbac/im/gateway/registry/RouteService.java
```

这两条搜索共同证明：续期能力已经定义，但心跳链路没有调用它。

### 12.4 真实握手实验

前提：按阶段 0 启动 MySQL、Redis、Kafka、MongoDB、MinIO，再启动 backend 与 im-gateway。若本机安装了 `jq` 和 `websocat`，先登录获取 access token：

```bash
IM_LOGIN_JSON=$(curl -s \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  http://localhost:8080/api/auth/login)

IM_ACCESS_TOKEN=$(printf '%s' "$IM_LOGIN_JSON" | jq -r '.data.accessToken')
```

无 token 握手：

```bash
websocat -v 'ws://localhost:9001/im'
```

预期得到 HTTP 401 或握手被拒绝。

有效 token 握手：

```bash
websocat -v \
  "ws://localhost:9001/im?token=${IM_ACCESS_TOKEN}&deviceId=study-web"
```

连接成功后输入：

```json
{"op":"PING","ts":1}
```

预期收到 `op=PONG` 和服务端时间戳。

另开终端查看路由：

```bash
docker exec rbac-redis \
  redis-cli -a rbac_redis_123 \
  HGETALL route:user:1
```

默认 admin 的实际 userId 应以登录数据为准；若不是 1，替换 key 中的数字。关闭 websocat 后再次 HGETALL，对应 `study-web` field 应被删除。

> token 在命令行参数中可能进入 shell history 或进程列表。本实验只适合本地学习环境；完成后清理历史中的敏感命令，不要把真实生产 token 用这种方式测试。

### 12.5 观察路由过期差异

保持 websocat 连接，每 25 秒发送一次 JSON PING。同时观察：

```bash
docker exec rbac-redis \
  redis-cli -a rbac_redis_123 \
  TTL route:user:1
```

按当前实现，TTL 会继续下降，而不会因 PING 回到 120。约 120 秒后 key 过期，但 WebSocket 仍可回复 PONG。这是“Channel 活跃”和“全局路由存在”分离的直接证据。

---

## 十三、排错时按握手阶段找证据

| 现象 | 先查什么 | 不能直接得出的结论 |
|---|---|---|
| 9001 refused | `lsof`、网关 Netty bind 日志 | 还没到 JWT 鉴权 |
| HTTP 401 | token、typ/exp、secret、Redis access key | 不一定是账号密码错误 |
| 有 Redis route 但客户端没收到 101 | Upgrade 请求头、路径、网关日志 | route 写入不证明升级成功 |
| 101 成功但很快断开 | 60 秒读空闲、客户端是否发 PING、网络状态 | 不一定是 token 过期 |
| PONG 正常但收不到 PUSH | route TTL 是否已过期、Kafka 下行、本机 registry | PONG 只证明当前连接的应用往返 |
| 登出后旧连接仍能发消息 | 当前是否只做握手时校验 | 不能据此说新握手也能通过 |
| 同 deviceId 重连后下行消失 | 旧 Channel 是否随后触发清理竞争 | 不一定是 backend 没扇出 |
| 测试报 Byte Buddy attach | JDK/Mockito agent 环境 | 尚未进入 JWT 业务断言 |

建议顺序：

```text
端口 LISTEN
  → HTTP 是否到达
  → 401 还是 101
  → Channel 属性/本机 registry
  → Redis route 与 TTL
  → PING/PONG
  → channelInactive 清理
```

不要一开始就同时查 Kafka、MongoDB 和 MySQL。握手连 101 都没有时，消息链路尚未开始。

---

## 十四、常见误判

### 误判 1：建立 TCP 连接就算 WebSocket 在线

不对。还要完成 HTTP Upgrade、JWT/Redis 鉴权，并收到 101。

### 误判 2：认证成功就一定升级成功

不对。认证 handler 与协议 handler 是两站；合法 token 也可能配上错误路径或不完整 Upgrade 请求。

### 误判 3：SO_KEEPALIVE 可以代替 PING/PONG

不对。TCP keepalive 与业务读空闲/应用往返的时间尺度和语义不同。

### 误判 4：Channel 可以放 Redis，让 backend 直接写

不对。Channel 是网关本机运行时对象。Redis 只保存 deviceId → gatewayId 路由。

### 误判 5：每条 SEND 都应该相信 JSON senderId

不对。发送者身份来自握手后写入 Channel 的 USER_ID，网关覆盖帧内字段。

### 误判 6：收到 PONG 就证明用户能收到 PUSH

不对。当前 PING 没续期 Redis 路由；PONG 正常时 route key 也可能已经过期。

### 误判 7：logout 删除 Redis session 会自动关闭旧 WebSocket

不对。当前 Redis access session 只在新握手时查询，已有连接没有持续复核。

### 误判 8：retain 是为了让请求永久不释放

不对。retain 只是在所有权交给下一 handler 前增加引用计数；下游完成后仍应释放。

---

## 十五、动手练习

### 练习 1：给 pipeline 工位分工

把下面职责匹配到对应 handler：

```text
HTTP 编解码 / 聚合 HTTP 分片 / JWT 门禁 / 返回 101 / 读空闲计时 / 文本业务帧
```

<details>
<summary><b>参考答案</b></summary>

| 职责 | handler |
|---|---|
| HTTP 编解码 | `HttpServerCodec` |
| 聚合 HTTP 分片 | `HttpObjectAggregator` |
| JWT + Redis 门禁 | `HandshakeAuthHandler` / `GatewayJwtVerifier` |
| 完成 WebSocket Upgrade、返回 101 | `WebSocketServerProtocolHandler` |
| 读空闲计时并产生事件 | `IdleStateHandler` |
| PING/SEND 文本业务帧与断连清理 | `ImFrameHandler` |

</details>

### 练习 2：解释三个关键动作

认证成功后，为什么要依次执行 URI 去 query、移除自身、retain 后 fire？

<details>
<summary><b>参考答案</b></summary>

- URI 去 query：后面的 WebSocket handler 按 `/im` 匹配，不能让 token/deviceId query 干扰路径。
- 移除自身：这是一次性 HTTP 握手门禁，连接升级后不应重复处理长期业务帧。
- retain 后 fire：当前 SimpleChannelInboundHandler 返回时会自动 release HttpRequest；转交同一对象前必须增加引用计数，保证下游仍能读取。

</details>

### 练习 3：判断四种状态

下面观察各自最多能证明什么？

1. Redis 出现 `route:user:7 -> web-1:gw1`；
2. 客户端收到 HTTP 101；
3. 客户端每 25 秒收到 PONG；
4. `TTL route:user:7` 返回 -2。

<details>
<summary><b>参考答案</b></summary>

1. 证明认证 handler 已写路由；当前注册发生在 101 之前，不能单独证明升级完成。
2. 证明该 HTTP 请求已经成功切换为 WebSocket；不证明路由以后一直存在。
3. 证明当前 Channel 能完成应用层 PING/PONG 往返，也在持续避免读空闲；当前不能证明 Redis route 已续期。
4. -2 表示 key 不存在。若 PONG 仍正常，说明已出现“本机 Channel 活跃、全局路由缺失”的状态。

</details>

### 练习 4：分析认证失败

backend 登录成功，但用 access token 连接网关总是 401。列出至少四项检查。

<details>
<summary><b>参考答案</b></summary>

- 确认传的是 accessToken，不是 refreshToken；
- 检查 token 是否过期、是否在 URL 中被截断或错误编码；
- 核对 backend 和 gateway 实际使用的 JWT secret；
- 核对 gateway 与 backend 是否连接同一 Redis；
- 从 JWT 取 jti 后检查 `auth:access:<jti>` 是否存在；
- 检查用户是否刚登出或会话 TTL 已到期。

</details>

### 练习 5：推演同设备重连竞争

用户 7 的 d1 旧连接 A 尚未完全关闭，新连接 B 已完成 `registry.add(7,d1,B)`。随后 A 触发 `channelInactive`。当前代码会怎样？

<details>
<summary><b>参考答案</b></summary>

A 按 userId/deviceId 执行 remove/unregister，不校验 Map 中的 Channel 是否仍是 A。因此它可能删除 B 刚写入的本机映射和 Redis 路由。B 的 socket 本身可以继续 active，但下行查找和跨网关路由已经丢失。

</details>

### 练习 6：解释登出边界

用户已经建立 WS，随后调用 logout。为什么旧 token 新建连接会失败，而已有连接未必立即断？

<details>
<summary><b>参考答案</b></summary>

logout 删除 `auth:access:<jti>`。新握手会再次调用 GatewayJwtVerifier 查这个 key，因此失败。已有连接已经在握手时把 userId 写入 Channel，并移除了认证 handler；PING/SEND 不再查询 token 或 Redis access session，所以不会自动感知登出，只会在主动关闭、网络异常或读空闲时断开。

</details>

---

## 十六、自检与通过标准

不看文档，尝试回答：

1. 客户端连接 `ws://...` 时，为什么服务端最先收到的还是 HTTP？
2. `ApplicationReadyEvent`、boss、worker、initializer 分别处于什么阶段？
3. 六个 pipeline handler 的顺序和单一职责是什么？
4. 为什么 JWT 验签后还必须查 Redis `auth:access:<jti>`？
5. 为什么认证成功与收到 101 不是同一件事？
6. USER_ID/DEVICE_ID 为什么放 Channel Attribute，而不是相信每帧 JSON？
7. `ChannelRegistry` 与 Redis route 分别保存什么？
8. URI 去 query、移除 handler、retain request 各解决什么问题？
9. 60 秒读空闲怎样最终触发两处清理？
10. 为什么当前 PONG 正常仍可能收不到 PUSH？
11. logout 后新连接和已有连接的行为为什么不同？
12. 同一 deviceId 快速重连存在哪个当前竞争窗口？

<details>
<summary><b>自检参考答案</b></summary>

1. WebSocket 以 HTTP Upgrade 开始。客户端先发送带 Connection/Upgrade、Sec-WebSocket-Key 等头的 HTTP GET，服务端成功后返回 101，之后同一 TCP 连接才切换为 WebSocket Frame。
2. Spring Bean 全部就绪并发布 ApplicationReadyEvent 后，Netty 才 bind 9001；boss accept 新 TCP 连接；worker 管理已连接 Channel 的读写事件；initializer 为每条新 SocketChannel 安装 pipeline。
3. HttpServerCodec 做 HTTP 编解码；Aggregator 拼完整请求；HandshakeAuthHandler 做升级前门禁；WebSocketServerProtocolHandler 完成 `/im` 升级；IdleStateHandler 产生读空闲事件；ImFrameHandler 处理文本业务帧、关闭与清理。
4. 验签只能证明 token 内容由共享 secret 签发且未被篡改/过期；Redis key 代表这次登录尚未撤销。登出、强退或会话 TTL 到期后 key 消失，新握手必须失败。
5. 两者由两个 handler 完成。认证成功后仍可能因为请求不是合法 Upgrade、版本/路径等问题无法返回 101；当前连接和 route 甚至在协议升级前就已登记。
6. Channel Attribute 来自一次可信握手，并与具体 socket 绑定；JSON senderId/deviceId 可由客户端伪造。后续 handler 从 Channel 取真实身份并覆盖消息字段。
7. ChannelRegistry 保存本 JVM 的 userId/deviceId → Channel；Redis 保存跨进程可查的 userId/deviceId → gatewayId。backend 先找网关，目标网关再找本机 Channel。
8. 去 query 让 `/im?...` 恢复为协议 handler 可匹配的 `/im`；移除 handler 结束一次性门禁；retain 抵消 SimpleChannelInboundHandler 返回时的自动 release，把 HttpRequest 所有权安全交给下游。
9. IdleStateHandler 连续 60 秒未读到数据后传播 IdleStateEvent；ImFrameHandler 收到事件调用 close；Channel 失效触发 channelInactive；它删除本机 registry 项和 Redis route field。
10. PING 分支只回复 PONG，没有调用 RouteService.renew。注册时设置的 120 秒 route TTL 会继续下降直至过期，此时 Channel 可活跃，但 backend 无法从 Redis发现目标网关。
11. 新连接会重新验 token 和 Redis access session，所以 logout 后失败；已有连接不再运行认证 handler，也没有周期复核 session，因此不会被自动关闭。
12. 新 Channel B 覆盖同 userId/deviceId 后，旧 Channel A 再断开时会按键无条件 remove/unregister，可能把 B 的映射和路由删掉。

</details>

本章通过标准是：

- 能从 HTTP GET 画到 101，再画到 TextWebSocketFrame；
- 能按顺序写出六个 pipeline handler，并给每个只分配一个核心职责；
- 能解释 JWT、Redis session、Channel Attribute 三者分别证明什么；
- 能说明本机 ChannelRegistry 与全局 Redis route 为什么不能合并；
- 能完整复述注册、心跳、读空闲关闭和 `channelInactive` 双清理；
- 能指出 `retain(req)` 的引用计数原因；
- 能基于源码识别当前 route 未续期、已有连接不复核登录态、同 deviceId 重连清理竞争三个边界。

<details>
<summary><b>通过标准参考产物</b></summary>

**1. 一张握手时序图：**

```text
客户端           AuthHandler        JwtVerifier/Redis      WS Protocol
  │ HTTP Upgrade      │                     │                   │
  ├──────────────────►│ verify(token)       │                   │
  │                   ├────────────────────►│                   │
  │                   │◄────────────────────┤ ok(userId)        │
  │                   │ attr + registry + route                 │
  │                   │ URI=/im, remove self, retain+fire       │
  │                   ├────────────────────────────────────────►│
  │◄────────────────────────────────────────────────────────────┤ 101
  │                 WebSocket established                       │
```

**2. 一张连接状态表：**

| 状态 | 最可靠证据 |
|---|---|
| 端口已监听 | `lsof :9001` + Netty bind 日志 |
| 身份门禁已通过 | Channel 属性/注册动作已发生 |
| WebSocket 已升级 | 客户端收到 HTTP 101 |
| 应用连接可往返 | JSON PING 收到 JSON PONG |
| 全局下行可路由 | Redis route field 存在且目标网关 registry 有 active Channel |
| 连接已清理 | registry 项和 route field 都消失 |

**3. 一条关闭链路：**

```text
客户端关闭 / 网络断开 / IdleStateEvent→close
  → channelInactive
  → registry.remove(userId, deviceId)
  → routeService.unregister(userId, deviceId)
```

**4. 三个当前实现结论：**

```text
PING 能维持读活跃并返回 PONG，但没有刷新 route TTL。
Redis access session 只在握手时检查，登出不会立即踢掉已有连接。
同 userId/deviceId 新连接覆盖后，旧连接迟到的清理可能删除新映射。
```

能说明这些结论来自哪些调用点或缺失调用，而不是只背结果，才算真正通过。

</details>

下一章进入 `04-Redis路由与多端连接.md`：沿着 `route:user:<uid>` 拆开 deviceId → gatewayId、Hash TTL、多网关下行，以及一个设备续期为什么会影响同用户的其他设备。
