# 04 · 反向代理与 upstream

> 目标：读透 `location /api/` 那 6 行，搞清一个请求是怎么从 nginx 转到 Spring Boot 的。
>
> 读完你能：
> - 解释 `proxy_pass` 带不带尾斜杠的**根本差异**，并说清本项目为什么必须不带。
> - 说出四个 `proxy_set_header` 各自解决什么问题，不设会怎样。
> - 指出本项目一行**真实存在、已被记录在案、目前恰好没爆**的问题。
> - 区分 502 和 504 的成因，并知道拿到这两个码时该查哪儿。
> - 说清 `upstream` 的负载均衡策略，以及本项目为什么"只有一台也要写 upstream"。

---

## 一、承上：第二副面孔开工

`03` 把**发静态文件**那条链路讲完了。现在是另一条：

```nginx
    # 后端 RBAC 服务（容器网络里用服务名 backend 直连）
    upstream rbac_backend {
        server backend:8080;
    }
    ...
        # 接口请求反代给后端（后端 context-path 是 /api，原样转发）
        location /api/ {
            proxy_pass http://rbac_backend;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
```

**一个关键的分岔点**：`03` 讲的 `location /` 走的是"查磁盘"这条路，而 `location /api/` 一旦执行 `proxy_pass`，就**彻底不碰磁盘了**。

这解释了 `01` 练习 3 留的那个伏笔：`location /api/` 也从 server 层继承到了 `root /usr/share/nginx/html`，但它**永远用不上**——`proxy_pass` 把请求转走了，压根没有"找文件"这一步。

> 🔑 **继承来的指令不一定会被用到。** 一个 location 走静态路径还是代理路径，取决于里面有没有 `proxy_pass`。有了它，`root`、`index`、`try_files`、`sendfile` 全部失去意义。

---

## 二、`upstream`：定义后端在哪

```nginx
upstream rbac_backend {
    server backend:8080;
}
```

### 2.1 `backend` 这个名字凭什么能解析

`backend` 不是域名，不是 IP，它是 **compose 里的服务名**（`deploy/docker-compose.yml:65`）。

它能被解析，靠的是 Docker 的**内嵌 DNS**：compose 把所有服务放进同一个自定义网络（本项目是 `rbac-net`），在这个网络里，**服务名就是域名**，Docker 内置的 DNS 服务器负责把它解析成容器的内网 IP。

（这套机制 `learning-docker 04 §2.4` 已经精读过，这里只回指不重复。）

这就是为什么 `frontend` 和 `backend` 两个服务都必须写 `networks: [rbac-net]`——不在同一个网络里，这个名字就解析不了，直接 502。

**对比一下遗留配置**（`deploy/config/nginx/nginx.conf:19`）：

```nginx
server host.docker.internal:8080;    # ← 完全不同的东西
```

`host.docker.internal` 是 Docker Desktop 提供的一个特殊域名，指向**宿主机**。那份配置写于"后端还跑在宿主机上、不在容器里"的年代。这两个名字的差异，是本项目部署演进的化石证据，`06` 会把整条时间线挖出来。

### 2.2 只有一台，为什么还要写 upstream

`upstream` 块里就一行 `server backend:8080;`。完全可以省掉它，直接写：

```nginx
location /api/ {
    proxy_pass http://backend:8080;    # ← 直接写地址，不要 upstream
}
```

**功能上完全等价。** 那为什么还要多此一举？三个理由：

1. **给它起了个名字**。`rbac_backend` 这个名字比 `backend:8080` 有语义——它说的是"RBAC 后端服务"这个**角色**，而不是"某个主机的某个端口"这个**地址**。

2. **扩展点在这儿了**。哪天要加第二个后端实例，只需要在 upstream 里加一行：

   ```nginx
   upstream rbac_backend {
       server backend:8080;
       server backend2:8080;    # ← 加一行就是负载均衡
   }
   ```
   `location` 里**一个字都不用改**。而如果当初写死了 `proxy_pass http://backend:8080`，就得改 location（如果有多个 location 用到它，就得改多处）。

3. **upstream 独有的能力**：`keepalive`、负载均衡策略、健康检查、`proxy_next_upstream` 这些**只能写在 upstream 块里**。不写 upstream 就永远用不上它们（第六节会讲本项目因此漏掉了什么）。

> 🔑 `upstream` 的价值不在"有几台"，在于**把"后端在哪"这个决策收敛到一个地方**。这是接口和实现分离的思路——location 只说"转给 rbac_backend 这个角色"，至于这个角色由谁扮演、几个人扮演、怎么分配，全在 upstream 里说了算。

### 2.3 一个要命的细节：DNS 只解析一次

这是 nginx 反代容器时的经典陷阱，值得提前知道：

**`upstream` 里的域名，nginx 只在启动（或 reload）时解析一次，然后把 IP 缓存住，永不重解析。**

在容器环境里这很危险：容器重建后 IP 会变（Docker 分配的内网 IP 不固定）。所以：

```
① nginx 启动，解析 backend → 172.18.0.5，记住
② backend 容器被重建（up -d --build）→ 新容器 IP 变成 172.18.0.8
③ nginx 还在往 172.18.0.5 发请求 → 【502，而且永远不会自愈】
```

**本项目为什么没被这个坑到？** 因为 `docker compose up -d --build` 时，`frontend` 通常也会被一起重建/重启（依赖关系 + compose 的重建策略），nginx 跟着重启，就重新解析了。属于**歪打正着**。

真要根治，得用 `resolver` 指令强制动态解析：

```nginx
resolver 127.0.0.11 valid=10s;    # Docker 内嵌 DNS 的固定地址
set $backend_host backend;
proxy_pass http://$backend_host:8080;   # ← 用变量，会走动态解析
```

（关键是 `proxy_pass` 里**用了变量**，这会强制 nginx 每次重新解析。这是个 nginx 的行为怪癖：写死的域名只解析一次，带变量的才动态解析。）

本项目没配这个，属于**已知但可接受**的风险——单机部署，容器一起重建，撞上的概率低。但如果哪天 backend 单独重启而 frontend 不重启，就会踩到。

---

## 三、`proxy_pass` 的尾斜杠（nginx 头号事故来源）

```nginx
location /api/ {
    proxy_pass http://rbac_backend;    # ← 注意：【没有】尾斜杠
}
```

这一行是本节、也可能是全系列**最重要**的一行。

### 3.1 两种模式

`proxy_pass` 的行为由一件事决定：**它的值里有没有 URI 部分**（也就是主机名后面跟没跟路径）。

```nginx
proxy_pass http://rbac_backend;      # ← 没有 URI 部分  →【不改路径】模式
proxy_pass http://rbac_backend/;     # ← 有 URI 部分（那个 /）→【替换路径】模式
```

**注意：那个孤零零的 `/` 就算"有 URI 部分"。** 这是最坑人的地方——一个字符决定两种完全不同的行为。

规则：

| | 写法 | 转发给后端的路径 |
|---|---|---|
| **无 URI 部分** | `proxy_pass http://rbac_backend;` | **原样转发完整 URI** |
| **有 URI 部分** | `proxy_pass http://rbac_backend/;` | **把 location 前缀替换成这个 URI** |

### 3.2 对比实验

请求 `GET /api/users`，location 是 `/api/`：

```nginx
# 本项目的写法（无尾斜杠）
location /api/ {
    proxy_pass http://rbac_backend;
}
# → 转发给后端的是：/api/users        ← 完整 URI，原样不动 ✔
```

```nginx
# 手滑加了个斜杠
location /api/ {
    proxy_pass http://rbac_backend/;
}
# → nginx 把 location 前缀 /api/ 从 URI 里【剥掉】，换成 proxy_pass 里的 /
# → /api/users  减去 /api/  =  users
# → 拼上斜杠  →  转发给后端的是：/users     ← /api 没了！ ✘
```

**同一个请求，两个完全不同的后端路径。**

### 3.3 本项目为什么必须不带斜杠

关键在后端的 **context-path**。看 `frontend/nginx.conf:31` 那句注释，写得明明白白：

```nginx
# 接口请求反代给后端（后端 context-path 是 /api，原样转发）
```

Spring Boot 的 `context-path` 配的是 `/api`（`CLAUDE.md` 里也写着"统一前缀 `/api`"）。这意味着**后端自己就期望收到带 `/api` 前缀的路径**：

```
后端注册的真实路径：  /api/users
                      /api/auth/login
                      /api/roles
```

所以链路必须是：

```
浏览器 GET /api/users
   ↓ nginx 【原样转发】（不带斜杠的功劳）
backend 收到 /api/users
   ↓ Spring Boot 的 context-path=/api 把它匹配到 UserController 的 /users
   ✔ 命中
```

**如果手滑加了斜杠**：

```
浏览器 GET /api/users
   ↓ nginx 剥掉 /api/，转发 /users
backend 收到 /users
   ↓ Spring Boot 期望 /api 开头 → 【匹配不上任何 Controller】
   ✘ 404
```

**症状**：所有 API 全部 404，但**静态页面完全正常**（因为 `location /` 那条路没受影响）。用户能打开登录页，一点登录就报错。

> 🔑 **本项目 `proxy_pass` 不带尾斜杠，和后端 `context-path=/api` 是一对必须配套的设计。** 两边约定了"路径原样传递"这个契约。改任何一边而不改另一边，API 全挂。这也是为什么那行注释里特意写了"后端 context-path 是 /api，**原样转发**"——它在提醒后来人：**这里的"没有斜杠"是故意的，别手贱**。

### 3.4 为什么这个坑特别阴险

三重叠加：

1. **视觉上几乎看不见**。`http://rbac_backend` 和 `http://rbac_backend/` 差一个字符，code review 时极易滑过去。
2. **`nginx -t` 完全不会报错**。两种写法**语法都合法**——这是"配置正确但行为错误"的典型，`01` 练习 5 讲过 `nginx -t` 只查语法不查逻辑，这就是那个论断的实例。
3. **症状离原因很远**。你看到的是"后端 404"，第一反应是去查 Spring Boot 的路由、Controller 注解、context-path 配置——查半天后端，问题却在 nginx 的一个斜杠上。

**记忆方法**（比背规则管用）：

> **`proxy_pass` 后面跟了路径（哪怕只是一个 `/`），nginx 就会做"路径替换"；什么都不跟，就是"原样转发"。**

### 3.5 什么时候该带斜杠

带斜杠不是错，它有正当用途——**当后端不期望前缀时**。

假设后端是个没有 context-path 的服务，它的接口就是 `/users`、`/roles`，但你想让外部通过 `/api/users` 访问：

```nginx
location /api/ {
    proxy_pass http://some_backend/;    # ← 这时候【必须】带斜杠
}
# /api/users → 剥掉 /api/ → /users → 后端正好期望这个 ✔
```

**所以带不带斜杠，取决于后端期望什么，不存在"哪个更对"。**

| 后端的 context-path | `proxy_pass` 该怎么写 |
|---|---|
| `/api`（本项目） | `http://rbac_backend;` **不带斜杠**（原样转发，前缀留着） |
| 无（后端就是 `/users`） | `http://rbac_backend/;` **带斜杠**（剥掉前缀） |

---

## 四、四个 `proxy_set_header`

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### 4.1 为什么需要它们

反向代理有个**固有的信息损失**问题：

```
浏览器 ──► nginx ──► backend
        ↑          ↑
   nginx 知道：   backend 只知道：
   - 真实客户端 IP    - 请求来自 nginx（172.18.0.x）
   - 用户访问的域名   - Host 是啥？（取决于 nginx 怎么发）
   - 用的是 HTTPS     - 协议？它自己收到的是 http
```

**backend 看到的"客户端"是 nginx，不是真实用户。** 所有关于真实用户的信息，如果 nginx 不主动带上，就永远丢了。

这四行就是在**手动补回这些信息**，通过自定义请求头传给后端。

### 4.2 `Host $host`

```nginx
proxy_set_header Host $host;
```

**不设会怎样**：nginx 默认会把 `Host` 设成 **`proxy_pass` 里的那个值**，也就是 `rbac_backend`（upstream 的名字！）。后端会收到：

```http
Host: rbac_backend        ← 一个根本不存在的域名
```

**后果**：任何依赖 `Host` 的后端逻辑全部失灵——生成绝对 URL（重定向、邮件里的链接）会指向 `http://rbac_backend/...`，用户点了就打不开；多租户按域名路由的逻辑会崩；Spring Security 某些配置也会受影响。

`$host` 这个变量的取值规则（按优先级）：

1. 请求行里的主机名（罕见）
2. **请求头 `Host` 的值**（绝大多数情况）
3. 与请求匹配的 `server_name`（前两个都没有时）

所以 `Host $host` 的效果是：**把客户端发来的 Host 原样透传**。用户访问 `www.eureka32.top`，后端就看到 `www.eureka32.top`。

**注意 `$host` vs `$http_host` 的区别**（面试常考）：

| 变量 | 值 | 端口 |
|---|---|---|
| `$host` | Host 头的**主机名部分**，小写，**去掉端口** | ❌ 不含 |
| `$http_host` | Host 头的**原始值**，一字不改 | ✅ 含（如果客户端带了） |

本项目用 `$host` 更稳——它做了规范化（小写、去端口），且在客户端没发 Host 头时能回落到 `server_name`（虽然 HTTP/1.1 强制要求 Host，但畸形请求是存在的）。

### 4.3 `X-Real-IP $remote_addr`

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

`$remote_addr` 是 **nginx 看到的直连客户端 IP**。

**这个头对本项目有直接的业务价值**：RBAC 系统有**操作日志**模块（`CLAUDE.md` 里的包结构有 `system.log`），要记录"谁在什么 IP 干了什么"。如果没有这个头，后端记录的 IP 全都是 nginx 容器的内网 IP（`172.18.0.x`）——**每一条日志的 IP 都一样，这个字段直接失去意义**。

**但这里有个本项目特有的严重问题**，必须讲清楚：

```
真实链路：浏览器(1.2.3.4) → caddy(172.18.0.6) → nginx(172.18.0.5) → backend
                                                  ↑
                                    nginx 的 $remote_addr = 172.18.0.6（caddy 的 IP）
                                    【不是 1.2.3.4！】
```

**nginx 的直连客户端是 caddy，不是浏览器。** 所以 `X-Real-IP` 传给后端的是 **caddy 的内网 IP**，而不是真实用户 IP。

除非 caddy 把真实 IP 传下来，而 nginx 再把它转出去。caddy 的 `reverse_proxy` 默认**会**设置 `X-Forwarded-For`（这是 caddy 的默认行为），但 nginx 这行 `X-Real-IP $remote_addr` **写死了用 `$remote_addr`**，把 caddy 传下来的信息**覆盖**掉了。

> 🔑 **多层代理下，`$remote_addr` 只是"上一跳"，不是"最初的客户端"。** 每加一层代理，`$remote_addr` 就往后退一格。本项目有两层（caddy + nginx），所以 nginx 眼里的"客户端"是 caddy。这是 `X-Forwarded-For` 存在的全部理由——见下一节。

### 4.4 `X-Forwarded-For $proxy_add_x_forwarded_for`

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

**这个变量名很长，但语义极其精确**：

```
$proxy_add_x_forwarded_for  =  【客户端传来的 X-Forwarded-For】 + ", " + 【$remote_addr】
                                        ↑ 如果没有就是空                    ↑ 上一跳的 IP
```

也就是**追加**，不是覆盖。这让它能在多层代理下累积出一条完整的路径：

```
① 浏览器(1.2.3.4) 发请求，没有 XFF 头
② caddy 收到，$remote_addr=1.2.3.4，设置：
   X-Forwarded-For: 1.2.3.4
③ nginx 收到，$remote_addr=172.18.0.6（caddy），$proxy_add_x_forwarded_for =
   "1.2.3.4" + ", " + "172.18.0.6" = "1.2.3.4, 172.18.0.6"
   设置：X-Forwarded-For: 1.2.3.4, 172.18.0.6
④ backend 收到：
   X-Forwarded-For: 1.2.3.4, 172.18.0.6
                     ↑ 最左边是真实客户端    ↑ 中间各跳
```

**所以 `X-Forwarded-For` 保住了 `X-Real-IP` 丢掉的信息。** 后端要拿真实用户 IP，应该读 XFF 的**最左边第一个**，而不是读 `X-Real-IP`。

**但 XFF 有个致命弱点：它可以被伪造。**

```
攻击者直接发：
GET /api/users
X-Forwarded-For: 8.8.8.8        ← 我自己编的

→ caddy 收到，追加自己看到的 IP：
X-Forwarded-For: 8.8.8.8, 1.2.3.4(攻击者真实IP)
→ nginx 再追加：
X-Forwarded-For: 8.8.8.8, 1.2.3.4, 172.18.0.6

→ 后端如果傻乎乎读"最左边第一个" → 认为客户端是 8.8.8.8 ✘
```

> 🔑 **`X-Forwarded-For` 的最左边是"客户端自称的"，不是"验证过的"。** 任何人都能在请求里塞一个假的 XFF。安全的读法是**从右往左数**，跳过你信任的代理跳数（本项目是 2 跳：nginx + caddy），取第一个不受信任的——而不是无脑取最左。
>
> 这条对本项目直接相关：**如果操作日志里的 IP 是用来审计和追责的，那它必须不可伪造**。用 XFF 最左边 = 允许攻击者往审计日志里写任意 IP，栽赃嫁祸。

### 4.5 `X-Forwarded-Proto $scheme`——本项目的真实问题

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

`$scheme` 是 **nginx 自己这一跳收到的协议**——`http` 或 `https`。

意图很明确：告诉后端"用户原本用的是 HTTPS 还是 HTTP"。

**但在本项目里，这一行是错的。**

看链路（`00 §3.1` 的图）：

```
浏览器 ──HTTPS:443──► caddy ──【明文 http】──► nginx ──► backend
                       ↑ TLS 在这里终结        ↑
                                       nginx 收到的是 http
                                       所以 $scheme = "http"  【永远】
```

**caddy 做了 TLS 终结**（这是它的核心职责，`00 §6` 讲过）。它解密之后，用**明文 HTTP** 转发给 nginx。所以 nginx 的 `$scheme` **恒为 `http`**，永远不可能是 `https`。

结果：

```
用户访问 https://www.eureka32.top/api/users   （明明是 HTTPS）
   ↓
backend 收到 X-Forwarded-Proto: http          ← 错的！
```

**这不是我发现的新问题，项目文档里已经记录在案了。** `docs/ops/02-域名与HTTPS配置.md:97` 原文：

> - **X-Forwarded-Proto**：Caddy → frontend 是内网 http，后端收到的协议头是 `http`。当前用 JWT 放请求头（非 Cookie），不受影响；日后若接入依赖「是否 HTTPS」的功能（Secure Cookie、生成绝对回调 URL），需在 nginx 层透传真实协议。

**当前为什么没爆**：本项目的认证用 **JWT 放在请求头**里，不依赖 Cookie，所以后端压根不关心"是不是 HTTPS"。这个错误的头传过去，**没有任何代码去读它**。

**什么时候会爆**——两个具体场景：

1. **Secure Cookie**：如果哪天改用 Cookie 存 token 并加 `Secure` 标记，Spring Security 会检查 `X-Forwarded-Proto`。它看到 `http` → 认为连接不安全 → **拒绝下发 Secure Cookie** → 登录直接失效。
2. **生成绝对 URL**：任何需要后端拼出完整链接的功能（邮件里的重置密码链接、OAuth 回调地址、文件下载的绝对路径），Spring 会用 `X-Forwarded-Proto` 判断协议 → 生成 `http://www.eureka32.top/...` → 用户点了要么被浏览器拦（混合内容），要么被 caddy 301 跳转（多一跳），OAuth 回调则会因为**协议不匹配直接失败**。

**怎么修**（整改建议，本系列不动手）：

需要**两边配合**：

```
① caddy 侧：Caddy 的 reverse_proxy 【默认就会】设置 X-Forwarded-Proto: https
   （所以 caddy 那边不用改）

② nginx 侧：不要用 $scheme（那是 nginx 自己收到的协议），
   改用【caddy 传下来的那个头】：
```

```nginx
# 改法：优先用上游传来的，没有才回落到自己的 $scheme
map $http_x_forwarded_proto $real_scheme {
    default $http_x_forwarded_proto;
    ""      $scheme;                    # caddy 没传时回落
}
...
proxy_set_header X-Forwarded-Proto $real_scheme;
```

（`$http_x_forwarded_proto` 是 nginx 读取请求头的通用形式：`$http_` + 头名小写、连字符换下划线。）

> 🔑 **`$scheme` 是"我这一跳收到的协议"，不是"用户用的协议"。** 在 TLS 终结发生在更外层的架构里，`$scheme` 必然是 `http`，用它设 `X-Forwarded-Proto` 是**语义错误**。正确做法是透传上游传来的值。这个坑在"caddy/ALB/CDN + 内层 nginx"的架构里极其普遍。

### 4.6 一个杀伤力惊人的继承坑

`01 §4.3` 讲继承时留了个伏笔，现在还：

**`proxy_set_header` 的继承规则是"整体覆盖"，不是"合并"。**

```nginx
http {
    proxy_set_header X-Global "foo";      # ← 写在 http 层

    server {
        location /api/ {
            proxy_set_header Host $host;   # ← 这里写了【任何一条】 proxy_set_header
            # → http 层那条 X-Global 【完全失效】！不是叠加，是替换整组
        }
    }
}
```

**规则**：nginx 在某一层找到**任何一条** `proxy_set_header` 时，**该层级的整组设置会完全取代上层的整组**，而不是合并。

**本项目为什么没事**：四条 `proxy_set_header` **全都写在同一个 location 里**，上层（http、server）一条都没写。所以不存在被覆盖的问题。

**但这是个陷阱**：哪天有人想"给所有请求加个通用头"，于是在 `http` 层加一条：

```nginx
http {
    proxy_set_header X-Request-ID $request_id;   # ← 好心加的
    ...
    location /api/ {
        proxy_set_header Host $host;              # ← 这里有 proxy_set_header
        proxy_set_header X-Real-IP $remote_addr;
        ...
        # → X-Request-ID 【不会生效】！
    }
}
```

那个 `X-Request-ID` **静默失效**——不报错、`nginx -t` 通过、日志里什么都没有，就是后端收不到。查起来极其痛苦。

**解药**：要么把通用头**也写进每个 location**，要么用 `include` 把公共头抽成一个文件在每个 location 里引入：

```nginx
location /api/ {
    include /etc/nginx/proxy_headers.conf;    # 把四条 + 通用头都放这儿
    proxy_pass http://rbac_backend;
}
```

---

## 五、502 和 504：反代最常见的两个错误

反向代理链路一出问题，几乎总是这两个码。**它们的成因完全不同，查的地方也完全不同**。

### 5.1 对比

| | **502 Bad Gateway** | **504 Gateway Timeout** |
|---|---|---|
| 含义 | **连不上**上游，或上游给了个无效响应 | **连上了，但等太久没回应** |
| 典型原因 | 上游没启动 / 端口不对 / DNS 解析失败 / 上游崩溃 / 上游主动断连 | 上游卡住了 / 慢 SQL / 死锁 / 线程池耗尽 |
| 发生时机 | 建连阶段（快，通常毫秒级） | 超时之后（慢，默认 60 秒） |
| 该查谁 | **上游在不在、地址对不对** | **上游为什么慢** |
| 本项目对应 | backend 容器没起 / `backend:8080` 解析不了 / 不在同一网络 | 某个接口有慢 SQL / Hikari 连接池耗尽 |

### 5.2 本项目会 502 的几个真实场景

**场景 A：backend 还没起来**

这是最常见的，而且**是设计允许的**。看 compose：

```yaml
  frontend:
    depends_on:
      - backend        # ← 普通写法，只等"启动"，不等"就绪"
```

对比 backend 自己的：

```yaml
  backend:
    depends_on:
      mysql:
        condition: service_healthy    # ← 严格写法，等 healthy
      redis:
        condition: service_healthy
```

**`frontend` 用的是宽松的普通 `depends_on`，为什么？**

`learning-docker 04` 已经分析过这个设计：因为 **nginx 连不上上游只会返回 502，不会崩溃**。所以 frontend 可以先起来，这段时间访问 API 会 502，等 backend 就绪后**自动恢复**——不需要任何人干预。

而 backend 如果 mysql 没好就启动，Spring Boot **会直接启动失败退出**（连不上数据源），所以它必须用 `condition: service_healthy` 严格等待。

> 🔑 **502 在本项目是"可自愈"的**：backend 一就绪，下一个请求就正常了。所以刚 `up -d --build` 完的头十几秒 API 报 502 是**正常现象**，不是故障。这也正是 frontend 敢用宽松 `depends_on` 的底气。

**场景 B：DNS 解析不了 `backend`**

如果 `frontend` 和 `backend` 不在同一个网络里，`backend` 这个名字压根解析不出来 → 502。

排查：`docker exec rbac-frontend ping backend`（不过 nginx 镜像可能没装 ping；`getent hosts backend` 更靠谱）。

**场景 C：用错了配置文件**

如果线上跑的是 `deploy/config/nginx/nginx.conf` 那份（upstream 指向 `host.docker.internal:8080`），那**必然 502**——因为宿主机上根本没有 8080（`docker-compose.yml:87` 那行注释写着"不映射 8080 到宿主机"）。

`learning-docker 07:459` 排 502 时的原话就是：**"那两个 nginx.conf 别弄混"**。

### 5.3 超时相关的配置（本项目全没配）

504 是等超时才发生的，而"等多久"由这三个配置决定：

```nginx
proxy_connect_timeout 60s;    # 建连超时（连不上上游要等多久才放弃）
proxy_send_timeout    60s;    # 发送请求超时
proxy_read_timeout    60s;    # 【最重要】等上游响应的超时
```

**本项目一个都没配，全用默认值 60 秒。**

`proxy_read_timeout` 是最该关注的一个：**它决定了"后端处理多久算超时"**。

对本项目：60 秒对一个后台管理系统的常规接口来说**过于宽松**了——正常接口应该在几百毫秒内返回，跑满 60 秒说明后端已经出大问题了。但也有例外：如果有导出报表、批量导入这类重接口，60 秒可能**不够**。

这是个"**没配就是默认，默认未必合适**"的典型。要不要调，取决于最慢的那个接口需要多久——本项目暂时没有已知的长耗时接口，所以保持默认没问题。

---

## 六、补课：本项目没用上的 upstream 能力

`§2.2` 说过 upstream 独有一些能力。本项目一个都没用，但它们正是 nginx 反代的另一半价值。

### 6.1 负载均衡策略

upstream 里写多个 `server` 就自动负载均衡了：

```nginx
upstream rbac_backend {
    server backend1:8080;
    server backend2:8080;
    server backend3:8080;
}
```

分配策略：

| 策略 | 写法 | 行为 | 适用 |
|---|---|---|---|
| **轮询**（默认） | 不写任何东西 | 依次轮流 | 各实例性能相近 |
| **加权轮询** | `server backend1:8080 weight=3;` | 按权重分配 | 机器配置不一样 |
| **least_conn** | `least_conn;` | 给当前连接数最少的 | 请求耗时差异大 |
| **ip_hash** | `ip_hash;` | 按客户端 IP 哈希，同一 IP 固定到同一台 | 需要会话粘性 |
| **hash** | `hash $request_uri;` | 按指定变量哈希 | 自定义粘性规则 |

**对本项目的意义**：如果哪天要扩到多实例，**`ip_hash` 是不需要的**——因为本项目用 **JWT**（无状态），任何实例都能处理任何请求，不需要会话粘性。这是无状态认证的一个直接好处：**水平扩展时不用操心会话保持**。

（如果用的是传统 Session，就必须要么 `ip_hash`，要么把 session 存进 Redis。本项目选 JWT，等于提前避开了这个问题。）

**另外两个有用的参数**：

```nginx
upstream rbac_backend {
    server backend:8080 max_fails=3 fail_timeout=30s;
    #                   ↑ 30 秒内失败 3 次，就把它标记为不可用，暂停 30 秒不给它发请求
    server backend2:8080 backup;
    #                    ↑ 备用机：只有主的全挂了才启用
}
```

`max_fails` / `fail_timeout` 是 nginx 内置的**被动健康检查**——它不主动探测，只是根据实际转发的失败次数来摘除节点。（主动健康检查 `health_check` 是 nginx Plus 商业版功能，开源版没有。）

### 6.2 `keepalive`：本项目真实漏掉的一个优化

`02 §4.3` 埋了个扣，现在还：

**nginx 到 backend 这一段，本项目没有任何连接复用。**

```nginx
upstream rbac_backend {
    server backend:8080;
    # ← 这里没有 keepalive
}
```

**后果**：每一个 `/api/**` 请求，nginx 都要**新建一条到 backend 的 TCP 连接**，用完就关。

```
请求1: 三次握手 → 发请求 → 收响应 → 四次挥手
请求2: 三次握手 → 发请求 → 收响应 → 四次挥手     ← 又来一遍
请求3: 三次握手 → ...
```

每个请求白白多花一个 RTT 的握手，还给两边都留下大量 `TIME_WAIT` 状态的连接（这会消耗端口和内存）。

**该怎么配**：

```nginx
upstream rbac_backend {
    server backend:8080;
    keepalive 32;                    # ← 保持 32 条空闲长连接备用
}

location /api/ {
    proxy_pass http://rbac_backend;
    proxy_http_version 1.1;          # ← 【必须】！默认是 1.0，1.0 不支持 keep-alive
    proxy_set_header Connection "";  # ← 【必须】！清掉 Connection 头
    ...
}
```

**后两行是关键，而且极易被忘**：

- `proxy_http_version 1.1`：nginx 默认用 **HTTP/1.0** 和上游通信，而 1.0 默认不支持持久连接。不改这行，`keepalive 32` **完全不生效**（静默失效，没有任何报错）。
- `proxy_set_header Connection ""`：清空 `Connection` 头。因为客户端可能发来 `Connection: close`，如果原样传给上游，上游处理完就会关连接，keepalive 又白搭了。

> 🔑 **`keepalive` 是 upstream 里的三件套：`keepalive N` + `proxy_http_version 1.1` + `proxy_set_header Connection ""`。缺任何一个都会静默失效。** 这是 nginx 反代最常见的"配了但没生效"案例——很多人只写了第一行，然后以为自己开了长连接。

**对本项目的实际收益**：内网 RTT 极低（同一台机器的容器间通信，握手开销约几十微秒），所以收益**不大**。但这是个"三行代价、白捡的优化"，属于可以顺手做的。真正的价值在于消除 `TIME_WAIT` 堆积——不过本项目的量级也远达不到会堆积的程度。

**结论**：这是个**真实的、正确的、但优先级很低**的优化。列进 `06` 的整改清单，但排在后面。

---

## 动手练习

> 全部是思考题，对着仓库真实文件推。

### 练习 1：斜杠事故推演

有人给 `frontend/nginx.conf` 的 `proxy_pass` 加了个尾斜杠：

```nginx
proxy_pass http://rbac_backend/;
```

重新构建上线。请推演：

- A. 用户访问 `https://www.eureka32.top` 能打开登录页吗？
- B. 点击登录（`POST /api/auth/login`）会发生什么？后端收到的路径是什么？返回什么？
- C. 运维在服务器上跑 `docker compose ps`，看到什么？`nginx -t` 呢？
- D. 如果你是排查这个故障的人，最容易往哪个方向跑偏？

### 练习 2：Host 头丢失

假设 `proxy_set_header Host $host;` 这行被删了。请回答：后端收到的 `Host` 头会是什么？本项目现在会因此出什么问题？（提示：想想本项目有没有"生成绝对 URL"的功能。）

### 练习 3：追踪 XFF

用户 IP 是 `1.2.3.4`，caddy 容器 IP 是 `172.18.0.6`，nginx 容器 IP 是 `172.18.0.5`。请写出 backend 最终收到的这两个头的**确切值**：

- `X-Real-IP:`
- `X-Forwarded-For:`

然后回答：如果后端想记录**真实用户 IP** 到操作日志，该读哪个头的哪一部分？这么读安全吗？

### 练习 4：伪造 XFF

攻击者直接对 `https://www.eureka32.top/api/auth/login` 发请求，并在请求里塞了 `X-Forwarded-For: 8.8.8.8`。请推演 backend 最终收到的 `X-Forwarded-For` 完整值。

然后回答：如果后端的操作日志读"XFF 最左边第一个"，日志里会记下什么 IP？这有什么安全后果？正确的读法是什么？

### 练习 5：X-Forwarded-Proto（重要）

请回答：

- A. 用户访问 `https://www.eureka32.top/api/users`，backend 收到的 `X-Forwarded-Proto` 是什么值？为什么？
- B. 这个值对吗？如果不对，错在哪一环？
- C. 本项目现在为什么没出问题？
- D. 举一个具体的、会让它爆炸的功能改动。

### 练习 6：502 归因

某天线上 API 全部 502，静态页面正常。请列出**至少 4 个**可能的原因，并说明每个该怎么快速排除。（提示：把链路上每一跳都过一遍。）

### 练习 7：keepalive 三件套

有人想给本项目开 nginx → backend 的长连接，于是改成：

```nginx
upstream rbac_backend {
    server backend:8080;
    keepalive 32;
}
```

只加了这一行。请问长连接生效了吗？为什么？还缺什么？如果不生效，他能通过什么现象发现？

---

## 自检问题

1. `location /api/` 也继承了 `root /usr/share/nginx/html`，它用得上吗？为什么？
2. `upstream` 里的 `backend` 凭什么能被解析成 IP？
3. 只有一台后端，为什么还要写 `upstream` 而不是直接 `proxy_pass http://backend:8080`？
4. `proxy_pass http://rbac_backend;` 和 `proxy_pass http://rbac_backend/;` 有什么区别？
5. 本项目为什么**必须**不带尾斜杠？这和后端的什么配置是配套的？
6. `nginx -t` 能发现 `proxy_pass` 的斜杠写错了吗？
7. 不设 `proxy_set_header Host $host`，后端会收到什么 Host？
8. `$host` 和 `$http_host` 有什么区别？
9. `$proxy_add_x_forwarded_for` 的值是怎么算出来的？
10. `X-Real-IP` 在本项目里是真实用户 IP 吗？为什么？
11. `X-Forwarded-For` 的最左边一定是真实客户端 IP 吗？
12. 本项目的 `X-Forwarded-Proto $scheme` 为什么是错的？现在为什么没爆？
13. 502 和 504 的区别是什么？分别该查哪儿？
14. 为什么 `frontend` 用普通 `depends_on` 就够，而 `backend` 必须用 `condition: service_healthy`？
15. 开 upstream keepalive 需要几个配置？少一个会怎样？

---

## 承上启下

本节把 `frontend/nginx.conf` 的**第二副面孔**读完了。到这里，45 行配置里**只剩日志相关的一行没讲**：

```nginx
error_log  /var/log/nginx/error.log warn;    # ← 01 提了一嘴，说放到 05 讲
```

而更大的悬念是 `00 §5` 埋的第二个扣：**这份配置里一行 TLS 都没有，但线上明明是 HTTPS**。

`05` 一起还这两笔：讲日志体系（包括本项目**没配** `access_log` 却仍然能 `docker logs` 看到访问日志的原因），然后完整给出"如果不用 caddy，nginx 自己做 TLS 得写成什么样"的对照配置——以及本项目为什么一行都不用写。

顺带补上本项目**全都没配**的安全加固：限流（对登录接口防爆破，和 RBAC 项目直接相关）、`server_tokens`、`client_max_body_size`、安全响应头。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

### 自检问题

<details>
<summary><b>1. <code>location /api/</code> 继承了 <code>root</code>，用得上吗？</b></summary>

**用不上。**

`proxy_pass` 一旦执行，请求就被转发给上游了，**根本不会去查磁盘**。`root`、`index`、`try_files`、`sendfile` 这些"静态文件路径"上的指令，对这个 location 全部失去意义。

这是一个 location 的**根本分岔**：有 `proxy_pass` 就走代理路径，没有就走静态路径。

**结论**：继承来的指令**不一定会被用到**，取决于这个 location 实际走哪条路。理解"继承"和"生效"是两回事，能省掉很多困惑。
</details>

<details>
<summary><b>2. <code>backend</code> 凭什么能被解析成 IP？</b></summary>

靠 **Docker 的内嵌 DNS**。compose 把所有服务放进同一个自定义网络（`rbac-net`），网络内**服务名就是域名**，Docker 内置 DNS 负责解析成容器内网 IP。（`learning-docker 04 §2.4` 精读过。）

前提是**两个服务在同一个网络里**——`frontend` 和 `backend` 都写了 `networks: [rbac-net]`。不在同一网络，这个名字解析不了，直接 502。

**一个隐藏陷阱**（`§2.3`）：nginx 只在启动/reload 时解析一次并缓存 IP，**永不重解析**。容器重建后 IP 会变 → nginx 还往老 IP 发 → 502 且**永不自愈**。本项目没踩到是因为 compose 通常会把 frontend 一起重建，属于歪打正着。
</details>

<details>
<summary><b>3. 只有一台后端，为什么还要写 <code>upstream</code>？</b></summary>

功能上确实等价，但有三个理由：

1. **命名**：`rbac_backend` 表达的是"RBAC 后端服务"这个**角色**，比 `backend:8080` 这个**地址**更有语义。
2. **扩展点**：要加实例只需在 upstream 里加一行，`location` 一个字不用改。
3. **独有能力**：`keepalive`、负载均衡策略、`max_fails`、`proxy_next_upstream` **只能写在 upstream 块里**，不写 upstream 就永远用不上。

本质是**把"后端在哪"这个决策收敛到一处**——location 只管说"转给这个角色"，谁扮演、几个人扮演、怎么分配，全在 upstream 里决定。
</details>

<details>
<summary><b>4. <code>proxy_pass</code> 带不带尾斜杠有什么区别？</b></summary>

由 **`proxy_pass` 的值里有没有 URI 部分**决定（那个孤零零的 `/` 就算 URI 部分）：

- **无 URI 部分**（`http://rbac_backend;`）→ **原样转发完整 URI**
- **有 URI 部分**（`http://rbac_backend/;`）→ **把 location 前缀替换成这个 URI**

请求 `/api/users`，location 是 `/api/`：
- 不带斜杠 → 后端收到 `/api/users`（完整）
- 带斜杠 → 剥掉 `/api/` → 后端收到 `/users`

**一个字符，两种完全不同的行为。**
</details>

<details>
<summary><b>5. 本项目为什么必须不带尾斜杠？</b></summary>

因为**后端的 `context-path` 是 `/api`**——Spring Boot 自己就期望收到带 `/api` 前缀的路径（它注册的真实路径就是 `/api/users`）。

所以 nginx 必须**原样转发**，把 `/api` 前缀留着：

```
浏览器 /api/users → nginx 原样转发 → backend 收到 /api/users
                                      → context-path=/api 匹配到 /users ✔
```

带了斜杠就会剥掉前缀 → backend 收到 `/users` → 匹配不上任何 Controller → **全部 API 404**。

`frontend/nginx.conf:31` 那行注释就是在说这件事：「后端 context-path 是 /api，**原样转发**」——它在提醒后来人这个"没有斜杠"是**故意的**。

**这是一对必须配套的设计**：改任何一边而不改另一边，API 全挂。
</details>

<details>
<summary><b>6. <code>nginx -t</code> 能发现斜杠写错了吗？</b></summary>

**不能。两种写法语法都完全合法。**

这正是 `01` 练习 5 那个论断的实例：**`nginx -t` 只查语法，不查逻辑**。它拦不住"语法正确但行为错误"的改动。

这也是这个坑特别阴险的原因之一——你的所有自动化检查都会说"没问题"，但线上 API 全挂。
</details>

<details>
<summary><b>7. 不设 <code>Host $host</code>，后端会收到什么？</b></summary>

nginx 会把 Host 设成 **`proxy_pass` 里的那个值**，也就是 `rbac_backend`（upstream 的名字）：

```http
Host: rbac_backend        ← 一个根本不存在的域名
```

后果：任何依赖 Host 的后端逻辑失灵——生成绝对 URL 会指向 `http://rbac_backend/...`（用户点了打不开）、多租户按域名路由会崩、Spring Security 某些配置受影响。
</details>

<details>
<summary><b>8. <code>$host</code> 和 <code>$http_host</code> 有什么区别？</b></summary>

| 变量 | 值 | 端口 | 客户端没发 Host 时 |
|---|---|---|---|
| `$host` | Host 头的**主机名部分**，转小写，**去掉端口** | ❌ 不含 | 回落到 `server_name` |
| `$http_host` | Host 头的**原始值**，一字不改 | ✅ 含（若客户端带了） | **空** |

`$host` 做了规范化，且有回落机制，**更稳**。本项目用它是对的。
</details>

<details>
<summary><b>9. <code>$proxy_add_x_forwarded_for</code> 的值怎么算？</b></summary>

```
$proxy_add_x_forwarded_for = 【客户端传来的 XFF】 + ", " + 【$remote_addr】
```

是**追加**，不是覆盖。客户端没传 XFF 时，值就等于 `$remote_addr`。

这个追加语义让它能在多层代理下累积出完整路径：`1.2.3.4, 172.18.0.6` —— 最左是最初的客户端，往右是各跳代理。
</details>

<details>
<summary><b>10. <code>X-Real-IP</code> 在本项目是真实用户 IP 吗？</b></summary>

**不是。它是 caddy 的容器内网 IP（`172.18.0.x`）。**

因为 `$remote_addr` 是 **nginx 看到的直连客户端**，而 nginx 的直连客户端是 **caddy**，不是浏览器。

```
浏览器(1.2.3.4) → caddy(172.18.0.6) → nginx
                                       ↑ $remote_addr = 172.18.0.6
```

**通则**：多层代理下，`$remote_addr` 只是"上一跳"。每加一层代理，它就往后退一格。这正是 `X-Forwarded-For` 存在的理由——只有它能靠追加语义保住最初的客户端 IP。
</details>

<details>
<summary><b>11. <code>X-Forwarded-For</code> 最左边一定是真实客户端 IP 吗？</b></summary>

**不一定！它是"客户端自称的"，可以被任意伪造。**

任何人都能在请求里塞 `X-Forwarded-For: 8.8.8.8`，后续各跳只会往后追加，**不会验证也不会删除**最左边那个。

**安全的读法**：从**右往左**数，跳过你信任的代理跳数（本项目是 2 跳：nginx + caddy），取第一个不受信任的。

这对本项目**直接相关**：操作日志的 IP 如果用来审计追责，就必须不可伪造——无脑取最左边 = 允许攻击者往审计日志里写任意 IP 栽赃。
</details>

<details>
<summary><b>12. 本项目的 <code>X-Forwarded-Proto $scheme</code> 为什么是错的？现在为什么没爆？</b></summary>

**为什么错**：`$scheme` 是 **nginx 自己这一跳收到的协议**。而 caddy 做了 TLS 终结，用**明文 http** 转发给 nginx → nginx 的 `$scheme` **恒为 `http`**，永远不可能是 https。

所以用户明明访问的是 `https://`，backend 却收到 `X-Forwarded-Proto: http`。

**为什么没爆**：本项目用 **JWT 放请求头**（非 Cookie），后端压根不关心"是不是 HTTPS"，**没有任何代码去读这个头**。

这不是新发现——`docs/ops/02-域名与HTTPS配置.md:97` 已经记录在案了。

**什么时候会爆**：① 改用 Secure Cookie（Spring Security 看到 http → 拒绝下发 → 登录失效）；② 后端生成绝对 URL（重置密码链接、OAuth 回调 → 生成 `http://` → 被拦或回调失败）。

**通则**：**`$scheme` 是"我这一跳收到的协议"，不是"用户用的协议"。** 在 TLS 终结发生在更外层的架构里（caddy / ALB / CDN + 内层 nginx），`$scheme` 必然是 http，用它设 `X-Forwarded-Proto` 是语义错误。正确做法是透传上游传来的 `$http_x_forwarded_proto`。
</details>

<details>
<summary><b>13. 502 和 504 的区别？分别该查哪儿？</b></summary>

- **502 Bad Gateway** = **连不上**上游，或上游给了无效响应。发生在**建连阶段**（快，毫秒级）。→ 查**上游在不在、地址对不对**（容器起没起、DNS 能不能解析、在不在同一网络、端口对不对）。
- **504 Gateway Timeout** = **连上了，但等太久没回应**。发生在**超时之后**（慢，默认 60 秒）。→ 查**上游为什么慢**（慢 SQL、死锁、线程池耗尽、外部依赖卡住）。

**一句话**：502 是"找不到人"，504 是"人找到了但不吭声"。
</details>

<details>
<summary><b>14. 为什么 <code>frontend</code> 用普通 <code>depends_on</code> 就够，<code>backend</code> 必须用 <code>service_healthy</code>？</b></summary>

因为**失败后果完全不同**：

- **nginx 连不上上游只会返回 502，不会崩溃**。所以 frontend 可以先起来，这段时间 API 报 502，等 backend 就绪后**自动恢复**，无需干预 → 宽松的 `depends_on` 够了。
- **Spring Boot 连不上数据源会直接启动失败退出**。所以 backend 必须用 `condition: service_healthy` 严格等 mysql/redis 真正就绪。

（`learning-docker 04` 分析过这个设计。）

**推论**：刚 `up -d --build` 完的头十几秒 API 报 502 是**正常现象**，不是故障——这正是 frontend 敢用宽松 depends_on 的底气。
</details>

<details>
<summary><b>15. 开 upstream keepalive 需要几个配置？少一个会怎样？</b></summary>

**三件套，缺一个就静默失效**：

```nginx
upstream rbac_backend {
    server backend:8080;
    keepalive 32;                    # ① 保持 32 条空闲长连接
}
location /api/ {
    proxy_http_version 1.1;          # ② 必须！默认是 1.0，不支持 keep-alive
    proxy_set_header Connection "";  # ③ 必须！清掉可能的 Connection: close
}
```

- 少 ②：nginx 默认用 **HTTP/1.0** 和上游通信，1.0 默认不支持持久连接 → `keepalive 32` **完全不生效**。
- 少 ③：客户端发来的 `Connection: close` 会被原样传给上游 → 上游处理完就关连接 → keepalive 白搭。

**这是"配了但没生效"的最经典案例**：很多人只写了第一行，然后以为自己开了长连接。而且**没有任何报错**——`nginx -t` 通过，日志干净，只是性能没变好。
</details>

### 练习 1（斜杠事故推演）

<details>
<summary><b>点开看答案</b></summary>

**A. 能打开登录页吗？**

**能，完全正常。**

因为登录页走的是 `location /` → `try_files` → 发 `index.html`。这条链路**根本不经过 `proxy_pass`**，斜杠改动对它零影响。HTML、JS、CSS 全部正常加载，页面渲染完美。

**B. 点击登录会发生什么？**

```
浏览器 POST /api/auth/login
   ↓ nginx: location /api/ 匹配，proxy_pass http://rbac_backend/  （带斜杠）
   ↓ 剥掉 location 前缀 /api/，替换为 /
   ↓ /api/auth/login  减去 /api/  =  auth/login
   ↓ 拼上 proxy_pass 的 /  →  /auth/login
backend 收到 POST /auth/login
   ↓ Spring Boot 的 context-path = /api，期望路径以 /api 开头
   ↓ /auth/login 匹配不上任何 Controller
   ✘ 返回 404
```

**后端收到的路径是 `/auth/login`，返回 404。**

**所有 API 全部 404。** 用户看到登录页正常，一点登录就报错。

**C. `docker compose ps` 和 `nginx -t` 看到什么？**

- `docker compose ps`：**全部 Up**，一片健康。容器没有任何问题——nginx 跑得好好的，它只是在**忠实地执行一个错误的配置**。
- `nginx -t`：**syntax is ok, test is successful**。因为**语法完全合法**。

**所有机器指标全绿。** 这是 `03` 练习 5 那类"成功地提供了错误的东西"的故障。

**D. 最容易往哪儿跑偏？**

**几乎所有人都会先去查后端。** 因为症状是"后端返回 404"，思维链条自然是：

```
API 404 → 后端路由没注册？→ 查 Controller 注解
       → context-path 配错了？→ 查 application.yml
       → Spring Security 拦了？→ 查安全配置
       → 是不是没编译进去？→ 重新 build 后端
```

**能查一整天，而且每一步都"合理"**——因为证据确实都指向后端。

**唯一能救你的动作**：看 backend 的**访问日志**，或者在 backend 容器里抓一下实际收到的请求路径。一旦看到"后端收到的是 `/auth/login` 而不是 `/api/auth/login`"，方向立刻就对了——**路径在半路上被人改了，那只能是 nginx 干的**。

> 🔑 **排查反代问题的第一原则：确认"上游到底收到了什么"。** 不要从"上游为什么这么响应"开始猜，先确认它收到的请求是不是你以为的那个。这一步能省掉 90% 的弯路。
</details>

### 练习 2（Host 头丢失）

<details>
<summary><b>点开看答案</b></summary>

**后端会收到 `Host: rbac_backend`** —— nginx 默认把 Host 设成 `proxy_pass` 里的值，也就是 upstream 的**名字**。

那是个根本不存在的"域名"（它只是 nginx 配置里的一个标识符）。

**本项目现在会出什么问题？**

**几乎不出问题。** 因为本项目的后端目前**没有任何"生成绝对 URL"的功能**：

- 认证用 JWT 放请求头 → 不生成回调 URL
- 没有邮件功能 → 不生成重置密码链接
- 没有 OAuth → 不需要回调地址
- 前端全部走相对路径 `/api`（`00 §2.2`）→ 不依赖后端告诉它域名
- 单租户 → 不按域名路由

所以这个头传成什么，**当前没有代码去读它**。

**注意这个结论的味道**：它和 `X-Forwarded-Proto`（`§4.5`）**是同一个故事**——一个错误的头，因为恰好没人读，所以没爆。

**区别在于**：`Host $host` 这行**是对的**（写了正确的值），只是当前用不上；而 `X-Forwarded-Proto $scheme` 这行**是错的**（写了错误的值），也是当前用不上。

**两者都属于"潜伏的正确/错误"**。等哪天加了个需要生成绝对 URL 的功能（比如"导出报表后发邮件通知"），这两行会同时决定成败：`Host` 那行会救你，`X-Forwarded-Proto` 那行会坑你——生成出来的链接是 `http://www.eureka32.top/...`，域名对了，协议错了。
</details>

### 练习 3（追踪 XFF）

<details>
<summary><b>点开看答案</b></summary>

**逐跳推：**

```
① 浏览器(1.2.3.4) 发请求，无 XFF 头

② caddy 收到：$remote_addr = 1.2.3.4
   caddy 的 reverse_proxy 默认设置 XFF：
   → X-Forwarded-For: 1.2.3.4

③ nginx 收到：$remote_addr = 172.18.0.6（caddy 的 IP）
   - X-Real-IP: $remote_addr           → 172.18.0.6
   - X-Forwarded-For: $proxy_add_x_forwarded_for
     = 客户端传来的 XFF + ", " + $remote_addr
     = "1.2.3.4" + ", " + "172.18.0.6"
     → 1.2.3.4, 172.18.0.6
```

**backend 最终收到：**

```http
X-Real-IP: 172.18.0.6
X-Forwarded-For: 1.2.3.4, 172.18.0.6
```

**注意 `X-Real-IP` 是 caddy 的内网 IP，完全没有价值。** 它本该记录真实客户端，但因为 nginx 用了 `$remote_addr`（只是上一跳），在多层代理下**失去了意义**。

**想记录真实用户 IP 该读哪个？**

读 **`X-Forwarded-For`**，因为只有它靠追加语义保住了 `1.2.3.4`。

**该读哪一部分？** 直觉答案是"最左边第一个"——但**这么读不安全**（练习 4 就是打这个的）。

**安全的读法**：从**右往左**数，跳过信任的代理跳数。本项目是 2 跳（nginx + caddy），所以：

```
X-Forwarded-For: 1.2.3.4, 172.18.0.6
                                ↑ 右起第1个 = caddy 加的（可信，是 caddy 看到的客户端）
                 ↑ 右起第2个 = 客户端自称的（不可信！）
```

嗯——**这里有个微妙之处**：右起第 1 个（`172.18.0.6`）是 nginx 加的，它等于 caddy 的 IP，没用。而 caddy 加的那个（`1.2.3.4`）**是 caddy 亲眼看到的 `$remote_addr`**，这个可信。

所以本项目正确的取法是：**取 XFF 里 nginx 追加的那个之前的那一个**，也就是 caddy 写入的值。实践上如果确定链路固定是"caddy + nginx 两跳"，就是**倒数第二个**。

**更稳的工程做法**：与其在后端算跳数（脆弱，链路一变就错），不如让 **caddy 写一个专用的、下游不可覆盖的头**（比如 caddy 设 `X-Client-IP`），nginx 原样透传，后端只读它。**把"谁是真实 IP"这个判断收敛到唯一有资格判断的那一跳（最外层的 caddy）**。
</details>

### 练习 4（伪造 XFF）

<details>
<summary><b>点开看答案</b></summary>

**推演：**

```
① 攻击者(真实IP 1.2.3.4) 发请求，【自己塞了一个】：
   X-Forwarded-For: 8.8.8.8

② caddy 收到：$remote_addr = 1.2.3.4
   caddy 默认【追加】而不是覆盖：
   → X-Forwarded-For: 8.8.8.8, 1.2.3.4
                       ↑ 攻击者编的，被【原样保留】了

③ nginx 收到：$remote_addr = 172.18.0.6
   $proxy_add_x_forwarded_for = "8.8.8.8, 1.2.3.4" + ", " + "172.18.0.6"
   → X-Forwarded-For: 8.8.8.8, 1.2.3.4, 172.18.0.6
```

**backend 收到：`X-Forwarded-For: 8.8.8.8, 1.2.3.4, 172.18.0.6`**

**如果后端读"最左边第一个"，日志里会记下 `8.8.8.8`** —— 一个**攻击者随手编的 IP**。

**安全后果**（对 RBAC 系统尤其严重）：

1. **审计日志被污染**。操作日志是用来**追责**的——"谁在什么时间从什么 IP 干了什么"。如果 IP 可以随便编，这个字段**在法律和安全意义上完全归零**。攻击者暴力破解登录，日志里记的是 `8.8.8.8`，真实来源完全查不到。

2. **栽赃嫁祸**。攻击者可以把 XFF 设成**同事的 IP**、**公司出口 IP**、甚至**管理员常用 IP**。事后审计时，锅精准地扣在无辜的人头上。

3. **基于 IP 的安全策略被绕过**。如果哪天加了"IP 白名单"或"异地登录告警"，这些逻辑读 XFF 最左边 → 攻击者只需伪造成白名单 IP → **整个防线形同虚设**。

4. **限流被绕过**。如果按 XFF 最左边限流（比如登录接口每 IP 每分钟 5 次），攻击者每次请求换一个伪造 IP → **限流完全失效**，可以无限爆破。（这条和 `05` 要讲的限流直接相关。）

**正确的读法**：

**绝不能取最左边。** 应该从**右往左**数，跳过你信任的代理跳数，取第一个不受信任的值——因为**只有你自己的代理追加的那些是可信的**（它们写的是自己亲眼看到的 `$remote_addr`），客户端自带的那部分**永远不可信**。

**最稳的做法**（重申练习 3 的结论）：让最外层的 caddy 写一个**专用头**（如 `X-Client-IP`），并确保它**覆盖而非追加**客户端传来的同名头；nginx 原样透传；后端只信这个头。

> 🔑 **XFF 的设计缺陷在于：它把"不可信的客户端输入"和"可信的代理记录"混在同一个头里，用逗号隔开，却不告诉你分界线在哪。** 分界线只能由你自己根据"我有几层代理"来算——这个知识不在数据里，在架构里。所以 XFF **永远不能无脑取最左**。
</details>

### 练习 5（X-Forwarded-Proto）

<details>
<summary><b>点开看答案</b></summary>

**A. backend 收到什么值？**

**`X-Forwarded-Proto: http`**

推导：

```
浏览器 ──HTTPS──► caddy ──【明文 http】──► nginx
                   ↑ TLS 在这里终结        ↑ nginx 收到的是 http
                                          → $scheme = "http"
                                          → proxy_set_header X-Forwarded-Proto $scheme
                                          → 传给后端 "http"
```

**B. 这个值对吗？错在哪一环？**

**不对。用户明明用的是 HTTPS。**

错在**用 `$scheme` 来表达"用户用的协议"**。`$scheme` 的真实语义是"**nginx 自己这一跳收到的协议**"。在 TLS 已经被 caddy 终结的架构里，nginx 收到的**永远是 http**，所以 `$scheme` **恒为 http**，它根本不可能反映用户的真实协议。

**这是语义错误，不是配置错误**——这行配置在"nginx 直接对外"的架构里是**完全正确**的（`$scheme` 就等于用户的协议）。它是在 caddy 接入、nginx 退到内网之后**才变错的**，但没人回来改它。

（这正是 `00 §3.2` 说的那类问题：架构变了，配置留在原地。`docs/09` 的图漂移了，这行配置也漂移了——只不过一个是文档，一个是代码。）

**C. 现在为什么没出问题？**

因为本项目用 **JWT 放在请求头**，不用 Cookie，后端**压根不关心是不是 HTTPS**——**没有任何代码去读这个头**。

`docs/ops/02-域名与HTTPS配置.md:97` 已经明确记录了这一点，原文：「当前用 JWT 放请求头（非 Cookie），不受影响」。

**D. 什么改动会让它爆炸？**

**场景 1：改用 Secure Cookie 存 token**

```
后端下发 Cookie 时加 Secure 标记
→ Spring Security 检查 X-Forwarded-Proto
→ 看到 "http" → 判定连接不安全
→ 【拒绝下发 Secure Cookie】
→ 用户登录后拿不到 token → 【登录功能直接失效】
```

**场景 2：任何生成绝对 URL 的功能**

比如加一个"忘记密码"发邮件：

```
后端拼重置链接：{scheme}://{host}/reset?token=xxx
→ scheme 从 X-Forwarded-Proto 读 → "http"
→ 生成 http://www.eureka32.top/reset?token=xxx
→ 用户点击 → caddy 301 跳到 https（多一跳，勉强能用）
```

这个还算"勉强能用"。但如果是 **OAuth 回调**：

```
后端向第三方注册回调地址 http://www.eureka32.top/callback
→ 第三方那边登记的是 https://www.eureka32.top/callback（必须 HTTPS）
→ 【协议不匹配 → 回调直接被拒 → OAuth 登录彻底不可用】
```

**这个没有"勉强能用"，是硬失败。**

**修法**（整改建议，本系列不动手）：

caddy 的 `reverse_proxy` **默认就会**设置 `X-Forwarded-Proto: https`，所以 caddy 侧不用改。nginx 侧要**透传上游传来的值**而不是用自己的 `$scheme`：

```nginx
map $http_x_forwarded_proto $real_scheme {
    default $http_x_forwarded_proto;   # 优先用 caddy 传来的
    ""      $scheme;                   # caddy 没传时才回落到自己的
}
...
proxy_set_header X-Forwarded-Proto $real_scheme;
```

（`map` 要写在 `http` 块里。`$http_x_forwarded_proto` 是读请求头的通用形式：`$http_` + 头名小写 + 连字符换下划线。）

**这个改动的风险很低**（加一个 map + 改一行），**但当前收益也是零**（没人读这个头）。所以它属于"**在加 Cookie 认证或绝对 URL 功能之前必须先做**"的**前置债务**——列进 `06` 的整改清单，标注触发条件。
</details>

### 练习 6（502 归因）

<details>
<summary><b>点开看答案</b></summary>

**关键信息：静态页面正常 → 说明 caddy 和 nginx 都活着，`location /` 那条链路完好。问题一定在 `location /api/` 这条链路上，也就是 nginx → backend 之间。**

这个信息一下就把排查范围砍掉了一大半。

**至少 6 个可能原因：**

| # | 原因 | 怎么快速排除 |
|---|---|---|
| 1 | **backend 容器没起来 / 崩了** | `docker compose ps` 看 backend 状态；`docker compose logs --tail=50 backend` 看有没有启动失败 |
| 2 | **backend 还在启动中**（刚部署完） | 等 30 秒再试。Spring Boot 启动要十几秒，这期间 502 是**正常的**（`§5.2` 场景 A）。看日志有没有 `Started RbacServerApplication` |
| 3 | **backend 启动失败**（连不上 mysql/redis） | `docker compose ps` 看 mysql/redis 是否 healthy；backend 用的是 `condition: service_healthy`，如果依赖没好它压根不会启动 |
| 4 | **DNS 解析不了 `backend`**（不在同一网络） | `docker exec rbac-frontend getent hosts backend` 应该返回一个 IP。解析不出来 → 检查两个服务的 `networks: [rbac-net]` |
| 5 | **upstream IP 缓存过期**（`§2.3` 的陷阱） | backend 单独重建过而 frontend 没重启？→ `docker compose restart frontend` 让 nginx 重新解析。如果这样就好了，就是这个原因 |
| 6 | **用错了配置文件** | 如果 nginx 里的 upstream 指向 `host.docker.internal:8080`（遗留那份），**必然 502**——宿主机上没有 8080。`docker exec rbac-frontend cat /etc/nginx/nginx.conf \| grep server` 一眼看穿 |

**排查顺序建议**（从最可能到最不可能）：

```
① docker compose ps                    ← 一眼看出 1/2/3
② docker compose logs --tail=50 backend  ← 确认启动成功没
③ docker exec rbac-frontend getent hosts backend   ← 排除 4
④ docker compose logs --tail=50 frontend           ← 看 nginx error.log 的真实报错
   （502 时 error.log 会写明是 "connect() failed" 还是 "no live upstreams" 还是解析失败，
    这条信息量最大，其实应该排第二）
```

**最有价值的一条其实是 ④**：nginx 的 error.log 会**直接告诉你它连不上的原因**：

- `connect() failed (111: Connection refused) while connecting to upstream` → 地址对，但没人监听（backend 没起 / 端口不对）
- `backend could not be resolved` → DNS 问题（原因 4）
- `no live upstreams while connecting to upstream` → 所有上游都被标记为失败

**教训**：排 502 别急着猜，**先看 nginx 的 error.log**，它通常直接把答案写在脸上了。（`learning-docker 07` 讲"看日志两步定位"就是这个意思。）
</details>

### 练习 7（keepalive 三件套）

<details>
<summary><b>点开看答案</b></summary>

**没生效。**

因为缺了 `location` 里的**两行**：

```nginx
location /api/ {
    proxy_pass http://rbac_backend;
    proxy_http_version 1.1;          # ← 缺了这行 = keepalive 完全不生效
    proxy_set_header Connection "";  # ← 缺了这行 = 可能被客户端的 Connection: close 破坏
    ...
}
```

**为什么 `proxy_http_version 1.1` 是必须的**：

nginx 和上游通信时**默认用 HTTP/1.0**。而 HTTP/1.0 **默认不支持持久连接**（它的默认行为就是"一个请求一个连接，用完就关"）。

所以只写 `keepalive 32`，nginx 会老老实实地：建连 → 发 HTTP/1.0 请求 → 收响应 → **关连接**。那个连接池**永远是空的**，因为根本没有连接活下来进池子。

**为什么 `proxy_set_header Connection ""` 也是必须的**：

客户端（这里是 caddy）可能发来 `Connection: close`。如果 nginx 把这个头原样传给 backend，backend 处理完就会主动关闭连接 → 连接同样进不了池子。

清空它，让 nginx 自己管理连接生命周期。

**他能通过什么现象发现？**

**这才是这道题真正的价值：他基本发现不了。**

| 检查手段 | 结果 |
|---|---|
| `nginx -t` | ✅ syntax is ok（语法完全合法） |
| 容器状态 | ✅ Up |
| error.log | ✅ 干净，**一条警告都没有** |
| 功能测试 | ✅ API 全部正常 |
| 性能 | ❌ **和改之前一模一样** |

**没有任何报错。** 配置写了，语法对了，功能正常，就是**性能一点没变**。他会以为"keepalive 也就这点效果嘛"，然后带着一个错误的认知走开。

**唯一能发现的方法**——去看实际的 TCP 连接：

```bash
# 在 backend 容器里看连接状态，如果全是 TIME_WAIT 且不断新建，就说明没复用
docker exec rbac-backend netstat -an | grep 8080 | head -20
```

或者更直接：连续发几个请求，看 backend 那边的连接数是不是稳定复用几条，还是每次都新建。

> 🔑 **这是 nginx 最典型的"静默失效"**：`keepalive` 三件套缺一个就不生效，但**没有任何反馈告诉你**。它和 `04 §4.6` 的 `proxy_set_header` 继承坑、`02` 练习 4 的 "gzip_types 写了 text/html" 是同一类问题——**nginx 的配置正确性，很多时候无法从 nginx 自己那里得到确认**。
>
> **通则：任何"配了但可能不生效"的优化，必须用外部手段验证它真的生效了**（看响应头、看连接状态、看实际耗时），而不是看配置写没写。**配置文件不是事实，运行时行为才是。**
</details>
