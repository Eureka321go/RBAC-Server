# 00 · 为什么是 nginx：它在本项目的位置

> 目标：先搞清楚 nginx 在本项目里到底是干什么的、站在哪一层，再动手读配置。
>
> 读完你能：
> - 说清 nginx 的两副面孔（静态文件服务器 / 反向代理），以及"反向"到底反在哪。
> - 画出本项目从浏览器到数据库的完整链路，并指出 nginx 在链路的第几跳。
> - 解释为什么前端代码里写 `/api/users` 就能访问到后端，而不需要写域名。
> - 找到本项目里 nginx 的两份配置文件，并说出为什么"有两份"这件事本身就值得警惕。

**这个系列怎么读**：以本项目 `frontend/nginx.conf` 那 40 行为主线，逐行讲透。但只讲这 40 行是学不会 nginx 的——所以每讲到一个真实存在的指令，就把这个指令的完整能力边界一起讲了；项目里没用上、但你迟早要会的（rewrite、负载均衡、限流、TLS），作为"为什么这里没写"的对照补上。

---

## 一、nginx 是什么

nginx 是一个 **HTTP 服务器兼反向代理服务器**。这句定义里藏着两个不同的身份，本项目两个都用上了，而且是同一个进程同时干的。

### 1.1 第一副面孔：静态文件服务器

**静态文件**指的是服务器不需要做任何计算、原样发给浏览器就行的文件：`.html`、`.css`、`.js`、`.png`、`.svg`。

它的工作模型简单到一句话：**把 URL 路径拼到一个本地目录后面，找到文件，读出来发回去**。

```
请求 GET /assets/index-a1b2c3.js
        ↓  拼上配置里的根目录 /usr/share/nginx/html
读磁盘  /usr/share/nginx/html/assets/index-a1b2c3.js
        ↓
200 OK + 文件内容
```

找不到文件就返回 404。就这么点事——但"找不到时怎么办"这个问题，在本项目里恰恰是一个必须专门配置的坑，`03` 会专门讲。

### 1.2 第二副面孔：反向代理

**代理**就是"替别人转发请求"。分正向和反向两种，区别不在技术上，在**代理是替谁工作**：

| | 正向代理 | 反向代理 |
|---|---|---|
| 站在谁那边 | 客户端 | 服务端 |
| 谁知道它存在 | 客户端知道（要主动配置） | 客户端**不知道**（以为自己直接在跟服务器说话） |
| 隐藏了谁 | 隐藏客户端（服务器不知道真实访客是谁） | 隐藏服务端（客户端不知道背后有几台机器、是什么架构） |
| 典型用途 | 科学上网、公司出口网关 | 负载均衡、统一入口、TLS 终结 |

本项目用的是**反向代理**：浏览器发 `GET /api/users`，它以为这个请求就是 nginx 处理的；实际上 nginx 转手把它交给了后面的 Spring Boot，拿到结果再原样递回去。浏览器全程蒙在鼓里。

> 🔑 "反向"不是"方向反了"，而是"立场反了"。正向代理是客户端的代表，反向代理是服务端的门面。本项目的 nginx 是后端的门面。

### 1.3 两副面孔合在一起

本项目的 nginx 就是靠**按 URL 路径分流**，让两副面孔在同一个端口上共存：

```
GET /                      → 面孔一：发 index.html
GET /assets/index-xxx.js   → 面孔一：发静态文件
GET /api/users             → 面孔二：转发给 backend:8080
```

分流规则写在配置里，就是后面要精读的 `location` 块。

---

## 二、本项目为什么需要 nginx

### 2.1 Vue build 完就是一堆静态文件，总得有人发

开发时你跑 `npm run dev`，Vite 起了一个开发服务器，它负责编译、热更新、发文件。但 **dev server 只用于开发**——它慢、它把源码信息暴露出来、它不是为并发设计的。

生产环境要先 `npm run build`，把整个 Vue 项目编译成一个 `dist/` 目录，里面是纯 HTML/JS/CSS。到这一步 **Node 运行时就退场了**，产物是死的静态文件，需要一个 HTTP 服务器把它们发出去。

这就是 nginx 在本项目的第一个职责。看 `frontend/Dockerfile` 的最后几行，这个交接过程写得很清楚：

```dockerfile
# ---- 运行阶段：nginx 发静态文件 + 反代后端 ----
FROM nginx:1.27                                      # ① 换成 nginx 镜像，node 不要了
COPY nginx.conf /etc/nginx/nginx.conf                # ② 塞进我们自己的配置
COPY --from=build /app/dist /usr/share/nginx/html    # ③ 把构建阶段的 dist 搬进来
#声明容器会用哪个端口
EXPOSE 80
```

第 ③ 行 `--from=build` 是从前面的 `node:22` 构建阶段里把 `dist` 捞出来。最终镜像里**没有 node、没有 node_modules、没有源码**，只有 nginx 和一堆静态文件（这套多阶段构建的机制，`learning-docker 02` 已经精读过）。

### 2.2 同源免 CORS：`/api` 为什么不用写域名

打开前端代码你会发现，请求后端一律写的是相对路径 `/api/users`，从来不写 `http://xxx:8080/api/users`。

这不是偷懒，是**刻意的**。原因是浏览器的**同源策略**：网页只能自由地向"同源"（协议 + 域名 + 端口三者全同）的地址发请求。跨源就要服务端配 CORS 响应头，配不对就报错，还会多一次 OPTIONS 预检请求。

而写相对路径 `/api/users`，浏览器会自动补上当前页面的源。页面是从 `https://www.eureka32.top` 打开的，那这个请求就发向 `https://www.eureka32.top/api/users`——**和页面同源，CORS 问题根本不存在**。

代价是：得有人在服务器那头，把 `/api/**` 这批请求认出来、转给真正的后端。这就是 nginx 在本项目的第二个职责。

> 🔑 前端写相对路径 `/api` + 反向代理按路径分流 = 前后端同源。这是本项目从头到尾没被 CORS 折磨过的唯一原因，而这个便利是 nginx 挣来的。

### 2.3 开发环境其实早就在用同一招

有意思的是，你在本机 `npm run dev` 时，这件事**已经在发生了**，只是干活的不是 nginx，是 Vite。看 `frontend/vite.config.ts`：

```ts
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 前端 /api/** 的请求代理到后端 Spring Boot（context-path 也是 /api）
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
```

`proxy` 这一段做的事，和 nginx 的 `location /api/` 一模一样：**认出 `/api` 开头的请求，转给 8080**。区别只是：

| | 开发环境 | 生产环境 |
|---|---|---|
| 谁发静态文件 | Vite dev server（现编译） | nginx（发 `dist` 里的死文件） |
| 谁反代 `/api` | Vite 的 `server.proxy` | nginx 的 `location /api/` |
| 后端在哪 | `http://localhost:8080`（宿主机进程） | `http://backend:8080`（容器服务名） |
| 谁在监听 | `:5173` | `:80` |

> 🔑 nginx 的 `location /api/` 是 `vite.config.ts` 里 `server.proxy` 的**生产版对应物**。你早就在用这个模式了，只是没意识到。这也解释了为什么前端代码在开发和生产之间**一行都不用改**——两边都保证了 `/api` 同源可达。

---

## 三、本项目的真实链路

### 3.1 从浏览器到数据库，一共几跳

线上（阿里云 `106.15.89.180`，域名 `www.eureka32.top`）现在跑着五个容器，完整链路是：

```
                  ┌───────────────────────────────── 阿里云安全组：只放行 22 / 80 / 443
                  │
   浏览器 ──:443(HTTPS)──► [caddy]  ← 唯一对外入口，TLS 终结、自动申请证书
                              │
                              │ 内网明文 http，走 rbac-net
                              ▼
                          [frontend]  ← 这就是 nginx（镜像 nginx:1.27）
                              │
                 ┌────────────┴────────────┐
                 │                         │
          location /                location /api/
        发 dist 静态文件            反代给 backend
                                          │
                                          ▼
                                      [backend]  ← Spring Boot :8080
                                          │
                                 ┌────────┴────────┐
                                 ▼                 ▼
                             [mysql]           [redis]
                              :3306             :6379
```

对应到 `deploy/docker-compose.yml`，`frontend` 服务长这样：

```yaml
  # 前端 nginx：发 dist 静态文件 + 把 /api 反代给 backend
  # 不再直接对外，改由前面的 caddy 走 HTTPS 反代（只留内网 expose）
  frontend:
    build:
      context: ../frontend
    image: rbac-frontend
    container_name: rbac-frontend
    restart: unless-stopped
    expose:
      - "80"           # ← 注意是 expose 不是 ports：只在内网可达，宿主机上访问不到
    depends_on:
      - backend
    networks: [rbac-net]
```

注意那句注释——"**不再**直接对外"。这个"不再"是有故事的，`06` 会挖。

### 3.2 一个反直觉的事实：nginx 不是最外层

如果你去读 `docs/09-部署上线指南.md` 第 22-26 行，会看到这样一张图：

```
浏览器 ──80/443──> nginx 容器
                    ├── /        → 直接返回 frontend/dist 静态文件（发前端）
                    └── /api/    → 反向代理到 backend 容器:8080
```

同一份文档第 42 行还明说了：「nginx 是整个部署的唯一入口（占 80/443）」。

**这张图现在是过时的。** 真实情况是 caddy 占着 80/443，nginx 已经缩回内网了。`docs/09` 写于 2026-07-14，那天 caddy 还没来；caddy 是同一天晚些时候接入的（见 `docs/ops/02-域名与HTTPS配置.md`）。

这不是要挑文档的刺，而是一个必须先建立的认知：

> 🔑 **nginx 在本项目是内网组件，不是边界组件。** 它监听的 80 端口从来没有暴露在公网上；它面前站着 caddy。这个定位决定了它的配置里为什么没有 TLS、为什么没有限流、为什么 `server_name` 可以随便写。后面每一节都会用到这个前提。

顺带记住这个事实：**文档会漂移，配置文件不会说谎**。`06` 会把 `docs/09` 的几处漂移拿出来当案例讲，因为文档漂移比代码 bug 更坑人——bug 只是不工作，漂移的文档会**主动把人带进沟里**。

---

## 四、第一个扣：这个项目里有两份 nginx.conf

现在做一件事：在项目里搜 `nginx.conf`。你会搜到两个：

| 路径 | 是什么 |
|---|---|
| `frontend/nginx.conf` | **线上真正在跑的那份**，被 `frontend/Dockerfile` 烤进 `rbac-frontend` 镜像 |
| `deploy/config/nginx/nginx.conf` | 另一份，被 `deploy/docker-compose.yml` 里一个叫 `nginx` 的服务挂载 |

两份文件的开头 15 行**几乎一模一样**，后面开始分岔。更麻烦的是，compose 里那个 `nginx` 服务是这样的：

```yaml
  # ==================== 扩展层（--profile extra） ====================
  nginx:
    image: nginx:1.27
    container_name: rbac-nginx
    profiles: ["extra"]              # ← 默认不启动，要 --profile extra 才起
    restart: unless-stopped
    ports:
      - "80:80"                      # ← 它想占宿主机 80 端口
    volumes:
      - ./config/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    networks: [rbac-net]
```

而 caddy 是这样的：

```yaml
  caddy:
    image: caddy:2.8
    ...
    ports:
      - "80:80"                      # ← 它也要 80
      - "443:443"
```

**两个服务都要宿主机的 80 端口。** 一台机器上同一个端口只能有一个进程监听，所以在线上跑 `docker compose --profile extra up -d` 会直接失败。

这一整摊事——为什么会有两份、哪份是真的、为什么留着一份会炸的配置——是 `06` 要还的债。现在你只需要记住：**看到 `nginx.conf` 先确认是哪一份**。

## 五、第二个扣：一行 TLS 都没有

线上访问的是 `https://www.eureka32.top`，有锁。但你去翻这两份 nginx.conf，会发现：

- 没有 `listen 443`
- 没有 `ssl_certificate`
- 没有任何证书路径
- 只有孤零零一行 `listen 80`

**HTTPS 是怎么来的？** 提示已经在第三节的图里了。完整答案（包括"如果不用 caddy，nginx 自己做 TLS 得写成什么样"的对照配置）在 `05`。

---

## 六、nginx vs caddy：为什么两个都在跑

既然 caddy 也能发静态文件、也能反代，为什么不把 nginx 直接删了，让 caddy 一个人干完？

技术上**完全可以**。留着 nginx 是**演进的结果，不是设计的结果**：

1. 项目先有了前端 nginx 镜像（发 dist + 反代 `/api`），跑通了，上线了。
2. 后来要上 HTTPS。nginx 自己也能做 TLS，但要么手动申请证书、要么配 certbot 定时续期，都是活。
3. caddy 的卖点是**自动申请 + 自动续期 Let's Encrypt 证书**，配置只有两行。于是选了"在前面加一层 caddy"，而不是"改造 nginx"。

看 `deploy/config/caddy/Caddyfile` 的全部内容，真的就两行有效配置：

```
# Caddy 会自动为该域名申请 + 续期 Let's Encrypt 证书，并把 http 强制跳转到 https。
www.eureka32.top {
    # 反代给现有的 frontend(nginx) 容器；它继续发 SPA 静态文件 + 反代 /api 给 backend
    reverse_proxy frontend:80
}
```

注释里"**继续**发 SPA 静态文件"这个词，就是这次演进的态度：**已经能跑的部分一个字都不动，只在前面加一层**。代价是链路多了一跳、多了一个容器；收益是不用碰能跑的东西，也不用伺候证书。

| | nginx | caddy |
|---|---|---|
| 本项目职责 | 发 dist 静态文件 + 反代 `/api` | TLS 终结 + 自动证书 + 反代给 frontend |
| 位置 | 内网第二跳 | 唯一对外入口 |
| 配置量 | 45 行 | 5 行 |
| HTTPS | 要手写一堆 ssl_* 指令 + 自己搞证书 | 写个域名就自动了 |
| 生态/可控性 | 模块多、能调的旋钮极多、遇到问题搜得到答案 | 少而美，但复杂需求会撞墙 |

> 🔑 这不是"哪个更好"的问题。nginx 是内网的分流器，caddy 是外网的门卫，**在本项目里它们不是竞品，是上下游**。真要说的话，caddy 之所以能只写两行，正是因为 nginx 已经把脏活干完了。

---

## 动手练习

> 本系列全部练习都是**思考题**，不需要敲命令。请对着仓库里的真实文件推，别凭印象。

### 练习 1：走一遍链路

用户在浏览器地址栏敲 `https://www.eureka32.top/system/user` 并回车。请按顺序写出：这个请求依次经过哪几个容器？每一跳分别用什么协议、什么端口？最终是谁把内容返回的？

### 练习 2：找出所有"nginx 的身份证"

在仓库里找出**所有**能证明"本项目在用 nginx"的地方（提示：不止 `.conf` 文件，还有镜像声明、端口声明等）。列出文件路径 + 行号。至少能找到 4 处。

### 练习 3：如果前端写死了域名

假设某天有人把前端代码里的 `/api/users` 改成了 `http://106.15.89.180:8080/api/users`。请推演：浏览器访问 `https://www.eureka32.top` 时会发生什么？会报什么错？涉及几个问题？（提示：不止一个）

### 练习 4：删掉 nginx 可行吗

假设要把 nginx 从本项目彻底删掉，让 caddy 一个人发静态文件 + 反代 `/api`。请列出至少 3 个必须改动的地方（具体到文件），并说出这次改动最大的风险是什么。

---

## 自检问题

1. 正向代理和反向代理的本质区别是什么？本项目的 nginx 属于哪种？
2. 为什么前端代码里写相对路径 `/api/users` 而不是完整 URL？这跟 nginx 有什么关系？
3. `npm run dev` 时并没有 nginx，那开发环境里 `/api` 的请求是谁转发的？
4. 本项目的 nginx 监听 80 端口。这个 80 端口在公网上能访问到吗？为什么？
5. `docs/09-部署上线指南.md` 说 "nginx 是整个部署的唯一入口（占 80/443）"。这句话现在还对吗？
6. 项目里有两份 `nginx.conf`，线上跑的是哪一份？你怎么证明？

---

## 承上启下

本节把 nginx 放回了它在项目里的真实位置：**内网第二跳，负责发静态文件 + 按路径分流**。也埋了两个扣：两份配置（`06` 还）、没有 TLS（`05` 还）。

下一节开始动真格，逐行读 `frontend/nginx.conf`。先从最顶上这四行开始：

```nginx
user  nginx;
worker_processes  auto;              # ← auto 是几个？
error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;        # ← 这是说最多 1024 个人同时访问吗？
}
```

那两个问号，`01` 会给出答案——其中第二个的答案，和大多数人的第一反应**不一样**。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

### 自检问题

<details>
<summary><b>1. 正向代理和反向代理的本质区别是什么？本项目的 nginx 属于哪种？</b></summary>

区别不在技术实现，在**立场**：代理是替客户端工作还是替服务端工作。

- 正向代理站在客户端一侧，客户端必须主动配置它，服务器看不到真实客户端。
- 反向代理站在服务端一侧，客户端**完全不知道它的存在**，以为自己直接在和目标服务器通信；它隐藏的是服务端的架构。

本项目的 nginx 是**反向代理**：浏览器发 `/api/users`，以为是 nginx 处理的，实际上 nginx 转给了 backend。浏览器全程不知道 backend 存在，也不知道后面还有 mysql 和 redis。

补充一个容易忽略的点：本项目里 caddy 对 nginx 来说也是反向代理。反向代理是可以串起来的，链路上每一跳都对下一跳隐藏了更后面的东西。
</details>

<details>
<summary><b>2. 为什么前端代码里写相对路径 <code>/api/users</code> 而不是完整 URL？这跟 nginx 有什么关系？</b></summary>

因为浏览器的**同源策略**。写相对路径，浏览器自动补上当前页面的源，请求就发向 `https://www.eureka32.top/api/users`——和页面同源，不触发 CORS，不需要预检请求，服务端也不用配 CORS 响应头。

这个便利的前提是：**必须有人在服务端把 `/api/**` 认出来转给后端**，否则同源的代价就是"这个路径根本没有对应的后端"。nginx 的 `location /api/` 就是干这个的。

还有一层附加好处：换域名、上 HTTPS、改后端端口，前端代码**一行都不用动**（`docs/ops/02-域名与HTTPS配置.md:23` 明确记了这一点——接 caddy 上 HTTPS 时前端根本没重新构建）。
</details>

<details>
<summary><b>3. <code>npm run dev</code> 时并没有 nginx，那开发环境里 <code>/api</code> 的请求是谁转发的？</b></summary>

Vite dev server 自己转的。见 `frontend/vite.config.ts:23-29` 的 `server.proxy` 配置，把 `/api` 转给 `http://localhost:8080`。

这是和 nginx `location /api/` **完全同构**的机制，只是实现方不同、后端地址不同（开发是宿主机进程 `localhost:8080`，生产是容器服务名 `backend:8080`）。

这也是为什么前端代码在两个环境之间不用改：两边都保证了"`/api` 与页面同源且可达"这个契约，只是履约的人不一样。
</details>

<details>
<summary><b>4. 本项目的 nginx 监听 80 端口。这个 80 端口在公网上能访问到吗？为什么？</b></summary>

**访问不到。** 有两道锁：

1. `deploy/docker-compose.yml:97-98` 里 `frontend` 服务用的是 `expose: ["80"]` 而不是 `ports: ["80:80"]`。`expose` 只在 Docker 内网（`rbac-net`）里可达，**不映射到宿主机**。宿主机上都访问不到，更别说公网。
2. 就算映射了，阿里云安全组只放行 22/80/443，而宿主机的 80 已经被 caddy 占了。

所以 nginx 的 80 端口只有一个客户：同在 `rbac-net` 里的 caddy 容器。

顺带说：`frontend/Dockerfile:21` 那句 `EXPOSE 80` 是**纯声明**，是镜像作者写给使用者看的文档，它自己不开放任何东西（`learning-docker 06` 讲过"`expose` 是纸老虎"）。
</details>

<details>
<summary><b>5. <code>docs/09</code> 说 "nginx 是整个部署的唯一入口（占 80/443）"。这句话现在还对吗？</b></summary>

**不对了。** 现在的唯一对外入口是 **caddy**（`deploy/docker-compose.yml:109-111` 占着 80 和 443），nginx 缩到内网（`expose: ["80"]`）。

这是典型的**文档漂移**：`docs/09` 写于 2026-07-14，当时确实是 nginx 直接对外；同一天晚些时候接入 caddy 后（见 `docs/ops/02-域名与HTTPS配置.md:48`——明确记录了 `ports: ["80:80"]` → `expose: ["80"]` 这次改动），架构变了，但 `docs/09` 没跟着改。

判断依据永远是：**以配置文件为准，文档只是旁证**。`06` 会把 `docs/09` 的几处漂移集中拿出来当案例。
</details>

<details>
<summary><b>6. 项目里有两份 <code>nginx.conf</code>，线上跑的是哪一份？你怎么证明？</b></summary>

线上跑的是 **`frontend/nginx.conf`**。

证据链（三步，缺一不可）：

1. `frontend/Dockerfile:18` —— `COPY nginx.conf /etc/nginx/nginx.conf`。构建上下文是 `frontend/`（见 `deploy/docker-compose.yml:92-93` 的 `context: ../frontend`），所以这里 `COPY` 的就是 `frontend/nginx.conf`，它被烤进了 `rbac-frontend` 镜像。
2. `deploy/docker-compose.yml:91-101` —— 线上跑的 `frontend` 服务用的正是这个镜像。
3. 另一份 `deploy/config/nginx/nginx.conf` 只被 `nginx` 服务挂载（`:129`），而那个服务是 `profiles: ["extra"]`（`:124`），**默认不启动**。线上从来没起过它。

反过来还有一个佐证：另一份的 upstream 指向 `host.docker.internal:8080`（宿主机），而线上的 backend 根本不在宿主机上跑、也没映射 8080 到宿主机（`:87` 那行注释写明了）。就算它起来了也是 502。
</details>

### 练习 1（走一遍链路）

<details>
<summary><b>点开看答案</b></summary>

```
① 浏览器 ──HTTPS/TLS，公网:443──► caddy 容器
   （caddy 在这里做 TLS 终结：解密，还原成明文 HTTP 请求）

② caddy ──明文 HTTP，内网 rbac-net:80──► frontend 容器(nginx)
   （依据 Caddyfile 的 reverse_proxy frontend:80）

③ nginx 判断路径 /system/user：不是 /api/ 开头 → 进 location /
   → try_files 找 /usr/share/nginx/html/system/user，没有
   → 找目录，也没有
   → 回退到 /index.html ✔

④ nginx 把 index.html 原样返回 ──► caddy ──加密──► 浏览器

⑤ 浏览器加载 index.html → 加载 JS → Vue Router 启动 → 看到当前 URL 是
   /system/user → 渲染对应页面
⑥ 页面再发 GET /api/... 拿数据 → 这次是 /api/ 开头 → 走 location /api/
   → 转给 backend:8080 → backend 查 mysql/redis
```

**最终把内容返回的是 nginx**（它发的 index.html），但**页面上你看到的用户列表是 Vue 在浏览器里渲染的**，数据来自第 ⑥ 步。

关键点：第 ③ 步那个"回退到 index.html"是 SPA 能正常工作的命门。`docs/09:38` 明确点过这个坑——不配 `try_files`，刷新 `/system/user` 直接 404。`03` 会把这条讲透。
</details>

### 练习 2（找出所有"nginx 的身份证"）

<details>
<summary><b>点开看答案</b></summary>

至少 7 处：

| # | 文件 | 行 | 内容 |
|---|---|---|---|
| 1 | `frontend/nginx.conf` | 全文 45 行 | 线上真配置 |
| 2 | `deploy/config/nginx/nginx.conf` | 全文 39 行 | 遗留配置 |
| 3 | `frontend/Dockerfile` | 17 | `FROM nginx:1.27` ← 运行阶段的基础镜像 |
| 4 | `frontend/Dockerfile` | 18 | `COPY nginx.conf /etc/nginx/nginx.conf` |
| 5 | `frontend/Dockerfile` | 19 | `COPY --from=build /app/dist /usr/share/nginx/html` ← 这个路径是 nginx 的默认站点根目录 |
| 6 | `deploy/docker-compose.yml` | 121-130 | `nginx` 服务（profile extra） |
| 7 | `deploy/docker-compose.yml` | 89-101 | `frontend` 服务 —— 注释第一句就是"前端 nginx" |

容易漏掉的是第 5 处：`/usr/share/nginx/html` 这个路径本身就是 nginx 官方镜像的约定，看到它就该反应过来这是 nginx。

还有一个"隐形"的：`deploy/config/caddy/Caddyfile:3` 的注释里写着 `frontend(nginx)`——caddy 的配置在提醒你它的下游是 nginx。
</details>

### 练习 3（如果前端写死了域名）

<details>
<summary><b>点开看答案</b></summary>

会同时炸三个问题，一个比一个严重：

1. **协议降级 / 混合内容拦截**：页面是 `https://` 打开的，却要发 `http://` 请求。浏览器判定为 **Mixed Content（混合内容）**，直接拦截，请求根本发不出去。控制台报 "was loaded over HTTPS, but requested an insecure resource"。

2. **跨域（CORS）**：就算把它改成 `https://106.15.89.180:8080`，`106.15.89.180:8080` 和 `www.eureka32.top:443` 三要素（协议/域名/端口）全不同 → 跨源。后端没配 CORS 响应头 → 浏览器拦截。

3. **端口根本不通**：`deploy/docker-compose.yml:87` 那行注释写着"不映射 8080 到宿主机，只让 frontend 容器走内网反代"。backend 的 8080 **压根没暴露到宿主机**，更不用说阿里云安全组只放行 22/80/443。所以就算前两个问题都解决了，这个请求也是连不上。

**这就是相对路径的价值**：一行 `/api/users` 同时绕开了这三个坑，而且开发/生产两套环境通用。
</details>

### 练习 4（删掉 nginx 可行吗）

<details>
<summary><b>点开看答案</b></summary>

技术上可行。caddy 能发静态文件（`file_server` 指令）、能反代（`reverse_proxy`）、也能做 SPA 回退（`try_files {path} /index.html`）。

至少要改 4 处：

1. **`frontend/Dockerfile`** —— 运行阶段不能再 `FROM nginx:1.27`。要么改成 caddy 镜像，要么干脆废掉这个镜像，把 `dist` 直接挂载/复制给 caddy 容器。
2. **`deploy/config/caddy/Caddyfile`** —— 从 2 行变成要写 `root`、`file_server`、`handle /api/*` 反代 backend、SPA `try_files`。caddy 的语法和 nginx 完全不同，得重学。
3. **`deploy/docker-compose.yml`** —— 删 `frontend` 服务；caddy 要能拿到 `dist`（新增挂载或改构建）；`caddy` 的 `depends_on` 从 `frontend` 改成 `backend`。
4. **`deploy/config/nginx/nginx.conf` + compose 里的 `nginx` 服务** —— 这时候就纯属垃圾了，该删。

**最大的风险**：改的是**唯一对外入口**。改坏了不是某个功能不好使，是**整站 502 或直接打不开**，而且 caddy 那两行现在还兼着 TLS——万一 Caddyfile 语法错误导致 caddy 起不来，连 HTTPS 一起没了。

更要命的是证书：反复重建 caddy 容器有触发 **Let's Encrypt 限流**的风险（`docs/ops/02:96` 专门警告过：每域名每周有签发上限，被限流就是**等一周**，不是重启能解决的）。

**收益/风险比很差**：省一个容器、少一跳内网转发，换来一次可能让站点下线的改动，还要重学一套配置语法。所以现状虽然"不优雅"，但留着是对的。真要清理，该先清的是那个已经没用还会抢 80 端口的 `nginx` 服务——那个才是纯负债（`06` 详谈）。
</details>
