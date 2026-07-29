# IM 链接卡片（里程碑 7）Design

> 分支：`feat/im`　|　基线 HEAD：`c8b3b65`（里程碑 1-6 完成）
> 总设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 「分阶段实施里程碑 · 7」
> 本期目标：TEXT 消息里的 URL → OG 抓取（超时 + **SSRF 防护**）→ LINK 卡片；抓不到降级纯文本。

## 一、目标与范围

发送含链接的文本消息后，服务端**异步**抓取该链接的 Open Graph 元数据，成功则把卡片信息补写进这条消息、并向会话在线成员增量推送一帧让客户端就地把纯文本气泡升级为卡片。抓取失败/超时/被安全策略拒绝时不做任何事，消息保持纯文本（天然降级）。

**In scope**
- 仅 `TEXT` 消息；一条消息只取**第一个** `http(s)` URL，最多一张卡。
- 严格白名单式 SSRF 防护（协议/端口/IP 段/逐跳重定向），完整覆盖 IPv4 + IPv6。
- Redis 正/负缓存；专用有界线程池抓取，不阻塞 Kafka 消费线程。
- OG 解析用 jsoup。

**Out of scope（YAGNI，明确排除）**
- 多 URL 多卡；图片下载转存 / 缩略图；非 TEXT 消息（IMAGE/AUDIO/FILE/SYSTEM）识别。
- 撤回联动（里程碑 8）；@提及（里程碑 9）；favicon 抓取；oEmbed。

## 二、整体架构与数据流

```
发送 TEXT ──> InboundMessageConsumer（不变：幂等/成员/禁言/媒体校验）
              └─> MessageAppender.append() 返回 seq=N
                    ── 立即：定序 + 落 Mongo + 更新会话摘要 + PUSH(TEXT)
              └─（append 之后，在 InboundMessageConsumer 里）
                   LinkPreviewService.tryEnrich(cid, seq=N, text)
                     └─ 提交到专用线程池（Kafka 消费线程不阻塞）
                          ├─ UrlExtractor：取 text 第一个 http(s) URL；无 → 结束
                          ├─ Redis GET im:link:og:<sha256(url)>
                          │     命中正缓存 → 用之；命中负缓存 → 放弃（不发 HTTP）
                          ├─ 未命中 → SsrfGuardedFetcher 逐跳抓取 HTML（见 §四）
                          │     └─ OgParser 解析 → LinkCard
                          ├─ 抓成功(title 非空) → 写正缓存 6h
                          │     ① ImMessageRepository.updateLink(cid, seq, card)  ($set body.link)
                          │     ② OutboundDispatcher.dispatch(cid, LINK_PREVIEW 帧)
                          └─ 失败/超时/被拒/title 缺失 → 写负缓存 10min，无操作（纯文本）
```

**触发点**：在 `InboundMessageConsumer.onMessage` 里、`appender.append(...)` 返回后调用 `LinkPreviewService.tryEnrich(cid, seq, text)`。`MessageAppender` 保持纯粹，不感知链接预览。

**读路径**：`body.link` 补写进 Mongo 后天然带在消息里，`pull` / 历史查询无需改动。`link` 不含临时签名 URL（与富媒体 `MediaUrlEnricher` 不同），直接落库、直接回显。

### 新增组件（均在 `com.rbac.im`）

| 组件 | 职责 | 依赖 | 可独立测试点 |
|------|------|------|--------------|
| `LinkPreviewService` (`service`) | 编排：提取→缓存→抓取→回写 Mongo + 扇出；持有线程池 | UrlExtractor / fetcher / parser / repo / dispatcher / redis / props | 缓存命中不抓、抓成功回写+扇出、抓失败写负缓存不扇出、title 缺失判失败 |
| `SsrfGuardedFetcher` (`service`) | 给定 URL：SSRF 校验 + 逐跳抓取 + 体积/超时限制，返回 HTML 或空 | JDK HttpClient；host→IP 解析接口（可注入） | IP 段判定表驱动、端口/协议白名单、逐跳重定向拒内网 |
| `OgParser` (`service`) | 纯函数：HTML(+baseUrl) → `LinkCard` | jsoup | 各种 HTML 片段解析/判失败（零 IO） |
| `UrlExtractor` (`service`) | 纯函数：文本 → 第一个 http(s) URL | — | 多 URL 取首、无 URL、边界字符 |
| `LinkPreviewProperties` (`config`) | `im.link.*` 配置绑定 | — | 默认值/绑定 |
| `LinkCard` (`vo`) | 值对象 record（url/title/description/image/siteName） | — | — |

## 三、消息形态与协议

### `body.link` 数据形态（补写进 TEXT 消息 body，与 `body.text` 并存）
```json
{
  "text": "看看这个 https://example.com/article",
  "link": {
    "url": "https://example.com/article",
    "title": "文章标题",
    "description": "摘要…",
    "image": "https://example.com/og.png",
    "siteName": "Example"
  }
}
```
- `link` **只在抓取成功时写**；抓不到就无此键 → 前端按纯文本渲染（降级）。
- **`title` 为卡片必要字段**：OG `og:title` 与 `<title>` 都取不到 → 视为抓取失败，不写 link。
- `image` / `description` / `siteName` 可空，前端各自兜底。
- 落库前限长：`title` 200、`description` 300、`url` 2048 字符；`url` 取逐跳后的最终落点。

### `LINK_PREVIEW` 增量推送帧（复用 `Envelope` + `OutboundDispatcher.dispatch(cid, env)`）
```json
{ "op": "LINK_PREVIEW", "cid": "c_1_2", "seq": 42, "body": { "link": { ... } } }
```
- **承载方式**：复用 `Envelope` 现有 `body`（`body.link`），**不给 `Envelope` 新增顶层字段**。设 `op=LINK_PREVIEW`、`cid`、`seq`、`body={"link": card}`。
- 语义：客户端按 `cid + seq` 找到本地已渲染的纯文本气泡，就地补 `body.link` 变卡片。**不是新消息，不占新 seq。**
- **扇出范围：整个会话在线成员**（群聊亦然，全员看到同一条消息升级为卡片，体验一致），与 `PUSH` 共用 `dispatch(cid, …)`。
- 更新帧可能晚于用户后续消息到达客户端；它带 `seq` 精确定位，不依赖到达顺序。

### 网关侧：零改动透传
`im-gateway` 的 `OutboundConsumer` 把 `packet.getEnvelope()` 整体序列化后 `writeAndFlush` 给客户端，**对 `op` 完全无感知**——新的 `LINK_PREVIEW` 帧与既有 `PUSH`/`ERROR` 走同一条 `im-outbound` → 网关 → WebSocket 路径，**网关无需任何改动**。客户端（联调侧）需新增识别 `op=LINK_PREVIEW`、按 `cid+seq` 就地更新气泡的渲染逻辑；本期后端只负责产出该帧。

### Mongo 回写
`ImMessageRepository` 新增 `updateLink(cid, seq, LinkCard card)`：按 `cid + seq` 定位文档，`$set` 更新 `body.link` 单字段（不用 `save` 整档覆盖，避免与其它并发更新打架）。

## 四、SSRF 防护 + 抓取（`SsrfGuardedFetcher`）

用 JDK 内置 `java.net.http.HttpClient`，**`.followRedirects(NEVER)`**——自己逐跳，才能对每一跳真实目标 IP 重新校验（自动跟随会让 302 到内网绕过一切前置检查）。

### 校验链（每一跳都完整跑一遍）
1. **协议**：∈ `{http, https}`，否则拒（挡 file/gopher/ftp/data…）。
2. **主机解析**：IP 字面量 → 直接进第 4 步；域名 → `InetAddress.getAllByName(host)` 取所有 A/AAAA。
3. **端口白名单**：仅 80/443（含协议默认端口）；显式非默认端口一律拒。
4. **逐个 IP 判定，任一命中危险段即整体拒**：
   - IPv4：`0/8`、`10/8`、`100.64/10`(CGNAT)、`127/8`、`169.254/16`(链路本地/云元数据)、`172.16/12`、`192.0.0/24`、`192.168/16`、`198.18/15`、`224/4`(组播)、`240/4`(保留)
   - IPv6：`::1`(回环)、`::`(未指定)、`fc00::/7`(ULA)、`fe80::/10`(链路本地)、`::ffff:0:0/96`(IPv4-mapped → 拆出内嵌 v4 再按 IPv4 判)、`64:ff9b::/96`(NAT64 → 拆 v4 判)
   - 兜底：`InetAddress` 的 `isLoopbackAddress/isLinkLocalAddress/isSiteLocalAddress/isMulticastAddress/isAnyLocalAddress`
5. **防 DNS rebinding**：用**第 2 步已校验通过的那个 IP** 发起连接，而非把 host 再交给 HttpClient 重新解析一次（两次解析之间 DNS 可被改成内网）。`Host` 头 / SNI 保留原域名。

### 逐跳重定向
收到 3xx → 读 `Location` → 解析成绝对 URL → **对新 URL 从第 1 步重新全套校验** → 最多跟随 **3 跳**，超出即放弃（返回空 = 降级）。

### 抓取限制
- 连接超时 + 请求超时各 2s（`im.link.*` 可配）。
- 响应体**流式读、边读边计数、超上限即中断**（默认 512KB）——不信 `Content-Length`。
- 仅处理 `Content-Type: text/html`（或无类型时试探）；其它类型（图片/PDF）直接不解析。
- 固定 UA `RBAC-IM-LinkBot/1.0`，带 `Accept-Language`。

## 五、配置、线程池、缓存、错误处理

### `LinkPreviewProperties`（`im.link.*`）
```yaml
im:
  link:
    enabled: true            # 总开关，可整期禁用
    connect-timeout-ms: 2000
    request-timeout-ms: 2000
    max-body-bytes: 524288   # 512KB
    max-redirects: 3
    allowed-ports: [80, 443]
    user-agent: "RBAC-IM-LinkBot/1.0"
    cache-ttl-ok: 6h
    cache-ttl-fail: 10m      # 负缓存，防反复打死链
    pool-core: 2
    pool-max: 4
    pool-queue: 100          # 有界队列
```

### 线程池
`LinkPreviewService` 内建 `ThreadPoolExecutor`（core/max + 有界队列 + **`DiscardPolicy`**：队列满直接放弃预览，消息已发出、降级即可，宁可不出卡也不拖住 Kafka）。`@PreDestroy` 优雅关闭。

### 缓存（Redis，复用现有 `StringRedisTemplate`/Lettuce）
- key：`im:link:og:<sha256(normalizedUrl)>`
- 命中正缓存 → 直接补写 + 扇出；命中负缓存（sentinel，如 `"FAIL"`）→ 直接放弃，不发 HTTP。
- 抓成功写正缓存 TTL 6h；失败/被拒/超时写负缓存 TTL 10min。
- 值用 JSON 序列化 `LinkCard`。

### 错误处理原则
`LinkPreviewService` 的整个异步任务用一个 `try/catch(Throwable)` 兜住：任何异常只 `log.debug/warn` + 写负缓存，**绝不外抛**（独立线程池里抛了没人接、还污染日志）。消息发送主链路完全不受影响。

## 六、测试策略

沿用 `spring-boot-starter-test`，以纯单测为主，不依赖真实外网。

- **`OgParserTest`**（纯函数，零 IO）：完整 og / 只有 `<title>` / 畸形 / 无 head / 相对 image URL 绝对化 / title 缺失判失败。
- **`SsrfGuardTest`**（本期最重要）：把「host→IP 解析」和「连接」抽成可注入接口，表驱动喂 `127.0.0.1` / `169.254.169.254` / `10.x` / `192.168.x` / `::1` / `::ffff:169.254.169.254` / `64:ff9b::a9fe:a9fe` / 公网 IP / 非默认端口 / 非 http 协议 / 3xx 指向内网 → 断言拒绝或放行。
- **`UrlExtractorTest`**：多 URL 取首、无 URL、URL 带中文/标点边界。
- **`LinkPreviewServiceTest`**：mock fetcher/repo/dispatcher/redis → 缓存命中不抓、抓成功回写 Mongo + 扇 LINK_PREVIEW、抓失败写负缓存不扇出、title 缺失判失败。
- **（可选，不进默认构建）** `LinkPreviewFetcherIT`：用 MockWebServer/WireMock 起本地服务验证逐跳重定向拒内网、体积截断、超时。与既有 `S3MediaStorageIT` 同款（`*IT.java` 命名，不在 Surefire 默认匹配内）。

## 七、依赖变更

- 新增 `org.jsoup:jsoup`（HTML 解析）。
- 复用：`spring-boot-starter-web`（JDK HttpClient 亦为 JDK 内置）、`spring-boot-starter-data-redis`（缓存）。
- 无新增中间件、无新增环境变量（区别于富媒体那期）。

## 八、验证方式（端到端）

- 起中间件：`cd deploy && docker compose --profile im --profile full up -d`。
- 发含公网 URL 的 TEXT → 先收到纯文本 `PUSH`，随后收到 `LINK_PREVIEW` 帧，客户端把该 seq 气泡升级为卡片。
- 发含 `http://169.254.169.254/…` / `http://127.0.0.1/…` / `http://10.0.0.1/…` 的 TEXT → **只收到纯文本，无 LINK_PREVIEW**（被 SSRF 拒），服务器无对内网/元数据的外发请求。
- 发无法解析 OG 的普通页面（无 title）→ 保持纯文本。
- 同一 URL 二次发送 → 命中缓存，不重复发 HTTP。

## 九、已决策汇总

1. 抓取时机：**异步补写 + 增量推送**（消息立即以 TEXT 投递，绝不被外站拖慢）。
2. SSRF：**严格白名单式**，完整 IPv4 + IPv6 清单，逐跳重定向重校验，防 DNS rebinding。
3. 范围：仅 TEXT，取第一个 URL，最多一张卡。
4. 缓存：Redis 正/负缓存；抓取走专用有界线程池，满载 `DiscardPolicy`。
5. `title` 缺失即判抓取失败，不写 link。
6. HTML 解析加 jsoup 依赖。
