# 02 · http 块与静态文件服务

> 目标：读完 `http {}` 块开头那 9 行，搞清 nginx 作为"静态文件服务器"这副面孔的全部工作机制。
>
> 读完你能：
> - 说清 `include mime.types` 到底影响什么，以及配错 MIME 会让浏览器干出什么蠢事。
> - 解释 `sendfile on` 省掉了哪几次数据拷贝。
> - 说出 `root` 和 `alias` 的区别，并知道为什么这个区别每年都在坑人。
> - 回答"为什么 `gzip_types` 里没有 `text/html`"——以及为什么写了反而是错的。
> - 指出本项目**没配但该配**的一个静态资源优化，并说清为什么它对 Vite 打包的产物特别安全。

---

## 一、承上：这 9 行都是"发文件"的配置

`01` 读完了最外层 8 行，建立了五层上下文的骨架。现在进 `http {}`，这是第 10-18 行：

```nginx
http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;

    gzip on;
    gzip_min_length 1k;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;
```

这 7 条指令有一个共同点：**它们全都写在 `http` 层，所以底下每个 server、每个 location 都继承得到**（`01 §4.3` 讲的机制）。

还有一个共同点更重要：**它们几乎全是在服务"发静态文件"这件事**。`00` 说过 nginx 有两副面孔，这一节读的就是第一副面孔的全部装备。

---

## 二、MIME 类型：`include mime.types` + `default_type`

```nginx
include       /etc/nginx/mime.types;
default_type  application/octet-stream;
```

### 2.1 MIME 是什么，为什么非有不可

服务器发回一个文件时，光有内容不够，还得告诉浏览器**这是什么东西**。这个"是什么"通过响应头 `Content-Type` 传达，值就是 **MIME 类型**：

```http
HTTP/1.1 200 OK
Content-Type: text/css          ← 这一行就是 MIME 类型
Content-Length: 12345

body { margin: 0; ... }
```

浏览器**完全靠这个头**来决定怎么处理收到的字节：

| Content-Type | 浏览器的反应 |
|---|---|
| `text/html` | 当 HTML 解析，渲染成页面 |
| `text/css` | 当样式表，应用到页面上 |
| `application/javascript` | 当脚本，**执行它** |
| `image/png` | 当图片，解码显示 |
| `application/octet-stream` | 不认识 → **触发下载** |

**关键**：浏览器**不看文件扩展名**。URL 里写着 `.css` 但服务器说 `Content-Type: text/plain`？浏览器就当纯文本，样式一点都不生效。

> 🔑 决定浏览器怎么解释响应体的，**只有 `Content-Type` 响应头**，不是 URL 后缀，不是文件内容。nginx 的职责就是给每个文件贴上正确的标签。

### 2.2 `mime.types` 就是那张对照表

nginx 靠一张"扩展名 → MIME 类型"的表来贴标签。这张表就在 `/etc/nginx/mime.types`（官方镜像自带），内容长这样：

```nginx
types {
    text/html                             html htm shtml;
    text/css                              css;
    application/javascript                js;
    image/png                             png;
    image/svg+xml                         svg svgz;
    application/json                      json;
    ...约 90 行
}
```

nginx 发文件时，拿文件扩展名去这张表里查，查到什么就写进 `Content-Type`。

`01 §4.4` 讲过 `include` 就是"原地展开这个文件"。这张表 90 行，没人愿意抄进自己的配置，所以官方拆出来让你 `include`。

### 2.3 `default_type`：查不到怎么办

```nginx
default_type  application/octet-stream;
```

如果扩展名不在表里（比如 `.xyz`，或者干脆没有扩展名），就用这个兜底值。

`application/octet-stream` 的意思是"**一串不知道是什么的二进制字节**"。浏览器收到它的反应是：不敢解释，**直接触发下载**。

这是一个**故意选的保守值**，安全上很重要：如果兜底值设成 `text/html`，那么任何一个 nginx 不认识扩展名的文件，浏览器都会当 HTML 解析。假设某个功能允许用户上传文件，攻击者传一个 `evil.xyz`，里面塞满 `<script>`——nginx 查不到 `.xyz`，兜底成 `text/html`，浏览器**执行了里面的脚本**，XSS 直接成立。

用 `application/octet-stream` 兜底，最坏情况只是"浏览器下载了一个文件"，脚本不会执行。

> 🔑 `default_type application/octet-stream` 是一条**安全默认值**：不认识的东西宁可让它下载，也绝不猜成可执行的类型。这是"不确定时选最保守的那个"这一安全原则的教科书案例。

### 2.4 对本项目意味着什么

Vue 打包出来的 `dist/` 里全是标准扩展名：

| 文件 | 扩展名 | 查表得到 | 结果 |
|---|---|---|---|
| `index.html` | `.html` | `text/html` | 渲染成页面 ✔ |
| `assets/index-a1b2.js` | `.js` | `application/javascript` | 执行 ✔ |
| `assets/index-c3d4.css` | `.css` | `text/css` | 应用样式 ✔ |
| `vite.svg` | `.svg` | `image/svg+xml` | 显示图标 ✔ |

**全部命中，`default_type` 一次都用不上。** 这就是为什么本项目这两行可以照抄官方模板不动脑子——Vite 的产物都是最主流的类型。

但反过来说：**如果哪天 `include mime.types` 这行被误删**，所有文件都会掉进 `default_type` 的兜底，`Content-Type` 全变成 `application/octet-stream`。后果是：浏览器把 `index.html` **下载**下来而不是渲染，整站直接变成一个下载器。这个故障现象很唬人，但原因就一行配置。

---

## 三、`sendfile on`：省掉两次拷贝

```nginx
sendfile        on;
```

### 3.1 不开 sendfile 时，数据走了多远

nginx 要把磁盘上的 `index-a1b2.js` 发给浏览器。传统做法（`read()` + `write()`）是这样的：

```
磁盘
 │ ① DMA 拷贝
 ▼
内核缓冲区 (page cache)
 │ ② CPU 拷贝  ← 内核态 → 用户态
 ▼
nginx 进程的用户态缓冲区        ← 数据在这儿转了一圈，nginx 其实【什么都没对它做】
 │ ③ CPU 拷贝  ← 用户态 → 内核态
 ▼
socket 缓冲区
 │ ④ DMA 拷贝
 ▼
网卡 → 浏览器
```

**四次拷贝，两次用户态/内核态上下文切换。**

荒谬的地方在第 ② 和 ③ 步：数据被搬进 nginx 的内存，nginx **一个字节都没改**，又原封不动搬回内核。纯粹是白跑一趟。

### 3.2 开了 sendfile 之后

`sendfile` 是 Linux 的一个系统调用，它让内核**直接把文件从 page cache 送到 socket**，不经过用户态：

```
磁盘
 │ ① DMA 拷贝
 ▼
内核缓冲区 (page cache)
 │ ② 直接送（现代内核配合网卡 SG-DMA，甚至只传描述符，连这次拷贝都省了）
 ▼
socket 缓冲区 → 网卡 → 浏览器

nginx 进程全程没碰数据，只是发了个"把这个文件的这段发出去"的指令
```

**两次拷贝，零次用户态往返。** 这就是俗称的**零拷贝（zero-copy）**。

| | `sendfile off` | `sendfile on` |
|---|---|---|
| 数据拷贝次数 | 4 | 2（或更少） |
| 用户态/内核态切换 | 2 次往返 | 0 |
| nginx 内存占用 | 要为每个连接留缓冲区 | 几乎不占 |
| 大文件性能 | 差 | 显著更好 |

### 3.3 边界：什么时候 sendfile 用不上

这是关键的使用边界，**很多人不知道**：

**sendfile 的前提是"数据原样发出，不经过用户态"。所以一旦 nginx 需要修改内容，sendfile 就自动失效。**

哪些情况会修改内容？

- **gzip 压缩**——要压缩就得把数据读进来算一遍，必然经过用户态。
- SSI（服务端包含）、`sub_filter` 这类内容替换模块。
- **反向代理**——响应根本不来自本地磁盘，而是来自 upstream，压根没有"文件"可 sendfile。

这就意味着本项目一个有意思的事实：

> 🔑 本项目同时开了 `sendfile on` 和 `gzip on`，而这两个**在同一个响应上是互斥的**。`.js`/`.css` 走 gzip（在 `gzip_types` 里）→ 用不上 sendfile；图片、字体这类不在 `gzip_types` 里的 → 走 sendfile。**两条指令各自服务不同的文件类型，不冲突，但也不叠加。**

而 `location /api/` 那条链路，`sendfile` 和 `gzip`（对上游响应）都基本用不上——那是反向代理，是 `04` 的地盘。

---

## 四、`keepalive_timeout 65`：连接复用

```nginx
keepalive_timeout  65;
```

### 4.1 为什么要复用连接

HTTP 跑在 TCP 上，而建立一条 TCP 连接要**三次握手**（一个 RTT）。如果用了 HTTPS，还要再加 TLS 握手（1-2 个 RTT）。

打开一个 Vue 页面要加载多少资源？`index.html` + 几个 JS chunk + CSS + 字体 + 图标，轻松十几个请求。如果每个请求都重新握手：

```
不复用：  握手 → 请求1 → 关闭 → 握手 → 请求2 → 关闭 → 握手 → 请求3 ...
          ↑ 每次都白花一个 RTT

复用：    握手 → 请求1 → 请求2 → 请求3 → ... → （65 秒没动静）→ 关闭
          ↑ 只握一次手
```

`keepalive_timeout 65` 的意思是：**一个请求处理完后，这条 TCP 连接保持打开 65 秒，等待这个客户端的下一个请求；65 秒内没有新请求才关闭**。

### 4.2 65 这个数字

这是 nginx 的传统默认值（官方默认配置就写 65）。它是个权衡：

- **太短**（比如 5 秒）：用户看完首页停顿一下再点下一页，连接已经关了，又得重新握手。复用的收益打折。
- **太长**（比如 300 秒）：连接白白占着不放。而 `01 §3.1` 讲过，**每个空闲连接都算在 `worker_connections` 的账上**。真到高并发时，大量僵尸连接会把连接数吃光。

65 秒对"用户在页面上操作一会儿再点下一个"的交互节奏是够的，同时又不至于囤积太多空闲连接。

**对本项目**：后台管理系统的典型用法是管理员打开页面、点几下、翻几页，操作间隔通常在几秒到几十秒。65 秒能覆盖住绝大多数连续操作，是个合理值。而且 `01 §3.2` 说过，本项目的并发量离 `worker_connections` 上限差两个数量级，**空闲连接囤积对本项目根本不构成压力**——所以这个值怎么调都无所谓，保持默认最省事。

### 4.3 一个必须知道的边界

本项目的 nginx **前面站着 caddy**（`00 §3.1` 的链路图）。所以 nginx 的 `keepalive_timeout` 管的是**"caddy ↔ nginx"这一段连接**，不是"浏览器 ↔ nginx"。

```
浏览器 ──①──► caddy ──②──► nginx ──③──► backend
         ↑              ↑              ↑
    caddy 管这段    nginx 的           这段是【另一回事】
                keepalive_timeout      （见 04）
                  管这段
```

浏览器那一侧的连接复用行为，是 **caddy** 说了算的，nginx 的这行配置对它毫无影响。

而第 ③ 段——nginx 到 backend 的连接——**本项目压根没配 keepalive**，所以每次反代都是新建连接、用完就关。这是本项目一个真实的、可以优化的点，`04` 会展开。

---

## 五、`root` 和 `index`：文件到底从哪儿找

这两行在 `server` 层（第 28-29 行），但它服务的是同一副面孔，放这一节讲。

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;      # ← 站点根目录
    index index.html;                # ← 目录的默认文件
```

### 5.1 `root`：路径怎么拼

规则**一句话**：

```
磁盘路径 = root 的值 + URI（完整的，一个字符都不删）
```

举例（本项目 `root /usr/share/nginx/html`）：

| 请求 URI | 拼出来的磁盘路径 |
|---|---|
| `/index.html` | `/usr/share/nginx/html/index.html` |
| `/assets/index-a1b2.js` | `/usr/share/nginx/html/assets/index-a1b2.js` |
| `/favicon.ico` | `/usr/share/nginx/html/favicon.ico` |

而 `/usr/share/nginx/html` 这个目录，正是 `frontend/Dockerfile:19` 把 dist 塞进去的地方：

```dockerfile
COPY --from=build /app/dist /usr/share/nginx/html
```

**闭环了**：Vite 打包出 `dist/` → Dockerfile 把它 COPY 到 `/usr/share/nginx/html` → nginx 的 `root` 指向这里 → 请求 `/assets/xxx.js` 就能找到 `dist/assets/xxx.js`。

顺带说：`/usr/share/nginx/html` 不是随便选的，它是 **nginx 官方镜像的约定路径**（官方默认配置里的 `root` 就是它，那个"Welcome to nginx!"页面也放这儿）。用它的好处是——万一哪天 `COPY nginx.conf` 那行没了、退回官方默认配置，站点**居然还能发出来**，因为默认配置的 `root` 也指这儿。

### 5.2 `index`：请求目录时发什么

```nginx
index index.html;
```

当 URI 以 `/` 结尾（指向一个目录）时，nginx 会在那个目录里找 `index` 指定的文件。

请求 `/` → 拼出 `/usr/share/nginx/html/` → 是个目录 → 找 `index.html` → 找到 → 发 `/usr/share/nginx/html/index.html`。

`index` 可以写多个，按顺序找第一个存在的：`index index.html index.htm;`。本项目只有一个 `index.html`（SPA 只有一个入口），写一个就够。

**如果 `index` 指定的文件都不存在会怎样？** 默认返回 **403 Forbidden**（不是 404）——因为 nginx 拒绝列出目录内容。想列目录得显式开 `autoindex on`，而那**几乎永远不该在生产开**（等于把整个目录结构公开）。

### 5.3 `root` vs `alias`：每年都在坑人的那个区别

本项目**没用 `alias`**。但这是 nginx 最经典的坑之一，也是高频面试题，必须讲。

两者都是"把 URI 映射到磁盘路径"，区别只有一个字：

```
root  的路径 = root 值  +  【完整 URI】       ← 追加
alias 的路径 = alias 值 +  【URI 去掉 location 前缀后的剩余部分】  ← 替换
```

**对比实验**。同样请求 `/static/app.js`：

```nginx
# 用 root
location /static/ {
    root /var/www;
}
# → 磁盘路径 = /var/www  +  /static/app.js  =  /var/www/static/app.js
#                              ↑ 完整 URI，/static/ 还在

# 用 alias
location /static/ {
    alias /var/www/;
}
# → 磁盘路径 = /var/www/  +  app.js  =  /var/www/app.js
#                              ↑ /static/ 这个前缀【被吃掉了】
```

**同一个 URI，两个完全不同的磁盘路径。**

| | `root` | `alias` |
|---|---|---|
| 语义 | 追加：root + 完整 URI | 替换：alias + 剩余 URI |
| location 前缀 | **保留**在磁盘路径里 | **被吃掉** |
| 能写在哪 | `http` / `server` / `location` | **只能写在 `location` 里** |
| 尾斜杠 | 不敏感 | **极其敏感**（见下） |

**`alias` 的尾斜杠陷阱**（真正的杀手）：

```nginx
location /static/ {
    alias /var/www;        # ← 少了尾斜杠！
}
# 请求 /static/app.js
# → /var/www + app.js = /var/wwwapp.js     ← 字符串直接粘在一起了！
```

路径拼成了 `/var/wwwapp.js` 这种鬼东西。**nginx 不会报错，`nginx -t` 也过**——它只是安静地 404，然后你查一晚上。

> 🔑 **`alias` 的规矩：location 和 alias 的尾斜杠必须同时有或同时没有。** 更稳的建议是——**能用 `root` 就别用 `alias`**。`root` 的语义是纯追加，不存在这个陷阱。只有当"URL 路径"和"磁盘目录结构"确实对不上时（比如 URL 是 `/static/` 但文件在 `/var/www/dist/`），才需要 `alias`。

**本项目为什么用 `root` 就够**：URL 结构和 dist 目录结构**完全一致**（请求 `/assets/x.js` ↔ 文件 `dist/assets/x.js`），不需要做任何路径改写。所以一个 `root` 写在 server 层，两个 location 都继承，干净利落。

---

## 六、gzip 全家桶

```nginx
gzip on;
gzip_min_length 1k;
gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;
```

### 6.1 压缩是怎么协商的

gzip 不是服务器想压就压，是**双方协商**的结果：

```http
① 浏览器请求时声明自己能解压什么：
   GET /assets/index-a1b2.js
   Accept-Encoding: gzip, deflate, br

② nginx 判断：客户端支持 gzip ✔ + 这个类型在 gzip_types 里 ✔ + 大小超过 1k ✔
   → 压缩，并在响应里声明：

   HTTP/1.1 200 OK
   Content-Type: application/javascript
   Content-Encoding: gzip          ← "我压过了，你解一下"
   Vary: Accept-Encoding

③ 浏览器解压 → 拿到原始 JS
```

任何一个条件不满足，nginx 就发原文。

### 6.2 `gzip on`：开关

默认是 `off`。开了之后 nginx 才会尝试压缩。

收益有多大？对文本类资源**非常大**。JS/CSS/JSON 里充满了重复的关键字、空格、变量名，gzip 通常能压到 **原大小的 20%-30%**。一个 500KB 的 Vue bundle 压完大概 150KB——用户少下 350KB，首屏快一大截。

代价是 **CPU**：压缩要算。但对本项目来说这笔账毫无悬念——`01 §3.2` 说过 nginx 这层离饱和差得远，CPU 有的是富余，拿来换带宽和首屏时间，稳赚。

### 6.3 `gzip_min_length 1k`：小文件不压

```nginx
gzip_min_length 1k;
```

**只压超过 1KB 的响应。** 小于这个值的原样发。

为什么？因为 **gzip 有固定开销**：gzip 格式本身有十几字节的头尾，加上压缩算法对短内容几乎找不到重复模式。结果是——**压一个 200 字节的文件，很可能压完比原来还大**，同时还白烧了 CPU。

1KB 是个经验阈值，差不多是"压缩开始稳定产生正收益"的临界点。

**注意一个边界**：这个判断依据是响应头里的 `Content-Length`。如果响应是**分块传输**（`Transfer-Encoding: chunked`，没有 `Content-Length`），nginx 事先不知道多大，`gzip_min_length` 就**失效了，一律压**。反代场景下上游经常用 chunked，所以这条对 `/api/` 那侧基本管不住。

### 6.4 `gzip_types`：压哪些类型

```nginx
gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;
```

按 **MIME 类型**（第二节讲的那个 `Content-Type`）来决定压不压。逐个看本项目为什么选这六个：

| MIME 类型 | 对应本项目的什么 | 为什么值得压 |
|---|---|---|
| `text/plain` | 零星的文本 | 纯文本，压缩比高 |
| `text/css` | `assets/index-xxx.css` | **样式表，几十到几百 KB，压缩比极高** |
| `application/json` | `/api/**` 的响应 | **接口返回的 JSON，字段名重复度极高，压缩比惊人** |
| `application/javascript` | `assets/index-xxx.js` | **Vue bundle，最大的一块，压缩收益最大** |
| `application/xml` | 基本没有 | 顺手加的，无害 |
| `image/svg+xml` | `vite.svg` 等图标 | **SVG 本质是 XML 文本，能压**（这是唯一一个"图片但要压"的） |

**注意 `image/svg+xml` 这个选择很讲究**：其他图片格式（PNG/JPG/WebP）**绝对不能压**——它们本身就是压缩格式，再 gzip 一遍不但压不动，还纯烧 CPU，有时体积反而涨。但 SVG 是个异类，它是**文本**，压缩比能到 70% 以上。所以这个列表里"只有 SVG 一种图片"，是精准的，不是随便写的。

### 6.5 为什么没有 `text/html`（本节高潮）

盯着那一长串看，你会发现一个"漏洞"：**`text/html` 不在里面**。而 `index.html` 明明是最先加载的文件。

这是漏了吗？**不是。写了才是多余的。**

nginx 官方文档对 `gzip_types` 的说明里有一句：

> `text/html` is always compressed.

**`text/html` 永远被压缩，无法通过 `gzip_types` 排除，也不需要在里面声明。**

原因是设计上的：`gzip_types` 的默认值就是 `text/html`，而且这个类型是**硬编码**进去的——只要 `gzip on`，HTML 就一定在压缩范围内。你在 `gzip_types` 里写 `text/html` 不会报错，但完全是重复劳动。

> 🔑 **`gzip_types` 是在默认的 `text/html` 基础上做「追加」，不是「替换」。** 所以写了 `text/html` 纯属多余，不写也照压。看到这个列表里没有 HTML **不要以为是配置漏了**——这恰恰说明写这份配置的人知道自己在干什么。

（顺带：这是 nginx 的高频面试题。会答"不用写，HTML 永远压"，比会背那一长串类型有用得多。）

### 6.6 本项目没配、但值得知道的两个

**`gzip_comp_level`（压缩等级 1-9，默认 1）**

数字越大压得越狠、也越费 CPU。但收益是**严重递减**的：

```
level 1  →  压到 ~30%，CPU 开销基准
level 6  →  压到 ~26%，CPU 约 3 倍       ← 通常认为的甜点
level 9  →  压到 ~25.5%，CPU 约 6 倍     ← 多花 3 倍 CPU 换 0.5%，不划算
```

本项目没写，用默认的 `1`。**这其实是个可以改进的点**：调到 `4`-`6` 能再省 10%-15% 带宽，而本项目 CPU 富余得很。不过收益也就那样，属于"闲着可以调"的级别。

**`gzip_vary on`（本项目没配，但这条值得说）**

它的作用是在压缩响应里加一个头：

```http
Vary: Accept-Encoding
```

意思是"**这个响应的内容取决于请求的 `Accept-Encoding` 头，缓存的时候请按这个头分开存**"。

不加会怎样？想象链路上有个 CDN 或缓存代理：

```
① 支持 gzip 的浏览器请求 /app.js → 缓存里没有 → 回源 → nginx 返回【压缩版】
   → 缓存存下来（没有 Vary，它以为这就是 /app.js 的唯一版本）
② 一个不支持 gzip 的老客户端请求 /app.js → 缓存命中！→ 把【压缩版】发给它
   → 那个客户端不会解压 → 拿到一堆乱码 ✘
```

这叫**缓存污染**。`Vary: Accept-Encoding` 就是让缓存按"要不要压缩"分成两份存，各给各的。

**本项目现在有没有问题？** 目前**没有**。因为链路上（浏览器 → caddy → nginx）**没有共享缓存**，caddy 默认也不缓存。浏览器自己的私有缓存是按请求存的，不存在"发给别人"的问题。

但这是个**脆弱的安全区**：哪天在前面加了 CDN（这对静态资源是很自然的下一步优化），这个坑立刻就成立了。所以 `gzip_vary on` 属于"**一行代价、防患未然**"的配置，值得加。

---

## 七、本项目没配、但真该配的：静态资源缓存

这是本节最有实操价值的一段。`docs/09-部署上线指南.md:220` 在"上线后可选增强"里提过一句：

> **反向代理层加限流 / gzip / 静态缓存**：nginx 配 `gzip on`、静态资源 `expires`。

gzip 已经配了，**`expires` 至今没配**。

### 7.1 现在的行为：每次都问一遍

本项目没有任何缓存相关配置，所以 nginx 只会带上文件的 `Last-Modified` 和 `ETag`（这两个是自动的）。浏览器的行为是：

```
第 2 次访问页面：
浏览器 → GET /assets/index-a1b2c3.js
         If-None-Match: "abc123"        ← 带上上次的 ETag 问一句
nginx  → 304 Not Modified               ← "没变，用你本地的"
```

**没有重新下载文件（好），但仍然发生了一次完整的网络往返（不够好）**。十几个静态资源就是十几次往返。在网络差的时候，这些 304 的 RTT 累加起来很可观。

### 7.2 为什么本项目可以放心地把缓存开到最长

关键在 Vite 的打包产物。看文件名：

```
dist/assets/index-a1b2c3d4.js       ← 这串哈希不是装饰
dist/assets/index-e5f6g7h8.css
```

那串哈希是**根据文件内容算出来的**。这带来一个极强的性质：

> **文件内容一变，文件名必然跟着变。**

也就是说，`index-a1b2c3d4.js` 这个文件名一旦确定，它的内容就**永远不会变**。改了代码？那会打包出 `index-x9y8z7w6.js`，是一个**新的 URL**，而 `index.html` 里的引用也会同步更新指向新名字。

这种设计叫**内容哈希 / 缓存指纹**，它的全部意义就是：**让这些文件可以被无限期缓存**。

### 7.3 该怎么配

```nginx
# 带哈希的静态资源：一年，且声明 immutable（永不重验）
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# index.html：绝对不能缓存
location = /index.html {
    expires -1;
    add_header Cache-Control "no-cache";
}
```

**两条规则的分工至关重要，而且是相反的**：

| | `/assets/*`（带哈希） | `index.html`（不带哈希） |
|---|---|---|
| 文件名会变吗 | 内容变则名变 | **永远叫 index.html** |
| 缓存策略 | **一年 + immutable** | **不缓存** |
| 为什么 | 名字唯一标识内容，缓存永远不会给错 | 它是入口，必须每次拿最新的，否则用户永远加载旧版本的 JS |

`immutable` 这个值是关键：它告诉浏览器"**这个文件永远不会变，连 304 都不用问**"。加了它，第二次访问是**零请求**——直接读本地缓存，连那次往返都省了。

**为什么 `index.html` 必须 `no-cache`**：它是整个应用的入口，里面写着"要加载哪个哈希的 JS"。如果它被缓存了，用户就会一直拿着旧的 `index.html`，里面指向旧的 JS 哈希——**你发了新版本，用户永远看不到**，除非手动强刷。

> 🔑 **带内容哈希的资源 = 缓存到天荒地老；不带哈希的入口文件 = 一秒都不能缓存。** 这两条必须成对出现。只配前者会让用户卡在旧版本；只配后者等于没优化。Vite 的哈希文件名机制，存在的意义就是为了让第一条能安全成立。

### 7.4 为什么这条是"建议"而不是"已经改了"

本系列**只写不改**（这是这套文档的定位）。而且这个改动有个前提要先确认：`location /assets/` 会和现有的 `location /` 产生匹配关系——谁赢谁输，取决于 nginx 的 location 匹配优先级规则。

**那正好是 `03` 的主题。** 在没搞清优先级之前贸然加 location，是在赌。

整改建议的完整清单（含理由、影响面、风险）统一放在 `06`。

---

## 动手练习

> 全部是思考题，对着仓库真实文件推。

### 练习 1：MIME 事故

有人手滑把 `include /etc/nginx/mime.types;` 这行删了，重新构建镜像上线。请推演：用户访问 `https://www.eureka32.top` 会看到什么？（提示：不是白屏，是更奇怪的东西。想清楚 `index.html` 会拿到什么 `Content-Type`，浏览器会怎么反应。）

### 练习 2：sendfile 和 gzip 打架吗

本项目同时配了 `sendfile on` 和 `gzip on`。请分别回答下面四个请求，**实际用上了哪个**（可能都没用上）：

- A. `GET /assets/index-a1b2.js`
- B. `GET /vite.svg`
- C. `GET /some-photo.png`（假设 dist 里有）
- D. `GET /api/users`

### 练习 3：root 拼路径

假设有人在本项目的 server 里加了这么一段：

```nginx
location /static/ {
    root /usr/share/nginx/html;
}
```

请求 `GET /static/logo.png`，nginx 会去磁盘上找哪个文件？如果想让它去找 `/usr/share/nginx/html/logo.png`（注意：没有 `static` 这一层），配置该怎么改？改完有什么风险？

### 练习 4：为什么没有 text/html（思考题）

一个同事 review 时说："`gzip_types` 里漏了 `text/html`，`index.html` 没被压缩，赶紧加上。" 请用一句话反驳他，并说明如果真加上去会发生什么。

### 练习 5：缓存策略推演

假设按 `§7.3` 配好了缓存，然后你发布了一个新版本（改了某个 Vue 组件）。请按顺序推演一个**老用户**（浏览器里有上个版本的全部缓存）再次访问站点时发生的每一步：哪些文件是从缓存读的？哪些是重新下载的？他能看到新版本吗？

### 练习 6：如果哈希没了

假设某天 Vite 配置被改成了打包不带内容哈希（产物就叫 `index.js`、`index.css`）。此时 `§7.3` 那套缓存配置会变成什么后果？

---

## 自检问题

1. 浏览器靠什么决定"这个响应是 CSS 还是 JS 还是图片"？靠 URL 后缀吗？
2. `default_type application/octet-stream` 为什么是个安全的选择？换成 `text/html` 会怎样？
3. `sendfile on` 省掉了哪几次拷贝？为什么开了 gzip 之后它就用不上了？
4. `keepalive_timeout 65` 管的是"浏览器 ↔ nginx"这段连接吗？
5. `root` 和 `alias` 的核心区别是什么？为什么说 `alias` 的尾斜杠是个陷阱？
6. `gzip_min_length 1k` 为什么要设下限？不设会怎样？
7. `gzip_types` 里为什么没有 `text/html`？
8. 为什么 `gzip_types` 里有 `image/svg+xml`，却没有 `image/png`？
9. `gzip_vary on` 防的是什么问题？本项目现在有这个问题吗？
10. 为什么 `/assets/*` 可以缓存一年，而 `index.html` 一秒都不能缓存？

---

## 承上启下

本节把 nginx 的第一副面孔——静态文件服务器——的装备全读完了：MIME 贴标签、sendfile 零拷贝、keepalive 复用连接、root 拼路径、gzip 压缩。也留了一个"该配没配"的缓存优化，但它卡在一个前置问题上：**加了新 location 会不会和现有的打架**。

下一节就解决这个问题，读这三行：

```nginx
    server {
        listen 80;
        server_name _;                       # ← 这个下划线是通配符吗？

        location /api/ { ... }               # ← 两个 location 都能匹配 /api/users
        location / { ... }                   # ← 凭什么是前者赢？是因为它写在前面吗？
```

第二个问号的答案是**否**——location 的胜负**和书写顺序基本无关**，而这正是无数人栽跟头的地方。`03` 会给出完整的优先级规则，那是本系列最硬的一节。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

### 自检问题

<details>
<summary><b>1. 浏览器靠什么决定"这个响应是 CSS 还是 JS 还是图片"？靠 URL 后缀吗？</b></summary>

**只靠 `Content-Type` 响应头。不看 URL 后缀，也不看内容。**

URL 里写着 `.css`，但服务器返回 `Content-Type: text/plain`？浏览器就当纯文本处理，样式一点都不生效。反过来，一个叫 `/foo` 的 URL，只要 `Content-Type: text/css`，浏览器照样当样式表用。

nginx 是靠**文件扩展名**去 `mime.types` 表里查，查到什么写进 `Content-Type`。所以后缀确实间接起作用——但那是在**服务器**这一侧起作用，浏览器只认那个头。
</details>

<details>
<summary><b>2. <code>default_type application/octet-stream</code> 为什么是个安全的选择？换成 <code>text/html</code> 会怎样？</b></summary>

`application/octet-stream` 的语义是"不知道是什么的二进制"，浏览器的反应是**触发下载，不解释、不执行**。最坏后果就是用户莫名下载了个文件。

换成 `text/html` 就危险了：任何 nginx 不认识扩展名的文件，浏览器都会**当 HTML 解析**。如果站点有文件上传功能，攻击者传一个 `evil.xyz` 里面塞 `<script>`，nginx 查不到 `.xyz` → 兜底 `text/html` → 浏览器执行脚本 → **XSS 成立**。

这是"不确定时选最保守的那个"这一安全原则的标准案例。
</details>

<details>
<summary><b>3. <code>sendfile on</code> 省掉了哪几次拷贝？为什么开了 gzip 之后它就用不上了？</b></summary>

**省掉了内核态 ↔ 用户态之间的两次 CPU 拷贝**（以及两次上下文切换）。

传统路径是 4 次拷贝：磁盘 → 内核缓冲区 → **nginx 用户态缓冲区** → socket 缓冲区 → 网卡。中间那两步很荒谬——数据被搬进 nginx 内存，nginx 一个字节没改，又搬回内核。

sendfile 让内核直接把文件从 page cache 送到 socket，nginx 全程不碰数据，只发一个"把这个文件发出去"的指令。

**gzip 会让它失效**，因为 sendfile 的前提是"原样发出、不经用户态"。要压缩就必须把数据读进用户态算一遍——前提破了，sendfile 自动不用。

同理，SSI、`sub_filter` 这类要改内容的模块，以及**反向代理**（响应根本不来自本地文件），sendfile 都用不上。
</details>

<details>
<summary><b>4. <code>keepalive_timeout 65</code> 管的是"浏览器 ↔ nginx"这段连接吗？</b></summary>

**不是。** 本项目的 nginx 前面站着 caddy（`00 §3.1`），所以 nginx 面对的客户端**是 caddy，不是浏览器**。

这行配置管的是 **caddy ↔ nginx** 这一段。浏览器那一侧的连接复用行为由 **caddy** 决定，nginx 这行对它毫无影响。

顺带：nginx → backend 那一段（第 ③ 跳）是**另一套配置**（`upstream` 块里的 `keepalive`），本项目**压根没配**，所以每次反代都新建连接。这是个真实的优化点，`04` 展开。
</details>

<details>
<summary><b>5. <code>root</code> 和 <code>alias</code> 的核心区别是什么？为什么说 <code>alias</code> 的尾斜杠是个陷阱？</b></summary>

**`root` 是追加，`alias` 是替换：**

- `root` 的磁盘路径 = root 值 + **完整 URI**（location 前缀保留）
- `alias` 的磁盘路径 = alias 值 + **URI 去掉 location 前缀后的剩余部分**（前缀被吃掉）

同样请求 `/static/app.js`：
- `location /static/ { root /var/www; }` → `/var/www/static/app.js`
- `location /static/ { alias /var/www/; }` → `/var/www/app.js`

**尾斜杠陷阱**：

```nginx
location /static/ {
    alias /var/www;        # ← 少了尾斜杠
}
# /var/www + app.js = /var/wwwapp.js   ← 字符串直接粘在一起
```

拼出个 `/var/wwwapp.js` 这种鬼路径。**nginx 不报错，`nginx -t` 也过**，只是安静地 404。

规矩：location 和 alias 的尾斜杠必须**同时有或同时没有**。更稳的建议是**能用 root 就别用 alias**——root 的纯追加语义不存在这个坑。本项目 URL 结构和 dist 目录结构完全一致，所以一个 `root` 就够。
</details>

<details>
<summary><b>6. <code>gzip_min_length 1k</code> 为什么要设下限？不设会怎样？</b></summary>

因为 **gzip 有固定开销**：格式本身有十几字节头尾，而短内容里几乎找不到可压缩的重复模式。

结果是：压一个 200 字节的文件，**很可能压完比原文还大**，同时白烧 CPU。这是纯负收益。

1KB 是经验阈值，大致是"压缩开始稳定产生正收益"的临界点。

**一个边界**：这条判断依赖响应头里的 `Content-Length`。如果响应是分块传输（`Transfer-Encoding: chunked`，没有 `Content-Length`），nginx 事先不知道大小，这条就**失效，一律压**。反代场景下上游常用 chunked，所以它对 `/api/` 那侧基本管不住。
</details>

<details>
<summary><b>7. <code>gzip_types</code> 里为什么没有 <code>text/html</code>？</b></summary>

**因为 `text/html` 永远被压缩，写了是多余的。**

nginx 官方文档原话：*`text/html` is always compressed.* 这个类型是 `gzip_types` 的默认值且硬编码——只要 `gzip on`，HTML 就一定在压缩范围内，既不需要声明，也**无法通过 `gzip_types` 排除**。

关键认知：**`gzip_types` 是在默认的 `text/html` 之上做「追加」，不是「替换」。**

所以看到这个列表里没有 HTML，**不是配置漏了**——恰恰说明写的人知道自己在干什么。（这是 nginx 高频面试题。）
</details>

<details>
<summary><b>8. 为什么 <code>gzip_types</code> 里有 <code>image/svg+xml</code>，却没有 <code>image/png</code>？</b></summary>

因为 **SVG 本质是文本（XML），而 PNG 本质是已压缩的二进制**。

- SVG 是标签文本，重复度高，gzip 能压掉 70% 以上 → 值得压。
- PNG/JPG/WebP **本身就是压缩格式**，再 gzip 一遍压不动（可能只有 1%-2%），纯烧 CPU，有时体积甚至反而变大。

所以这个列表里"只有 SVG 一种图片"是**精准的选择**，不是随手写的。规则可以概括为：**看它本质是不是文本，而不是看它叫什么**。
</details>

<details>
<summary><b>9. <code>gzip_vary on</code> 防的是什么问题？本项目现在有这个问题吗？</b></summary>

防**缓存污染**。它在压缩响应里加 `Vary: Accept-Encoding`，告诉沿途的缓存："这个响应的内容取决于请求的 `Accept-Encoding`，请按这个头分开存两份"。

不加会出事的场景（前提是链路上有**共享缓存**，如 CDN）：
1. 支持 gzip 的浏览器请求 `/app.js` → 回源 → 缓存存下**压缩版**（它以为这是唯一版本）
2. 不支持 gzip 的客户端请求 `/app.js` → 缓存命中 → 把**压缩版**发给它 → 它不会解压 → **乱码**

**本项目现在没有这个问题**：链路上（浏览器 → caddy → nginx）没有共享缓存，caddy 默认也不缓存，浏览器的私有缓存不存在"发给别人"的问题。

但这是个**脆弱的安全区**——哪天在前面加了 CDN（对静态资源是很自然的下一步），坑立刻成立。所以它属于"一行代价、防患未然"，值得加。
</details>

<details>
<summary><b>10. 为什么 <code>/assets/*</code> 可以缓存一年，而 <code>index.html</code> 一秒都不能缓存？</b></summary>

差别在**文件名里有没有内容哈希**。

`/assets/index-a1b2c3d4.js` 那串哈希是按**内容**算的 → **内容一变，文件名必然变** → 这个 URL 对应的内容永远不会变 → 可以放心缓存到天荒地老，甚至加 `immutable` 让浏览器连 304 都不问。

`index.html` **永远叫 index.html**，名字不带哈希。而它是入口，里面写着"该加载哪个哈希的 JS"。一旦它被缓存：用户永远拿着旧的 index.html → 里面指向旧的 JS 哈希 → **你发了新版本，用户永远看不到**，除非手动强刷。

**这两条必须成对出现**：只配前者会让用户卡在旧版本；只配后者等于没优化。Vite 的哈希文件名机制存在的全部意义，就是为了让第一条能安全成立。
</details>

### 练习 1（MIME 事故）

<details>
<summary><b>点开看答案</b></summary>

**用户会"下载"到一个 index.html 文件，而不是看到网页。**

推演：删了 `include mime.types` → nginx 手里没有扩展名对照表 → 所有文件都查不到类型 → 全部掉进 `default_type application/octet-stream` 的兜底。

于是：

```http
GET /
HTTP/1.1 200 OK
Content-Type: application/octet-stream    ← 本该是 text/html
```

浏览器看到 `application/octet-stream`：不认识 → **触发下载**。用户访问网站，浏览器弹出一个"下载 index.html"的对话框。

站点变成了一个下载器。JS、CSS 更不用提——但根本走不到那一步，因为 HTML 压根没被渲染。

**这个故障的特点**：现象极其唬人（整站"消失"），排查方向容易跑偏（会怀疑构建、怀疑路径、怀疑 dist 没进去），但原因只是**一行配置**。

**怎么快速定位**：看响应头。`curl -I https://www.eureka32.top` 一眼就能看到 `Content-Type` 不对。**排查静态资源问题，永远先看响应头，别先看文件在不在。**
</details>

### 练习 2（sendfile 和 gzip 打架吗）

<details>
<summary><b>点开看答案</b></summary>

| | 请求 | gzip | sendfile | 为什么 |
|---|---|---|---|---|
| **A** | `/assets/index-a1b2.js` | ✅ 用上 | ❌ 用不上 | `application/javascript` **在** `gzip_types` 里 → 要压缩 → 必须读进用户态 → sendfile 的前提（原样发出）被破坏 |
| **B** | `/vite.svg` | ✅ 用上 | ❌ 用不上 | `image/svg+xml` **在** `gzip_types` 里（SVG 是文本）→ 同 A |
| **C** | `/some-photo.png` | ❌ 用不上 | ✅ 用上 | `image/png` **不在** `gzip_types` 里 → 不压缩 → 原样发出 → **sendfile 的理想场景** |
| **D** | `/api/users` | 看情况 | ❌ 用不上 | 这是**反向代理**，响应来自 backend 不是本地磁盘，**根本没有"文件"可 sendfile**。<br>gzip 理论上能压（`application/json` 在列表里），但上游若用 chunked 传输则 `gzip_min_length` 失效（`§6.3`） |

**结论**：`sendfile` 和 `gzip` 在同一个响应上**互斥**——但它们不冲突，因为**各自服务不同的文件类型**：

```
文本类（js/css/svg/json） → 走 gzip，牺牲 sendfile，换体积
二进制类（png/jpg/字体）  → 压不动，走 sendfile，换零拷贝
反向代理（/api/）        → 两个基本都用不上
```

这也说明本项目 `gzip_types` 那个列表的**真正含义**：它不只是"压哪些"，它同时也是在划分"**哪些走 gzip 路径、哪些走 sendfile 路径**"。两条指令合起来，覆盖了所有静态文件类型，各得其所。
</details>

### 练习 3（root 拼路径）

<details>
<summary><b>点开看答案</b></summary>

**第一问**：`root` 是**追加完整 URI**：

```
/usr/share/nginx/html  +  /static/logo.png  =  /usr/share/nginx/html/static/logo.png
                             ↑ 完整 URI，/static/ 保留
```

所以会去找 `/usr/share/nginx/html/static/logo.png`。

**第二问**：想让它找 `/usr/share/nginx/html/logo.png`（吃掉 `/static/` 这一层），得用 `alias`：

```nginx
location /static/ {
    alias /usr/share/nginx/html/;    # ← 尾斜杠！必须有！
}
# /usr/share/nginx/html/  +  logo.png  =  /usr/share/nginx/html/logo.png ✔
```

**第三问：改完的风险**——三条，一条比一条阴险：

1. **尾斜杠**：`alias /usr/share/nginx/html;`（漏了尾斜杠）会拼出 `/usr/share/nginx/htmllogo.png`。**nginx 不报错，`nginx -t` 也过**，只是安静 404。

2. **和 `location /` 的关系**：新加的 `location /static/` 是前缀匹配，比 `location /` 更长 → **它会赢**。所以 `/static/**` 的请求不再走 `try_files`，也就**不再有 SPA 回退**。如果 Vue Router 里恰好有个 `/static/xxx` 的前端路由，它会直接 404 而不是回退到 index.html。（这个"谁赢"的判断依据正是 `03` 的主题。）

3. **本项目压根不需要这么干**：dist 的目录结构和 URL 结构本来就一一对应，凭空造一个需要路径改写的 `/static/` 前缀，是**自己给自己制造 alias 陷阱**。

**通则**：能用 `root` 就别用 `alias`。只有当 URL 路径和磁盘目录结构**确实对不上**时才需要它——而好的项目结构应该让它们对得上。
</details>

### 练习 4（为什么没有 text/html）

<details>
<summary><b>点开看答案</b></summary>

**一句话反驳**：

> `text/html` 是 `gzip_types` 的默认值且硬编码，**只要 `gzip on` 它就永远被压缩**，写不写都一样——nginx 官方文档原话是 "text/html is always compressed"。

**真加上去会发生什么**：

**什么都不会发生。** 不报错、`nginx -t` 通过、行为一模一样。它就是一句**纯粹的废话**——重复声明了一个已经默认开启且无法关闭的行为。

**这道题的价值不在压缩，在 review 习惯**：那位同事的推理链条是"我没在列表里看到它 → 所以它没被压 → 所以要加"。这个链条的第二步是**臆断**，他没有验证过。

正确的做法是**先看证据**：

```bash
curl -H "Accept-Encoding: gzip" -I https://www.eureka32.top | grep -i content-encoding
# 有 Content-Encoding: gzip → 压了，讨论结束
```

一条命令就能终结这场争论。**"配置里没写" ≠ "没生效"**——默认值、继承（`01 §4.3`）、硬编码行为，都会让"没写"和"没生效"脱钩。这在 nginx 里尤其常见。
</details>

### 练习 5（缓存策略推演）

<details>
<summary><b>点开看答案</b></summary>

假设新版本改了某个组件，Vite 重新打包后：`index-a1b2c3d4.js` → `index-x9y8z7w6.js`（哈希变了），CSS 没改所以还是 `index-e5f6g7h8.css`。

老用户再次访问：

```
① GET /  （index.html）
   → 配置是 no-cache → 【不用缓存，重新请求】
   → nginx 返回【新的 index.html】
   → 里面写着 <script src="/assets/index-x9y8z7w6.js">   ← 新哈希

② 浏览器解析 index.html，要加载 /assets/index-x9y8z7w6.js
   → 查本地缓存：【没有这个 URL】（老缓存里是 a1b2c3d4）
   → 【重新下载】✔ 拿到新代码

③ 要加载 /assets/index-e5f6g7h8.css
   → 查本地缓存：【有！】而且是 expires 1y + immutable
   → 【零请求，直接用本地的】—— 连 304 都不问 ✔

④ 老的 index-a1b2c3d4.js 还在缓存里占着空间
   → 【再也不会被请求】（新 index.html 不引用它了）
   → 等它自己过期 / 被浏览器 LRU 淘汰
```

**结论**：

- **重新下载的**：`index.html`（1 次往返）+ 改了的那个 JS
- **零请求的**：没改的 CSS、图片、字体 —— **连 304 往返都没有**
- **能看到新版本吗**：**能，而且是立刻**。因为 `index.html` 没被缓存，它每次都是最新的，而它一更新就会指向新的哈希。

**这套机制的精妙之处**：只有**真正改变的文件**才产生流量，其余一律零请求。缓存命中率极高，同时**不牺牲一丁点发布的即时性**。

**如果反过来配**（index.html 缓存一年、assets 不缓存）会怎样？用户永远拿着旧 index.html → 永远加载旧哈希的 JS → **你发的新版本对老用户永久不可见**，而每次访问还要把所有 assets 重新下一遍。**两头全输。**
</details>

### 练习 6（如果哈希没了）

<details>
<summary><b>点开看答案</b></summary>

**`expires 1y; immutable` 会从最佳实践直接变成一场灾难。**

产物变成固定的 `index.js` / `index.css`，于是"文件名唯一标识内容"这个**前提彻底崩塌**：

```
① 老用户缓存里有 /assets/index.js（旧版本，标着 immutable、1 年后过期）
② 你发了新版本，服务器上 /assets/index.js 已经是新内容
③ 老用户访问 → index.html 是 no-cache，拿到新的 ✔
   → 里面还是引用 /assets/index.js（名字没变）
   → 浏览器查缓存：有！immutable！【连问都不问，直接用旧的】✘
④ 结果：新 HTML + 旧 JS
```

**后果比"看不到新版本"严重得多**：这是**新旧混搭**。新的 index.html 可能引用了新增的 DOM 结构或全局变量，而旧的 JS 完全不知道它们的存在 → 页面报错、白屏、功能诡异失灵。

**最要命的是没有解药**：`immutable` 的语义就是"永不重验"，浏览器**连 304 都不会发**。用户不会自愈，除非：

- 手动清缓存 / 强刷（`Ctrl+Shift+R`）——但用户不知道要这么做，他只会觉得"你们网站坏了"
- 等一年过期

而且你**没有任何服务端手段**能把这个缓存收回来——它已经在几万个浏览器里了。

> 🔑 **`immutable` 是一张不可撤销的支票。** 敢开它的唯一依据是"文件名带内容哈希"这个**技术保证**。哈希一旦没了，这个保证就没了，而配置还在——这正是最危险的状态：**一个曾经正确、如今失效、但没人注意到的假设**。

**这道题的真正教训**：nginx 配置里的很多"最佳实践"，都**隐含依赖着别处的某个前提**（这里是 Vite 的打包策略）。抄配置的时候，抄走了指令，却没抄走前提——这是配置类事故的一大来源。所以 `§7.3` 那两条缓存规则，注释里必须写清"依赖 Vite 内容哈希"，否则下一个人改 Vite 配置时根本不会想到这里会炸。
</details>
