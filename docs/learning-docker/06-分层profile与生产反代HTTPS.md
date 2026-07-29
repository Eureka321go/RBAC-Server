# 06 · 分层 profile 与生产反代 HTTPS

> **学习目标**：搞懂同一份 compose 文件怎么按需启动不同规模的服务，以及一个生产系统为什么只留一个对外的口子。
>
> **读完你能**：
> - 说清 `profiles` 的判定规则，以及三种激活 profile 的方式；
> - 用 `docker compose config --services` 亲眼验证哪些服务会被启动；
> - 回答 `expose` 到底做了什么——**这个答案和绝大多数教程说的不一样**；
> - 讲明白本项目 backend / frontend / caddy 三级递减的暴露面是怎么设计的；
> - 逐行读懂 `Caddyfile`，说出自动 HTTPS 的完整过程，以及为什么 `80` 和 `443` 两个端口一个都不能少；
> - 解释本项目为什么有**两个 nginx 配置**，它们分别是干什么的。

---

## 一、承上：还剩三块

`05` 结束时，核心层（mysql + redis）每一个字段你都能讲出为什么了。但 `deploy/docker-compose.yml` 一共 217 行，你精读过的还不到一半。剩下的东西可以归成三块：

| 剩下的 | 是什么问题 |
|---|---|
| `profiles: ["extra"]` / `["full"]` | 一份文件，怎么按需起不同规模？ |
| `frontend` 的 `expose: - "80"` | 和 `ports` 差在哪？ |
| `caddy` 整个服务段 + `Caddyfile` | HTTPS 证书怎么会自己长出来？ |

这三块合起来，回答的其实是同一个问题：**这套编排从"能在我机器上跑"变成"能对着公网提供服务"，中间差了什么。**

---

## 二、`profiles`：一份文件，几套规模

### 2.1 先看要解决的问题

本项目的 compose 文件里，除了 mysql / redis，还有 nginx、rabbitmq 和 kafka。

问题来了：**你每天写 RBAC 的增删改查，需要 Kafka 吗？**

普通 RBAC 功能不需要 Kafka；只有 IM 消息流等场景才需要它。所以配置保留在 `full` profile 中，按需启动。Elasticsearch/Kibana 没有业务依赖，已从编排中移除，避免为未使用的能力长期占用资源。

`profiles` 解决的就是这个矛盾：**配置写在文件里（不丢），但默认不启动（不占资源）。**

### 2.2 判定规则

规则只有两条，非常干脆：

> 🔑 **`profiles` 的判定规则**
>
> | 服务写了什么 | 什么时候启动 |
> |---|---|
> | **没有** `profiles` 字段 | **永远启动**。任何 `up` 都会带上它 |
> | 有 `profiles: ["extra"]` | **只有 `extra` 被激活时**才启动；否则 Compose 当它不存在 |
>
> 注意"当它不存在"是字面意思：没激活 profile 时，这个服务连 `docker compose config` 的输出里都不会出现。

一个关键的推论，很多人会搞反：

> 🔑 **不写 `profiles` ≠ "属于默认 profile"，而是"不受 profile 管辖"。**
>
> 没有"default" 这个 profile。**没写 = 无条件启动**。所以你没法用 profile 把 mysql 关掉——它压根不在这套机制的管辖范围内。

### 2.3 本项目的三层

文件头部的注释（第 6-16 行，真实内容）已经把设计写清楚了：

```yaml
# 分层启动（用 profile 控制）：
#   核心层（默认，无 profile）：mysql、redis
#   扩展层（--profile extra）  ：nginx、rabbitmq
#   完整层（--profile full）   ：kafka
#
# 常用命令：
#   仅核心      : docker compose up -d
#   核心+扩展   : docker compose --profile extra up -d
#   全部        : docker compose --profile extra --profile full up -d
#   停止        : docker compose down
#   停止并清数据: docker compose down -v
```

对应到服务上，`profiles` 字段就三处写法（都是真实行号）：

```yaml
  nginx:
    profiles: ["extra"]     # 第 124 行
  rabbitmq:
    profiles: ["extra"]     # 第 135 行

  kafka:
    profiles: ["full"]      # 第 157 行
```

注意最后一条命令：**`--profile extra --profile full`，两个都要写**。

这里藏着一个容易想当然的地方：**`full` 不包含 `extra`**。名字听起来像"完整层 ⊃ 扩展层"，但 Compose 里 **profile 之间没有任何层级关系**——它就是一组标签，激活哪个起哪个。"分层"完全是这份文件用注释和命名**约定**出来的人类概念，Compose 本身不知道。

### 2.4 亲眼验证

不用起容器，`docker compose config --services` 就能看到"这条命令会起哪些服务"。下面是在本项目 `deploy/` 目录下跑出来的**真实输出**：

```bash
$ cd deploy
$ docker compose config --services
mysql
redis
backend
frontend
caddy
```

```bash
$ docker compose --profile extra config --services
redis
mysql
backend
frontend
caddy
nginx        # ← 多出来了
rabbitmq     # ← 多出来了
```

```bash
$ docker compose --profile extra --profile full config --services
mysql
redis
backend
frontend
kafka            # ← full 层
nginx
rabbitmq
caddy
```

（输出顺序是乱的，别在意，Compose 不保证顺序。）

第一组输出请多看两眼：**默认状态下有 5 个服务**——mysql、redis、backend、frontend、caddy。你本地现在只跑着 mysql 和 redis，那是因为你当初只 `up` 了它们；**按这份文件的设计，`docker compose up -d` 本来是要把这 5 个全起起来的**。你阿里云那台跑的就是这 5 个。

> 🔑 **`config` 是你的"预演"命令。** 它只做解析、不碰容器：变量替换成什么、profile 之后到底剩哪些服务，全都摊开给你看。**改完 compose 文件先 `config` 一把再 `up`**，这个习惯能省掉大量"起来了但不对"的排查时间。

还有个命令能列出这份文件定义过的所有 profile：

```bash
$ docker compose config --profiles
extra
full
```

### 2.5 三种激活方式

| 方式 | 怎么写 | 什么时候用 |
|---|---|---|
| 命令行参数 | `docker compose --profile extra up -d` | 临时起一次 |
| 环境变量 | 在 `deploy/.env` 里加 `COMPOSE_PROFILES=extra,full` | 我这台机器**长期**就要带着它们 |
| 直接点名服务 | `docker compose up -d rabbitmq` | 就想起这一个 |

第三种值得说一下：**你在命令行直接点名一个带 profile 的服务，Compose 会自动把它的 profile 激活**，不用再写 `--profile`。这是 Compose v2 之后的行为（你本机是 v5.2.0，没问题）。

注意 `--profile` 的**位置**：它是 `docker compose` 的参数，**必须放在 `up` 前面**。写成 `docker compose up --profile extra -d` 是不认的。这个位置错误特别高频，因为大多数 CLI 都习惯把参数放后面。

### 2.6 一个真实的坑：nginx 和 caddy 抢 80

现在做个小推理。看 `nginx`（第 126-127 行）和 `caddy`（第 109-111 行）的真实配置：

```yaml
  nginx:
    profiles: ["extra"]
    ports:
      - "80:80"        # ← 抢宿主机 80

  caddy:
    ports:
      - "80:80"        # ← 也要宿主机 80
      - "443:443"
```

**两个服务都要宿主机的 80 端口。** 而 caddy 没有 profile，意味着它永远启动。

所以在你阿里云那台（caddy 正跑着）上敲 `docker compose --profile extra up -d`，会发生什么？

```
Error ... failed to bind host port for 0.0.0.0:80 ... address already in use
```

**就是你在 `01` 手动 `docker run mysql` 时踩过的那个 `port is already allocated`。** 当时是你的 `rbac-mysql` 占着 3306，这次是 caddy 占着 80。同一个原理：**宿主机的一个端口只能给一个容器**。

> 🔑 **profile 只管"起不起"，不管"起了会不会打架"。**
>
> Compose 不会帮你检查两个服务的 `ports` 是不是冲突——它老老实实照你写的去 bind，然后由操作系统把请求驳回。**分层设计里，任何两层之间的端口冲突都是你自己的责任。**

（你本机现在只跑 mysql/redis，没人占 80，所以本地 `--profile extra up -d` 反而不会冲突。这也说明一件事：**这类坑在开发机上常常是隐形的，到了服务器才炸。**）

### 2.7 为什么 backend / frontend / caddy 不带 profile

看这三个服务，它们都在"应用层"的注释下面（第 63 行）：

```yaml
  # ==================== 应用层（前后端，随核心层一起起） ====================
```

**它们一个 `profiles` 都没写，所以永远启动。** 理由很直白：**没有它们，这个项目就不叫 RBAC-Server 了。**

`extra` / `full` 里那些是"可选依赖"——没有 Kafka，RBAC 照样能登录、能管权限。但没有 backend，起一堆中间件给谁用？

> 🔑 **profile 的划分依据是"缺了它，系统还成立吗"。**
>
> 成立 → 可以进 profile（按需起）。
> 不成立 → 不写 profile（无条件起）。
>
> 这不是 Docker 的规定，是**你对自己系统的理解**在配置文件里的投影。一份 compose 文件的 profile 怎么分，暴露的是设计者觉得什么是主干、什么是枝叶。

---

## 三、`expose` vs `ports`：一个诚实的答案

### 3.1 先复习 `04` 的结论

`04` 讲透了一句话，现在请你原样想起来：

> 🔑 **`ports` 是"对外开窗户"，不是"对内开门"。**
>
> - 容器之间互访（`backend` 连 `mysql:3306`）→ **不需要** `ports`，同一个网络里全通。
> - 宿主机 / 外网要访问容器 → **才需要** `ports`。

**最有力的证据就是 `backend`**（第 86-87 行，真实内容）：

```yaml
    networks: [rbac-net]
    # 不映射 8080 到宿主机，只让 frontend 容器走内网反代
```

`backend` 没有 `ports`，外面碰不到它，但 `frontend` 照样能反代过去。

当时说好了这一节把这个思路推到极致。现在开始。

### 3.2 那 `expose` 做了什么？

看 `frontend`（第 97-98 行，真实内容）：

```yaml
    expose:
      - "80"
```

按字面直觉，`expose` 应该是"把 80 端口在内网暴露出来"，对吧？

**不对。而且是反着的。**

请把 `04` 的结论和这个字段放在一起想三秒：**同一个网络里的容器，端口本来就全通**（`backend` 没写任何东西，`frontend` 照样连得上它的 8080）。

既然本来就全通——

> 🔑 **`expose` 什么也没打开，因为压根没有东西需要打开。**
>
> 它**不创建**任何映射，**不改变**任何网络规则，**不影响**任何容器的可达性。把 `frontend` 的 `expose: - "80"` 整段删掉，caddy 照样能反代到 `frontend:80`，**一切如常**。
>
> 它是一句**写给人看的声明**：「这个容器对外提供服务的端口是 80」。

这是整个 Docker 学习路上**误解率最高的字段之一**。很多教程会说"`expose` 是只在内网暴露，`ports` 是对外暴露"——这话给人的印象是 `expose` 干了某种活儿，但**它没有**。内网的通不通，从头到尾由**网络**决定（`04` 讲的 `rbac-net`），跟 `expose` 一个字的关系都没有。

### 3.3 Dockerfile 里的 `EXPOSE` 也一样

顺便把 `02` 的一个尾巴收掉。`frontend/Dockerfile` 最后两行（第 20-21 行，真实内容）：

```dockerfile
#声明容器会用哪个端口
EXPOSE 80
```

**同样是纯声明。** 它的实际作用有两个，都很轻：

1. **文档**：别人 `docker inspect` 你的镜像，能看到"这镜像打算用 80"，不用去翻 nginx 配置。
2. **`docker run -P`**（大写 P）会把所有 `EXPOSE` 的端口**随机**映射到宿主机。这个用法在 compose 场景里基本用不到。

所以 `frontend` 这边其实**声明了两遍**（Dockerfile 一遍、compose 一遍），两遍都不产生实际效果。**这不是冗余错误，是一致的表达习惯**——镜像层面声明一次给用镜像的人看，编排层面声明一次给读 compose 的人看。

### 3.4 那纵深防护到底靠什么？

既然 `expose` 不干活，那本项目"外面碰不到 backend"这件事，**靠的是什么？**

> 🔑 **靠的是"没写 `ports`"。**
>
> 安全性来自**沉默**，不来自声明。`ports` 是唯一一个真正打洞的字段——**你不写它，洞就不存在**。

想通这一点，再看本项目这三个服务，设计就完全清楚了（都是真实配置）：

```yaml
  backend:                       # 第 65 行
    # 既没有 ports，也没有 expose
    # 注释：不映射 8080 到宿主机，只让 frontend 容器走内网反代

  frontend:                      # 第 91 行
    expose:
      - "80"                     # 声明：我提供 80，但没开任何洞

  caddy:                         # 第 105 行
    ports:
      - "80:80"                  # 真·对外
      - "443:443"                # 真·对外
```

**三级递减的暴露面：**

| 服务 | 写了什么 | 外网能碰到吗 | 谁能碰到它 |
|---|---|---|---|
| `mysql` / `redis` | `ports: "3306:3306"` / `"6379:6379"` | ⚠️ **能**（宿主机） | 宿主机 + 内网所有容器 |
| `backend` | **什么都没写** | ❌ 不能 | 只有 `rbac-net` 里的容器 |
| `frontend` | `expose: "80"`（声明） | ❌ 不能 | 只有 `rbac-net` 里的容器 |
| `caddy` | `ports: "80:80"` `"443:443"` | ✅ **能** | 全世界 |

> 🔑 **整个系统对公网只有 caddy 一个入口。** 打进来的所有流量，必须从 caddy 这道门过。backend 藏在两层后面——攻击者就算知道你用 Spring Boot，也没有任何一个端口可以直接怼上去。

**注意那一行 ⚠️。** `mysql` 和 `redis` 把 3306 / 6379 映射到了宿主机——`05` 说过那是为了本地开发方便（你要用 Navicat 连）。但在阿里云那台公网机器上，**这两行就是实打实的暴露面**：只要安全组放行了，全世界都能来试你的 MySQL 密码。

本项目目前靠**阿里云安全组只放行 80/443** 挡着，也就是说：**你的数据库安全依赖于一个 compose 文件之外的配置**。这不是错，但你必须知道这根弦挂在哪儿——真正的生产配置会把这两行 `ports` 删掉，让它们和 backend 一样彻底消失在内网里。

（`07` 讲运维时会回到这个话题。）

---

## 四、Caddy：唯一的对外入口

### 4.1 完整的请求链路

先把 `04` 学的网络、`05` 学的卷、本节学的 `ports` 串成一条线。你在浏览器敲 `https://www.eureka32.top/api/system/user/list`，发生的是：

```
   浏览器
     │  https://www.eureka32.top/api/...
     ▼
 ┌───────────────────────────────────────────────────────────┐
 │ 阿里云主机                                                  │
 │   :443 ◀── 唯一对外的口子（caddy 的 ports）                  │
 │     │                                                      │
 │     ▼                                                      │
 │ ┌─────────────────── rbac-net（内网）────────────────────┐ │
 │ │                                                        │ │
 │ │  caddy ──── TLS 终结，解出明文 HTTP                     │ │
 │ │    │        reverse_proxy frontend:80                  │ │
 │ │    ▼                                                   │ │
 │ │  frontend(nginx) ── /api/ 命中 → proxy_pass            │ │
 │ │    │                 其他路径 → 发 index.html          │ │
 │ │    ▼                                                   │ │
 │ │  backend(:8080) ── Spring Boot                         │ │
 │ │    │                                                   │ │
 │ │    ├──▶ mysql:3306                                     │ │
 │ │    └──▶ redis:6379                                     │ │
 │ └────────────────────────────────────────────────────────┘ │
 └───────────────────────────────────────────────────────────┘
```

**从 caddy 往里的每一跳，用的都是服务名**（`frontend:80`、`backend:8080`、`mysql:3306`）——那是 `04` 讲的"服务名即 DNS"。**这四跳里只有第一跳是加密的**：TLS 在 caddy 这里就终结了，内网里跑的是明文 HTTP。这是标准做法——`rbac-net` 是宿主机内部的虚拟网络，流量不经过任何物理网线。

### 4.2 逐行读 `Caddyfile`

`deploy/config/caddy/Caddyfile` **全文只有 5 行**（真实内容，一字未改）：

```caddyfile
# Caddy 会自动为该域名申请 + 续期 Let's Encrypt 证书，并把 http 强制跳转到 https。
www.eureka32.top {
    # 反代给现有的 frontend(nginx) 容器；它继续发 SPA 静态文件 + 反代 /api 给 backend
    reverse_proxy frontend:80
}
```

**就这样。一个域名，一行反代，HTTPS 就全好了。**

对比一下：用 nginx 做同样的事，你需要写 `server` 块、`listen 443 ssl`、`ssl_certificate` 路径、`ssl_certificate_key` 路径，再配一个 80 的 `server` 块做跳转，然后**自己去装 certbot**、配定时任务续期、续期后 reload nginx。**这 5 行 Caddyfile 替掉的是那一整套。**

逐行拆：

| 这一行 | 语法上是什么 | 实际作用 |
|---|---|---|
| `www.eureka32.top {` | **站点地址**（site address） | 声明这个站点服务哪个域名。**Caddy 一看见这是个域名（不是 `:80` 也不是 `localhost`），就自动开启 HTTPS** |
| `reverse_proxy frontend:80` | 一条指令（directive） | 把请求原样转给 `frontend` 容器的 80 端口 |
| `}` | 块结束 | — |

> 🔑 **自动 HTTPS 的触发条件是"站点地址长得像个域名"。**
>
> 你没写任何一个和证书、TLS、443 有关的字段。`www.eureka32.top` 这个字符串本身就是开关。如果这里写的是 `:80` 或者 `localhost`，Caddy 就**不会**去申请证书（本地开发时就该这么写——总不能给 localhost 申请公网证书）。

`reverse_proxy frontend:80` 里那个 `frontend`，就是 compose 里的服务名。**Caddy 能解析它，是因为 caddy 和 frontend 都在 `rbac-net` 里**（第 118 行 `networks: [rbac-net]`）——`04` 的知识，在这里直接用上了。

### 4.3 自动 HTTPS 到底发生了什么

「自动申请证书」听起来很魔法，其实过程是标准的、可以完整讲清楚的：

```
caddy 容器启动
  │
  ├─▶ 读 Caddyfile，发现站点地址是域名 www.eureka32.top
  │     → 开启自动 HTTPS
  │
  ├─▶ 先看 /data 里有没有这个域名的有效证书
  │     ├── 有且没过期 ──▶ 直接用，不申请 ✅（这就是 caddy-data 卷的意义）
  │     └── 没有 ──▶ 走 ACME 流程 ↓
  │
  ├─▶ 向 Let's Encrypt 发起 ACME 申请
  │     LE 说："你得先证明 www.eureka32.top 真是你的"
  │
  ├─▶ HTTP-01 挑战：
  │     LE 从公网访问 http://www.eureka32.top/.well-known/acme-challenge/<随机串>
  │     caddy 在 :80 上应答这个随机串 ✅
  │     → LE 确认：能在这个域名的 80 端口放东西的，就是域名的主人
  │
  ├─▶ LE 签发证书 → caddy 存进 /data
  │
  └─▶ 开始服务：
        :443 用证书做 TLS
        :80  除了应答挑战，一律 301 跳转到 https ↗
        （之后每 ~60 天自动续期，全程无人干预）
```

现在可以回答一个关键问题了：

> 🔑 **为什么 caddy 的 `ports` 必须是 `80` 和 `443` 两个，一个都不能少？**
>
> - **`443`**：HTTPS 本体。这个好理解。
> - **`80`**：有**两个**用途，缺一不可——
>   1. **ACME HTTP-01 挑战必须走 80**。这是 Let's Encrypt 定死的，不接受别的端口（想想也合理：如果挑战能走任意端口，那随便租个高位端口的人都能冒充域名主人）。**删掉 `80:80`，证书就永远申请不下来**。
>   2. **接住敲 `http://` 的用户**，301 跳到 https。

而 HTTP-01 挑战这个机制，也解释了**为什么本地开发做不了自动 HTTPS**：Let's Encrypt 要从**公网**来访问你的 80 端口。你的 Mac mini 在家里的路由器后面，LE 找不到你。**你必须有一台公网可达的机器 + 一个解析到它的域名**——这正是你在阿里云上做的事。

### 4.4 `caddy-data`：`05` 那笔账的下文

`05` 第六节讲 `:ro` 时提到了这个卷，说 `06` 会展开。现在展开（第 112-115 行，真实内容）：

```yaml
    volumes:
      - ./config/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data      # 证书持久化，重建容器不会重新申请（避免 LE 限流）
      - caddy-config:/config
```

三行挂载，正好把 `05` 的两个概念各演示了一遍：

| 挂载 | 类型 | 装什么 | 为什么 |
|---|---|---|---|
| `./config/caddy/Caddyfile:...:ro` | bind mount | **你写的配置** | 你要能随时改、要 `git commit`。`:ro` = 不许 caddy 改我的文件 |
| `caddy-data:/data` | 命名卷 | **证书**（caddy 自己申请来的） | 必须活得比容器长。**绝不能加 `:ro`**，加了 caddy 就存不下证书 |
| `caddy-config:/config` | 命名卷 | caddy 自动生成的运行时配置 | 同上，caddy 要写 |

**「配置只读，数据可写」这条界线，在同一个服务里同时出现了。**

而 `caddy-data` 那行注释里的「避免 LE 限流」，是一个**会真的把你网站搞挂**的坑，值得说透：

Let's Encrypt 有**频率限制**：同一个注册域名，**每 7 天最多签 5 张相同的证书**。假设你没挂这个卷：

```
docker compose down && up   →  证书没了，重新申请（第 1 张）
改个配置，又 down && up      →  重新申请（第 2 张）
调试，再来一次              →  第 3 张
再来                       →  第 4 张
再来                       →  第 5 张
再来                       →  🚫 rate limited
                              → 你的网站在接下来几天里签不出证书
                              → 所有用户看到「不安全连接」警告
```

**上线当天连着重启五次，这个次数一点都不夸张。** 而限流是按域名算的、要等**一周**才恢复——你没法通过重装、换服务器绕过去。

挂上 `caddy-data`，`down` 之后证书还躺在卷里（`05` 的实验证明过：`down` 不删卷），`up` 起来的新容器一看"证书还在且没过期"，**直接复用，一次 LE 请求都不发**。

> 🔑 **这是"数据必须活得比容器长"最有代价的一个例子。**
>
> mysql 丢数据，你至少立刻就发现了。证书这事儿更阴——**平时完全看不出区别**（反正每次都能申请到），直到某天你手快多重启了两次，网站就挂了，而且**要等一周**。

顺便看 `depends_on`（第 116-117 行）：

```yaml
    depends_on:
      - frontend
```

**这是 `04` 讲的短写法**——只等 frontend 容器**启动**，不等它 ready（frontend 也确实没配 `healthcheck`，想等也没得等）。这里够用：caddy 是收到请求才去连 frontend 的，就算启动瞬间 nginx 还没 ready，那零点几秒里也没有真实用户。**对比一下 backend 的 `depends_on`（第 81-85 行）用的是 `condition: service_healthy` 长写法**——因为 Spring Boot **一启动就要连数据库**，连不上直接启动失败。

> 🔑 **两种 `depends_on` 写法的选择依据：这个服务是"启动时就要用依赖"，还是"运行中才按需用"。** 前者必须等健康，后者等启动就够。本项目两种都有，正好对照。

### 4.5 为什么有两个 nginx 配置？

本项目里有**两个** `nginx.conf`，这是个真实的困惑点：

| 文件 | 谁在用 | 状态 |
|---|---|---|
| `frontend/nginx.conf` | **`frontend` 镜像**（`02` 读过：Dockerfile 第 18 行 `COPY nginx.conf /etc/nginx/nginx.conf`） | ✅ **正在服役** |
| `deploy/config/nginx/nginx.conf` | `extra` 层那个独立的 `nginx` 服务（bind mount 进去） | ⬜ **基本闲置** |

关键区别就在 `upstream` 那一行。`frontend/nginx.conf`（第 21-23 行，真实内容）：

```nginx
    # 后端 RBAC 服务（容器网络里用服务名 backend 直连）
    upstream rbac_backend {
        server backend:8080;
    }
```

`deploy/config/nginx/nginx.conf`（第 16-20 行，真实内容）：

```nginx
    # 后端 RBAC 服务（宿主机 Spring Boot，默认 8080 端口）
    # host.docker.internal 让容器访问宿主机
    upstream rbac_backend {
        server host.docker.internal:8080;
    }
```

**一个连 `backend:8080`（容器），一个连 `host.docker.internal:8080`（宿主机）。**

这两行记录了项目的**两个不同阶段**：

- `host.docker.internal` 那个是**早期开发态**的产物：那时候后端还在 IDEA 里跑（宿主机上），只有中间件在容器里。容器要回头访问宿主机上的 Spring Boot，就得用 `host.docker.internal` 这个 Docker 提供的特殊域名。
- `backend:8080` 那个是**现在**：后端也进容器了，同一个 `rbac-net`，直接服务名互访（`04` 的内容）。

再看 `deploy/config/nginx/nginx.conf` 的 `location /`（第 34-37 行）：

```nginx
        location / {
            return 200 'RBAC Nginx is up\n';
            add_header Content-Type text/plain;
        }
```

**它连前端页面都不发，只回一句"我活着"。** 这已经明说了它的身份：一个**探索期的测试件**，不是生产链路的一环。

> 🔑 **读别人（包括几个月前的自己）的 compose 文件时，`profiles` 里的东西要格外小心：它可能是"将来要用的"，也可能是"过去用过的"。**
>
> 判断方法就是刚才做的：**看它的配置指向哪儿**。指向 `host.docker.internal` 的 upstream，和指向 `backend:8080` 的 upstream，讲的是两个时代的故事。

顺带把 `frontend/nginx.conf` 剩下那半段收掉（第 40-43 行，真实内容），它解释了前端为什么必须有这个 nginx：

```nginx
        # SPA 路由回退：找不到的路径一律交给 index.html（Vue Router 接管）
        location / {
            try_files $uri $uri/ /index.html;
        }
```

Vue 打包出来的 `dist` 只有一个 `index.html`。用户直接访问 `https://www.eureka32.top/system/user`，硬盘上**根本没有** `system/user` 这个文件——不做回退就是 404。`try_files` 的意思是"先找文件、再找目录，都没有就发 `index.html`"，剩下的交给 Vue Router 在浏览器里解析。**这就是 SPA 部署的标配。**

---

## 五、对照表：本节所有字段

| 字段 / 配置 | 本项目怎么写 | 实际作用 |
|---|---|---|
| `profiles: ["extra"]` | nginx、rabbitmq | 只有 `--profile extra` 时才启动 |
| `profiles: ["full"]` | kafka | 只有 `--profile full` 时才启动 |
| **不写** `profiles` | mysql、redis、backend、frontend、caddy | **无条件启动**（不是"默认 profile"，是"不受管辖"） |
| `expose: - "80"` | frontend | **纯声明**，不产生任何效果 |
| `EXPOSE 80`（Dockerfile） | frontend 镜像 | **纯声明** + `docker run -P` 时随机映射 |
| **不写** `ports` | backend | **真正的隔离**：外网无路可走 |
| `ports: "80:80"` `"443:443"` | caddy | 唯一对外入口；80 兼作 ACME 挑战 + 跳转 |
| `www.eureka32.top {` | Caddyfile | 站点地址是域名 → **自动开启 HTTPS** |
| `reverse_proxy frontend:80` | Caddyfile | 转给 frontend 容器（靠 `rbac-net` 的 DNS） |
| `caddy-data:/data` | 命名卷 | 证书持久化 → 避开 LE 一周 5 张的限流 |
| `depends_on: - frontend` | caddy（短写法） | 只等启动，不等健康（够用：按需才连） |
| `docker compose config --services` | — | **预演**：这条命令到底会起哪些服务 |

---

## 动手练习

### 练习 1：亲眼看见 profile 的效果

```bash
cd deploy
docker compose config --services
docker compose --profile extra config --services
docker compose --profile extra --profile full config --services
```

对比三次输出，数一数分别是几个服务。**注意第一次输出就有 5 个**——想一想，为什么你 `docker compose ps` 只看到 2 个？

### 练习 2：确认 `--profile` 的位置

先跑对的：

```bash
docker compose --profile extra config --services
```

再跑错的：

```bash
docker compose config --services --profile extra
```

看看报什么错。**记住这个错误长什么样**，你以后一定还会再犯一次。

### 练习 3：让 profile 服务真的跑起来（可选）

本地 caddy 没在跑，所以起 nginx 不会有端口冲突，可以安全试：

```bash
docker compose --profile extra up -d nginx
curl http://localhost/
```

应该看到 `RBAC Nginx is up`——就是 `deploy/config/nginx/nginx.conf` 第 35 行那句。

**验证它确实是个"探索期测试件"**：

```bash
curl http://localhost/api/auth/login
```

会挂（502 或超时），因为它的 upstream 指向 `host.docker.internal:8080`，而你宿主机上并没有跑 Spring Boot。

玩完收拾掉：

```bash
docker compose --profile extra down nginx
```

> ⚠️ rabbitmq 镜像比较大，这个练习**只点名 nginx**，别整个 `--profile extra up -d`。

### 练习 4：证明 `expose` 是纸老虎（思考题）

`frontend` 写了 `expose: - "80"`。假设你把这两行**整段删掉**，然后重新 `up`：

1. caddy 还能反代到 frontend 吗？
2. 如果能，那这两行到底在干嘛？

<details>
<summary>点开看答案</summary>

1. **能，完全不受影响。** caddy 和 frontend 都在 `rbac-net` 里，同一个网络内**所有端口本来就互通**（`04` 的核心结论）。`expose` 没创建过任何东西，删掉它自然也不会失去任何东西。

2. **它是写给读这份文件的人看的一句声明**："这个容器对外提供服务的端口是 80"。价值在可读性——别人不用去翻 `frontend/nginx.conf` 才知道该反代到哪个端口。

**最有力的反证在本项目里现成摆着**：`backend` 连 `expose` 都没写，`frontend` 照样反代到它的 8080。如果 `expose` 真的"负责在内网暴露端口"，backend 早就该连不上了。

**真正决定"外面能不能进来"的，只有 `ports`。**
</details>

### 练习 5：给 backend 开个后门（思考题，别真做）

假设你给 `backend` 加上：

```yaml
    ports:
      - "8080:8080"
```

1. `frontend` 反代 backend 的方式会变吗？
2. 在阿里云那台上，这一行意味着什么？

<details>
<summary>点开看答案</summary>

1. **完全不变。** frontend 走的是 `rbac-net` 内网找 `backend:8080`（`frontend/nginx.conf` 第 22 行 `server backend:8080;`），压根不经过宿主机。`ports` 是**另开一条路**，不影响原来那条。

2. **你在精心设计的防线上凿了一个洞。**

   本来 backend 只能通过 `caddy(443) → frontend(80) → backend(8080)` 这条链路访问，中间的每一跳你都控制得住。加了这行，`http://106.15.89.180:8080/api/...` 就直接怼到 Spring Boot 上了：
   - **绕过了 HTTPS**——凭据在公网上裸奔。
   - **绕过了 caddy 和 frontend** 这两层，将来在 caddy 上加的限流、加的 WAF 规则，全部形同虚设。

   **唯一还挡着的，是阿里云安全组没放行 8080。** 也就是说：你的后端安全从"结构上不可达"降级成"依赖一条防火墙规则"。哪天有人为了排查问题临时放行 8080 然后忘了关——这个故事的结局你能猜到。

   > 🔑 **`ports` 每多写一行，攻击面就大一圈。写之前先问：这个洞，非开不可吗？**
</details>

---

## 自检问题

1. 一个服务不写 `profiles`，它属于哪个 profile？什么时候启动？
2. `--profile full` 会不会把 `extra` 层也带起来？为什么？
3. 不启动任何容器，怎么提前知道 `docker compose --profile extra up -d` 会起哪些服务？
4. 在阿里云那台上敲 `docker compose --profile extra up -d`，会发生什么？为什么？
5. `expose: - "80"` 实际做了什么？把它删了会怎样？
6. 本项目"外网碰不到 backend"，靠的是哪个字段？
7. `Caddyfile` 里没有一个字提到证书、TLS、443，为什么 HTTPS 就自动有了？触发条件是什么？
8. caddy 已经有了 `443:443`，为什么 `80:80` 不能删？（说出两个理由）
9. `caddy-data:/data` 这个卷不挂会怎样？为什么这个坑比 mysql 丢数据更阴？
10. 本项目为什么有两个 `nginx.conf`？怎么一眼分辨哪个还在服役？

---

## 承上启下

到这里，`deploy/docker-compose.yml` **217 行，你已经全部读完了**。从 `01` 手敲 `docker run mysql` 踩端口冲突，到现在能讲清楚一套带自动 HTTPS 的生产编排——每个字段为什么这么写，你都答得上来。

**但"读懂"和"养得活"是两回事。**

线上服务半夜挂了，你怎么知道是谁挂的？改了一行代码，怎么让阿里云那台用上新版本？容器起不来，日志在哪儿看？`docker system df` 说你磁盘满了，删什么才安全？

**下一节 `07-运维实战与排错.md`**：把命令从"能看懂"变成"手上有"。看日志、进容器、更新上线的完整流程（呼应 `docs/09-部署上线指南.md`）、以及一份"症状 → 怎么查"的排错清单——包括本节留下的那两根弦（mysql/redis 的 `ports` 暴露在公网、安全组这道最后防线）。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

<details>
<summary><b>1. 不写 `profiles` 属于哪个 profile？</b></summary>

**不属于任何 profile——因为压根没有"默认 profile"这个东西。**

规则是：
- **没写 `profiles`** → **无条件启动**，任何 `up` 都带上它。**不受 profile 机制管辖。**
- 写了 `profiles: ["extra"]` → 只有 `extra` 被激活时才启动，否则 Compose 当它不存在。

这个区分的实际意义：**你没有任何办法用 profile 参数把 mysql 排除掉**。它不在这套机制里。

本项目无条件启动的有 5 个：mysql、redis、backend、frontend、caddy——就是 `docker compose config --services` 的输出。
</details>

<details>
<summary><b>2. `--profile full` 会带起 `extra` 吗？</b></summary>

**不会。**

**profile 之间没有任何层级、包含或继承关系。** 它就是一组平行的标签，激活哪个起哪个。

"核心层 / 扩展层 / 完整层"这个层级感，**完全是这份文件用注释和命名约定出来的人类概念**，Compose 本身对此一无所知。所以文件头部第 14 行才要老老实实写成：

```
#   全部        : docker compose --profile extra --profile full up -d
```

**两个都得写。** 名字取得像包含关系（full 听着就该 ⊃ extra），是这个坑的主要来源。
</details>

<details>
<summary><b>3. 怎么提前知道会起哪些服务？</b></summary>

```bash
docker compose --profile extra config --services
```

`config` **只做解析、不碰容器**：把 `.env` 变量替换、profile 筛选全跑一遍，然后把结果打给你看。

相关的几个用法：
- `docker compose config --services` —— 只列服务名（最常用）
- `docker compose config` —— 打印完整的、替换过变量的 YAML
- `docker compose config --profiles` —— 列出这份文件定义过的所有 profile（本项目输出 `extra` 和 `full`）

> 🔑 **改完 compose 文件，先 `config` 再 `up`。** 这是最便宜的一道保险。
</details>

<details>
<summary><b>4. 在阿里云上 `--profile extra up -d` 会怎样？</b></summary>

**起不来，报端口冲突**，大意是 `failed to bind host port for 0.0.0.0:80: address already in use`。

因为 `nginx`（第 126-127 行）和 `caddy`（第 109-110 行）**都要宿主机的 80 端口**，而 caddy 没有 profile → 永远在跑 → 80 已经被占了。

**这就是你在 `01` 踩过的那个 `port is already allocated`**，只是主角从 mysql 的 3306 换成了 caddy 的 80。同一条铁律：**宿主机一个端口只能给一个容器**。

> 🔑 **profile 只管"起不起"，不管"起了会不会打架"。** Compose 不做端口冲突检查，它照着你写的去 bind，然后由操作系统驳回。

补一刀：**你本机不会遇到这个错**（只跑着 mysql/redis，没人占 80）。**这类坑在开发机上是隐形的，专挑服务器炸。**
</details>

<details>
<summary><b>5. `expose` 实际做了什么？删了会怎样？</b></summary>

**它什么也没做。删了什么也不会发生。**

`expose` **不创建**映射、**不改变**网络规则、**不影响**可达性。它是一句**写给人看的声明**："这个容器对外提供服务的端口是 80"。

原因就是 `04` 那条结论：**同一个网络里的容器，端口本来就全通**。既然本来就通，就没有任何东西需要"暴露"。

**本项目里的现成反证**：`backend` 连 `expose` 都没写，`frontend` 照样反代得到它的 8080。

（`frontend/Dockerfile` 第 21 行的 `EXPOSE 80` 同理——纯声明，外加一个 `docker run -P` 时随机映射的边角用途，compose 场景里用不上。）

这是全 Docker 误解率最高的字段之一。很多教程说"`expose` 是只在内网暴露"，听着像它干了活，**其实一件没干**。
</details>

<details>
<summary><b>6. "外网碰不到 backend"靠的是什么？</b></summary>

> 🔑 **靠的是"没写 `ports`"。**

**安全性来自沉默，不来自声明。** `ports` 是唯一真正打洞的字段——**不写它，洞就不存在**。

`backend` 服务既没 `ports` 也没 `expose`，第 87 行还专门写了注释「不映射 8080 到宿主机，只让 frontend 容器走内网反代」。它只活在 `rbac-net` 里，外面**没有任何一条路**能碰到它。

三级递减：
- `backend`：什么都不写 → 只有内网容器能碰
- `frontend`：`expose "80"`（声明而已）→ 也只有内网容器能碰
- `caddy`：`ports "80:80"/"443:443"` → **全世界能碰**

**整个系统对公网只有 caddy 一个入口。**（除了 mysql/redis 那两行为本地开发保留的 `ports`——那是真实的暴露面，目前靠阿里云安全组挡着。）
</details>

<details>
<summary><b>7. `Caddyfile` 没提证书，HTTPS 怎么就有了？</b></summary>

**触发条件：站点地址长得像个域名。**

```caddyfile
www.eureka32.top {
    reverse_proxy frontend:80
}
```

Caddy 解析到站点地址是 `www.eureka32.top`（不是 `:80`，不是 `localhost`），就**自动开启 Automatic HTTPS**：去 Let's Encrypt 申请证书、装上、把 80 跳转到 443、之后每 ~60 天自动续期。**全程零配置。**

**这个字符串本身就是开关。** 换成 `:80` 或 `localhost`，Caddy 就不会去申请证书——本地开发时就该这么写，总不能给 localhost 申请公网证书。

对比一下 nginx 做同样的事：`listen 443 ssl` + `ssl_certificate` + `ssl_certificate_key` + 一个 80 的跳转 server 块 + 自己装 certbot + 配续期定时任务 + 续期后 reload。**Caddy 的 5 行替掉的是这一整套。**
</details>

<details>
<summary><b>8. 有了 443，为什么 80 不能删？</b></summary>

**两个理由，缺一不可：**

1. **ACME HTTP-01 挑战必须走 80。** Let's Encrypt 要验证域名归你所有，做法是从公网访问 `http://www.eureka32.top/.well-known/acme-challenge/<随机串>`，看 caddy 能不能应答上。**这个端口是 LE 定死的，不接受别的**（合理：如果挑战能走任意端口，那随便租个高位端口的人都能冒充域名主人）。**删掉 `80:80`，证书永远申请不下来，443 上没证书可用，网站直接挂。**

2. **接住敲 `http://` 的用户**，301 跳到 https。真实用户不会主动打 `https://`。

顺带解释了**为什么本地做不了自动 HTTPS**：LE 要从**公网**访问你的 80。你的 Mac mini 在路由器后面，LE 找不到你。**必须有公网可达的机器 + 解析到它的域名**——就是你阿里云那套。
</details>

<details>
<summary><b>9. 不挂 `caddy-data` 会怎样？为什么比丢数据更阴？</b></summary>

**证书会跟着容器一起没**（`05` 讲透了：不挂卷 = 写在容器可写层 = `down` 就蒸发）。每次 `down && up`，caddy 都得**重新向 LE 申请一次**。

**而 Let's Encrypt 有限流：同一注册域名每 7 天最多 5 张相同证书。**

```
上线当天 down && up 调试五次 → 🚫 rate limited
→ 接下来几天签不出证书
→ 所有用户看到「不安全连接」警告
```

上线当天重启五次，**一点都不夸张**。

**为什么比 mysql 丢数据更阴：**

| | mysql 丢数据 | caddy 丢证书 |
|---|---|---|
| 症状 | **立刻**发现，数据没了 | **平时完全看不出**（反正每次都能申请到） |
| 触发 | 一次 `down -v` 就中 | 攒够 5 次才炸，而且是**在最忙的上线日** |
| 恢复 | 重新初始化 | **等一周**，重装/换服务器都绕不过（限流按域名算） |

挂上卷之后：`down` 不删卷 → 证书还在 → 新容器一看"证书有效"，**直接复用，一次 LE 请求都不发**。

> 🔑 **有一类 bug，平时和正确代码表现得一模一样，只在最坏的时刻现形。** 不挂 `caddy-data` 就是标准样本。
</details>

<details>
<summary><b>10. 为什么有两个 `nginx.conf`？怎么分辨？</b></summary>

**它们属于项目的两个不同阶段。**

| 文件 | 谁在用 | upstream 指向 | 状态 |
|---|---|---|---|
| `frontend/nginx.conf` | frontend 镜像（Dockerfile 第 18 行 `COPY` 进去的） | `backend:8080`（**容器**） | ✅ 正在服役 |
| `deploy/config/nginx/nginx.conf` | `extra` 层的独立 nginx 服务（bind mount） | `host.docker.internal:8080`（**宿主机**） | ⬜ 探索期遗留 |

**一眼分辨的方法：看 upstream 指向哪儿。**

- `host.docker.internal:8080` = **早期开发态**：后端还在 IDEA 里跑（宿主机上），容器要回头找宿主机，只能用 Docker 提供的这个特殊域名。
- `backend:8080` = **现在**：后端也进容器了，同一个 `rbac-net`，服务名直连（`04` 的内容）。

**还有个更直接的证据**：`deploy/config/nginx/nginx.conf` 第 35 行的 `location /` 只 `return 200 'RBAC Nginx is up'`——**它连前端页面都不发**。一个不发页面的"前端服务器"，身份不言自明：探索期的测试件。

> 🔑 **读 compose 文件时，`profiles` 里的东西要格外小心：可能是"将来要用的"，也可能是"过去用过的"。** 判断方法就是刚才这个——**看它的配置指向哪儿**。配置文件是有考古价值的。
</details>
</content>
</invoke>
