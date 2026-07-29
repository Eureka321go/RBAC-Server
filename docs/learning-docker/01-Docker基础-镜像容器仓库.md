# 阶段 1 · Docker 基础：镜像、容器、仓库（不碰 Compose）

> 目标：这一节我们**不用 compose**，就用最原始的 `docker` 命令，亲手把一个 `mysql:8.4` 容器
> 跑起来、看它的日志、钻进去连上数据库、再把它删掉。
> 读完你能：看懂 `docker run` 每个参数在干嘛，理解"镜像→容器"这条最基础的链路，并能独立管理单个容器。
>
> 为什么先学这个再学 compose？因为 compose 只是**帮你批量下命令的工具**，它底下每一行还是这些 docker 概念。地基不牢，compose 里的字段你只会照抄不会懂。

---

## 零、先确认 Docker 装好了

打开终端，敲这两条：

```bash
docker --version          # 例：Docker version 27.x.x
docker compose version    # 例：Docker Compose version v2.x.x
```

两条都能打印出版本号就 OK。如果提示 `command not found`：

- **Mac / Windows**：去官网装 **Docker Desktop**，装完打开它（菜单栏/任务栏有个小鲸鱼图标，图标不转了说明引擎起来了）。
- **Linux 服务器**：装 `docker-ce`（我们项目 `docs/09-部署上线指南.md` 里有装法）。

> 🔑 Docker 分两部分：一个**后台引擎（daemon）**真正干活，一个 **`docker` 命令**发指令给它。Mac/Windows 上 Docker Desktop 就是把引擎装在一个小型 Linux 虚拟机里。所以**引擎没启动，任何 docker 命令都会报连不上**——记住先确认小鲸鱼在跑。

---

## 一、回顾三个名词，这次落到命令上

阶段 0 用做菜类比过：**仓库存镜像，镜像启动成容器**。这一节把它们对应到真实命令：

| 名词 | 命令层面的样子 | 类比 |
|------|----------------|------|
| 仓库 Registry | `docker pull mysql:8.4` 从这里下载 | 菜谱网站 |
| 镜像 Image | `docker images` 能列出来，只读、不动 | 下载好的菜谱 |
| 容器 Container | `docker run` 启动出来，`docker ps` 能看到在跑 | 照菜谱做出的那盘菜 |

关于 `mysql:8.4` 这个写法：冒号前面 `mysql` 是**镜像名**，后面 `8.4` 是**标签（tag）**，通常代表版本。不写标签默认是 `latest`（最新版）。我们项目**特意钉死 `8.4`**，就是为了本地和服务器版本一致——这正是阶段 0 说的"环境一致"。

---

## 二、第一步：把镜像拉下来

```bash
docker pull mysql:8.4
```

你会看到它一层一层地下载：

```
8.4: Pulling from library/mysql
a1b2c3...: Pull complete
d4e5f6...: Pull complete
...
Status: Downloaded newer image for mysql:8.4
```

**为什么是一层一层的？** 因为镜像是**分层**的（阶段 2 讲 Dockerfile 时会深入）。你现在只需知道：镜像由多个只读层叠起来，下载时逐层拉，**层可以被多个镜像复用**，所以第二次拉别的镜像时公共层不用重下。

拉完确认一下：

```bash
docker images
```

```
REPOSITORY   TAG   IMAGE ID       CREATED       SIZE
mysql        8.4   a1b2c3d4e5f6   2 weeks ago   600MB
```

> 小知识：其实下一步 `docker run` 时如果本地没有镜像，Docker 会**自动帮你 pull**。所以单独 `docker pull` 不是必须的，这里单独做一次只是为了让你看清"下载镜像"这个动作。

---

## 三、第二步：用镜像启动一个容器

现在把 MySQL 跑起来。**先给一条能用的完整命令，再逐行拆解**：

```bash
docker run -d \
  --name my-test-mysql \
  -e MYSQL_ROOT_PASSWORD=rbac_root_123 \
  -e MYSQL_DATABASE=rbac \
  -p 3306:3306 \
  mysql:8.4
```

逐个参数拆开讲（这些参数后面在 compose 里都会以另一种形式重逢）：

| 参数 | 作用 | 对应 compose 里的字段（阶段 3 会遇到） |
|------|------|------------------------------------------|
| `docker run` | 由镜像启动一个容器 | 整个 `services:` 块 |
| `-d` | detach，后台运行，不占着你的终端 | compose `up -d` 的 `-d` |
| `--name my-test-mysql` | 给容器起个名，方便后面引用 | `container_name` |
| `-e MYSQL_ROOT_PASSWORD=...` | 设一个**环境变量**传给容器 | `environment:` |
| `-e MYSQL_DATABASE=rbac` | 让 mysql 启动时自动建个叫 `rbac` 的库 | `environment:` |
| `-p 3306:3306` | **端口映射**：把宿主机 3306 转发到容器内 3306 | `ports:` |
| `mysql:8.4` | 用哪个镜像 | `image:` |

**重点讲 `-p 3306:3306`**（初学最容易糊涂的点）：

容器是隔离的，里面 MySQL 监听的是**容器自己的** 3306 端口，外面默认摸不到。`-p 宿主机端口:容器端口` 就像给这个箱子**开一扇窗**，把宿主机的 3306 接到容器的 3306。所以你在电脑上用 Navicat 连 `localhost:3306`，实际连的就是这个容器里的 MySQL。

```
  你的电脑                          容器 my-test-mysql
 ┌──────────────┐   -p 3306:3306   ┌──────────────────┐
 │ localhost:3306│ ◄─────────────► │ MySQL 监听 :3306  │
 └──────────────┘                  └──────────────────┘
```

> 🔑 冒号**左边是宿主机、右边是容器**。写成 `-p 13306:3306` 就是"电脑上用 13306 访问容器里的 3306"——当宿主机 3306 已被占用时就这么改。

运行成功后它会打印一长串容器 ID，说明容器已在后台跑起来了。

---

## 四、第三步：管理这个容器（最常用的几条命令）

### 看有哪些容器在跑

```bash
docker ps            # 只看正在运行的
docker ps -a         # 看所有（包括已停止的）
```

```
CONTAINER ID   IMAGE       STATUS         PORTS                    NAMES
f9a8b7c6d5e4   mysql:8.4   Up 30 seconds  0.0.0.0:3306->3306/tcp   my-test-mysql
```

### 看容器日志（排错第一利器）

```bash
docker logs my-test-mysql          # 打印全部日志
docker logs -f my-test-mysql       # -f 持续跟踪（像 tail -f），Ctrl+C 退出
```

MySQL 首次启动要初始化，等日志里出现 `ready for connections` 才算真正能连了。**以后应用连不上数据库，第一反应就是 `docker logs` 看看它到底起没起好。**

### 钻进容器内部

```bash
docker exec -it my-test-mysql bash
```

- `exec` = 在**已运行**的容器里执行一条命令
- `-it` = 给我一个可交互的终端（i=interactive，t=终端）
- `bash` = 要执行的命令，这里是开一个 shell

进去后你就"站在容器内部"了，可以直接连 MySQL 验证库建好没：

```bash
mysql -uroot -prbac_root_123 -e "show databases;"
```

能看到列表里有 `rbac` 库，就证明第三步的 `-e MYSQL_DATABASE=rbac` 生效了。敲 `exit` 退出容器。

### 停止 / 启动 / 删除

```bash
docker stop my-test-mysql      # 停止（容器还在，数据还在，能再启动）
docker start my-test-mysql     # 重新启动刚才停的
docker rm my-test-mysql        # 删除容器（要先 stop；加 -f 可强制删运行中的）
```

> 🔑 分清两组"删"：`docker rm` 删的是**容器**，镜像还在（下次 run 秒起）；`docker rmi mysql:8.4` 才是删**镜像**。

---

## 五、一个关键实验：容器删了，数据去哪了？

这个实验能让你亲身体会到阶段 5 要讲的"数据持久化"为什么重要。跟着做：

1. 上面你已经起了 `my-test-mysql` 并确认有 `rbac` 库。
2. 现在把它删掉：`docker rm -f my-test-mysql`
3. 用**完全一样**的命令再 `docker run` 起一个新的。
4. 再进去 `show databases;`——你之前如果往库里加过表，会发现**全没了**。

为什么？因为刚才那条 `docker run` **没挂任何数据卷**，MySQL 的数据写在容器内部的可写层里，**容器一删，数据跟着灰飞烟灭**。

> 🔑 容器默认是"用完即弃"的，内部数据不持久。想让数据活过容器的生死，必须把数据目录挂到容器外面——这就是阶段 5 的**卷（volume）**。你现在项目里 `docker-compose.yml` 的 `mysql-data:/var/lib/mysql` 干的就是这件事。

---

## 六、和我们项目的关系：你刚才手动做的，compose 都替你做了

回头看项目 `deploy/docker-compose.yml` 里的 `mysql` 服务片段：

```yaml
  mysql:
    image: mysql:8.4                                    # 对应 docker run 的 mysql:8.4
    container_name: rbac-mysql                          # 对应 --name
    ports:
      - "3306:3306"                                     # 对应 -p 3306:3306
    environment:
      MYSQL_ROOT_PASSWORD: "${MYSQL_ROOT_PASSWORD:-rbac_root_123}"  # 对应 -e
      MYSQL_DATABASE: "${MYSQL_DATABASE:-rbac}"         # 对应 -e
    volumes:
      - mysql-data:/var/lib/mysql                       # 我们手动实验时"缺"的那块，持久化数据
```

看出来了吗？**compose 文件里的每个字段，几乎都能在你刚敲的 `docker run` 参数里找到对应。** compose 没有魔法，它只是把这些参数从"一长串命令行"搬进了"一个整洁的 yaml 文件"，还顺便管好了多个容器之间的关系。

> 🔑 学会读这张对应表，你就打通了从"原始 docker 命令"到"compose 配置"的任督二脉。后面几节都是在这张表上加东西。

---

## 动手练习（本节）

> 请全程在自己电脑上真敲。敲错了也没关系，`docker rm -f` 删掉重来即可，练的就是手感。

1. **走通全链路**：依次完成 —— `docker pull mysql:8.4` → 用第三节那条 `docker run` 起容器 → `docker ps` 确认在跑 → `docker logs` 看到 `ready for connections` → `docker exec -it` 进去 `show databases;` 看到 `rbac` 库 → `docker rm -f` 删掉。
2. **改端口映射**：把 `-p 3306:3306` 改成 `-p 13306:3306` 重新起一个，然后想想：现在要用什么地址端口才能连到它？（提示：宿主机那侧变了。）
3. **感受"用完即弃"**：完成第五节的实验，亲眼看到删容器后数据消失。用一句话写下你的结论。
4. **查一条没讲过的命令**：敲 `docker stats`（看容器实时 CPU/内存占用），Ctrl+C 退出。以后想知道哪个容器吃资源就用它。

**自检问题**：

- `docker pull`、`docker run`、`docker exec`、`docker rm` 分别在干什么？
- `-p 8080:80` 里，哪个是宿主机端口，哪个是容器端口？访问时该用哪个？
- 为什么删掉容器后数据会丢？要想不丢该怎么办（关键词即可）？
- `docker rm` 和 `docker rmi` 删的东西有什么不一样？
- 对着 `docker-compose.yml` 的 `mysql` 服务，说出 `image`/`container_name`/`ports`/`environment` 各自对应 `docker run` 的哪个参数。

---

> 下一节（阶段 2）：MySQL、Redis 这种镜像是别人在 Docker Hub 上做好的，我们**直接拉来用**。可我们自己的后端、前端是自己写的代码，Docker Hub 上没有——它们是怎么变成镜像的？答案是 **Dockerfile**。我们会逐行精读 `backend/Dockerfile` 和 `frontend/Dockerfile`，看懂"多阶段构建"这个专业打包手法。

---

## 附：课堂答疑（阶段 1 实操中遇到的真实问题）

> 这些是学本节时真敲命令碰到的问题，记录在此方便回看。

### Q1. `docker run` 报 `port is already allocated`（端口已被占用）是为啥？

**现象**：手动 `docker run ... -p 3306:3306 ... mysql:8.4` 时报错：

```
Bind for 0.0.0.0:3306 failed: port is already allocated
```

**原因**：项目的 compose 早已把 `rbac-mysql` 起起来了（`docker ps` 能看到它 `0.0.0.0:3306->3306`），**宿主机的 3306 已经被它占走**。宿主机同一个端口不能同时给两个容器，第二个来抢就失败。冲突的是**宿主机那侧**的端口，容器内部的 3306 各在各的箱子里并不冲突。

**解法 A（推荐，即练习 2）**——换宿主机端口，两个容器就能并存：

```bash
docker rm -f my-test-mysql            # 先清掉那个"已创建但没跑起来"的残留
docker run -d --name my-test-mysql \
  -e MYSQL_ROOT_PASSWORD=rbac_root_123 -e MYSQL_DATABASE=rbac \
  -p 13306:3306 mysql:8.4             # 走宿主机 13306，连它就用 localhost:13306
```

**解法 B**——不需要项目那套就先停掉它让出 3306：`cd deploy && docker compose down`。

> 🔑 报错前若已打印出容器 ID，说明容器**被创建了、只是启动失败**，用 `docker ps -a` 能看到残留（STATUS 为 Created/Exited），要 `docker rm -f` 清掉，否则下次 `--name` 同名会冲突。

### Q2. `mysql-data:/var/lib/mysql` 里的 `mysql-data`，我在服务器项目目录里为啥找不到？

因为 `mysql-data`（开头没有 `/` 也没有 `./`）**不是一个目录，而是"命名卷"的名字**——一块由 Docker 托管的存储区，不在你的项目目录里。靠"左边长什么样"区分两种挂载：

| 左边写法 | 类型 | 存在哪 | 项目目录能 `ls` 到吗 |
|----------|------|--------|----------------------|
| `mysql-data`（纯名字，无斜杠） | **命名卷** | Docker 自己的地盘 | ❌ |
| `./config/mysql/init`（`./` 或 `/` 开头） | **bind mount** | 你写的那个真实路径 | ✅ |

命名卷实际落在 Docker 数据根目录下（Linux 服务器：`/var/lib/docker/volumes/<卷全名>/_data`），且 compose 会加项目名前缀——本项目 `name: rbac-server`，故全名是 `rbac-server_mysql-data`。查看（只读、安全）：

```bash
docker volume ls                              # 能看到 rbac-server_mysql-data
docker volume inspect rbac-server_mysql-data  # 输出里的 Mountpoint 就是真实物理路径
```

> Mac 上进不去 `/var/lib/docker/`，因为引擎跑在隐藏的 Linux 虚拟机里，只能用 `docker volume inspect` 看。这正是命名卷的好处：**跨系统都用同一个名字引用，不管底层路径。**
>
> 🔑 记法：**"我不想管、交给 Docker 存的数据"用命名卷；"我要自己编辑、要进 git 的文件"用 bind mount。**（阶段 5 主线）

### Q3. 那冒号右边的 `/var/lib/mysql` 到底指什么？

**指容器内部的一个目录**——MySQL 存放全部数据库文件（库、表、`ibdata1` 等）的默认位置，这是 MySQL 官方镜像的约定。

一行挂载 `左边:右边` = `外部存储 : 容器内路径`，中间的冒号表示"把左边这块外部存储**盖到**容器内部右边这个目录上"。于是 MySQL 以为在往 `/var/lib/mysql` 写（它毫不知情），字节其实落进了外面的命名卷。**容器删了，这个目录随容器没了，但数据早写进卷里，卷还在 → 数据还在。**

验证里面真有东西：

```bash
docker exec -it rbac-mysql ls -lh /var/lib/mysql   # 能看到 ibdata1、mysql/、rbac/ 等
```

> 🔑 **冒号右边永远是"容器里面的某个目录"**，含义固定；变的只是左边（数据存哪 / 挂的是哪份外部东西）。同理 `./config/mysql/init:/docker-entrypoint-initdb.d`：右边是 MySQL"首次启动自动执行 .sql"的约定目录，左边是你放 `01-init.sql` 的真实目录。
