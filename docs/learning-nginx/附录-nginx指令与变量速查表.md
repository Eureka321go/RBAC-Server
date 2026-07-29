# 附录 · nginx 指令与变量速查表

> **这不是教程，是速查。** 每条都带回指章节，想不起来为什么就去那一节。
> 正文见 `00`-`06`。本项目的配置见 `frontend/nginx.conf`（**线上那份**）。

---

## 0. 只记两条的话

| 记住 | 为什么 |
|---|---|
| **`nginx -t` 改完先验** | 只查语法不查逻辑，但那是最便宜的一道防线（`01 §5.1`） |
| **location 前缀比长度，正则比顺序** | 前缀匹配和书写顺序**无关**；正则是唯一看顺序的（`03 §4.2`） |

---

## 1. 上下文速查

| 上下文 | 管什么 | 本项目有几个 | 哪节 |
|---|---|---|---|
| main | 进程、用户、全局日志 | 1（文件本身） | `01 §4.2` |
| `events` | 连接处理模型 | 1 | `01 §3` |
| `http` | 所有 HTTP 配置的家 | 1 | `02` |
| `upstream` | 后端服务器组（在 http 内） | 1 | `04 §2` |
| `server` | 一个虚拟主机 | 1 | `03 §2` |
| `location` | 一组 URL 的处理规则 | 2 | `03 §4` |

**继承规则**：内层自动继承外层；内层重写则**整体覆盖，不合并**（`01 §4.3`）。

⚠️ **覆盖坑重灾区**：`proxy_set_header`（`04 §4.6`）、`add_header`（`05 §4.5`）——内层写**任何一条**，外层**整组**作废，且**静默无提示**。

---

## 2. 进程与连接

| 指令 | 干什么 | 本项目 | 哪节 |
|---|---|---|---|
| `user` | **worker** 降权后的身份（master 恒为 root） | `nginx` | `01 §2.1` |
| `worker_processes` | worker 数量，`auto` = CPU 核心数 | `auto` | `01 §2.2` |
| `worker_connections` | **每个 worker** 的连接上限（**不是用户数**） | `1024` | `01 §3.1` |
| `worker_rlimit_nofile` | 文件描述符上限（调 worker_connections 必须同时调） | 没配 | `01 §3.1` |
| `pid` | master 进程号存哪（给 reload 找 master 用） | 默认路径 | `01 §2.3` |

**算连接**：`worker_processes × worker_connections`，而**反代一个请求吃两个连接**（`01 §3.1`）。

---

## 3. 静态文件服务

| 指令 | 干什么 | 本项目 | 哪节 |
|---|---|---|---|
| `include mime.types` | 扩展名 → MIME 对照表 | ✅ | `02 §2.2` |
| `default_type` | 查不到时的兜底 MIME | `application/octet-stream`（**安全默认值**） | `02 §2.3` |
| `sendfile` | 零拷贝，省两次用户态往返 | `on` | `02 §3` |
| `keepalive_timeout` | 连接复用保持时长 | `65` | `02 §4` |
| `root` | 站点根目录，**追加完整 URI** | `/usr/share/nginx/html` | `02 §5.1` |
| `alias` | **替换** location 前缀（⚠️ 尾斜杠陷阱） | 没用 | `02 §5.3` |
| `index` | 请求目录时发哪个文件 | `index.html` | `02 §5.2` |
| `autoindex` | 列目录 | 没用（**生产别开**） | `02 §5.2` |

**`root` vs `alias`**：`root` = 追加（前缀保留），`alias` = 替换（前缀被吃掉）。**能用 root 就别用 alias**（`02 §5.3`）。

---

## 4. gzip

| 指令 | 干什么 | 本项目 | 哪节 |
|---|---|---|---|
| `gzip` | 开关 | `on` | `02 §6.2` |
| `gzip_min_length` | 小于此不压（压了反而更大） | `1k` | `02 §6.3` |
| `gzip_types` | 压哪些 MIME（**在默认 `text/html` 上追加**） | 六种 | `02 §6.4` |
| `gzip_comp_level` | 压缩等级 1-9，收益严重递减 | 没配（默认 1） | `02 §6.6` |
| `gzip_vary` | 加 `Vary: Accept-Encoding`，防缓存污染 | 没配 | `02 §6.6` |

⚠️ **`text/html` 永远被压缩**，写进 `gzip_types` 是**废话**（`02 §6.5`）。
⚠️ `gzip` 和 `sendfile` **在同一响应上互斥**（要压就得进用户态）（`02 §3.3`）。
⚠️ 图片只压 `image/svg+xml`（它是文本）；PNG/JPG **绝不能压**（`02 §6.4`）。

---

## 5. location 与匹配

### 5.1 优先级（**背下来**）

```
① location = /path        精确匹配 → 命中【立即结束】
② location ^~ /path       前缀 + 禁正则 → 若是最长前缀则【立即结束】
③ location ~ /path        正则（大小写敏感）  ┐ 按【书写顺序】
   location ~* /path       正则（不敏感）      ┘ 第一个命中就用
④ location /path          普通前缀 → 前面全没中时，用【最长】的那个
```

| 记住 | 哪节 |
|---|---|
| 前缀匹配比**长度**，不比顺序 | `03 §4.2` |
| 正则匹配比**顺序**（唯一看顺序的） | `03 §4.2` |
| **正则优先级高于普通前缀** ← 截胡的根源 | `03 §4.4` |
| `^~` 唯一作用 = **阻止正则截胡** | `03 §4.4` |

### 5.2 server 匹配（虚拟主机）

```
精确 → 前导通配 *.a.com → 尾部通配 www.* → 正则（按顺序）→ default_server
```

⚠️ `server_name _` **不是通配符**，`_` 是个无效域名；它靠 **default_server 兜底**才能收到请求（`03 §3.2`）。

### 5.3 处理指令

| 指令 | 干什么 | 会查磁盘吗 | 哪节 |
|---|---|---|---|
| `try_files` | 按顺序找，**最后一个是无条件兜底** | ✅ | `03 §5` |
| `return` | 立即返回，**短路** | ❌ | `03 §6.1` |
| `rewrite` | 改写 URI（`last`/`break`/`redirect`/`permanent`） | ❌ | `03 §6.3` |

⚠️ `try_files` 最后一个参数**不存在 → 500**（不是 404）（`03 §5.4`）。
⚠️ `rewrite ... last` 可能**死循环** → 10 次后 500 + `rewrite or internal redirection cycle`（`03 §6.3`）。
⚠️ **能用 `try_files` 就别用 `rewrite`**（`03 §6.3`）。

---

## 6. 反向代理

| 指令 | 干什么 | 本项目 | 哪节 |
|---|---|---|---|
| `proxy_pass` | 转发给上游 | `http://rbac_backend;`（**无尾斜杠**） | `04 §3` |
| `proxy_set_header` | 改发给上游的请求头 | 四条 | `04 §4` |
| `proxy_http_version` | 和上游通信的 HTTP 版本 | 没配（**默认 1.0**） | `04 §6.2` |
| `proxy_connect_timeout` | 建连超时 | 没配（默认 60s） | `04 §5.3` |
| `proxy_read_timeout` | **等上游响应超时**（最重要） | 没配（默认 60s） | `04 §5.3` |

### ⚠️ `proxy_pass` 尾斜杠（**头号事故来源**）

```nginx
proxy_pass http://up;     # 无 URI 部分 → 【原样转发完整 URI】
proxy_pass http://up/;    # 有 URI 部分 → 【剥掉 location 前缀】
```

请求 `/api/users`，location `/api/`：
- 不带斜杠 → 后端收到 `/api/users` ← **本项目要的**（后端 context-path=`/api`）
- 带斜杠 → 后端收到 `/users` → **全部 API 404**

**`nginx -t` 查不出来**（两种都合法）（`04 §3.4`）。

---

## 7. upstream

| 指令 | 干什么 | 本项目 | 哪节 |
|---|---|---|---|
| `server` | 一个上游 | `backend:8080`（compose 服务名） | `04 §2.1` |
| `keepalive` | 空闲长连接池 | 没配 | `04 §6.2` |
| `least_conn` / `ip_hash` / `hash` | 负载均衡策略 | 没用（默认轮询） | `04 §6.1` |
| `weight=N` | 加权 | 没用 | `04 §6.1` |
| `max_fails` / `fail_timeout` | 被动健康检查 | 没配 | `04 §6.1` |
| `backup` | 备用机 | 没用 | `04 §6.1` |

### ⚠️ keepalive 三件套（缺一个**静默失效**）

```nginx
upstream up { server x:8080; keepalive 32; }   # ①
location / {
    proxy_http_version 1.1;                     # ② 少了 = 完全不生效（默认 1.0）
    proxy_set_header Connection "";             # ③ 少了 = 被 Connection: close 破坏
}
```

⚠️ **upstream 里的域名只在启动/reload 时解析一次**，容器重建后 IP 变了会 502 且**永不自愈**。要动态解析得用 `resolver` + **变量形式**的 `proxy_pass`（`04 §2.3`）。

---

## 8. 日志

| 指令 | 干什么 | 本项目 | 哪节 |
|---|---|---|---|
| `error_log` | 错误日志 + 级别 | `warn` | `01 §2.3` / `05 §2.2` |
| `access_log` | 访问日志 | **没配**（默认开着，`combined`） | `05 §2.1` |
| `log_format` | 自定义格式 | 没配 | `05 §2.3` |

**级别**：`debug → info → notice → warn → error → crit → alert → emerg`（记录该级别**及以上**）。

⚠️ **本项目日志里的客户端 IP 全是 caddy 的内网 IP**，毫无价值（`05 §2.3`）。
💡 官方镜像把日志**软链到 `/dev/stdout` `/dev/stderr`**，所以 `docker logs` 看得到；**不需要配 logrotate**（`05 §2.4`）。

---

## 9. TLS（本项目**一行都没有**，caddy 全包）

| 指令 | 干什么 | 哪节 |
|---|---|---|
| `listen 443 ssl` + `http2 on` | 开 HTTPS | `05 §3.1` |
| `ssl_certificate` / `ssl_certificate_key` | 证书 + 私钥 | `05 §3.1` |
| `ssl_protocols` | 禁掉 TLS 1.0/1.1 | `05 §3.1` |
| `ssl_session_cache` | 会话复用（性能） | `05 §3.1` |
| `ssl_stapling` | OCSP Stapling | `05 §3.1` |
| `add_header Strict-Transport-Security` | HSTS | `05 §3.1` |

⚠️ **LE 证书只有 90 天**。续期后**必须 reload**，否则 nginx 还用内存里的老证书（磁盘上是新的，看起来"续上了"）（`05` 练习 3）。
⚠️ **`caddy-data` 卷不能删** —— 删了重新申请，反复几次触发 LE 限流 → **等一周，无解药**（`05 §3.4`）。

---

## 10. 安全（本项目**全都没配**）

| 指令 | 干什么 | 哪节 |
|---|---|---|
| `server_tokens off` | 隐藏版本号 | `05 §4.1` |
| `limit_req_zone` + `limit_req` | 限流（漏桶：`rate`/`burst`/`nodelay`） | `05 §4.2` |
| `limit_conn_zone` + `limit_conn` | 限并发连接 | `05 §4.3` |
| `client_max_body_size` | 请求体上限（**默认 1m**） | `05 §4.4` |
| `add_header X-Frame-Options` 等 | 安全响应头（**记得加 `always`**） | `05 §4.5` |

⚠️ **本项目当前配 `limit_req` 会一键 DoS 自己** —— `$remote_addr` 恒为 caddy IP → 全站共享配额；改用 XFF 又**可伪造**。**两条路都不通**，得先修 IP 传递链路，或直接在 caddy 限流（`05 §4.2` / `06 §7.2③`）。
⚠️ `client_max_body_size` 默认 1m 的坑**只在生产出现** —— 本地 `npm run dev` 走 Vite proxy，**没有 nginx**（`05 §4.4`）。

---

## 11. 常用内置变量

| 变量 | 是什么 | 本项目实际值 | 哪节 |
|---|---|---|---|
| `$uri` | **规范化后**的 URI（不含参数） | `/api/users` | `03 §5.1` |
| `$request_uri` | **原始** URI（**含**参数） | `/api/users?page=1` | —— |
| `$args` | 查询串 | `page=1` | —— |
| `$host` | Host 主机名，小写、**去端口**，可回落 server_name | `www.eureka32.top` | `04 §4.2` |
| `$http_host` | Host 原始值，**含端口** | 同上 | `04 §4.2` |
| `$scheme` | **nginx 这一跳收到的**协议 | **恒为 `http`**（caddy 终结了 TLS） | `04 §4.5` |
| `$remote_addr` | **直连**客户端 IP（只是上一跳） | **恒为 caddy 的 `172.18.0.x`** | `04 §4.3` |
| `$proxy_add_x_forwarded_for` | 客户端 XFF **+ `, ` + `$remote_addr`**（追加） | `1.2.3.4, 172.18.0.6` | `04 §4.4` |
| `$http_<头名>` | 读任意请求头（小写、`-`→`_`） | `$http_x_forwarded_for` | `04 §4.5` |
| `$request_time` | nginx 处理总耗时 | 没用上 | `05 §2.3` |
| `$upstream_response_time` | **上游**耗时 | 没用上 | `05 §2.3` |
| `$status` | 响应码 | —— | `05 §2.3` |

💡 `$request_time - $upstream_response_time` ≈ **nginx 自己的开销** → 一眼看出"慢在后端还是慢在 nginx"（`05 §2.3`）。
⚠️ **`$remote_addr` 在本项目 ≠ 真实用户 IP**；**XFF 最左边可被任意伪造**，能排查**不能追责**（`04` 练习 4）。

---

## 12. 本项目速查

### 12.1 两份 nginx.conf（**别弄混**）

| | `frontend/nginx.conf` | `deploy/config/nginx/nginx.conf` |
|---|---|---|
| **线上跑吗** | ✅ **就是它** | ❌ 从没跑过（`profiles: ["extra"]`） |
| 怎么进容器 | `Dockerfile:18` **COPY**（烤进镜像） | compose `:129` **volumes 挂载** |
| **改了怎么生效** | **必须 `up -d --build`** | `restart` 即可（但改了也没用） |
| upstream | `backend:8080` | `host.docker.internal:8080`（宿主机时代） |
| server_name | `_` | `localhost` |
| 发静态文件 | ✅ root + try_files | ❌ 只 `return 200 'RBAC Nginx is up'` |
| gzip | ✅ | ❌ |
| **危害** | —— | ⚠️ **`ports: 80:80` 和 caddy 抢端口** |

考古与来龙去脉：`06 §3`。

### 12.2 链路图

```
浏览器 ──:443 HTTPS──► caddy ──内网 http:80──► frontend(nginx) ──► backend:8080 ──► mysql/redis
                        ↑ TLS 终结             ↑ 发 dist + 反代 /api
                        唯一对外入口            expose 不是 ports，公网摸不到
```

### 12.3 改配置的标准循环

```bash
# 开发机
vim frontend/nginx.conf
git add . && git commit -m "..." && git push origin feat/rbac-mvp
# 服务器
cd /root/project/RBAC-Server && git pull origin feat/rbac-mvp
cd deploy && docker compose up -d --build     # ← --build 不能省！
```

### 12.4 症状 → 先查哪儿（详见 `06 §6.2`）

| 症状 | 第一步 |
|---|---|
| API 全 **502** | `docker compose logs --tail=50 frontend` 看 error.log（**它把答案写脸上**） |
| API 全 **404**（页面正常） | 看**后端收到的路径** → 十有八九是 `proxy_pass` 斜杠 |
| **刷新 404**、点链接正常 | `try_files` 没了 |
| 静态资源 **403** | 文件权限（`nginx` 用户读不了） |
| 访问站点**变下载** | `include mime.types` 丢了 |
| 看到 **Welcome to nginx!** | dist 没 COPY 进镜像 |
| 上传 **413** | `client_max_body_size` 默认 1m |
| **改了没生效** | 是 COPY 还是 mount？→ 没 `--build` |
| JS 报 **`Unexpected token '<'`** | 静态资源 404 被 try_files 兜底成了 index.html |

### 12.5 error.log 关键字

| 看到 | 意思 |
|---|---|
| `connect() failed (111: Connection refused)` | 地址对，没人监听（backend 没起） |
| `... could not be resolved` | DNS 问题（不在同一网络） |
| `no live upstreams` | 上游全被标记失败 |
| `upstream timed out` | 这是 **504** 不是 502 |
| `client intended to send too large body` | **413**，`client_max_body_size` |
| `rewrite or internal redirection cycle` | rewrite 死循环 |

---

## 13. ⚠️ 红区：改之前停三秒

| 动作 | 后果 |
|---|---|
| **`proxy_pass` 手滑加/删尾斜杠** | **全部 API 404**。`nginx -t` 查不出来，容器全绿，症状指向后端 → 能查一天（`04 §3.3`） |
| **生产机跑 `--profile extra up -d`** | nginx 和 caddy **抢 80**，`port is already allocated`。而**这条命令就写在 compose `:13` 的注释里**。有人会为此停掉 caddy → **全站下线**（`06 §4`、`06` 练习 3） |
| **改了配置只 `restart` 不 `--build`** | 完全不生效（配置烤在镜像里），而你以为改了（`01 §5.3`） |
| **删 `caddy-data` 卷** | 证书重新申请，反复几次 **LE 限流 → 等一周，无解药**（`05 §3.4`） |
| **`docker compose down -v`** | `-v` 删数据卷 → **清库** + 删证书（`docs/09:202` 警告过） |
| **改 `expose: ["80"]` → `ports`** | nginx **直接裸奔公网**：无 TLS（**token 明文传输**）、无限流、版本号暴露（`05` 练习 7） |
| **在 location 里加 `add_header` / `proxy_set_header`** | 外层**整组静默失效**（覆盖非合并）（`04 §4.6`、`05` 练习 6） |
| **加正则 location** | 可能**截胡**前缀 location，改变不相干功能的行为。解药是给前缀 location 加 `^~`（`03` 练习 2） |
| **`root` / `alias` 混用** | `alias` 尾斜杠不对 → 路径粘成 `/var/wwwapp.js` → **不报错，安静 404**（`02 §5.3`） |
| **`expires 1y; immutable`** | **不可撤销的支票**。依赖 Vite 内容哈希；哈希一没 → **新旧混搭白屏，无解药**（`02` 练习 6） |
| **`client_max_body_size` 全局放开** | 任何接口都能收 100MB → **DoS 入口**。只在上传的 location 放开（`05 §4.4`） |
| **按 `$remote_addr` 限流** | 全站共享配额 → 攻击者每分钟 6 个请求**锁死所有人**（`05` 练习 4） |
| **信 XFF 最左边** | 可任意伪造 → 审计日志**可栽赃**、IP 白名单**可绕过**（`04` 练习 4） |

---

## 14. 三条通则

> 🔑 **1. 配置文件不是事实，运行时行为才是。**
> `nginx -t` 只查语法不查逻辑；容器 Up 只说明进程活着。验证靠 `curl -I` 看响应头、看后端收到的路径、看连接状态。本系列至少四个故障是"**所有指标全绿但提供错误的东西**"（`06 §6.3`）。

> 🔑 **2. 以配置文件为准，文档只是旁证。**
> 配置文件不会漂移（它就是运行的那个东西）；文档会。`docs/09` 至今指导你改**错的那份** nginx.conf（`06 §5`）。

> 🔑 **3. "没配置" ≠ "没生效"。**
> 默认值、上下文继承、硬编码行为，都会让两者脱钩。`access_log` 没配但开着；`text/html` 没写但永远压（`02 §6.5`、`05 §2.1`）。
