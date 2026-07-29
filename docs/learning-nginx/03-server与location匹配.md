# 03 · server 与 location 匹配

> 目标：搞清一个请求进来之后，nginx 到底怎么决定"由谁来处理"。这是全系列最硬、也最容易栽跟头的一节。
>
> 读完你能：
> - 说清 `server_name _` 里那个下划线**不是**通配符，以及它凭什么还能工作。
> - 背出 location 的完整匹配优先级，并解释为什么"写在前面"基本不管用。
> - 证明本项目 `/api/users` 一定进 `location /api/`，而且理由不是"它写在前面"。
> - 讲透 `try_files $uri $uri/ /index.html` 的每一个参数，以及为什么少了它整个 SPA 就废了。
> - 说出 `return`、`rewrite`、`try_files` 三者的执行时机差异。

---

## 一、承上：一个请求进来，nginx 要做两次选择

`02` 结尾留了个问号：两个 location 都能匹配 `/api/users`，凭什么是 `location /api/` 赢？

要回答它，得先看清 nginx 处理一个请求的**完整决策链**。它其实要做**两次选择**，而且是先后进行的：

```
请求到达
   │
   ├─ 第一次选择：这个请求归哪个 server 管？     ← 依据：listen + server_name
   │                                                 （本项目只有 1 个 server，看似没得选，
   │                                                  但"没得选"本身也是个规则，见第三节）
   ▼
选定 server
   │
   ├─ 第二次选择：server 内部，归哪个 location 管？ ← 依据：location 匹配优先级
   │                                                 （本项目有 2 个 location，这才是重头戏）
   ▼
选定 location → 执行里面的指令
```

这一节按这个顺序讲：先 server（第二、三节），再 location（第四节起）。

---

## 二、`listen 80`：监听哪个端口

```nginx
server {
    listen 80;
```

最简单的一行：这个 server 处理到达 **80 端口**的请求。

`listen` 的完整形态可以很复杂，值得知道有这些写法：

```nginx
listen 80;                      # 本项目：所有网卡的 80 端口
listen 127.0.0.1:80;            # 只监听回环地址（外部访问不到）
listen 80 default_server;       # 80 端口的默认 server（第三节详谈）
listen 443 ssl;                 # HTTPS（本项目没有，05 讲）
listen [::]:80;                 # IPv6
```

本项目写光秃秃一个 `listen 80`，意思是**监听容器内所有网卡的 80 端口**。

这里有个值得停一下的点：这个 `80` 和 `frontend/Dockerfile:21` 的 `EXPOSE 80`、`docker-compose.yml:97-98` 的 `expose: ["80"]` 是**三个不同层面的东西**，很容易混：

| 在哪 | 是什么 | 真的开端口吗 |
|---|---|---|
| `nginx.conf` 的 `listen 80` | **nginx 进程真的去监听 80** | ✅ 真的，这是唯一真干活的 |
| `Dockerfile` 的 `EXPOSE 80` | 纯文档声明，给镜像使用者看的 | ❌ 什么都不做 |
| `compose` 的 `expose: ["80"]` | 声明容器在内网可达 80 | ❌ 也基本是声明性的 |

> 🔑 只有 `listen` 是真的在监听。`EXPOSE` 和 `expose` 都是**声明**——`learning-docker 06` 管这叫"`expose` 是纸老虎"。三者全都写 80，是为了保持一致好读，但**真正决定端口的只有 `listen`**。把 `listen` 改成 8080 而其他两处不改，容器照样能跑，只是 caddy 连不上了（502）。

---

## 三、`server_name _`：那个下划线是什么

```nginx
server_name _;
```

### 3.1 先讲 server_name 是干什么的

一台 nginx 可以同时托管很多个网站（虚拟主机），它们**共用同一个 80 端口**。那请求进来时，怎么知道用户要访问的是哪个网站？

靠 HTTP 请求头里的 `Host`：

```http
GET /index.html HTTP/1.1
Host: www.eureka32.top        ← 就是这一行
```

`server_name` 就是用来和这个 `Host` 头做匹配的：

```nginx
server { listen 80; server_name www.a.com; root /var/www/a; }
server { listen 80; server_name www.b.com; root /var/www/b; }
#                                ↑ Host: www.b.com 的请求进这个
```

### 3.2 下划线**不是**通配符

网上到处能看到 `server_name _;`，很多人以为 `_` 是"匹配任意域名"的通配符。

**它不是。**

nginx 官方文档说得很直白：`_` 只是一个**无效的域名**——它不可能出现在任何真实的 `Host` 头里（域名里不允许有下划线开头这种形式）。所以 `server_name _;` 的真实含义是：

> **这个 server 永远不会通过 server_name 匹配上任何请求。**

那它凭什么还能工作？答案在下一小节。

### 3.3 靠的是 `default_server` 兜底

nginx 的虚拟主机匹配有一条**兜底规则**：

> 如果所有 server 的 `server_name` 都没匹配上 `Host` 头，就把请求交给该端口的 **default_server**。
>
> 而如果没有任何 server 显式声明 `default_server`，**该端口上第一个出现的 server 自动成为 default_server**。

本项目的情况：

```
① 请求进来，Host: www.eureka32.top
② 找 80 端口上的 server，逐个比对 server_name
③ 唯一的 server 写的是 _  → 不匹配（因为 _ 不是任何真实域名）
④ 所有 server 都没匹配上 → 交给 80 端口的 default_server
⑤ 谁是 default_server？没人声明 → 【第一个出现的 server】自动当选
⑥ 而 80 端口上总共就一个 server → 就是它自己 ✔
```

**绕了一圈回到了自己。** 所以 `server_name _;` 在只有一个 server 的场景下，效果等于"接收所有请求"——但**机制完全不是通配，是兜底**。

> 🔑 `server_name _;` 的真正含义是"**我不打算靠域名匹配，我就是那个兜底的**"。它是一种**惯用写法**（idiom），用来明确表达"这个 server 不挑域名"。写 `server_name localhost;` 或者干脆不写 `server_name`，在本项目的单 server 场景下**效果完全一样**——因为不管怎么写，兜底规则最后都会把请求给它。

### 3.4 完整的虚拟主机匹配顺序

既然讲到了，把完整规则给全（**这是面试常考的**）：

nginx 拿 `Host` 头去比对时，按这个优先级：

| 优先级 | 类型 | 例子 | 说明 |
|---|---|---|---|
| 1 | **精确匹配** | `server_name www.a.com;` | 一字不差 |
| 2 | **前导通配** | `server_name *.a.com;` | 星号在**开头** |
| 3 | **尾部通配** | `server_name www.*;` | 星号在**结尾** |
| 4 | **正则匹配** | `server_name ~^www\d+\.a\.com$;` | `~` 开头，按配置书写顺序取第一个命中的 |
| 5 | **default_server** | —— | 前面全没中时的兜底 |

注意第 4 级是唯一看书写顺序的。前三级都是"**类型优先**"，和写在哪一行无关。

### 3.5 对比：遗留配置写的是 `localhost`

`deploy/config/nginx/nginx.conf:24` 写的是：

```nginx
server_name localhost;
```

这是那份配置**诞生年代**的痕迹：当时它是给本机开发用的，访问方式就是 `http://localhost`，所以 `Host: localhost` 能**精确匹配**上（走上表的第 1 级，而不是第 5 级兜底）。

有意思的是：**即使它匹配不上（比如用 IP 访问，Host 是 `127.0.0.1`），请求照样会进这个 server**——因为它是那个端口上唯一的 server，兜底规则会把它捡回来。

所以这两份配置在 `server_name` 上的差异，**在运行时基本没有可观察的区别**。它是纯粹的"作者意图"化石：一个想说"我是本机开发用的"，一个想说"我不挑域名"。`06` 会把这类化石一起挖。

---

## 四、location 匹配优先级（本节核心）

现在进入重头戏。本项目的 server 里有两个 location：

```nginx
        # 接口请求反代给后端（后端 context-path 是 /api，原样转发）
        location /api/ {
            proxy_pass http://rbac_backend;
            ...
        }

        # SPA 路由回退：找不到的路径一律交给 index.html（Vue Router 接管）
        location / {
            try_files $uri $uri/ /index.html;
        }
```

请求 `/api/users` 进来，**两个都能匹配**（`/` 是任何路径的前缀，`/api/` 也是它的前缀）。谁赢？

### 4.1 五种 location 写法

先认清 location 有几种形态，靠的是**修饰符**：

| 写法 | 修饰符 | 类型 | 例子 |
|---|---|---|---|
| `location = /path` | `=` | **精确匹配** | 只匹配一模一样的 `/path` |
| `location ^~ /path` | `^~` | **前缀匹配，且禁止正则** | 匹配 `/path` 开头，命中后不再试正则 |
| `location ~ /path` | `~` | **正则匹配，大小写敏感** | 按正则匹配 |
| `location ~* /path` | `~*` | **正则匹配，大小写不敏感** | 同上，忽略大小写 |
| `location /path` | 无 | **普通前缀匹配** | 匹配 `/path` 开头 |

本项目的两个 location（`/api/` 和 `/`）**都是无修饰符的普通前缀匹配**。

### 4.2 完整优先级规则

这是必须刻进脑子的流程。nginx 拿到 URI 之后：

```
① 先找【精确匹配】 location = /xxx
   └─ 命中？ → 【立即使用，结束】不再往下看 ✔

② 再找所有【前缀匹配】（含 ^~ 和无修饰符），
   记住其中【匹配长度最长】的那个
   └─ 如果最长的那个带 ^~ ？ → 【立即使用，结束】，不试正则 ✔

③ 按【配置书写顺序】逐个试【正则匹配】（~ 和 ~*）
   └─ 第一个命中的 → 【立即使用，结束】✔
   └─ 全都没中 → 用第 ② 步记下的那个【最长前缀匹配】✔
```

**三条最反直觉、也最该记住的结论**：

> 🔑 **1. 前缀匹配比的是"谁更长"，不是"谁写在前面"。** 把 `location /` 写在 `location /api/` 前面，结果**完全一样**。
>
> **2. 正则匹配比的才是"谁写在前面"。** 这是唯一看顺序的一类。
>
> **3. 正则的优先级高于普通前缀匹配。** 这是最容易出事的一条——你写了个前缀 location 觉得稳了，结果被某个正则 location 半路截胡。`^~` 存在的唯一意义就是**阻止**这种截胡。

### 4.3 回到本项目：`/api/users` 为什么进 `location /api/`

现在可以严格地推了：

```
URI = /api/users

① 精确匹配？ 配置里没有 location = /... → 跳过
② 前缀匹配，找最长的：
   - location /      匹配 ✔  匹配长度 = 1  （"/"）
   - location /api/  匹配 ✔  匹配长度 = 5  （"/api/"）
   → 最长的是 location /api/ ← 记住它
   → 它带 ^~ 吗？没有 → 继续第 ③ 步
③ 正则匹配？ 配置里一个正则 location 都没有 → 没得试
   → 全都没中 → 【使用第 ② 步记下的最长前缀：location /api/】✔
```

**结论：`location /api/` 赢，因为它匹配得更长（5 > 1），和书写顺序无关。**

验证一下另一个方向，URI = `/system/user`：

```
② 前缀匹配：
   - location /      匹配 ✔  长度 1
   - location /api/  【不匹配】—— /system/user 不以 /api/ 开头
   → 只有 location / 一个候选 → 用它 ✔
```

所以：

| URI | 进哪个 location | 为什么 |
|---|---|---|
| `/api/users` | `location /api/` | 前缀匹配长度 5 > 1 |
| `/api/auth/login` | `location /api/` | 同上 |
| `/` | `location /` | `/api/` 不匹配 |
| `/system/user` | `location /` | `/api/` 不匹配 |
| `/assets/index-a1b2.js` | `location /` | `/api/` 不匹配 |
| `/apifoo` | **`location /`** | ⚠️ 注意！`/api/` 带尾斜杠，`/apifoo` 不以 `/api/` 开头 |

最后一行值得盯一眼：`location /api/`（带尾斜杠）**不会**匹配 `/apifoo`。如果写成 `location /api`（不带尾斜杠），那 `/apifoo` 就会被匹配走 —— 这是尾斜杠的一个实际差异，虽然本项目的 API 都在 `/api/` 下所以碰不到。

### 4.4 一个刻意设计的冲突例子

本项目太干净了（两个前缀 location，无正则），体现不出优先级的杀伤力。看一个人为构造的：

```nginx
server {
    location / { ... }                          # A：前缀，长度 1
    location /images/ { ... }                   # B：前缀，长度 8
    location ~ \.(gif|jpg|png)$ { ... }         # C：正则，匹配图片后缀
    location ^~ /images/static/ { ... }         # D：前缀 + ^~，长度 16
    location = /images/logo.png { ... }         # E：精确匹配
}
```

逐个推：

| 请求 | 结果 | 推导 |
|---|---|---|
| `/images/logo.png` | **E** | ① 精确匹配命中 → 立即结束，后面全不看 |
| `/images/cat.jpg` | **C** | ① 无精确<br>② 最长前缀是 B（`/images/`，长度 8），不带 `^~` → 继续<br>③ 试正则：C 命中 `.jpg` → **C 截胡了 B** ✔ |
| `/images/static/cat.jpg` | **D** | ① 无精确<br>② 最长前缀是 D（长度 16 > B 的 8），**带 `^~`** → **立即结束，不试正则**<br>→ C 虽然也能匹配 `.jpg`，但**根本没机会** ✔ |
| `/images/readme.txt` | **B** | ① 无精确<br>② 最长前缀 B（长度 8）<br>③ 试正则：C 不匹配 `.txt` → 没中<br>→ 回落到 B ✔ |
| `/system/user` | **A** | 只有 A 匹配 |

**看第 2 行和第 3 行的对比**：同样是 `.jpg`，一个被正则 C 抢走，一个被 `^~` 保住给了 D。

> 🔑 **`^~` 的唯一作用就是"我赢了前缀匹配之后，别再让正则来抢"。** 如果你写了个前缀 location 却发现请求跑到别的 location 去了，第一嫌疑人就是某个正则 location 截了胡——解药就是给你的前缀 location 加上 `^~`。

### 4.5 为什么本项目不需要 `^~`

因为**配置里一个正则 location 都没有**（第 ③ 步无事可做），所以最长前缀匹配的结果不可能被抢。加 `^~` 是完全冗余的。

但这也意味着一件事，回到 `02 §7.4` 留的那个问题：

**如果要加静态资源缓存（`location /assets/`），会不会打架？**

现在可以答了：

```nginx
location /assets/ {          # 新增，前缀长度 8
    expires 1y;
    add_header Cache-Control "public, immutable";
}
location / { try_files ... } # 现有，前缀长度 1
```

请求 `/assets/index-a1b2.js`：最长前缀是 `/assets/`（8 > 1）→ **走新的那个** ✔

**不打架，但有一个必须注意的后果**：`/assets/**` 从此**不再走 `try_files`**，也就没有 SPA 回退了。这对 `/assets/` 恰恰是**好事**——静态资源找不到就该老老实实 404，而不是回退到 index.html 假装成功（想想看：一个不存在的 JS 请求返回了一个 HTML，浏览器会报语法错误，排查起来比 404 难十倍）。

所以 `02 §7.3` 那套配置是安全的，前提是你**知道**它为什么安全。

---

## 五、`try_files`：SPA 的命门

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

这一行是整个前端能正常工作的**命门**。`docs/09-部署上线指南.md:38` 专门警告过：

> **不配这条，刷新页面就 404**。

### 5.1 逐个参数拆

`try_files` 的语义是：**按顺序尝试每个路径，用第一个存在的；全都不存在，就用最后一个参数兜底。**

```nginx
try_files $uri $uri/ /index.html;
          ①    ②     ③
```

| # | 参数 | 含义 | 例子（请求 `/system/user`） |
|---|---|---|---|
| ① | `$uri` | 把 URI 当**文件**找 | 找 `/usr/share/nginx/html/system/user` |
| ② | `$uri/` | 把 URI 当**目录**找 | 找 `/usr/share/nginx/html/system/user/`，存在则用 `index` 指令找里面的 index.html |
| ③ | `/index.html` | **兜底**（最后一个参数永远是兜底，不是"尝试"） | 直接用 `/usr/share/nginx/html/index.html` |

注意 ① 和 ② 拼路径用的是 **`root` 继承来的值**（`01` 练习 3 那道题的答案）——`location /` 里没写 `root`，但它从 server 层继承到了 `/usr/share/nginx/html`。

### 5.2 两条路径的对比

**请求一个真实存在的静态文件** `/assets/index-a1b2.js`：

```
① $uri  → /usr/share/nginx/html/assets/index-a1b2.js  → 【存在！】✔
→ 直接发这个文件，结束。② 和 ③ 根本不会执行
```

**请求一个前端路由** `/system/user`：

```
① $uri  → /usr/share/nginx/html/system/user   → 不存在
② $uri/ → /usr/share/nginx/html/system/user/  → 不存在（没这个目录）
③ 兜底  → /index.html  → 【发 index.html】✔
```

第 ③ 步是全部意义所在。

### 5.3 为什么 SPA 非要这条不可

Vue Router 用的是 **history 模式**（URL 里没有 `#`）。这带来一个根本矛盾：

**在浏览器里点链接跳转时**，Vue Router 用 `history.pushState()` 改地址栏，**根本不发 HTTP 请求**，页面是 JS 在本地渲染的。一切正常。

**但用户按 F5 刷新时**（或者直接把 `https://www.eureka32.top/system/user` 粘进地址栏），浏览器会**真的向服务器发起 `GET /system/user`**。

而服务器上：

```
dist/
├── index.html
├── vite.svg
└── assets/
    ├── index-a1b2.js
    └── index-c3d4.css

← 根本没有 system/user 这个文件！它是【前端路由】，只存在于 JS 里
```

所以：

| | 没有 `try_files` | 有 `try_files` |
|---|---|---|
| 点链接跳转 | ✔ 正常（不发请求） | ✔ 正常 |
| **按 F5 刷新** | **404** ✘ | ✔ 回退到 index.html |
| **直接粘贴 URL 访问** | **404** ✘ | ✔ 同上 |
| **分享链接给别人** | **404** ✘ | ✔ 同上 |

回退到 `index.html` 之后发生的事：浏览器拿到 index.html → 加载 JS → **Vue Router 启动，读取当前地址栏的 `/system/user`** → 渲染对应组件。用户完全感觉不到中间绕了一圈。

> 🔑 `try_files $uri $uri/ /index.html` 的本质是：**"这个路径我这儿没有文件，但别急着 404，先把 index.html 给浏览器，让前端路由自己看着办。"** 这是 history 模式 SPA 部署的**通用范式**，不是本项目特有的——所有用 Vue Router / React Router history 模式的项目，服务端都必须有等价的一条。

### 5.4 一个致命的细节：兜底参数不"尝试"

`try_files` 的最后一个参数**不是"再试一次"，而是"直接用"**。哪怕它也不存在：

```nginx
try_files $uri $uri/ /index.html;
#                     ↑ 如果 index.html 也不存在呢？
```

答案是 **500 Internal Server Error**，不是 404。因为 nginx 认为"你都指定兜底了，兜底还没有，那是配置错误，不是用户的问题"。

这个行为差异在排错时很有用：**看到 SPA 站点返回 500 而不是 404，先怀疑 dist 是不是压根没 COPY 进镜像**。

### 5.5 另一种写法：命名 location

`try_files` 的兜底参数还可以是一个**命名 location**（以 `@` 开头）：

```nginx
location / {
    try_files $uri $uri/ @fallback;    # ← 兜底到一个 location，而不是一个文件
}

location @fallback {
    # 可以在这儿干更复杂的事，比如反代给别人
    proxy_pass http://some_backend;
}
```

| | `/index.html`（本项目） | `@fallback` |
|---|---|---|
| 兜底目标 | 一个**文件** | 一个**location**，里面能写任意逻辑 |
| 状态码 | 200（发的是 index.html） | 取决于那个 location 干了什么 |
| 适用 | SPA 回退（够用了） | 需要在兜底时做复杂处理（反代、鉴权、改写） |

本项目用文件兜底就够了——SPA 回退不需要任何逻辑，就是"把入口文件发出去"。

### 5.6 一个真实的副作用：404 变成了 200

`try_files ... /index.html` 有个必须知道的代价：

**任何不存在的路径，现在都返回 200 + index.html，而不是 404。**

```
GET /this-page-does-not-exist   → 200 OK + index.html
GET /随便什么乱七八糟的路径      → 200 OK + index.html
```

这是 SPA 回退的**必然结果**——nginx 无法区分"这是一个前端路由"和"这是一个用户瞎打的路径"，因为**两者在服务端看起来一模一样**（都是 dist 里没有的文件）。

后果：

- **对用户**：无所谓。Vue Router 匹配不到这个路径，会渲染前端的 404 页面。用户体验正常。
- **对搜索引擎/爬虫**：**有影响**。它们看到 200 会以为这是个有效页面（这叫 "soft 404"）。对本项目无所谓——后台管理系统本来就不该被索引。
- **对监控**：**有影响**。如果靠"404 率"来监控坏链，这个指标在 SPA 上**永远是 0**，失去意义。

> 🔑 `try_files` 兜底到 index.html 是**用"分不清"换"能用"**：nginx 放弃了区分前端路由和无效路径的能力，换来了 SPA 刷新不 404。这笔交易对本项目稳赚——但要知道自己交易了什么。

---

## 六、`return`、`rewrite`、`try_files` 的分工

遗留配置 `deploy/config/nginx/nginx.conf:34-37` 的 `location /` 长这样，和线上那份完全不同：

```nginx
        location / {
            return 200 'RBAC Nginx is up\n';
            add_header Content-Type text/plain;
        }
```

正好用它来讲第三个指令。

### 6.1 `return`：直接短路

```nginx
return 200 'RBAC Nginx is up\n';
```

`return` 的语义是：**立即返回，不再往下执行任何东西**。不查磁盘、不反代、不走后面的指令。

常见形态：

```nginx
return 200 'text';              # 返回状态码 + 文本
return 404;                     # 只返回状态码
return 301 https://a.com$request_uri;   # 重定向（301 永久 / 302 临时）
```

这段遗留配置的意图很清楚：**它是个健康检查探针**。那个年代 `deploy/` 那份 nginx 只干反代（没有 `root`，不发静态文件），所以根路径没东西可发，就返回一句 "RBAC Nginx is up" 证明自己活着。

**一个隐藏的坑**：`add_header` 写在 `return` **后面**，看起来像是"永远执行不到"。但实际上它**生效**——因为 `add_header` 不是"执行到这一行才加"的顺序型指令，它是**声明型**的：nginx 在生成响应时统一处理这个 location 里所有的 `add_header`，和它写在哪一行无关。

（这正是 nginx 配置的一个特点：**它不是脚本，是声明**。大部分指令不按书写顺序执行。这也是为什么"location 写在前面就先匹配"这种直觉是错的。）

### 6.2 三者对比

| | `try_files` | `return` | `rewrite` |
|---|---|---|---|
| 干什么 | **查磁盘**，找到哪个用哪个 | **立即返回**，不查任何东西 | **改写 URI**，然后继续处理 |
| 会查磁盘吗 | ✅ 会（这是它的全部工作） | ❌ 不会 | ❌ 不会（只改字符串） |
| 之后还执行吗 | 找到就结束 | **立即结束** | **可能重新匹配 location**（见下） |
| 本项目用了吗 | ✅ 线上那份 | ✅ 遗留那份 | ❌ 都没用 |

### 6.3 `rewrite` 补课（项目没用，但迟早撞上）

`rewrite` 是 nginx 里最强大也最容易失控的指令。语法：

```nginx
rewrite 正则 替换 [flag];
```

例子：

```nginx
rewrite ^/old/(.*)$ /new/$1 last;
#       ↑ 匹配这个   ↑ 改成这个  ↑ 改完怎么办
```

**四个 flag 是关键**，它们决定改写之后发生什么：

| flag | 行为 | 浏览器地址栏 |
|---|---|---|
| `last` | 改写 URI，**重新走一遍 location 匹配** | 不变 |
| `break` | 改写 URI，**停在当前 location 里继续** | 不变 |
| `redirect` | 返回 **302** 临时重定向，让浏览器重新请求 | **变** |
| `permanent` | 返回 **301** 永久重定向 | **变** |

前两个是**内部**改写（浏览器不知情），后两个是**外部**重定向（浏览器要再发一次请求）。

**`last` 和 `break` 的差异**是经典考点：

```nginx
location /a/ {
    rewrite ^/a/(.*)$ /b/$1 last;    # ← 改完【重新匹配 location】→ 会进 location /b/
}
location /b/ {
    root /var/www;
}
```

换成 `break` 就完全不同：改写后**不重新匹配**，继续留在 `location /a/` 里执行剩下的指令。

**`rewrite` 的循环陷阱**（这是它最出名的坑）：

```nginx
location / {
    rewrite ^/(.*)$ /index.php?$1 last;   # 改写后重新匹配
    #  → 新 URI /index.php?... 还是以 / 开头
    #  → 又进 location /
    #  → 又被 rewrite 改写
    #  → 又重新匹配... 死循环
}
# nginx 检测到 10 次循环后强制返回 500，并在 error.log 里写
# "rewrite or internal redirection cycle"
```

nginx 有个硬保护：**内部重定向超过 10 次就返回 500**。看到 error.log 里出现 `rewrite or internal redirection cycle`，就是撞上这个了。

> 🔑 **能用 `try_files` 就别用 `rewrite`。** `try_files` 的语义是封闭的（查几个路径，用一个），不会循环、不会失控；`rewrite` 是图灵完备方向的东西，能写出让自己都看不懂的配置。本项目一个 `rewrite` 都没有，这**不是缺陷，是克制**——SPA 回退用 `try_files` 表达得又准又安全，没有任何理由动用 rewrite。

---

## 动手练习

> 全部是思考题，对着仓库真实文件推。

### 练习 1：调换顺序

有人觉得 `location /` 应该写在最前面（"兜底的放前面更清晰"），于是把 `frontend/nginx.conf` 改成：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
location /api/ {
    proxy_pass http://rbac_backend;
    ...
}
```

请问：`/api/users` 这个请求现在会进哪个 location？站点会坏吗？为什么？

### 练习 2：正则截胡

假设有人给本项目加了这么一条（想给所有 JS/CSS 加缓存头）：

```nginx
location ~* \.(js|css)$ {
    expires 1y;
}
```

加在现有两个 location **之后**。请推演这三个请求分别进哪个 location：

- A. `/assets/index-a1b2.js`
- B. `/api/users`
- C. `/api/export/report.css`（假设后端真有这么个接口）

其中哪个是事故？怎么修？

### 练习 3：证明顺序无关

请设计一个**思想实验**：只看 `frontend/nginx.conf`，如何证明"location 前缀匹配和书写顺序无关"这个结论？（提示：你不需要跑任何命令，只需要找到一个逻辑上的反证。）

### 练习 4：try_files 的三种结局

请求 `/vite.svg`（这个文件真实存在于 dist 里）。请写出 `try_files $uri $uri/ /index.html` 的执行过程，说明它在第几步结束、发了什么。

然后回答：如果 dist 里**同时**存在 `vite.svg` 文件和 `vite.svg/` 目录（假设），会发什么？

### 练习 5：500 还是 404

有人构建镜像时手滑，`frontend/Dockerfile` 里的 `COPY --from=build /app/dist /usr/share/nginx/html` 那行被删了。镜像构建**成功**（不报错），容器也**正常启动**。

请推演用户访问 `https://www.eureka32.top` 会看到什么？状态码是多少？为什么？（提示：想清楚 `/usr/share/nginx/html` 这个目录里现在有什么。这题有个反直觉的转折。）

### 练习 6：给 `/assets/` 加缓存

按 `02 §7.3` 的建议，要给本项目加：

```nginx
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

请回答：

- A. 它和 `location /` 会不会冲突？谁赢？为什么？
- B. 加了它之后，`/assets/**` 还走 `try_files` 吗？这是好事还是坏事？
- C. 需要给它加 `^~` 吗？
- D. 这个 location 里需要写 `root` 吗？

---

## 自检问题

1. `server_name _` 里的下划线是通配符吗？它凭什么能接收到请求？
2. 一台 nginx 上有三个 server 都监听 80，请求进来时靠什么决定归谁管？
3. location 的前缀匹配，比的是"谁写在前面"还是"谁更长"？
4. location 的正则匹配呢？
5. 正则匹配和普通前缀匹配，谁的优先级高？`^~` 是干什么用的？
6. `location = /` 和 `location /` 有什么区别？
7. 本项目 `/api/users` 为什么进 `location /api/`？请给出严格的推导。
8. `try_files $uri $uri/ /index.html` 的最后一个参数，是"再尝试一次"还是"直接用"？如果它也不存在，返回几？
9. 为什么 SPA 不配 `try_files` 就会"点链接正常、按 F5 就 404"？
10. `try_files` 兜底到 index.html 之后，一个不存在的路径返回的状态码是什么？这有什么副作用？
11. `rewrite` 的 `last` 和 `break` 有什么区别？
12. 为什么说本项目"一个 rewrite 都没有"是优点而不是缺陷？

---

## 承上启下

本节把 nginx 的**第一副面孔**（静态文件服务器）彻底讲完了：从 server 选择到 location 匹配，再到 `try_files` 怎么让 SPA 活下来。到这里，`frontend/nginx.conf` 里**发静态文件**那条链路，你应该每一行都能讲清为什么。

下一节进第二副面孔——**反向代理**，也就是这 8 行：

```nginx
    upstream rbac_backend {
        server backend:8080;
    }
    ...
        location /api/ {
            proxy_pass http://rbac_backend;      # ← 这里【没有】尾斜杠。加一个会怎样？
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;   # ← 这行在本项目里【是错的】
        }
```

两个悬念，一个比一个重：

- 第一个是 nginx 的**头号事故来源**——`proxy_pass` 那个尾斜杠，加不加是两种完全不同的行为，而且**语法都合法，`nginx -t` 都过**。
- 第二个是本项目一个**真实存在、已被记录在案、目前恰好没爆**的问题（`docs/ops/02-域名与HTTPS配置.md:97` 写着呢）。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

### 自检问题

<details>
<summary><b>1. <code>server_name _</code> 里的下划线是通配符吗？</b></summary>

**不是。** `_` 只是一个**无效的域名**——它不可能出现在任何真实的 `Host` 头里。所以 `server_name _;` 的字面含义是"**我永远不会通过 server_name 匹配上任何请求**"。

它能收到请求靠的是**兜底规则**：所有 server 的 `server_name` 都没匹配上时，请求交给该端口的 `default_server`；而**没有任何 server 显式声明 `default_server` 时，该端口上第一个出现的 server 自动当选**。

本项目 80 端口上只有一个 server → 它自动是 default_server → 所有请求都兜底给它。**绕一圈回到自己。**

所以 `server_name _;` 是一种**惯用写法**，表达"我不挑域名，我就是兜底的那个"。在单 server 场景下，写 `localhost`、写 `_`、或者干脆不写，**效果完全一样**。
</details>

<details>
<summary><b>2. 三个 server 都监听 80，请求进来靠什么决定归谁管？</b></summary>

靠 HTTP 请求头里的 **`Host`**，拿它和各 server 的 `server_name` 比对。优先级：

1. **精确匹配** `www.a.com`
2. **前导通配** `*.a.com`
3. **尾部通配** `www.*`
4. **正则** `~^www\d+\.a\.com$`（**按书写顺序**取第一个命中）
5. **default_server** 兜底

前三级是**类型优先**，和写在第几行无关。只有第 4 级（正则）看书写顺序。
</details>

<details>
<summary><b>3. location 的前缀匹配，比的是"谁写在前面"还是"谁更长"？</b></summary>

**比谁更长。和书写顺序完全无关。**

nginx 会把所有能匹配的前缀 location 都过一遍，记住**匹配长度最长**的那个。`location /api/`（长度 5）永远赢 `location /`（长度 1），不管谁写在前面。
</details>

<details>
<summary><b>4. location 的正则匹配呢？</b></summary>

**正则比的才是书写顺序**——按配置里的书写顺序逐个试，**第一个命中的就用**，后面的不再看。

这是 location 匹配里**唯一**看顺序的一类。所以多个正则 location 之间，顺序是有意义的，调换会改变行为。
</details>

<details>
<summary><b>5. 正则和普通前缀，谁优先级高？<code>^~</code> 是干什么的？</b></summary>

**正则的优先级高于普通前缀匹配。**

完整流程：① 精确匹配命中就结束 → ② 记住最长前缀（如果它带 `^~` 就立即结束）→ ③ 按顺序试正则，命中就用 → ④ 正则全没中，才回落到第 ② 步记的最长前缀。

所以一个普通前缀 location 即使匹配得最长，**也可能被某个正则 location 截胡**。

**`^~` 的唯一作用**就是：我赢了前缀匹配之后，**别再试正则了**，直接用我。它是防止正则截胡的解药。

排错口诀：**写了前缀 location 却发现请求跑别处去了 → 先找有没有正则 location。**
</details>

<details>
<summary><b>6. <code>location = /</code> 和 <code>location /</code> 有什么区别？</b></summary>

- `location = /`：**精确匹配**，**只**匹配 URI 恰好等于 `/` 的请求（也就是首页）。`/index.html`、`/system/user` 都**不**匹配。
- `location /`：**前缀匹配**，匹配**所有**以 `/` 开头的 URI，也就是**一切请求**（是最终的兜底）。

优先级上 `=` 是最高的，命中就立即结束。

实际用途：`location = /` 常用于给首页单独设策略，比如 `02 §7.3` 里给 `index.html` 配 `no-cache` 就该用 `location = /index.html`——用精确匹配才不会误伤别的路径。
</details>

<details>
<summary><b>7. 本项目 <code>/api/users</code> 为什么进 <code>location /api/</code>？</b></summary>

严格推导：

```
URI = /api/users

① 精确匹配？配置里没有 location = ... → 跳过
② 前缀匹配，找最长：
   - location /      匹配 ✔ 长度 1
   - location /api/  匹配 ✔ 长度 5
   → 最长 = location /api/ ← 记住
   → 带 ^~ 吗？没有 → 继续
③ 正则匹配？配置里【一个正则 location 都没有】→ 无事可做
   → 回落到 ② 记住的最长前缀 → 【location /api/】✔
```

**关键：赢在长度 5 > 1，不是因为它写在前面。** 把两个 location 调换顺序，结果完全一样（练习 1 就是问这个）。
</details>

<details>
<summary><b>8. <code>try_files</code> 的最后一个参数是"再尝试"还是"直接用"？它也不存在时返回几？</b></summary>

**是"直接用"，不是"尝试"。**

`try_files $uri $uri/ /index.html` 里，前两个是"尝试"（存在才用），**最后一个是无条件兜底**。

如果 `/index.html` 也不存在 → **返回 500**，不是 404。因为 nginx 认为"你指定了兜底，兜底都没有，这是**配置错误**，不是用户的问题"。

**排错价值**：SPA 站点返回 500 而不是 404 → 先怀疑 dist 压根没进镜像。（练习 5 会把这个推到底，但那题有个转折。）
</details>

<details>
<summary><b>9. 为什么 SPA 不配 <code>try_files</code> 就"点链接正常、按 F5 就 404"？</b></summary>

因为这两个动作，**一个不发请求，一个发**。

- **点链接**：Vue Router 用 `history.pushState()` 改地址栏，**完全不发 HTTP 请求**，页面由 JS 在本地渲染。服务器根本不知道发生了什么 → 当然正常。
- **按 F5 / 粘贴 URL / 分享链接**：浏览器**真的发起 `GET /system/user`**。而服务器的 dist 里只有 `index.html`、`vite.svg`、`assets/`——**没有 `system/user` 这个文件**（它是前端路由，只存在于 JS 里）→ 404。

`try_files` 的第三个参数就是解药：找不到文件时不 404，而是把 `index.html` 发过去 → 浏览器加载 JS → Vue Router 启动 → 读地址栏的 `/system/user` → 渲染对应组件。用户完全无感。

这是 history 模式 SPA 的**通用范式**，所有前端框架都一样（`docs/09:38` 也点过这个坑）。
</details>

<details>
<summary><b>10. 兜底到 index.html 后，不存在的路径返回什么状态码？有什么副作用？</b></summary>

返回 **200**（因为确实成功发出了 index.html），不是 404。

**这是必然的**：nginx **无法区分**"这是前端路由"和"这是用户瞎打的路径"——两者在服务端看起来一模一样，都是 dist 里没有的文件。

副作用三条：

- **对用户**：无影响。Vue Router 匹配不到会渲染前端 404 页，体验正常。
- **对搜索引擎**：有影响（"soft 404"——爬虫看到 200 以为是有效页面）。对本项目无所谓，后台管理系统不该被索引。
- **对监控**：**有影响**。靠"404 率"监控坏链的话，这个指标在 SPA 上**永远是 0**，彻底失去意义。

本质是**用"分不清"换"能用"**。这笔交易对本项目稳赚，但要知道自己交易了什么。
</details>

<details>
<summary><b>11. <code>rewrite</code> 的 <code>last</code> 和 <code>break</code> 有什么区别？</b></summary>

都是**内部**改写（浏览器地址栏不变，不重新发请求），区别在改写之后：

- **`last`**：改写 URI 后**重新走一遍 location 匹配** → 可能进入另一个 location。
- **`break`**：改写 URI 后**停止 rewrite，留在当前 location 里**继续执行剩下的指令。

对比另外两个 flag（它们是**外部**重定向，浏览器地址栏会变、要再发一次请求）：
- `redirect` → 302 临时
- `permanent` → 301 永久

**`last` 的经典坑**：改写后的 URI 如果还能匹配上同一个 location，就会**无限循环**。nginx 有硬保护——内部重定向超过 10 次返回 500，error.log 写 `rewrite or internal redirection cycle`。
</details>

<details>
<summary><b>12. 为什么说本项目"一个 rewrite 都没有"是优点？</b></summary>

因为**用 `try_files` 表达 SPA 回退，比用 `rewrite` 又准又安全**。

- `try_files` 的语义是**封闭**的：查几个指定路径，用一个。不会循环、不会失控、一眼看懂。
- `rewrite` 是往图灵完备方向走的东西：正则 + 四个 flag + 内部重定向，能写出连作者自己都推不清的配置，还有 10 次循环这个硬上限在等着。

本项目的需求（找不到就发 index.html）用 `try_files` 一行精确表达，动用 rewrite 只会引入风险而没有任何收益。

**这不是"没用上高级特性"，是克制**——能用简单封闭的工具解决，就不要请出一个能自己把自己绕死的工具。
</details>

### 练习 1（调换顺序）

<details>
<summary><b>点开看答案</b></summary>

**还是进 `location /api/`。站点完全不会坏。**

因为前缀匹配比的是**长度**，不是顺序：

```
② 前缀匹配，找最长：
   - location /      长度 1
   - location /api/  长度 5   ← 最长，赢
```

调换书写顺序对结果**没有任何影响**。

**这道题的价值**：它是"location 顺序无关"这条规则最直接的反证。很多人（包括很多博客）会说"要把更具体的 location 写在前面"——这个建议**对可读性有意义**（人读起来顺），**对 nginx 的行为毫无意义**。

**但要小心把这条结论泛化**：它只对**前缀匹配**成立。如果配置里有**正则** location，顺序就至关重要了（正则之间按书写顺序取第一个命中的）。本项目恰好没有正则，所以这里可以放心说"顺序无关"。
</details>

### 练习 2（正则截胡）

<details>
<summary><b>点开看答案</b></summary>

配置变成：

```nginx
location /api/ { proxy_pass ...; }            # 前缀，长度 5
location / { try_files ...; }                 # 前缀，长度 1
location ~* \.(js|css)$ { expires 1y; }       # 正则 ← 新加的
```

逐个推：

| | 请求 | 进哪个 | 推导 |
|---|---|---|---|
| **A** | `/assets/index-a1b2.js` | **正则** ✔ | ① 无精确<br>② 最长前缀 = `location /`（长度 1），不带 `^~` → 继续<br>③ 正则命中 `.js` → **正则赢**<br>→ 这正是想要的效果 ✔ |
| **B** | `/api/users` | **`/api/`** ✔ | ② 最长前缀 = `/api/`（5），不带 `^~` → 继续<br>③ 正则试 `\.(js\|css)$`：`/api/users` 不以 .js/.css 结尾 → **不命中**<br>→ 回落到最长前缀 `/api/` ✔ 正常反代 |
| **C** | `/api/export/report.css` | **正则** ✘ | ② 最长前缀 = `/api/`（5）<br>③ 正则命中 `.css` → **正则截胡了 `/api/`！**<br>→ 这个请求**不会被反代给 backend**！ |

**C 是事故。**

后果很具体：这个 API 请求本该转给 backend 生成报表，结果被正则 location 抓走了。而那个 location 里**只有 `expires 1y`，没有 `proxy_pass`** → nginx 会退回默认行为：**当静态文件处理**，去磁盘上找 `/usr/share/nginx/html/api/export/report.css` → **404**。

用户看到的现象是"导出 CSS 报表功能 404 了"，而**其他 API 全都正常**。排查时你会怀疑后端、怀疑路由、怀疑权限——很难想到是 nginx 里一个管缓存的 location 干的。

**怎么修**——两个方案：

**方案 A（推荐）：给 `/api/` 加 `^~`**

```nginx
location ^~ /api/ { proxy_pass ...; }    # ← 赢了前缀就结束，不给正则机会
```

语义最准："凡是 `/api/` 开头的，一律反代，谁也别来抢。"

**方案 B：把正则的范围收窄**

```nginx
location ~* ^/assets/.*\.(js|css)$ { expires 1y; }    # 限定只在 /assets/ 下
```

**方案 C（最好）：压根不用正则**

```nginx
location /assets/ { expires 1y; ... }    # 前缀长度 8，天然不会碰 /api/
```

这正是 `02 §7.3` 建议的写法——**用前缀 location 代替正则，从根上避免截胡**。

> 🔑 这道题是本节最有价值的一道。它展示了 nginx 事故的典型形态：**加一个看起来人畜无害的优化，悄悄改变了一个完全不相干的功能的行为**，而且症状离原因很远。
</details>

### 练习 3（证明顺序无关）

<details>
<summary><b>点开看答案</b></summary>

**反证法，而且证据就在配置里现成摆着。**

假设"location 按书写顺序匹配，先写的先赢"这个说法成立。那么本项目的配置：

```nginx
location /api/ { proxy_pass ...; }     # 写在前面
location / { try_files ...; }          # 写在后面
```

`/api/` 写在前面 → 按假设它先匹配 → **它匹配任何以 `/api/` 开头的请求，这没问题**。

但反过来看 `location /`：它写在**后面**。按"先写的先赢"，前面那个 `/api/` 已经把 `/api/**` 抢走了，剩下的请求（`/`、`/system/user`、`/assets/x.js`）都不以 `/api/` 开头，所以确实轮得到 `location /`。

**这样看起来假设也能自洽？** 所以还得再找一个更强的反证。

**真正的反证**：把两个 location 调换顺序。

```nginx
location / { try_files ...; }          # 现在写在前面
location /api/ { proxy_pass ...; }     # 现在写在后面
```

按"先写的先赢"的假设：`location /` 匹配**一切**请求（`/` 是所有 URI 的前缀）→ 它写在最前面 → **它会吞掉所有请求，包括 `/api/users`** → 所有 API 请求都会去磁盘上找文件 → 全站 API 崩溃。

**但现实是：这么改了站点照样好好的。** 所以"先写的先赢"这个假设**被证伪**。

**更强的一个反证**（不需要改配置）：如果真是"先写的先赢"，那么 `location /` 这个能匹配一切的兜底 location，**在任何配置里都只能写在最后一行**，否则它后面的 location 全都是死代码。但你在无数真实的 nginx 配置里能看到 `location /` 写在中间——它们都工作正常。**这个事实本身就否定了顺序假设。**

**结论**：前缀匹配的胜负**只取决于匹配长度**。书写顺序对前缀 location 毫无影响（对正则 location 则完全相反）。
</details>

### 练习 4（try_files 的三种结局）

<details>
<summary><b>点开看答案</b></summary>

**第一问**，请求 `/vite.svg`：

```
① $uri → root(/usr/share/nginx/html) + /vite.svg
        = /usr/share/nginx/html/vite.svg
        → 【存在！】✔
→ 第 ① 步就结束了，直接发这个文件
→ ② 和 ③ 【根本不会执行】
```

响应：`200 OK` + `Content-Type: image/svg+xml`（`02 §2.2` 那张 mime.types 表查出来的）+ 文件内容。

而且因为 `image/svg+xml` 在 `gzip_types` 里（`02 §6.4`），它会被 **gzip 压缩**，同时 **sendfile 用不上**（`02` 练习 2 的 B 项）。

**第二问**，如果同时存在 `vite.svg` 文件和 `vite.svg/` 目录：

**`$uri` 先被检查，文件赢。**

`try_files` 严格按参数顺序来：`$uri`（当文件找）排在 `$uri/`（当目录找）前面 → 找到文件就立即结束，`$uri/` 那一步压根不执行。

顺带说：这种情况在真实文件系统里**不可能发生**——同一目录下不能同时有同名的文件和目录。这道题的意义在于理解 `try_files` 的**严格顺序性**：它不是"哪个更合适用哪个"，就是**从左到右，第一个存在的就用**。
</details>

### 练习 5（500 还是 404）

<details>
<summary><b>点开看答案</b></summary>

**转折在这里：用户会看到 nginx 的默认欢迎页 "Welcome to nginx!"，状态码 200。**

推导（关键是想清楚 `/usr/share/nginx/html` 里现在有什么）：

```
删掉 COPY --from=build /app/dist /usr/share/nginx/html 之后：
→ 没有任何东西被 COPY 到那个目录
→ 但那个目录【不是空的】！

因为 FROM nginx:1.27 —— 官方镜像【自带】那个目录，里面预置了：
  /usr/share/nginx/html/index.html    ← "Welcome to nginx!" 页面
  /usr/share/nginx/html/50x.html      ← 错误页
```

于是访问 `/`：

```
location / → try_files $uri $uri/ /index.html
① $uri  → /usr/share/nginx/html/  → 这是目录，不是文件 → 不算命中
② $uri/ → /usr/share/nginx/html/  → 【是目录，存在】✔
        → 用 index 指令找里面的 index.html
        → 找到了！【官方那个欢迎页】
→ 200 OK + "Welcome to nginx!"
```

**所以是 200，不是 500，也不是 404。**

为什么"500"这个直觉是错的？因为 `§5.4` 那条规则（兜底文件不存在 → 500）**前提是 index.html 真的不存在**。而这里 index.html **存在**——只不过是官方镜像自带的那个，不是我们的 Vue 应用。

**这个故障的可怕之处**：

| 表现 | 实际 |
|---|---|
| 容器状态 | ✅ Up（healthy 也会过，如果配了健康检查） |
| HTTP 状态码 | ✅ 200 |
| nginx error.log | ✅ 干净，一条错误都没有 |
| 监控告警 | ✅ 全绿 |
| 用户看到的 | ❌ "Welcome to nginx!" |

**所有的机器指标都是健康的**，只有人眼能发现问题。这类故障叫"**成功地提供了错误的东西**"，比 500 难查得多——500 至少会告诉你出事了。

**顺带一个真实的连带**：`01 §4.4` 讲过 `COPY nginx.conf` 覆盖了官方默认配置，所以官方的 `conf.d/default.conf` 那个 server 不生效。**但官方的 html 目录还在**——覆盖配置和覆盖静态文件是两码事。这就是本题的机关所在。

**怎么防**：构建后验证产物，而不是只看容器起没起来。比如 `docker run --rm rbac-frontend ls /usr/share/nginx/html` 应该看到 `assets/`、`index.html`、`vite.svg`；如果看到 `50x.html` 就说明 dist 没进去。
</details>

### 练习 6（给 /assets/ 加缓存）

<details>
<summary><b>点开看答案</b></summary>

**A. 冲突吗？谁赢？**

**不冲突，`location /assets/` 赢。**

```
URI = /assets/index-a1b2.js
② 前缀匹配：
   - location /         长度 1
   - location /assets/  长度 8   ← 最长，赢 ✔
③ 无正则 location → 直接用它
```

**B. 还走 try_files 吗？是好是坏？**

**不走了。而且这是好事。**

`location /assets/` 里没有 `try_files`，所以走 nginx 的默认行为：直接按 `root` + URI 找文件，找不到就 **404**。

为什么是好事？因为**静态资源找不到就该 404**。设想走 `try_files` 会怎样：

```
GET /assets/index-typo.js   （某个不存在的 JS）
→ try_files 找不到 → 兜底发 index.html
→ 200 OK + Content-Type: text/html
→ 浏览器：我要的是 JS，你给我一坨 HTML？
→ 控制台报 "Uncaught SyntaxError: Unexpected token '<'"
```

那个 `Unexpected token '<'` 是前端最著名的迷惑报错之一——**报错内容和真实原因（文件不存在）毫无关系**，因为浏览器在拿 JS 解析器去解析 `<!DOCTYPE html>`。查这个能查半天。

**直接 404 反而清清楚楚。** 所以让 `/assets/` 脱离 `try_files` 的兜底，是这个改动的**附带收益**，不是代价。

**C. 需要 `^~` 吗？**

**当前不需要，但加上更稳。**

不需要：因为配置里**一个正则 location 都没有**，第 ③ 步无事可做，最长前缀不可能被抢。

但加上更稳：`^~` 是一道**保险**。哪天有人手贱加了个 `location ~* \.(js|css)$`（正如练习 2 演示的），`/assets/` 就会被截胡，缓存策略静默失效——而这种失效**没有任何报错**，你只会发现"缓存怎么不生效"，然后查很久。

`^~ /assets/` 等于提前声明"这块地我包了"。**代价是两个字符，收益是挡住一整类未来的事故。**

**D. 需要写 `root` 吗？**

**不需要。** `root /usr/share/nginx/html` 写在 **server 层**（第 28 行），`location /assets/` 会自动**继承**（`01 §4.3` 的机制）。

写了也不错（只是重复），但**不写更好**——万一以后要改站点根目录，只需改 server 层那一处，不用满配置找。这正是把 `root` 写在 server 层而非各个 location 里的价值。

**综合，最终建议的写法**：

```nginx
# 带内容哈希的静态资源：内容变则文件名变，可以永久缓存
# ⚠️ 此配置依赖 Vite 的内容哈希文件名，改 Vite 打包策略前先回来看这里
location ^~ /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

（注释里必须写清依赖前提——这是 `02` 练习 6 的教训。）
</details>
