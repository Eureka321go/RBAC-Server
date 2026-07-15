# 03 · Compose 入门：第一个服务

> **学习目标**：把阶段 1 里那条又长又难记的 `docker run` 命令，翻译成 `docker-compose.yml` 里的字段，并读懂 `${MYSQL_PASSWORD:-rbac_123}` 这种变量替换。
>
> **读完你能**：
> - 说出 Compose 文件的四个顶层键（`name` / `services` / `volumes` / `networks`）各管什么；
> - 拿着本项目的 `mysql` 服务段，逐个字段说出它对应阶段 1 的哪个 `docker run` 参数；
> - 读懂 `${变量:-默认值}`，知道 `deploy/.env` 是怎么被自动加载的，以及为什么密码不能带进生产；
> - 会用 `docker compose up -d` / `ps` / `logs -f` / `down` / `config` 这五条命令。

---

## 一、承上：Compose 只是"把命令写成文件"

阶段 1 你亲手敲过这么一条：

```bash
docker run -d \
  --name my-test-mysql \
  -p 13306:3306 \
  -e MYSQL_ROOT_PASSWORD=123456 \
  mysql:8.4
```

它能跑，但有三个问题：

| 问题 | 具体表现 |
|------|----------|
| **记不住** | 参数一多，下次你还得翻历史记录，或者去别人的博客里抄 |
| **不可复现** | 你敲的和同事敲的不一样，"在我机器上是好的"就是这么来的 |
| **管不了多个** | mysql、redis、backend、frontend、caddy——五个服务就是五条长命令，还得记住谁先起谁后起 |

回想 `00` 里那个类比：**镜像是菜谱，容器是按菜谱做出来的那盘菜**。那 `docker run` 就相当于你站在灶台前，一道菜一道菜地口头吩咐："这道用这个菜谱、火开中火、盐放三克……"

而 **Compose 就是那份写在纸上的宴席菜单 + 一个总厨**。你把整桌席面（哪些菜、每道菜什么要求、上菜顺序）一次写清楚，然后只喊一声"开席"，总厨照着单子把所有菜都安排好。

> 🔑 **Compose 没有魔法。** 它不是新的容器技术，底层还是在帮你调 `docker run`。你在阶段 1 学的每一个参数，在 Compose 里都能找到对应的字段——只是从"命令行参数"变成了"YAML 字段"。所以阶段 1 不白学，那是这一节的地基。

---

## 二、Compose 文件的骨架：四个顶层键

打开 `deploy/docker-compose.yml`，把中间的服务细节先全部折叠起来，你会看到它其实只有四块：

```yaml
name: rbac-server        # 1. 项目名

services:                # 2. 要跑哪些容器
  mysql: ...
  redis: ...
  backend: ...
  frontend: ...
  caddy: ...

volumes:                 # 3. 声明要用哪些数据卷
  mysql-data:
  redis-data:
  ...

networks:                # 4. 声明要建哪些网络
  rbac-net:
    driver: bridge
```

| 顶层键 | 管什么 | 类比 |
|--------|--------|------|
| `name` | 这一整套编排叫什么名字 | 这桌宴席的名号 |
| `services` | 要起哪些容器，每个怎么配 | 菜单上的每道菜 |
| `volumes` | **声明**要用到哪些持久化数据卷 | 后厨的几个专用储物柜（先登记，才能用） |
| `networks` | **声明**要建哪些内部网络 | 后厨的内部对讲频道 |

先看第一行：

```yaml
name: rbac-server #定义 Compose 项目名
```

这个 `name` 不只是个标签，它会**当前缀贴到 Compose 帮你创建的资源上**。还记得阶段 1 答疑里的 Q2 吗——你在服务器上找不到 `mysql-data` 这个目录，最后我们用 `docker volume ls` 找到了它的真名：

```
rbac-server_mysql-data
       ↑         ↑
   name 的值   volumes 里声明的名字
```

网络也一样，`rbac-net` 实际会叫 `rbac-server_rbac-net`。这样做的好处是：你电脑上就算跑十个项目、每个都有个叫 `mysql-data` 的卷，也不会打架——各自带着项目名前缀，井水不犯河水。

> 🔑 **顶层 `volumes:` 是"声明"，服务里的 `volumes:` 是"使用"。** 这是新手最容易绕晕的地方。顶层那几行光秃秃的 `mysql-data:` 什么都不干，它只是**登记**："本项目要用到一个叫 mysql-data 的卷"。真正把它挂到容器里的，是 `mysql` 服务内部那行 `- mysql-data:/var/lib/mysql`。
>
> 就像储物柜要先去后勤登记备案（顶层声明），然后厨师才能在自己的工位上说"我要用 3 号柜"（服务内使用）。**只用不登记，Compose 会直接报错。** `networks` 同理。
>
> 卷的细节（为什么必须挂、`down -v` 会怎样）留到阶段 5 专门讲，这一节你只要认得这个"声明 vs 使用"的分工就行。

---

## 三、精读 `mysql` 服务

来看本项目真实的 `mysql` 服务段（`deploy/docker-compose.yml` 第 21-45 行，一字未改）：

```yaml
  mysql:
    image: mysql:8.4
    container_name: rbac-mysql # 对应 --name
    restart: unless-stopped
    ports:
      - "3306:3306" # 对应 -p 3306:3306
    environment:
      MYSQL_ROOT_PASSWORD: "${MYSQL_ROOT_PASSWORD:-rbac_root_123}"
      MYSQL_DATABASE: "${MYSQL_DATABASE:-rbac}"
      MYSQL_USER: "${MYSQL_USER:-rbac}"
      MYSQL_PASSWORD: "${MYSQL_PASSWORD:-rbac_123}"
      TZ: Asia/Shanghai
    command: #启动参数
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-time-zone=+08:00
    volumes: #数据卷挂载（左=外部存储，右=容器内路径）
      - mysql-data:/var/lib/mysql # 我们手动实验时"缺"的那块，持久化数据
      - ./config/mysql/init:/docker-entrypoint-initdb.d # bind mount：注入你写的初始化 SQL
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-p${MYSQL_ROOT_PASSWORD:-rbac_root_123}"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [rbac-net]
```

注意最外层那个 `mysql:`——它是**服务名**，你自己起的。这个名字很重要，阶段 4 你会发现它同时还是容器之间互相访问的"域名"（`backend` 里那行 `DB_HOST: mysql` 就是在叫它）。这里先埋个扣。

### 3.1 逐字段对回 `docker run`

| Compose 字段 | 对应的 `docker run` 参数 | 作用 | 状态 |
|---|---|---|---|
| `image: mysql:8.4` | `mysql:8.4`（命令最后那个） | 用哪个镜像（菜谱） | ✅ 阶段 1 学过 |
| `container_name: rbac-mysql` | `--name my-test-mysql` | 给容器起个人话名字 | ✅ 阶段 1 学过 |
| `ports: - "3306:3306"` | `-p 13306:3306` | 宿主机端口:容器端口 | ✅ 阶段 1 学过（你还踩过端口冲突） |
| `environment:` | `-e MYSQL_ROOT_PASSWORD=123456` | 往容器里塞环境变量 | ✅ 阶段 1 学过 |
| `volumes:` | `-v` | 挂数据卷（阶段 1 就是漏了它才丢数据） | ⏭️ 阶段 5 细讲 |
| `restart: unless-stopped` | `--restart unless-stopped` | 挂了自动重启 | 🆕 本节 |
| `command:` | 镜像名后面跟的那串参数 | 覆盖容器的默认启动命令 | 🆕 本节 |
| `healthcheck:` | `--health-cmd` 等 | 怎么判断"服务真的能用了" | ⏭️ 阶段 4 |
| `networks: [rbac-net]` | `--network` | 接到哪个内部网络 | ⏭️ 阶段 4 |

看这张表你应该能松一口气：**一大半字段你阶段 1 已经会了**，只是换了个写法。剩下的 `healthcheck` 和 `networks` 是阶段 4 的主角，`volumes` 是阶段 5 的主角。这一节只需要吃透两个新东西：`restart` 和 `command`。

### 3.2 `restart: unless-stopped`——容器挂了怎么办

容器里的进程崩了，容器就停了。默认情况下它就那么躺着，没人管。`restart` 就是告诉 Docker"出了事你自己看着办"：

| 取值 | 含义 |
|------|------|
| `no`（默认） | 挂了就挂了，不管 |
| `always` | 挂了就重启；**连你手动 `docker stop` 停的，重启 Docker 后它也会自己爬起来** |
| `unless-stopped` | 挂了就重启；**但如果是你手动停的，就尊重你的决定，别自作主张** |
| `on-failure` | 只在非正常退出（退出码非 0）时重启 |

本项目选 `unless-stopped`，理由很实在：服务器重启、MySQL 偶然崩溃，希望它自动回来；但当我要停机维护、手动 `docker compose stop` 的时候，它就该老老实实停着，别跟我抢方向盘。

### 3.3 `command:`——覆盖容器的默认启动命令

还记得 `02` 里讲 Dockerfile 的 `ENTRYPOINT` / `CMD` 吗？那是**镜像作者写好的默认启动命令**。`mysql:8.4` 这个镜像默认就是启动 `mysqld`。

而 Compose 的 `command:` 就是**在开席前，你给这道菜追加的特殊要求**："照常做，但别放辣。"

```yaml
    command: #启动参数
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-time-zone=+08:00
```

这三行是给 `mysqld` 追加的启动参数：

- `--character-set-server=utf8mb4`：服务端默认字符集用 utf8mb4。**这是中文项目的救命参数**——MySQL 老版本的 `utf8` 其实是"阉割版"，只支持 3 字节，存不下 emoji 和部分生僻字。`utf8mb4` 才是真正的完整 UTF-8。
- `--collation-server=utf8mb4_unicode_ci`：排序规则，决定字符串怎么比大小、`WHERE name = 'Abc'` 要不要区分大小写（`_ci` = case insensitive，不区分）。
- `--default-time-zone=+08:00`：**这行躲掉了 Java 项目最经典的"差 8 小时"事故**。容器默认是 UTC，Java 应用是东八区，两边一对不上，存进去的时间就莫名其妙少 8 小时。这里直接把数据库钉死在 +08:00。

再看 `redis` 的写法（第 53 行），换了个形式：

```yaml
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD:-rbac_redis_123}"]
```

- 两种写法（YAML 列表的 `-` 换行式 vs `[...]` 数组式）本质一样，都是"一个词一个元素"，选哪个纯看顺眼。
- `redis-server` 开头——redis 这里是把**整条命令**都重写了（不像 mysql 只是追加参数）。
- `--appendonly yes`：开 AOF 持久化，redis 会把每条写命令记到日志里，重启能恢复。
- `--requirepass xxx`：给 redis 设密码。**注意这里又出现了 `${...}`**，下一节就讲它。

> 🔑 **`command` 覆盖的是 `CMD` / `ENTRYPOINT`，不是 `RUN`。** 别和 `02` 学的 Dockerfile 混了：
> - `RUN` = **构建时**执行，结果被烤进镜像里，跑起来之后你改不了；
> - `CMD` / `ENTRYPOINT` = **运行时**执行的默认命令，Compose 的 `command:` 可以把它顶掉。
>
> 一句话：镜像已经做好了，你能改的只有"怎么启动它"，改不了"它是怎么做出来的"。

---

## 四、`${...}` 变量替换与 `.env`（本节重头戏）

### 4.1 先把语法拆开

```
"${MYSQL_ROOT_PASSWORD:-rbac_root_123}"
  ↑ ↑                  ↑  ↑
  │ │                  │  └─ 默认值：找不到就用这个
  │ │                  └──── ":-" 读作"如果没有，就用"
  │ └───────────────────── 变量名
  └─────────────────────── ${...} 表示"这里要替换成变量的值"
```

整句读作：**"去找一个叫 `MYSQL_ROOT_PASSWORD` 的变量；找到了就用它的值，没找到就用 `rbac_root_123`。"**

这就像点菜时说"要杯茶，有龙井就龙井，没有就上白开水"——**永远不会因为缺一样东西就卡住不动**。

### 4.2 `.env` 是从哪冒出来的

变量的值从哪来？Compose 会**自动**读取 **compose 文件所在目录**下那个叫 `.env` 的文件。不用任何配置、不用任何参数，文件名对了就自动加载。

看本项目的 `deploy/.env`（真实内容）：

```bash
# ─── 中间件凭据（本地开发用；生产请改强密码并勿入库）───
# MySQL
MYSQL_ROOT_PASSWORD=rbac_root_123
MYSQL_DATABASE=rbac
MYSQL_USER=rbac
MYSQL_PASSWORD=rbac_123

# Redis
REDIS_PASSWORD=rbac_redis_123

# RabbitMQ
RABBITMQ_USER=rbac
RABBITMQ_PASSWORD=rbac_mq_123
```

于是整条链路是这样的：

```
deploy/.env                     docker-compose.yml                容器内
──────────────                  ──────────────────                ──────
MYSQL_ROOT_PASSWORD  ─── 替换 ──▶ "${MYSQL_ROOT_PASSWORD:-...}" ──▶ MYSQL_ROOT_PASSWORD=rbac_root_123
  =rbac_root_123                        （environment 下）            mysql 镜像启动时读到它，
                                                                      拿来设置 root 密码
```

注意 `.env` 文件必须放在 **compose 文件旁边**（也就是 `deploy/` 里），不是项目根目录。这也是为什么本项目所有 compose 命令都要先 `cd deploy`。

### 4.3 灵魂拷问：既然 `.env` 里有值，为什么还要写默认值？

两个都写，看着像重复劳动，其实分工很清楚：

| | 默认值 `:-rbac_root_123` | `.env` 里的 `MYSQL_ROOT_PASSWORD=rbac_root_123` |
|---|---|---|
| 角色 | **兜底** | **真正干活的** |
| 什么时候生效 | `.env` 丢了 / 变量没设 | 正常情况下，一直是它 |
| 为什么需要 | 新人 clone 下来，忘了建 `.env` 也能一把跑起来，不会报一堆看不懂的错 | 改配置只改 `.env`，不用动 compose 文件 |

再说深一层，这套设计的核心是**把"编排逻辑"和"环境配置"分开**：

- `docker-compose.yml` —— 描述**架构**（有哪些服务、怎么连、怎么起）。这个**要进 git**，团队共享，本地和生产都一样。
- `.env` —— 描述**这台机器上的具体配置**（密码是什么、数据库叫什么）。本地一套、生产另一套，**不该进 git**。

同一份 compose 文件，配上不同的 `.env`，就能跑出开发环境和生产环境——这就是为什么要多此一举搞变量替换。

> 🔑 **安全红线：`.env` 里这几个密码只是本地开发用的，绝对不能原样带到生产。**
>
> 你现在看到的 `rbac_root_123`、`rbac_redis_123` 全是弱密码，写在文档和仓库里人尽皆知。同理，`backend` 服务里那个 `RBAC_JWT_SECRET` 的默认值更是直白地写着 `...please-change-in-production-...`——这是镜像作者在冲你喊话。
>
> 生产环境该怎么换，本项目已经有专门文档：`docs/ops/01-更换默认密码与密钥.md`。这也呼应项目 `CLAUDE.md` 里那条红线："`application.yml`、`deploy/.env` 中密码仅限本地，勿带入生产。"

### 4.4 神器：`docker compose config`

变量替换是在**运行前**发生的，光看 YAML 你看不出最终结果。这时候用：

```bash
cd deploy
docker compose config
```

它会把 `.env` 全部代入、把所有简写展开，打印出**Compose 眼里最终的那份配置**。这条命令有三个用处：

1. **查变量替换对不对**——你会直接看到 `MYSQL_ROOT_PASSWORD: rbac_root_123`，而不是 `${...}`。
2. **当语法检查用**——YAML 缩进错了、字段名拼错了，它当场报错，而且**不会真的启动任何东西**，试错成本为零。
3. **看 Compose 到底怎么理解你的文件**——很多"我明明写了啊怎么没生效"的问题，`config` 一跑就真相大白。

> 改完 compose 或 `.env`，先 `config` 再 `up`。这是个好习惯，能省掉大量瞎猜。

---

## 五、五条常用命令

```bash
cd deploy                      # 前提：必须在 compose 文件所在目录

docker compose up -d           # 起（-d = 后台跑，detached）
docker compose ps              # 看现在跑着啥
docker compose logs -f mysql   # 追 mysql 的日志（-f = follow，Ctrl+C 退出）
docker compose down            # 停掉并删除容器和网络
docker compose config          # 看变量替换后的最终配置（不启动任何东西）
```

对比一下阶段 1 的单容器命令，你会发现规律：

| 阶段 1（单容器，要指名道姓） | 阶段 3（Compose，管一整套） |
|---|---|
| `docker run -d --name x -p ... 镜像` | `docker compose up -d` |
| `docker ps` | `docker compose ps` |
| `docker logs -f my-test-mysql` | `docker compose logs -f mysql` |
| `docker stop x && docker rm x` | `docker compose down` |

**最大的区别：不用报容器名了。** 阶段 1 你得记住 `my-test-mysql` 这个容器名；Compose 里你说 `mysql`——**服务名**，Compose 自己知道该找哪个容器。而且 `up -d` 一条命令就把整套都拉起来了，不用一个一个来。

> 🔑 **`down` 和 `down -v` 差一个字母，差一条命。**
> - `docker compose down` —— 删容器、删网络，**数据卷完好无损**。明天 `up -d` 回来，数据还在。
> - `docker compose down -v` —— 连数据卷一起删，**数据库里的数据全没了，不可恢复**。
>
> 阶段 5 会专门做实验验证这一点。现在只要记住：**没想清楚之前，永远别在有数据的环境上加 `-v`。**

---

## 六、串起来：现在你能读懂多少了

回头看整个 `mysql` 服务段，逐个字段标一下：

| 字段 | 哪一节讲的 |
|---|---|
| `image: mysql:8.4` | `01`（镜像 = 菜谱） |
| `container_name: rbac-mysql` | `01`（`--name`） |
| `ports: - "3306:3306"` | `01`（端口映射，你还踩过冲突） |
| `environment:` | `01`（`-e`）+ **本节**（`${...}` 变量替换） |
| `restart: unless-stopped` | **本节** |
| `command:` | `02`（覆盖 `CMD`）+ **本节** |
| `volumes:` | `01` 埋过扣（丢数据实验）→ **阶段 5 细讲** |
| `healthcheck:` | **阶段 4** |
| `networks: [rbac-net]` | **阶段 4** |

**九个字段，你已经能讲明白六个了。** 剩下三个正好就是接下来两节的内容——这份 compose 文件到那时候就再没有黑盒了。

---

## 动手练习

### 练习 1：看看变量到底被替换成了什么

```bash
cd deploy
docker compose config
```

在输出里找到 `mysql` 服务的 `environment`，确认 `MYSQL_ROOT_PASSWORD` 已经变成了实实在在的值，而不是 `${...}`。

**再想一下**：`redis` 的 `command` 那行里的 `${REDIS_PASSWORD:-rbac_redis_123}` 也被替换了吗？（提示：变量替换不挑字段，整个文件通吃。）

### 练习 2：起默认栈，看它是怎么活过来的

```bash
cd deploy
docker compose up -d
docker compose ps
docker compose logs --tail 20 mysql
```

- `ps` 里你应该能看到 mysql、redis 等服务。留意 `STATUS` 那列——有的写着 `healthy`，那是 `healthcheck` 在起作用（阶段 4 讲）。
- `logs` 里翻一翻 MySQL 的启动过程。看看能不能找到跟字符集、时区相关的行——那就是你 `command:` 里那三行参数的效果。

> ⚠️ 你机器上的 `rbac-mysql`、`rbac-redis` 本来就在跑，所以 `up -d` 大概率会提示容器已存在、什么都不做。这是正常的，**Compose 是"声明式"的**：你说"我要这些服务跑着"，它发现已经跑着了，就不折腾。

### 练习 3：改一次 `.env`，但先别启动

1. 把 `deploy/.env` 里的 `MYSQL_DATABASE=rbac` 临时改成 `MYSQL_DATABASE=rbac_test`。
2. **只跑** `docker compose config`，在输出里找 `MYSQL_DATABASE`——它变了吗？
3. **改回去**，别真的 `up`。

**思考题**：假设你真的把它改成 `rbac_test` 然后 `docker compose up -d`，MySQL 里会多出一个 `rbac_test` 库吗？

<details>
<summary>点开看答案</summary>

**不会。** `MYSQL_DATABASE` 这个变量只在**数据目录为空、第一次初始化**的时候起作用。你的 `mysql-data` 卷里早就有数据了，mysql 镜像的启动脚本一看"哦这里已经有库了"，就直接跳过整个初始化流程，`MYSQL_DATABASE` 连看都不看一眼。

这是个超级经典的坑：**"我明明改了环境变量，为什么没生效？"** —— 因为它压根就不是"每次启动都生效"的配置，而是"出厂设置"。

想让它真的生效，得先把卷清掉（`down -v`）让数据目录重新变空。同一个道理也适用于 `MYSQL_ROOT_PASSWORD`——你改了密码却发现还是老密码能登，就是这个原因。

阶段 5 会拿这个坑做专门的实验。
</details>

### 练习 4：不看文档，默写对照关系

合上这篇文档，凭记忆说出下面每个 `docker run` 参数对应 Compose 的哪个字段：

| `docker run` 参数 | Compose 字段？ |
|---|---|
| `--name` | ? |
| `-p 3306:3306` | ? |
| `-e KEY=VALUE` | ? |
| `-v xxx:/yyy` | ? |
| `--restart unless-stopped` | ? |
| 镜像名后面跟的参数 | ? |

---

## 自检问题

1. `name: rbac-server` 这一行，除了当个名字，还有什么实际作用？（提示：想想你在服务器上找不到的那个 `mysql-data`）
2. 顶层的 `volumes:` 和 `mysql` 服务里的 `volumes:`，是同一件事吗？各自干什么？
3. `${MYSQL_PASSWORD:-rbac_123}` 里的 `:-` 是什么意思？如果 `.env` 里有 `MYSQL_PASSWORD=abc123`，最终值是什么？如果 `.env` 整个文件被删了呢？
4. Compose 的 `command:` 能覆盖 Dockerfile 里的哪些指令？`RUN` 能被覆盖吗？为什么？
5. `restart: always` 和 `restart: unless-stopped` 的区别在哪？本项目为什么选后者？
6. `docker compose down` 和 `docker compose down -v` 的区别是什么？哪个会让你半夜被叫起来？

---

## 承上启下

现在你能读懂 `mysql` 服务的大半字段了。但还有两个刺眼的东西没讲：

```yaml
    healthcheck:            # ← 这是什么？
      test: [...]
    networks: [rbac-net]    # ← 这又是什么？
```

而且 `00` 里我埋过两个扣，现在该还了：

- `backend` 服务里为什么敢写 `DB_HOST: mysql`——不用 IP、不用端口号，就一个服务名，它怎么就能连上数据库？
- `depends_on: condition: service_healthy` 又是在等什么？为什么不能简单地"先起 mysql 再起 backend"就完事？

**下一节 `04-服务编排-网络依赖与健康检查.md`**：讲 `rbac-net` 这个自定义网络怎么让容器之间用服务名互相喊话，讲 `healthcheck` 怎么区分"进程起来了"和"服务真能用了"——这俩听着差不多，中间隔着的正是那个让无数人加班到半夜的经典 bug。

---

## 附：答案与解析

> 建议先自己想一遍再点开。想不出来不丢人，但直接看答案，这节就白读了。

### 自检问题

<details>
<summary><b>1. `name: rbac-server` 除了当名字还有什么用？</b></summary>

它会当**前缀贴到 Compose 创建的所有资源上**。你声明的 `mysql-data` 卷，实际真名是 `rbac-server_mysql-data`；`rbac-net` 网络实际叫 `rbac-server_rbac-net`。

这正是你之前在服务器上 `ls` 找不到 `mysql-data` 的原因（见 `01` 答疑 Q2）——它压根不是目录，而且名字还带前缀。

好处是**隔离**：你机器上跑十个项目、每个都有个叫 `mysql-data` 的卷，也不会互相覆盖。
</details>

<details>
<summary><b>2. 顶层 `volumes:` 和服务里的 `volumes:` 是同一件事吗？</b></summary>

不是，是"**登记**"和"**领用**"的关系。

- 顶层的 `mysql-data:`（后面空着什么都没有）只是**声明**："本项目要用到一个叫 mysql-data 的卷，Docker 你给我建一个。"
- 服务里的 `- mysql-data:/var/lib/mysql` 才是**使用**："把那个卷挂到我容器的 `/var/lib/mysql` 上。"

**只用不登记，Compose 直接报错不给启动。** `networks` 也是这套逻辑。
</details>

<details>
<summary><b>3. `${MYSQL_PASSWORD:-rbac_123}` 里 `:-` 是什么意思？</b></summary>

读作"**如果没有，就用**"。三种情况：

| 情况 | 最终值 |
|---|---|
| `.env` 里有 `MYSQL_PASSWORD=abc123` | `abc123`（`.env` 赢） |
| `.env` 整个文件被删了 | `rbac_123`（默认值兜底，照样能跑） |
| `.env` 里写了 `MYSQL_PASSWORD=`（等号后空着） | `rbac_123` |

**第三行是个坑**：`:-` 遇到**空值**也会用默认值。如果用的是它的兄弟 `-`（写成 `${MYSQL_PASSWORD-rbac_123}`，没有冒号），那空值就是空值，不会兜底。

本项目全用 `:-`，因为"变量写了但值是空的"基本都是手滑，兜底更安全。
</details>

<details>
<summary><b>4. `command:` 能覆盖 Dockerfile 的哪些指令？`RUN` 能覆盖吗？</b></summary>

能覆盖 `CMD` 和 `ENTRYPOINT`，**`RUN` 不能**。

因为**时机根本不同**：

- `RUN` 是**构建时**跑的，结果已经烤进镜像的层里、变成只读的了。`02` 里 `backend/Dockerfile` 那句 `RUN mvn clean package` 早在打镜像时就执行完了，jar 都躺在镜像里了，你运行时再怎么喊也改不了它。
- `CMD` / `ENTRYPOINT` 只是**默认启动命令**，一个建议值，运行时随便顶掉。

一句话：**菜已经做好了，你能改的只有"怎么端上桌"，改不了"它是怎么做出来的"。**
</details>

<details>
<summary><b>5. `always` 和 `unless-stopped` 的区别？为什么本项目选后者？</b></summary>

区别只在**你手动停过之后**：

- `always`：连你 `docker stop` 停掉的容器，Docker 守护进程重启（比如服务器重启）后也会自己爬起来。
- `unless-stopped`：记得"这是人手动停的"，就不自作主张。

选 `unless-stopped` 是因为要**尊重人的意图**：服务器重启、MySQL 偶然崩溃，希望自动恢复；但我停机维护时手动 `docker compose stop`，它就该老实待着，别跟我抢方向盘。`always` 在维护场景下会很烦人——你停一次它起一次。
</details>

<details>
<summary><b>6. `down` 和 `down -v` 的区别？哪个会让你半夜被叫起来？</b></summary>

- `down`：删容器、删网络，**数据卷完好**。明天 `up -d` 数据还在。
- `down -v`：**连数据卷一起删，数据库数据全没，不可恢复。**

半夜被叫起来的当然是 `down -v`。而且它**没有二次确认、没有回收站**，回车下去就结束了。

在有数据的环境上，把这个 `-v` 当成核按钮看。
</details>

### 练习 1 的"再想一下"

<details>
<summary><b>redis 的 `command` 里那个 `${REDIS_PASSWORD:-...}` 也被替换了吗？</b></summary>

**会。** 变量替换发生在 Compose 解析 YAML 的阶段，是**纯文本层面的操作**，跟字段是 `environment` 还是 `command` 完全无关——整个文件通吃。

所以 `redis` 的 `command` 里那个 `${REDIS_PASSWORD:-rbac_redis_123}`、乃至 `healthcheck.test` 数组里那个 `-p${MYSQL_ROOT_PASSWORD:-...}`，全都会在启动前被换成实际值。

跑一次 `docker compose config` 就能一眼看到全部——这也是为什么这条命令这么好用。
</details>

### 练习 4（默写对照表）

<details>
<summary><b>对照答案</b></summary>

| `docker run` 参数 | Compose 字段 |
|---|---|
| `--name` | `container_name:` |
| `-p 3306:3306` | `ports: - "3306:3306"` |
| `-e KEY=VALUE` | `environment:` 下的 `KEY: VALUE` |
| `-v xxx:/yyy` | `volumes: - xxx:/yyy` |
| `--restart unless-stopped` | `restart: unless-stopped` |
| 镜像名后面跟的参数 | `command:` |

能默写出这张表，这一节的核心就拿下了：**Compose 没有发明新东西，只是把命令行参数换了个地方写。**
</details>

---

## 附：课堂答疑（阶段 3 学习中遇到的真实问题）

### Q1：`backend` 配的 `environment`，是 `ENTRYPOINT ["java", "-jar", "app.jar"]` 的运行参数吗？

**不是。这是两条完全独立的通道。**

容器里那条命令**一个字都没变**，它就是字面意义上的：

```
java -jar app.jar
```

**后面没有追加任何参数。** 如果 `environment` 真的变成了启动参数，命令该长这样（但事实上并不是）：

```
java -jar app.jar --DB_HOST=mysql --DB_PORT=3306 ...   ← 不存在的
```

`environment` 干的事是：**在容器这个"操作系统环境"里设置环境变量**，等价于容器启动前先执行了一遍：

```bash
export DB_HOST=mysql
export DB_PORT=3306
export DB_USER=rbac
...
java -jar app.jar          # 命令本身没变，但它现在活在一个有这些变量的环境里
```

> 🔑 **参数是"塞到你手里"的，环境变量是"贴在墙上"的。**
> `java` 进程收到的命令行参数只有 `-jar app.jar`；至于墙上贴了什么，得**它自己抬头去看**。

#### 那 Spring Boot 是怎么"抬头看"的？

关键在于——**不是 Docker 送过去的，是 Spring Boot 主动去读的**。

看 `backend/src/main/resources/application.yml`（真实内容）：

```yaml
url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/rbac?...
username: ${DB_USER:rbac}
password: ${DB_PASSWORD:rbac_123}
```

Spring Boot 启动时解析 `application.yml`，遇到 `${DB_HOST:localhost}` 就去环境变量里找 `DB_HOST`——找到了用 `mysql`，找不到就用默认值 `localhost`。

（这也是为什么你在 Mac 上直接 `mvn spring-boot:run`、不带任何环境变量也能跑：全部走默认值，连的是本机。）

> 🔑 **compose 里 `environment` 的 key 不是随便起的名字**，它们必须和 `application.yml` 里 `${...}` 的名字**一字不差地对上**。改一个就断一条。

#### 完整链路：一个值的三段接力

以数据库用户名为例：

```
deploy/.env                    MYSQL_USER=rbac
      │
      │  ① Compose 变量替换（本节学的，启动前的纯文本操作）
      ▼
docker-compose.yml             DB_USER: "${MYSQL_USER:-rbac}"  →  DB_USER: "rbac"
      │
      │  ② Docker 设置容器环境变量
      ▼
容器内的环境                    DB_USER=rbac
      │
      │  ③ Spring Boot 占位符解析（application.yml）
      ▼
application.yml                username: ${DB_USER:rbac}  →  username: rbac
      │
      ▼
                               数据源真的用 rbac 连上了 MySQL
```

**三段接力，每段都是不同的系统在做替换，互不知道对方的存在。**

#### 一个极易看混的细节

这两个 `${...}` 长得像，其实是两套完全不同的语法：

| | 写法 | 谁解析的 | 什么时候 |
|---|---|---|---|
| Compose | `${MYSQL_USER:-rbac}` | Docker Compose | 容器启动**前**，纯文本替换 |
| Spring | `${DB_USER:rbac}` | Spring Boot | 应用**启动时**，读环境变量 |

**差一个 `-`**：Compose 是 `:-`，Spring 是单个 `:`。两边碰巧都是"没有就用默认值"的意思，但它们是**各自独立发明的语法，跑在完全不同的阶段**。

#### 那什么时候才该用 `command:`？

串一下 `02` 学的：

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

这是镜像作者定的默认启动命令。本节讲过 `command:` 能顶掉它——如果你真想给 java 传**命令行参数**，那才走 `command:`：

```yaml
    command: ["java", "-jar", "app.jar", "--spring.profiles.active=prod"]
```

但本项目**没这么干**，而是全走 `environment`。为什么？

因为环境变量是 **12-Factor App（十二要素应用）的标准做法**：配置和代码分离，**同一个镜像换套环境变量就能在开发/测试/生产跑**。用命令行参数的话，参数写死在 compose 里；而环境变量可以从 `.env`、从 CI 的 secret、从 K8s 的 ConfigMap 灌进来，灵活得多。

这也正好呼应本节 4.3 讲的那件事：**把"编排逻辑"和"环境配置"分开**——`environment` + `.env` 就是这个思路在应用层的落地。
