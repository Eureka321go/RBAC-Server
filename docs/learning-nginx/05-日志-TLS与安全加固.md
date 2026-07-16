# 05 · 日志、TLS 与安全加固

> 目标：还 `00` 埋的第二个扣（为什么一行 TLS 都没有），并把本项目**全都没配**的安全加固补齐认知。
>
> 读完你能：
> - 解释本项目**没配 `access_log`**，为什么 `docker logs rbac-frontend` 还能看到访问日志。
> - 完整写出"如果不用 caddy，nginx 自己做 TLS 得配什么"，并说清本项目为什么一行都不用写。
> - 说出 `limit_req` 的漏桶模型，以及它对 RBAC 登录接口意味着什么。
> - 判断本项目该不该加 `server_tokens off`、`client_max_body_size`、安全响应头。
> - 说清 nginx 在本项目的**安全边界是谁给的**。

---

## 一、承上：还剩一行没讲

`04` 结尾说过，45 行配置里只剩这一行：

```nginx
error_log  /var/log/nginx/error.log warn;
```

`01 §2.3` 提了一嘴级别体系就跳过了，因为它牵扯的东西要放到容器语境里才讲得清。现在补上。

---

## 二、日志：两条流，本项目只配了一条

### 2.1 nginx 有两种日志

| | `error_log` | `access_log` |
|---|---|---|
| 记什么 | **出问题了**：启动失败、上游连不上、配置警告 | **每一个请求**：谁、什么时候、请求了什么、返回了什么 |
| 写在哪个上下文 | main / http / server / location | http / server / location |
| 本项目 | ✅ 配了（第 3 行） | ❌ **一个字都没配** |
| 默认值 | `logs/error.log error` | `logs/access.log combined` |

**本项目只配了 `error_log`，`access_log` 完全没提。**

按 `01 §4.3` 的继承规则，没写就用默认值——所以 `access_log` **是开着的**，走默认的 `combined` 格式，写到 `/var/log/nginx/access.log`。

### 2.2 `error_log` 的级别

```nginx
error_log  /var/log/nginx/error.log warn;
#          ↑ 写哪                    ↑ 记多细
```

八个级别，从啰嗦到安静：

| 级别 | 记什么 | 举例 |
|---|---|---|
| `debug` | 一切（需要编译时带 `--with-debug`，官方镜像通常没有） | 每个请求的内部处理步骤 |
| `info` | 一般信息 | 客户端提前关闭连接 |
| `notice` | 值得注意但正常 | worker 启动/退出 |
| **`warn`** | **不对劲但还能跑** ← 本项目在这 | upstream 响应慢、`worker_connections` 快满了 |
| `error` | 出错了 | 502、上游连不上、文件权限不对 |
| `crit` | 严重 | 无法分配内存 |
| `alert` | 必须立即处理 | 主要子系统失效 |
| `emerg` | 系统不可用 | 配置错误导致起不来 |

规则是"**记录该级别及以上**"。`warn` = warn/error/crit/alert/emerg 都记，debug/info/notice 不记。

**为什么 `warn` 是个好选择**：

- 写 `debug`：磁盘刷爆，而且官方镜像大概率没编译 debug 支持，写了也没用。
- 写 `error`：**会漏掉"还没出错但已经不对劲"的信号**——比如上游响应变慢、连接数逼近上限。这些恰恰是**故障的前兆**，等到 `error` 才发现就晚了。
- `warn` 卡在"值得你半夜被叫起来看一眼"这条线上。

### 2.3 `log_format combined`：默认的访问日志长什么样

本项目没配 `access_log`，走的是默认的 `combined` 格式。它的定义（nginx 内置）：

```nginx
log_format combined '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent"';
```

逐个字段：

| 变量 | 含义 | 本项目实际会是什么 |
|---|---|---|
| `$remote_addr` | 直连客户端 IP | **`172.18.0.6`（caddy 的内网 IP）** ← 注意！ |
| `$remote_user` | HTTP Basic 认证的用户名 | `-`（本项目不用 Basic 认证） |
| `$time_local` | 本地时间 | `15/Jul/2026:10:30:45 +0800` |
| `$request` | 请求行 | `GET /api/users HTTP/1.1` |
| `$status` | 响应状态码 | `200` / `404` / `502` |
| `$body_bytes_sent` | 响应体字节数 | `1234` |
| `$http_referer` | 来源页 | `https://www.eureka32.top/system/user` |
| `$http_user_agent` | 浏览器标识 | `Mozilla/5.0 ...` |

**注意第一行那个坑**：`$remote_addr` 记的是 **caddy 的内网 IP**，不是真实用户 IP。`04 §4.3` 讲过这个道理——nginx 的直连客户端是 caddy。

> 🔑 **本项目 nginx 的访问日志里，每一条记录的客户端 IP 都是同一个（caddy 的容器 IP）。** 这个字段在本项目里**完全没有价值**。想在 nginx 日志里看到真实用户 IP，得自定义 `log_format` 用 `$http_x_forwarded_for`：
>
> ```nginx
> log_format main '$http_x_forwarded_for - $remote_user [$time_local] '
>                 '"$request" $status $body_bytes_sent '
>                 '"$http_referer" "$http_user_agent" '
>                 'rt=$request_time urt=$upstream_response_time';
> access_log /var/log/nginx/access.log main;
> ```
>
> 顺带加的 `$request_time`（nginx 处理总耗时）和 `$upstream_response_time`（上游耗时）**极其有用**——两者一减就是 nginx 自己的开销，排查"到底是后端慢还是 nginx 慢"时一眼定位。本项目没配，属于可以加的。

### 2.4 那为什么 `docker logs` 能看到日志

这是个好问题。配置里明明写着日志要写到**文件**里：

```nginx
error_log  /var/log/nginx/error.log warn;      # ← 写文件
# access_log 默认也是写 /var/log/nginx/access.log
```

而 `docker logs` 看的是容器**主进程的 stdout / stderr**。两者对不上——那 `docker logs rbac-frontend` 凭什么能看到东西？

**答案：nginx 官方镜像做了个软链接。**

镜像构建时干了这么一件事：

```
/var/log/nginx/access.log  ->  /dev/stdout
/var/log/nginx/error.log   ->  /dev/stderr
```

所以 nginx **老老实实地往"文件"里写**，但那个"文件"其实是指向标准输出/标准错误的软链接。写进去的东西直接流到了容器的 stdout/stderr，于是 `docker logs` 就看得到了。

```
nginx 以为：       写文件 /var/log/nginx/error.log
实际发生：         → 软链接 → /dev/stderr → 容器 stderr → docker logs ✔
```

> 🔑 这是**容器化日志的标准套路**：容器里的进程不该自己管日志文件（不该轮转、不该关心磁盘），它只管往 stdout/stderr 喷，由容器运行时统一收集。官方镜像用软链接这个技巧，**在不改 nginx 一行代码、不改配置的前提下**，把一个"写文件"的传统程序改造成了"云原生"的行为。
>
> （`learning-docker 07` 讲 `docker logs` 时提过这个约定。）

**这带来一个实际后果**：本项目**不需要**配置日志轮转（logrotate）。日志不落在容器的磁盘上，而是被 Docker 的日志驱动接管（默认 `json-file`，有自己的轮转配置）。如果哪天你想给 nginx 配 logrotate，那说明你搞错了方向——该配的是 Docker 的 `log-opts`。

### 2.5 关掉某些访问日志

一个实用技巧（本项目没用，但值得知道）：

```nginx
location /health {
    access_log off;        # ← 健康检查每秒一次，全记下来纯属噪音
    return 200 'ok';
}
```

`access_log off` 能关掉指定 location 的访问日志。适用于健康检查、静态资源这类**高频且无信息量**的请求。

本项目没有健康检查端点（`docs/09:221` 把"给 backend 加 healthcheck"列在"可选增强"里，至今没做），所以用不上。

---

## 三、还债：为什么一行 TLS 都没有

`00 §5` 埋的第二个扣。现在还。

### 3.1 如果 nginx 自己做 TLS，得写成什么样

先看**对照组**——假设没有 caddy，nginx 要自己扛 HTTPS，`frontend/nginx.conf` 得变成这样：

```nginx
http {
    # ... 前面的 include / gzip / upstream 都不变 ...

    # ① HTTP server：唯一职责是把所有请求踢到 HTTPS
    server {
        listen 80;
        server_name www.eureka32.top;

        # Let's Encrypt 的 ACME HTTP-01 验证要走 80 端口，这个路径必须放行
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;    # 301 永久跳转到 HTTPS
        }
    }

    # ② HTTPS server：真正干活的
    server {
        listen 443 ssl;
        http2 on;
        server_name www.eureka32.top;

        # ---- 证书（这两个文件从哪来？见 §3.2）----
        ssl_certificate     /etc/letsencrypt/live/www.eureka32.top/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/www.eureka32.top/privkey.pem;

        # ---- 协议与加密套件 ----
        ssl_protocols       TLSv1.2 TLSv1.3;         # 禁掉 TLS 1.0/1.1（已不安全）
        ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
        ssl_prefer_server_ciphers off;               # TLS1.3 时代建议交给客户端选

        # ---- 会话复用（性能）----
        ssl_session_cache   shared:SSL:10m;          # 10MB 共享缓存，约 4 万个会话
        ssl_session_timeout 1d;
        ssl_session_tickets off;                     # 关掉 ticket（前向安全性更好）

        # ---- OCSP Stapling（性能 + 隐私）----
        ssl_stapling on;
        ssl_stapling_verify on;
        ssl_trusted_certificate /etc/letsencrypt/live/www.eureka32.top/chain.pem;
        resolver 8.8.8.8 valid=300s;

        # ---- HSTS：告诉浏览器"以后一年内只准用 HTTPS 访问我" ----
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # ---- 下面这些才是本项目原本就有的东西 ----
        root /usr/share/nginx/html;
        index index.html;

        location /api/ {
            proxy_pass http://rbac_backend;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;   # ← 这时候它【是对的】！
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
```

**从 45 行涨到了 80 多行**，而且新增的每一行都需要你懂 TLS。

**顺带注意一个反转**：在这个架构里，`proxy_set_header X-Forwarded-Proto $scheme;` **是完全正确的**——因为 TLS 就在 nginx 这一跳终结，`$scheme` 真的等于 `https`。

> 🔑 **`04 §4.5` 那行"错的"配置，在这个假想的架构里是对的。** 它不是写错了，它是**为另一个架构写的，而架构变了**。这就是配置漂移的本质——代码没动，正确性却悄悄失效了。这比"写错了"更难发现，因为 git blame 会显示它一直是这样，而且当初确实是对的。

### 3.2 证书从哪来：nginx 的痛点

上面配置里那两个 `.pem` 文件，**nginx 不会自己生成**。你得：

```bash
# ① 装 certbot
apt install certbot

# ② 申请证书（要能通过 80 端口验证域名归属）
certbot certonly --webroot -w /var/www/certbot -d www.eureka32.top

# ③ 配置自动续期（LE 证书只有 90 天！）
#    certbot 会装一个 systemd timer 或 cron
certbot renew --dry-run

# ④ 续期后还得让 nginx 重新加载证书（否则它还用着内存里的老证书）
#    要配置 --deploy-hook
certbot renew --deploy-hook "nginx -s reload"
```

**每一步都是活，而且每一步都能出错**：

- 证书只有 **90 天**，续期失败 = 站点在某个你不知道的日子突然全红（浏览器报证书过期，用户完全无法访问）。
- 续期成功但忘了 reload nginx = nginx 还在用内存里的老证书，**照样过期**。这个坑尤其阴险——证书文件在磁盘上是新的，你去看会觉得"续上了啊"。
- 容器化之后更麻烦：certbot 和 nginx 在不同容器里，证书要用卷共享，reload 要跨容器执行。

### 3.3 本项目的答案：caddy 全包了

`deploy/config/caddy/Caddyfile` 的**全部内容**：

```
# Caddy 会自动为该域名申请 + 续期 Let's Encrypt 证书，并把 http 强制跳转到 https。
www.eureka32.top {
    # 反代给现有的 frontend(nginx) 容器；它继续发 SPA 静态文件 + 反代 /api 给 backend
    reverse_proxy frontend:80
}
```

**两行有效配置。**

对比一下上面那 40 多行 TLS 配置 + 一整套 certbot 运维流程：

| | nginx + certbot | caddy |
|---|---|---|
| 配置行数 | 40+ 行 TLS 相关 | **2 行** |
| 申请证书 | 手动跑 certbot | **自动**（启动时就办了） |
| 续期 | 配 timer/cron | **自动** |
| 续期后重载 | 要配 deploy-hook | **自动** |
| 加密套件 | 自己选，选错了就是安全隐患 | **内置安全默认值** |
| HSTS / OCSP | 自己配 | **默认开** |
| 80→443 跳转 | 自己写个 server | **自动** |
| 出错的机会 | 很多 | 很少 |

caddy 的设计哲学就是"**HTTPS 应该是默认的，不该是一个项目**"。它把 ACME 协议内建在里面，写个域名就全办了。

**这就是 `00 §6` 说的那次演进的全部理由**：不是 nginx 不行，是**为了 HTTPS 去伺候 certbot 不值得**——而已经跑通的 nginx 静态+反代逻辑，一个字都不用动。

### 3.4 `caddy-data` 卷为什么必须持久化

```yaml
  caddy:
    volumes:
      - ./config/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data      # 证书持久化，重建容器不会重新申请（避免 LE 限流）
      - caddy-config:/config
```

那行注释点出了要害。展开讲：

**Let's Encrypt 有签发限流**：每个域名每周有签发次数上限。`docs/ops/02-域名与HTTPS配置.md:96` 专门警告过：

> - **证书限流**：Let's Encrypt 每域名每周有签发上限。反复删 `caddy-data` 卷重建可能触发限流，正常运维不要删这个卷。

如果不挂 `caddy-data`，证书就存在容器的**可写层**里。而容器可写层的特点是：**容器一删，数据就没了**（`learning-docker 05` 讲过）。于是：

```
① caddy 启动 → 申请证书 → 存在可写层
② docker compose down && up  → 容器重建 → 【证书没了】
③ caddy 又去申请一遍
④ 反复几次 → 【触发 LE 限流】
⑤ 限流的后果是：等一周。不是重启能解决的，不是改配置能解决的。就是等。
```

`learning-docker 05` 讲过一个关键对照：**`caddy:2.8` 镜像的 `Config.Volumes` 是 `null`**——它**没有**声明匿名卷。所以不挂 `caddy-data`，证书是真的丢在可写层里，容器一删就永久消失。（对比 `mysql:8.4` 声明了 `VOLUME /var/lib/mysql`，即使你不挂，数据也会进一个自动创建的匿名卷。）

> 🔑 **`caddy-data` 这个卷是本项目唯一一个"丢了要等一周才能恢复"的东西。** 数据库丢了可以从备份恢复，代码丢了 git 里有，但 LE 限流**没有任何加速手段**。这个卷的重要性被严重低估了——它看起来只是个缓存，实际上是**一个不可再生资源的仓库**。

---

## 四、补课：本项目全都没配的安全加固

以下**全部是"建议"，本系列不动手**。整改清单统一在 `06`。

### 4.1 `server_tokens off`：别报家门

**默认行为**（本项目现在就是这样）：nginx 会在每个响应里带上自己的版本号：

```http
HTTP/1.1 200 OK
Server: nginx/1.27.0        ← 把版本号大声告诉全世界
```

404 之类的错误页上也会印着 "nginx/1.27.0"。

**风险**：攻击者扫到你的站，一眼就知道你跑的是 nginx 1.27.0。如果哪天这个版本爆出漏洞，你就自动进了"可攻击目标"名单——攻击者甚至不需要探测，直接按版本号筛就行了。

**改法**：

```nginx
http {
    server_tokens off;    # → Server: nginx（只说是 nginx，不说版本）
}
```

**本项目的实际情况有个转折**：nginx 在内网，**它的响应头会经过 caddy**。caddy 转发时会**保留** upstream 的 `Server` 头吗？

实际上 caddy 会用**自己的** `Server: Caddy` 头。所以外界看到的是 caddy 的标识，nginx 的版本号**大概率透不出去**。

> 🔑 所以 `server_tokens off` 对本项目**收益接近零**——但它的**代价也接近零**（一行配置，无任何副作用）。这属于"纵深防御"：万一哪天 nginx 直接对外了（比如临时绕过 caddy 调试），这行就派上用场了。**便宜的保险，买了不亏。**

### 4.2 `limit_req`：限流，和 RBAC 直接相关

这是本节**最值得做**的一条。

**问题**：本项目有 `/api/auth/login` 登录接口，**没有任何限流**。攻击者可以每秒发几百次请求暴力破解密码。

**nginx 的解法**：`limit_req` 用**漏桶算法**：

```nginx
http {
    # 定义一个限流区域
    limit_req_zone $binary_remote_addr zone=login_limit:10m rate=5r/m;
    #              ↑ 按什么维度限         ↑ 名字:内存大小    ↑ 速率：每分钟 5 次

    server {
        location /api/auth/login {
            limit_req zone=login_limit burst=3 nodelay;
            #              ↑ 用哪个区域  ↑ 突发容量  ↑ 突发的不排队直接过
            limit_req_status 429;        # 超限返回 429 而不是默认的 503
            proxy_pass http://rbac_backend;
            ...
        }
    }
}
```

**漏桶模型**：

```
rate=5r/m  → 桶以每分钟 5 个的速度漏水（即匀速放行）
burst=3    → 桶的容量是 3，允许瞬间涌进来 3 个先存着
nodelay    → 桶里的 3 个立即放行，而不是按 rate 匀速慢慢放

超过 burst 的 → 直接拒绝（429）
```

**参数含义要点**：

| 参数 | 含义 | 不写会怎样 |
|---|---|---|
| `$binary_remote_addr` | 按客户端 IP 限流（`binary_` 版本更省内存） | —— |
| `zone=login_limit:10m` | 10MB 内存能存约 **16 万个 IP** 的状态 | —— |
| `rate=5r/m` | 每分钟 5 次（也可写 `10r/s`） | —— |
| `burst=3` | 允许突发 3 个 | 不写 = 严格匀速，稍微快一点就被拒（体验很差） |
| `nodelay` | 突发的立即放行 | 不写 = 突发的会**排队等待**，用户感觉卡住 |

**但本项目有个致命前提问题**：

```nginx
limit_req_zone $binary_remote_addr ...    # ← 按 $remote_addr 限流
```

而 `04 §4.3` 讲过：**nginx 的 `$remote_addr` 是 caddy 的 IP，不是真实用户 IP！**

所以直接这么配的后果是：

```
所有用户共享同一个限流配额（因为在 nginx 眼里他们全是 172.18.0.6）
→ 一个人触发限流，【所有人都被限】
→ 攻击者爆破登录 → 把全站正常用户一起锁死
→ 这不是限流，这是【一键 DoS 自己】
```

**必须改成按 XFF 限流**：

```nginx
limit_req_zone $http_x_forwarded_for zone=login_limit:10m rate=5r/m;
```

**但 `04` 练习 4 又说了：XFF 可以伪造！** 攻击者每次请求换一个伪造的 XFF → 每次都是"新 IP" → **限流完全失效**，可以无限爆破。

> 🔑 **限流的有效性完全依赖于"客户端标识不可伪造"。** 本项目当前的架构下：
> - 用 `$remote_addr` → 全站共享配额，形同一键自杀
> - 用 `$http_x_forwarded_for` → 可伪造，形同虚设
>
> **两条路都不通。** 真正的解法是先修好 IP 传递链路（`04` 练习 3 的结论：让 caddy 写一个下游不可覆盖的专用头），**然后**才能谈限流。
>
> **这是本系列最重要的一个发现**：`limit_req`、操作日志的 IP 审计、未来可能的 IP 白名单——**这三个功能全都卡在同一个前置问题上**。修 IP 传递链路不是"锦上添花"，它是**三个安全功能的共同地基**。

**顺带**：限流也可以放在 **caddy 那一层**做（caddy 有 `rate_limit` 相关能力，或用插件）。既然 caddy 是唯一见得到真实 IP 的那一跳，**在 caddy 上限流反而更合理**——它不需要任何 IP 传递就能拿到正确的客户端地址。这可能才是本项目的最优解。

### 4.3 `limit_conn`：限制并发连接

```nginx
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

server {
    limit_conn conn_limit 20;    # 每个 IP 最多 20 条并发连接
}
```

和 `limit_req` 的区别：

- `limit_req` 限的是**请求速率**（每秒/每分钟多少个）
- `limit_conn` 限的是**同时保持的连接数**

`limit_conn` 主要防慢速攻击（Slowloris 这类——建立大量连接但慢慢发数据，把连接数耗光）。

**本项目**：同样卡在 `$remote_addr` 是 caddy IP 的问题上。而且 `01 §3.2` 算过，本项目的连接数离上限差两个数量级，慢速攻击的威胁不现实。**优先级很低。**

### 4.4 `client_max_body_size`：上传会撞的墙

**默认值是 `1m`。** 超过 1MB 的请求体，nginx 直接返回 **413 Request Entity Too Large**，**根本不会转给后端**。

**本项目现在有影响吗？** 没有——RBAC 系统目前的接口都是 JSON，最大的也就是批量操作，远不到 1MB。

**什么时候会撞**：加任何**文件上传**功能的那一天。头像上传、Excel 批量导入用户、附件——只要文件超过 1MB，用户就会收到 413。

**这个坑的经典之处**：

```
① 开发在本地测试上传 5MB 的 Excel → 成功（本地 npm run dev，没有 nginx！）
② 上线后用户上传 → 413 失败
③ 开发查后端日志 → 【什么都没有】，因为请求压根没到后端
④ 开发怀疑人生
```

**本地开发环境没有 nginx**（`00 §2.3` 讲过，dev 走的是 Vite 的 proxy），所以这个限制**在开发环境完全不存在**。它是一个**只在生产出现**的问题。

**改法**：

```nginx
location /api/upload {
    client_max_body_size 10m;     # 按实际需求给
    proxy_pass http://rbac_backend;
}
```

**注意别全局放开**：

```nginx
http {
    client_max_body_size 100m;    # ⚠️ 不要这么干
}
```

全局放开等于允许任何人往任何接口发 100MB 的请求体——这本身就是个 DoS 入口（内存/磁盘被撑爆）。**只在真正需要上传的 location 上放开**，其他地方保持严格。

> 🔑 **`client_max_body_size` 是"加上传功能时必然会撞、但只在生产撞"的坑。** 它值得提前记在 `06` 的清单里——不是现在改，而是**在做上传功能时会想起来这里有一堵墙**。

### 4.5 安全响应头

本项目**一个都没配**。常见的几个：

```nginx
add_header X-Content-Type-Options    "nosniff" always;
add_header X-Frame-Options           "SAMEORIGIN" always;
add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy   "default-src 'self'; ..." always;
```

逐个说：

| 头 | 防什么 | 对本项目 |
|---|---|---|
| `X-Content-Type-Options: nosniff` | 禁止浏览器"猜"MIME 类型（防止把上传的文件当脚本执行） | **值得加**，和 `02 §2.3` 的 `default_type` 是同一个防线的两层 |
| `X-Frame-Options: SAMEORIGIN` | 防点击劫持（别人把你的后台 iframe 进他的页面骗点击） | **值得加**，后台管理系统没有被别人嵌入的正当理由 |
| `Referrer-Policy` | 控制跳转时泄漏多少来源信息 | 可加，收益一般 |
| `Content-Security-Policy` | 最强的 XSS 防线，白名单化资源来源 | **收益最大但最难配**——配错了整站白屏。Vue 项目尤其要注意 inline style/script |

**`always` 参数是必须的**：不加 `always`，`add_header` **只在 2xx/3xx 响应上生效**；错误响应（404/500）不会带这些头。加了 `always` 才是所有响应都带。

**一个必须知道的坑**（和 `04 §4.6` 是同一类）：

```nginx
server {
    add_header X-Frame-Options "SAMEORIGIN" always;    # ← server 层

    location /api/ {
        add_header X-Custom "foo";     # ← 这里写了【任何一条】 add_header
        # → server 层那条 X-Frame-Options 【完全失效】！
    }
}
```

**`add_header` 和 `proxy_set_header` 一样，是"整层覆盖"而非"合并"。** 内层写了任何一条，外层整组作废。这个坑每年都在坑人，而且**静默失效，没有任何报错**。

### 4.6 本项目的安全边界是谁给的

把这一节串起来，会得到一个重要的认知：

本项目的 nginx **几乎没有任何自我保护**：

- ❌ 没有限流（而且当前架构下也配不对）
- ❌ 没有 `server_tokens off`
- ❌ 没有安全响应头
- ❌ 没有 TLS
- ❌ `client_max_body_size` 是默认值
- ❌ 拿不到真实客户端 IP

**它凭什么还是安全的？**

因为它**不在暴露面上**：

```
公网
 │
 ├─ 阿里云安全组：只放行 22 / 80 / 443     ← 第一道
 │
 ├─ caddy：唯一对外进程，TLS 终结          ← 第二道
 │
 └─ rbac-net 内网：nginx 在这里面
        ↑ frontend 用 expose 而非 ports（docker-compose.yml:97-98）
          宿主机上都访问不到，遑论公网
```

> 🔑 **nginx 在本项目是内网组件，它的安全边界是阿里云安全组和 caddy 给的，不是它自己挣的。**
>
> 这个判断决定了本节所有"建议"的**优先级**：它们全都不是紧急的，因为 nginx 面对的唯一客户端是同一个 docker 网络里的 caddy。真要攻击 nginx，得先攻破 caddy 或者进到内网——到那一步，nginx 的 `server_tokens` 是不是 off 已经无所谓了。
>
> **但这个判断也有个前提**：`expose` 而非 `ports`、安全组只开三个端口。这两条**任何一条被改掉**，上面所有的"不着急"立刻全部作废。而它们是**别人的配置**（compose、云控制台），不在 nginx 手里。
>
> `learning-docker 07` 第八节收过这条线：数据库的安全**当前是靠阿里云安全组这根弦**吊着的。nginx 这里是同一个故事——**安全依赖于一个不在本文件内、且随时可能被人改掉的假设**。

---

## 动手练习

> 全部是思考题。

### 练习 1：日志里的 IP

运维在服务器上跑 `docker compose logs frontend`，看到几百条访问日志，发现**每一条的第一个字段都是同一个 IP `172.18.0.6`**。他怀疑是不是有人在攻击（同一个 IP 疯狂请求）。

请解释他看到的现象，并告诉他怎么才能在 nginx 日志里看到真实用户 IP。

### 练习 2：日志去哪了

有人觉得日志写到 `/var/log/nginx/error.log` 不方便，想改成直接输出到控制台，于是把配置改成：

```nginx
error_log /dev/stderr warn;
```

重新构建上线。请问：① 这么改有用吗？② 和原来相比有什么区别？③ 有没有副作用？

### 练习 3：证书续期失败

假设本项目改成了"nginx 自己做 TLS + certbot"的方案。某天凌晨，用户反馈整站打不开，浏览器报"证书已过期"。

运维登上服务器，发现 `/etc/letsencrypt/live/www.eureka32.top/fullchain.pem` 的修改时间是**昨天**，看起来续期成功了。但站点就是报证书过期。

请解释这是怎么回事，并说出该怎么修、以及怎么根治。

### 练习 4：限流陷阱（重要）

有人给本项目加了登录限流：

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
location /api/auth/login {
    limit_req zone=login burst=3 nodelay;
    proxy_pass http://rbac_backend;
    ...
}
```

上线后测试：自己连续点 10 次登录，第 4 次开始返回 503。"限流生效了！"他很高兴。

请指出这个配置的**致命问题**，并推演一个具体的攻击场景。然后回答：改成 `$http_x_forwarded_for` 能解决吗？

### 练习 5：上传功能的墙

产品要加一个"Excel 批量导入用户"功能，文件大概 2-5MB。开发在本地测试通过，上线后用户全部失败。

请推演：① 用户看到什么错误？② 后端日志里有什么？③ 为什么本地测试没发现？④ 怎么修？⑤ 修的时候要注意什么？

### 练习 6：add_header 消失了

有人给本项目加了安全头：

```nginx
server {
    add_header X-Frame-Options "SAMEORIGIN" always;
    ...
    location /api/ {
        add_header X-Api-Version "1.0" always;
        proxy_pass http://rbac_backend;
        ...
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

测试发现：访问页面（`/`）时 `X-Frame-Options` 正常，但访问 `/api/users` 时**这个头不见了**。请解释原因并给出修法。

### 练习 7：安全边界

假设有人为了调试方便，把 `deploy/docker-compose.yml` 里 `frontend` 的 `expose: ["80"]` 改成了 `ports: ["8080:80"]`，并在阿里云安全组放行了 8080。改完忘了改回来。

请列出：这一个改动，让本节讲的哪些"不着急的建议"立刻变成了"紧急"？至少列 4 条，并说明每条的具体风险。

---

## 自检问题

1. 本项目配了 `access_log` 吗？那访问日志存在吗？
2. `error_log` 的级别写 `warn` 而不是 `error`，多记了什么？为什么值得？
3. 配置里写着日志写到文件，为什么 `docker logs` 能看到？
4. 本项目 nginx 访问日志里的客户端 IP 是谁的？
5. `$request_time` 和 `$upstream_response_time` 的差值代表什么？
6. nginx 自己做 TLS，最少要配哪几条指令？
7. Let's Encrypt 证书有效期多久？续期失败会怎样？
8. 为什么 `caddy-data` 卷不能删？删了最坏后果是什么，多久能恢复？
9. `04 §4.5` 说 `X-Forwarded-Proto $scheme` 是错的。在"nginx 自己做 TLS"的架构里，它还是错的吗？
10. `server_tokens off` 对本项目收益大吗？那还要不要加？
11. `limit_req` 的 `rate`、`burst`、`nodelay` 分别是什么意思？
12. 为什么本项目当前配 `limit_req` 会"一键 DoS 自己"？
13. `client_max_body_size` 的默认值是多少？为什么这个坑只在生产出现？
14. `add_header` 不加 `always` 有什么区别？
15. nginx 在本项目的安全边界是谁给的？这个判断依赖什么前提？

---

## 承上启下

到这里，`frontend/nginx.conf` 的 **45 行全部读完了**，一行不剩。你也知道了它**没写**的那些东西各自意味着什么。

但整个系列还欠着 `00 §4` 埋的**第一个扣**，也是最大的一个：

**这个项目里为什么有两份 nginx.conf？**

`06` 一次性还清。会做三件事：

1. **考古**：把两份配置并排逐行 diff，从四处差异倒推出本项目部署演进的**三个阶段**——为什么 `host.docker.internal` 会变成 `backend`，为什么 `return 200` 会变成 `try_files`，为什么 `ports` 会变成 `expose`。
2. **真实的坑**：那份遗留配置对应的 compose 服务，**和 caddy 抢 80 端口**。在生产机上跑 `--profile extra` 会直接失败。
3. **文档漂移**：`docs/09-部署上线指南.md` 至今还在指导你去改**那份错的文件**。会把它的几处漂移集中拿出来讲——**为什么文档漂移比代码 bug 更坑人**。

最后给出全系列的**整改建议清单**（只写不做）：把 `02` 的静态缓存、`04` 的 `X-Forwarded-Proto` 和 keepalive、`05` 的限流和 `client_max_body_size`，连同遗留配置的清理，一起按优先级排出来。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

### 自检问题

<details>
<summary><b>1. 本项目配了 <code>access_log</code> 吗？那访问日志存在吗？</b></summary>

**没配，但访问日志存在。**

`frontend/nginx.conf` 里一个字都没提 `access_log`。按 `01 §4.3` 的继承规则，没写就用**默认值**——而 `access_log` 的默认值是 `logs/access.log combined`，也就是**默认开着**。

所以访问日志一直在记，用的是内置的 `combined` 格式，写到 `/var/log/nginx/access.log`（而那个路径是个指向 `/dev/stdout` 的软链接，见自检 3）。

**"没配置" ≠ "没生效"** —— 这个道理 `02` 练习 4（gzip_types 里没有 text/html）已经演示过一次了。
</details>

<details>
<summary><b>2. <code>error_log</code> 写 <code>warn</code> 而不是 <code>error</code>，多记了什么？</b></summary>

多记了 **`warn` 级别**的东西——也就是"**不对劲但还能跑**"的信号：上游响应变慢、`worker_connections` 逼近上限、某些配置的兼容性警告。

**为什么值得**：这些恰恰是**故障的前兆**。写 `error` 只能看到"已经出事了"，而 `warn` 能让你在出事**之前**看到苗头。

对比另一头：写 `debug` 会把磁盘刷爆，而且官方镜像大概率没编译 debug 支持（写了也没用）。

`warn` 卡在"值得你半夜被叫起来看一眼"这条线上，是个中庸但正确的选择。
</details>

<details>
<summary><b>3. 配置里写着写文件，为什么 <code>docker logs</code> 能看到？</b></summary>

因为 **nginx 官方镜像做了软链接**：

```
/var/log/nginx/access.log  ->  /dev/stdout
/var/log/nginx/error.log   ->  /dev/stderr
```

nginx 老老实实地"往文件里写"，但那个文件是指向标准输出/标准错误的软链接，写进去的东西直接流到容器的 stdout/stderr → `docker logs` 就看得到了。

**这是容器化日志的标准套路**：在不改 nginx 一行代码、不改一行配置的前提下，把一个"写文件"的传统程序改造成"云原生"行为。

**实际后果**：本项目**不需要**给 nginx 配 logrotate。日志不落在容器磁盘上，由 Docker 的日志驱动（默认 `json-file`）接管轮转。想配轮转，该配的是 Docker 的 `log-opts`。
</details>

<details>
<summary><b>4. 本项目 nginx 访问日志里的客户端 IP 是谁的？</b></summary>

**caddy 的容器内网 IP（`172.18.0.x`）。**

`combined` 格式的第一个字段是 `$remote_addr` = nginx 看到的直连客户端。而 nginx 的直连客户端是 **caddy**（`04 §4.3`）。

**后果**：nginx 访问日志里**每一条记录的 IP 都是同一个**，这个字段完全没有价值。

想看真实 IP 得自定义 `log_format` 用 `$http_x_forwarded_for`（练习 1 就是这道题）。
</details>

<details>
<summary><b>5. <code>$request_time</code> 和 <code>$upstream_response_time</code> 的差值代表什么？</b></summary>

**nginx 自己的开销。**

- `$request_time`：nginx 处理这个请求的**总耗时**（从收到第一个字节到发完最后一个字节）
- `$upstream_response_time`：**上游**（backend）花的时间

两者一减 ≈ nginx 自己的开销（转发、缓冲、压缩等）。

**排查价值极大**：拿到一个"接口好慢"的投诉时，这两个数一比就知道该找谁：
- `upstream_response_time` 很大 → **后端慢**，去查 SQL / 线程池
- 两者差值很大 → **nginx 慢**（罕见，通常是 gzip 压缩大响应体、或者网络缓冲问题）

本项目没配这两个字段，属于可以加的（见 `§2.3` 的 `log_format main` 示例）。
</details>

<details>
<summary><b>6. nginx 自己做 TLS，最少要配哪几条？</b></summary>

**最少三条**：

```nginx
listen 443 ssl;
ssl_certificate     /path/fullchain.pem;
ssl_certificate_key /path/privkey.pem;
```

但"能跑"和"能用"是两回事。生产上还必须有：

- `ssl_protocols TLSv1.2 TLSv1.3;` —— 禁掉已不安全的 TLS 1.0/1.1
- 一个 80 端口的 server 做 `return 301 https://...` 跳转
- `add_header Strict-Transport-Security ...`（HSTS）
- `ssl_session_cache`（性能，不然每次都全握手）
- ACME 验证路径 `/.well-known/acme-challenge/` 的放行（否则证书都申请不下来）

**以及最重要的**：证书本身从哪来、怎么续期、续期后怎么让 nginx 重载——这些 nginx 配置管不了，得靠 certbot + timer + deploy-hook。
</details>

<details>
<summary><b>7. LE 证书有效期多久？续期失败会怎样？</b></summary>

**90 天。**

续期失败 = **站点在某个你不知道的日子突然全红**。浏览器报"证书已过期"并显示大红警告页，用户**完全无法访问**（除非手动点"继续前往，不安全"，而正常用户不会这么干）。

这个故障的特点是：**它有一个确定的爆炸时间，但你不知道那天是哪天**——除非你有监控。90 天的周期长到足以让所有人忘记这件事的存在。

这正是 caddy 的价值：它把这个定时炸弹变成了一个**没人需要关心的实现细节**。
</details>

<details>
<summary><b>8. 为什么 <code>caddy-data</code> 卷不能删？最坏后果是什么，多久恢复？</b></summary>

因为它存着**证书**。

`caddy:2.8` 镜像的 `Config.Volumes` 是 **`null`**（`learning-docker 05` 实测过）——它**没有声明匿名卷**。所以不挂 `caddy-data`，证书就真的存在**容器可写层**里，容器一删就**永久消失**。

**最坏后果：触发 Let's Encrypt 限流。** 每域名每周有签发上限，反复删卷重建会撞上（`docs/ops/02:96` 明确警告过）。

**多久恢复：等一周。** 没有任何加速手段——不是重启能解决的，不是改配置能解决的，不是加钱能解决的。**就是等。**

> 🔑 这是本项目**唯一一个"丢了要等一周"的东西**。数据库丢了能从备份恢复，代码丢了 git 里有，只有 LE 限流没有解药。这个卷看起来像个缓存，实际是**不可再生资源的仓库**。
</details>

<details>
<summary><b>9. 在"nginx 自己做 TLS"的架构里，<code>X-Forwarded-Proto $scheme</code> 还是错的吗？</b></summary>

**不是错的，是完全正确的。**

因为那个架构里 **TLS 就在 nginx 这一跳终结**——用户用 HTTPS 直连 nginx，所以 `$scheme` 真的等于 `https`。

> 🔑 **那行配置不是"写错了"，是"为另一个架构写的，而架构变了"。**
>
> 这比"写错了"难发现得多：`git blame` 会显示它一直是这样，而且**当初确实是对的**。没有任何一次提交引入了 bug——引入 bug 的是**一次它没有参与的架构变更**（caddy 接入）。
>
> 这就是配置漂移的本质：**代码没动，正确性却悄悄失效了。** 和 `00 §3.2` 讲的 `docs/09` 那张过时的架构图是同一个故事——只不过一个是文档，一个是代码。`06` 会把这条线彻底串起来。
</details>

<details>
<summary><b>10. <code>server_tokens off</code> 对本项目收益大吗？那还要不要加？</b></summary>

**收益接近零，但还是该加。**

**收益为什么低**：nginx 的响应会经过 caddy，而 caddy 用自己的 `Server: Caddy` 头。所以 nginx 的版本号**大概率透不到外界**。

**为什么还是该加**：**代价也接近零**（一行配置，零副作用、零性能开销、零维护成本）。

这属于**纵深防御**：万一哪天 nginx 直接对外了（临时绕过 caddy 调试、或者练习 7 那种改动），这行立刻就派上用场。

**判断原则**：当代价约等于零时，不需要证明收益很大——只需要证明**收益不为负**。便宜的保险，买了不亏。
</details>

<details>
<summary><b>11. <code>rate</code>、<code>burst</code>、<code>nodelay</code> 分别是什么？</b></summary>

漏桶模型：

- **`rate=5r/m`**：桶的**漏水速度** —— 每分钟匀速放行 5 个。
- **`burst=3`**：桶的**容量** —— 允许瞬间涌进 3 个先存着，不立即拒绝。
- **`nodelay`**：桶里存的那 3 个**立即放行**，而不是按 rate 匀速慢慢放。

**不写 `burst`** = 严格匀速，稍微快一点就被拒 → 体验极差（用户手抖点两下就被限）。

**不写 `nodelay`** = 突发的请求会**排队等待**（按 rate 慢慢放行）→ 用户感觉页面卡住不动，比直接拒绝还难受。

**实践**：`burst` + `nodelay` 通常成对出现，含义是"允许小幅突发且不惩罚，但持续超速就拒绝"。
</details>

<details>
<summary><b>12. 为什么本项目当前配 <code>limit_req</code> 会"一键 DoS 自己"？</b></summary>

因为 `limit_req_zone $binary_remote_addr` 是按 **`$remote_addr`** 分组，而本项目的 `$remote_addr` **恒等于 caddy 的 IP**（`04 §4.3`）。

于是**所有用户在 nginx 眼里都是同一个客户端**（`172.18.0.6`）→ **共享同一个限流配额**：

```
攻击者爆破登录，把 5r/m 的配额吃光
→ 所有正常用户的登录请求也被拒
→ 攻击者用一个人的流量锁死了整站
```

**这不是限流，这是给攻击者提供了一个一键 DoS 按钮**——而且成本极低（每分钟发 6 个请求就够）。

**改成 `$http_x_forwarded_for` 能解决吗？不能**（练习 4 的答案）：XFF 可伪造，攻击者每次换一个假 IP → 每次都是"新客户端" → 限流形同虚设。

**两条路都不通。** 必须先修好 IP 传递链路，或者干脆在 caddy 那一层限流。
</details>

<details>
<summary><b>13. <code>client_max_body_size</code> 默认多少？为什么这个坑只在生产出现？</b></summary>

**默认 `1m`。** 超过就返回 **413**，**请求根本不会转给后端**。

**为什么只在生产出现**：因为**本地开发环境根本没有 nginx**！

`00 §2.3` 讲过：`npm run dev` 时走的是 **Vite 的 `server.proxy`**，它没有这个限制。所以：

```
① 开发本地测试上传 5MB Excel → 成功 ✔（Vite 不拦）
② 上线后用户上传 → 413 失败 ✘（nginx 拦了）
③ 开发查后端日志 → 什么都没有（请求压根没到后端）
④ 开发怀疑人生
```

**这是"开发环境和生产环境组件不同"导致的经典事故**。任何"只在生产有、开发没有"的组件（nginx、caddy、CDN、WAF），都会制造这类问题。
</details>

<details>
<summary><b>14. <code>add_header</code> 不加 <code>always</code> 有什么区别？</b></summary>

**不加 `always`**：只在 **2xx / 3xx**（以及 204、301、302、303、304、307）响应上生效。

**加了 `always`**：**所有响应**都带，包括 4xx / 5xx。

**为什么重要**：安全头恰恰在错误页上**也需要**。比如 `X-Frame-Options`——如果 404 页面不带这个头，攻击者就能把你的 404 页 iframe 进去做点击劫持。

**通则：安全相关的 `add_header` 一律加 `always`。**
</details>

<details>
<summary><b>15. nginx 在本项目的安全边界是谁给的？依赖什么前提？</b></summary>

**是阿里云安全组和 caddy 给的，不是它自己挣的。**

nginx 自己几乎裸奔：没限流、没 `server_tokens off`、没安全头、没 TLS、`client_max_body_size` 是默认值、拿不到真实 IP。

它安全，纯粹因为**不在暴露面上**：

```
公网 → [阿里云安全组：只放行 22/80/443] → [caddy：唯一对外进程]
     → [rbac-net 内网：nginx 在这里，frontend 用 expose 而非 ports]
```

**依赖两个前提**：
1. `docker-compose.yml:97-98` 是 `expose: ["80"]` 而非 `ports`
2. 阿里云安全组只开三个端口

**任何一条被改掉，上面所有的"不着急"立刻全部作废**（练习 7 就是这道题）。

而这两条**都不在 nginx 的配置文件里** —— 它们是别人的配置（compose、云控制台），随时可能被人改，而改的人**不会想到这会让 nginx 裸奔**。

`learning-docker 07` 第八节收过同一条线：数据库的安全当前也是靠阿里云安全组这根弦吊着的。**这是同一个故事的两个受害者。**
</details>

### 练习 1（日志里的 IP）

<details>
<summary><b>点开看答案</b></summary>

**不是攻击，是正常现象。`172.18.0.6` 是 caddy 容器的内网 IP。**

解释：`combined` 格式的第一个字段是 `$remote_addr`，它是 **nginx 看到的直连客户端**。而本项目的链路是：

```
浏览器(千万个不同IP) → caddy(172.18.0.6) → nginx
                                            ↑ nginx 眼里的"客户端"永远是 caddy
```

所以**所有请求在 nginx 日志里都长着同一张脸**。这不是攻击，这是架构的必然结果。

**怎么看到真实 IP**：真实 IP 在 `X-Forwarded-For` 头里（caddy 放进去的）。自定义 `log_format` 读它：

```nginx
log_format main '$http_x_forwarded_for - $remote_user [$time_local] '
                '"$request" $status $body_bytes_sent '
                '"$http_referer" "$http_user_agent" '
                'rt=$request_time urt=$upstream_response_time';

access_log /var/log/nginx/access.log main;
```

（`$http_x_forwarded_for` 是读请求头的通用形式：`$http_` + 头名小写 + 连字符换下划线。）

**顺手加的两个字段特别值钱**：`$request_time`（总耗时）和 `$upstream_response_time`（后端耗时），一减就知道慢在 nginx 还是慢在后端。

**但要提醒**：这么改之后日志里的 IP 是 **XFF 的完整值**（可能是 `1.2.3.4, 172.18.0.6` 这样一串），而且**最左边可以被伪造**（`04` 练习 4）。**日志里的 IP 可以用来排查，但不能用来追责**——除非先修好 IP 传递链路。
</details>

### 练习 2（日志去哪了）

<details>
<summary><b>点开看答案</b></summary>

**① 有用吗？有用，能正常工作。**

**② 和原来的区别：几乎没有区别。**

因为原来那个 `/var/log/nginx/error.log` **本来就是指向 `/dev/stderr` 的软链接**（官方镜像做的）。所以：

```
原来：nginx → 写 /var/log/nginx/error.log → 软链接 → /dev/stderr → docker logs
改后：nginx → 写 /dev/stderr（直接）                        → docker logs
```

**殊途同归，最终都进了 stderr。** 改完 `docker logs` 看到的东西**一模一样**。

**③ 副作用**——有几个，都不严重但值得知道：

1. **丢失了灵活性**：写文件的话，如果哪天想把日志挂载出来单独收集（`volumes: - ./logs:/var/log/nginx`），原配置改个挂载就行；改成 `/dev/stderr` 后就锁死了，只能走 docker logs。

2. **和官方约定脱节**：官方镜像的软链接是个**约定**，别人接手时看到 `/var/log/nginx/error.log` 会知道"哦这是官方套路"；看到 `/dev/stderr` 反而要愣一下（虽然更直白）。

3. **本地跑非容器 nginx 时会变**：如果有人想在宿主机上直接用这份配置跑 nginx（不通过容器），`/dev/stderr` 在某些环境下的行为和容器里不完全一样（比如权限、或者 nginx 以 daemon 模式跑时 stderr 已经被重定向了）。

**结论**：这个改动**属于"没必要但也不算错"**。原来的写法靠官方软链接已经完美工作了，改它属于**解决一个不存在的问题**——而且改动本身还引入了上面三个微小的负面。

**真正的教训**：看到"配置写着写文件，但 docker logs 能看到"这个现象时，正确的反应是**去搞清楚为什么**（发现软链接），而不是**去改配置让它符合自己的直觉**。前者让你学到了容器化日志的标准套路，后者只是在用改动掩盖自己的困惑。
</details>

### 练习 3（证书续期失败）

<details>
<summary><b>点开看答案</b></summary>

**原因：证书文件续期成功了，但 nginx 还在用内存里的老证书。**

nginx 在**启动时**把证书读进内存，之后**不会再看磁盘**。certbot 把磁盘上的 `.pem` 换成新的，nginx 毫不知情，继续拿着已过期的老证书跟浏览器握手。

```
certbot: 磁盘上的证书 ✔ 新的（修改时间：昨天）
nginx:   内存里的证书 ✘ 老的（启动时读的，90 天前那个）
浏览器:  看到的是 nginx 内存里那个 → 【已过期】
```

**这就是为什么运维查磁盘会觉得"续上了啊"** —— 磁盘确实是对的，问题在内存。

**怎么修（立即止血）**：

```bash
nginx -s reload     # 让 nginx 重读配置和证书
```

`01 §5.2` 讲过 reload 是零停机的，几秒钟就恢复。

**怎么根治**：

给 certbot 配 `--deploy-hook`，让它**每次续期成功后自动 reload nginx**：

```bash
certbot renew --deploy-hook "nginx -s reload"
```

（写进 certbot 的续期配置里，或者 systemd timer 的 ExecStartPost。）

**为什么这个坑特别阴险**：

1. **它有 90 天的潜伏期**。你配好 certbot、看到"续期成功"、`--dry-run` 也过了——**一切正常**。然后 90 天后的某个凌晨爆炸。
2. **所有证据都指向"没问题"**：磁盘上的证书是新的，certbot 的日志写着 success，cron/timer 也确实跑了。
3. **爆炸时间是凌晨**（证书在什么时刻过期由签发时间决定，通常不是工作时间）。
4. **爆炸范围是全站**，而且用户看到的是浏览器的大红警告页——比 500 更吓人。

**这道题的真正意义**：它展示了 nginx + certbot 方案的**真实成本**。不是"配一次就完了"，而是**每一个环节都要配对**：申请、续期、reload、监控。而 caddy 把这四件事**全部内建**了——它连"重载证书"这个概念都不需要你知道，因为它自己管着证书的生命周期。

**这就是 `00 §6` 那次架构选择的价值所在**：不是 caddy 更强，是**这类坑不值得踩**。
</details>

### 练习 4（限流陷阱）

<details>
<summary><b>点开看答案</b></summary>

**致命问题：`$binary_remote_addr` 在本项目里恒等于 caddy 的 IP。**

所以这不是"每个用户 5r/m"，而是**"全站所有用户加起来 5r/m"**。

**他为什么以为成功了**：因为他自己一个人测试，连点 10 次 → 确实第 4 次开始被拒（burst=3 用完了）。**现象和"限流生效"完全一致**，他没有理由怀疑。

**测试环境的单用户，恰好掩盖了"所有用户共享配额"这个致命缺陷。**

**攻击场景推演**：

```
① 攻击者写个脚本，对 /api/auth/login 每分钟发 6 个请求
   （成本：一行 curl 循环，一台家用电脑，几乎零流量）

② nginx 视角：所有请求来自 172.18.0.6（caddy），共享同一个桶
   → 5r/m 的配额被攻击者吃光

③ 此时，任何一个【正常管理员】想登录：
   → 他的请求也来自 172.18.0.6（在 nginx 眼里）
   → 桶是空的 → 【被拒绝，503】

④ 结果：攻击者用【每分钟 6 个请求】的成本，
   让【整个后台的所有人都无法登录】
```

> 🔑 **这个"限流"配置，把一个需要海量流量才能实现的 DoS，降级成了每分钟 6 个请求就能做到的事。** 它不但没提升安全性，**反而制造了一个原本不存在的攻击面**——不加这个配置，攻击者想让所有人登不上，得真的打垮 backend；加了之后，他只需要礼貌地每分钟点 6 下。
>
> **一个错误的安全措施，比没有安全措施更危险。**

**改成 `$http_x_forwarded_for` 能解决吗？**

**不能，只是换了个失败方式。**

XFF **可以被任意伪造**（`04` 练习 4 详细推演过）：

```
攻击者每次请求换一个伪造的 XFF：
  X-Forwarded-For: 1.1.1.1  → nginx 认为是新客户端 → 放行
  X-Forwarded-For: 2.2.2.2  → 新客户端 → 放行
  X-Forwarded-For: 3.3.3.3  → 新客户端 → 放行
  ... 无限循环
→ 限流【完全失效】，可以无限爆破
```

从"误伤所有人"变成"谁也拦不住"。**两条路都不通。**

**真正的解法有两个方向**：

**方向 A（推荐）：在 caddy 那一层限流。**

caddy 是**唯一一个见得到真实客户端 IP 的跳**（`$remote_addr` 对它来说就是浏览器的真实 IP）。在它那儿限流：
- 不需要任何 IP 传递机制
- 不可能被 XFF 伪造绕过（它看的是 TCP 连接的源地址，那是伪造不了的）
- 天然正确

**方向 B：先修好 IP 传递链路，再在 nginx 限流。**

让 caddy 写一个**下游不可覆盖的专用头**（如 `X-Client-IP`，且强制覆盖客户端传来的同名头），nginx 用它限流。

**但这么绕一圈图什么？** 既然 caddy 已经有正确的 IP 了，让它直接限流不是更简单？

**方向 A 更优。** 这也是本系列反复出现的一个模式：**把判断收敛到唯一有资格判断的那一跳**。谁有真实信息，谁做决策。

> 🔑 **这道题的元教训**：`limit_req`、操作日志的 IP 审计、未来的 IP 白名单——**三个功能全都卡在"nginx 拿不到真实 IP"这同一个前置问题上**。
>
> 而更深一层的教训是：**测试通过 ≠ 配置正确**。他的测试完美复现了预期现象，却完全没有暴露那个致命缺陷——因为测试场景（一个人）和攻击场景（一个人 + 其他所有人）的**关键差异不在测试覆盖范围内**。
</details>

### 练习 5（上传功能的墙）

<details>
<summary><b>点开看答案</b></summary>

**① 用户看到什么错误？**

**413 Request Entity Too Large**。

前端拿到的是一个 HTTP 413，通常会显示成一个语焉不详的"上传失败"或"网络错误"（因为前端的错误处理大概率没专门处理 413）。

**② 后端日志里有什么？**

**什么都没有。一条记录都没有。**

这是最关键的一点：nginx 在**收到完整请求体之前**就判断出超限了，**直接返回 413，根本不会转发给 backend**。backend 完全不知道有人试图上传过。

（nginx 的 error.log 里倒是有：`client intended to send too large body`。**这条日志是唯一的线索**，但排查的人通常先去看后端日志。）

**③ 为什么本地测试没发现？**

**因为本地开发环境根本没有 nginx！**

`00 §2.3` 讲过：`npm run dev` 时，`/api` 的请求走的是 **Vite 的 `server.proxy`**（`vite.config.ts:23-29`），直连宿主机的 `localhost:8080`。**这条链路上一个 nginx 都没有**，自然没有 `client_max_body_size` 这堵墙。

```
开发环境：浏览器 → Vite dev server(:5173) → localhost:8080     ← 没有 nginx！
生产环境：浏览器 → caddy → nginx(1MB 限制!) → backend:8080
```

**这是"开发环境和生产环境组件不同"导致的经典事故**。

**④ 怎么修？**

```nginx
location /api/upload {           # 或者具体的导入接口路径
    client_max_body_size 10m;    # 按实际需求给，留点余量
    proxy_pass http://rbac_backend;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

⚠️ **注意这里必须重写四个 `proxy_set_header`** —— 因为 `04 §4.6` 讲过，`proxy_set_header` 是**整层覆盖**！新加的 location 如果不写，就一条头都没有（它不会从 `location /api/` 继承，那是兄弟不是父亲）。

**⑤ 修的时候要注意什么？**

**别全局放开**：

```nginx
http {
    client_max_body_size 100m;    # ⚠️ 不要这么干
}
```

全局放开等于允许任何人往**任何接口**发 100MB 请求体 → 这本身就是个 DoS 入口（攻击者并发发几十个 100MB 的请求，把内存/磁盘撑爆）。

**只在真正需要上传的 location 上放开，其他地方保持严格。** 这是最小权限原则在配置上的体现。

**还要注意三点**：

1. **后端也有自己的限制**。Spring Boot 的 `spring.servlet.multipart.max-file-size` 默认是 **1MB**！nginx 放开了，Spring 那边还会拦。**两边都要改**，否则只是把 413 换成了后端的 `MaxUploadSizeExceededException`。
2. **caddy 那边**：caddy 默认**没有**请求体大小限制，所以不用改。
3. **给个合理的上限**，别写 `client_max_body_size 0`（0 = 无限制）。无限制就是没设防。

> 🔑 这道题串起了本系列好几个点：`00` 的 dev/prod 差异、`04 §4.6` 的 `proxy_set_header` 覆盖坑、`05` 的 `client_max_body_size`。**真实的故障从来不是单点的，它是几个知识点的交叉口。**
</details>

### 练习 6（add_header 消失了）

<details>
<summary><b>点开看答案</b></summary>

**原因：`add_header` 是"整层覆盖"，不是"合并"。**

```nginx
server {
    add_header X-Frame-Options "SAMEORIGIN" always;   # ← server 层的整组

    location /api/ {
        add_header X-Api-Version "1.0" always;        # ← 这里写了【任何一条】
        # → server 层那【整组】add_header 全部失效！
        # → /api/ 的响应只有 X-Api-Version，没有 X-Frame-Options
    }

    location / {
        try_files $uri $uri/ /index.html;
        # ← 这里【没写】 add_header
        # → 正常继承 server 层的 X-Frame-Options ✔
    }
}
```

**这完美解释了他观察到的现象**：
- 访问 `/` → `location /` 里没有 `add_header` → 继承生效 → 有 `X-Frame-Options` ✔
- 访问 `/api/users` → `location /api/` 里有 `add_header` → **整组覆盖** → `X-Frame-Options` 消失 ✘

**这和 `04 §4.6` 的 `proxy_set_header` 是完全相同的机制**——nginx 里所有这类"数组型"指令（`add_header`、`proxy_set_header`、`fastcgi_param` 等）都是**整层覆盖，不合并**。

**修法一：在子层重复写**

```nginx
location /api/ {
    add_header X-Frame-Options "SAMEORIGIN" always;   # ← 重复一遍
    add_header X-Api-Version "1.0" always;
    ...
}
```

**修法二（推荐）：抽成 include 文件**

```nginx
# /etc/nginx/security_headers.conf
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options        "SAMEORIGIN" always;
add_header Referrer-Policy        "strict-origin-when-cross-origin" always;
```

```nginx
location /api/ {
    include /etc/nginx/security_headers.conf;    # ← 引进来
    add_header X-Api-Version "1.0" always;
    ...
}
location / {
    include /etc/nginx/security_headers.conf;    # ← 每个 location 都引一次
    try_files $uri $uri/ /index.html;
}
```

**但注意**：本项目的配置是**烤进镜像**的（`01 §5.3`），所以新增 include 文件还要改 `frontend/Dockerfile` 多 COPY 一个文件。这增加了改动的成本。**对本项目这种只有两个 location 的规模，直接重复写反而更简单。**

**这道题最值钱的地方**：

他的**测试方法是对的**（真去看了响应头，而不是"配置写了就当生效了"）。正因为他验证了，才发现了这个坑。

对比 `04` 练习 7 那个 keepalive 的人——他只写了配置就以为生效了，**永远不会发现自己错了**。

> 🔑 **`add_header` / `proxy_set_header` 的覆盖坑，是"配了但没生效"的头号来源，且完全静默**（不报错、`nginx -t` 通过、日志干净）。
>
> **唯一的防线是验证**：`curl -I` 看响应头。**配置文件不是事实，运行时行为才是**（`04` 练习 7 也是这个结论）。
</details>

### 练习 7（安全边界）

<details>
<summary><b>点开看答案</b></summary>

**这一个改动，让 nginx 从"内网组件"变成了"公网组件"。** `§4.6` 那个"它的安全边界是别人给的"论断，前提当场作废。

```
改之前：公网 → [安全组:22/80/443] → [caddy] → 内网 → nginx（摸不到）
改之后：公网 → [安全组:22/80/443/8080] ────────────────► nginx（直接摸到！）
                                          ↑ 绕过 caddy，绕过 TLS，绕过一切
```

**立刻变紧急的至少 5 条：**

| # | 原本"不着急"的 | 现在的具体风险 |
|---|---|---|
| 1 | **没有 TLS** | 8080 是**明文 HTTP**。用户走这个端口访问 → **JWT token 在公网上裸奔**。任何能抓包的人（同一 WiFi、运营商、任何中间节点）都能拿到 token，**直接冒充管理员**。这是最严重的一条 |
| 2 | **`server_tokens` 没关** | 现在响应**不再经过 caddy**，`Server: nginx/1.27.0` **直接暴露到公网**。扫描器一扫就知道版本，进"可攻击目标"名单 |
| 3 | **没有限流** | 8080 直连 → `/api/auth/login` **完全裸露，无任何速率限制** → 可以全速暴力破解密码。而 `docs/09` 的踩坑记录显示线上可能还是弱密码（`learning-docker 07` 第八节串过这条证据链） |
| 4 | **没有安全响应头** | 没有 `X-Frame-Options` → 后台可被 iframe 嵌入做**点击劫持**；没有 `nosniff` → MIME 嗅探攻击面打开 |
| 5 | **`client_max_body_size` 默认 1m** | 这条反而**帮了忙**（限制了 DoS）。但如果之前为了上传功能全局放开到 100m，现在就是个**公网可达的内存炸弹** |

**还有几条更隐蔽的：**

| # | 问题 | 风险 |
|---|---|---|
| 6 | **`$remote_addr` 现在变了** | 走 8080 直连的请求，`$remote_addr` **真的是用户 IP** 了；走 caddy 的还是 caddy IP。**同一份日志里两种语义混在一起**，审计彻底混乱 |
| 7 | **`X-Forwarded-For` 可完全伪造** | 之前至少 caddy 会追加一个可信值；现在攻击者**直连 nginx**，XFF 完全由他说了算，**没有任何一跳能提供可信 IP** |
| 8 | **HTTPS 强制跳转被绕过** | caddy 会把 80 跳到 443，但 **8080 没有任何跳转** → 用户可以停留在明文 HTTP 上，且**浏览器不会给任何警告**（因为它就是个 HTTP 站） |

**最可怕的是第 8 条的延伸**：如果有人把 `http://IP:8080` 这个地址分享出去（比如内部文档、书签），**用户会一直用明文访问**，而且**永远不会发现**——页面看起来一模一样，只是地址栏没有那把锁。

**这道题的真正意义**：

它证明了 `§4.6` 那个论断的**脆弱性**。

> 🔑 本节所有"不着急"的判断，**全部建立在一个不在 nginx 配置文件里的前提上**：`docker-compose.yml:97-98` 那两行 `expose` 和阿里云控制台的安全组设置。
>
> 而改这两处的人，**大概率不知道自己顺手让 nginx 裸奔了**。他只是想调试个东西。他改的是 compose，不是 nginx.conf——**在他的心智模型里，这跟 nginx 的安全配置毫无关系**。
>
> 这就是"安全依赖于外部假设"的根本问题：**假设不会自我保护，也不会在被违反时报警**。

**怎么防**：

1. **纵深防御**：把 `server_tokens off`、安全响应头这类**零代价**的加固**现在就加上**。它们平时是废话，只在假设被打破的那一刻值钱——而那一刻，你不会有时间去加。
2. **把假设写进注释**：在 `docker-compose.yml` 的 `expose` 旁边写清"⚠️ 改成 ports 会让 nginx 直接暴露到公网且无 TLS"。**让下一个想改的人在改之前就看见**。
3. **别指望记忆**：`learning-docker 07` 第八节已经把"数据库靠安全组这根弦吊着"这条线挖出来过了。**这是同一个故事的第二个受害者**——说明这个模式在本项目里是**系统性的**，不是偶发的。
</details>
