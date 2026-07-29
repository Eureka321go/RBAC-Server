# 阶段 2 · Dockerfile 精读：把后端 / 前端打成镜像

> 目标：搞懂"我们自己写的代码，是怎么变成一个能跑的镜像的"。
> 读完你能：逐行看懂 `backend/Dockerfile` 和 `frontend/Dockerfile`，理解**多阶段构建**为什么能把镜像做小，并说清 `docker build` 和阶段 1 的 `docker pull` 有什么本质区别。

---

## 一、先补上阶段 1 留的一个缺口

阶段 1 里，MySQL、Redis 的镜像我们是 `docker pull mysql:8.4` **直接从 Docker Hub 下载**的——因为这些是通用软件，官方早做好了。

可是你项目的**后端**（一个 Spring Boot 应用）和**前端**（一个 Vue 项目）是你自己写的代码，Docker Hub 上不可能有。那它们怎么变成容器能用的镜像？

答案是：**你自己写一份"打包说明书"，让 Docker 照着做出一个镜像。** 这份说明书就叫 **Dockerfile**。

| 来源 | 怎么得到镜像 | 例子 |
|------|--------------|------|
| 通用软件 | `docker pull` 别人做好的 | `mysql:8.4`、`redis:7.4`、`nginx:1.27` |
| 自己的代码 | 写 `Dockerfile` + `docker build` 自己做 | `rbac-backend`、`rbac-frontend` |

> 🔑 Dockerfile 是"怎么把我的代码 + 运行环境，一步步烤成一个镜像"的**食谱**。`docker build` 就是照食谱开火烤。烤出来的成品（镜像）才能像阶段 1 那样 `docker run` 成容器。

---

## 二、Dockerfile 长什么样：几个核心指令

Dockerfile 就是一个纯文本文件，一行一条指令，从上往下执行。先认识最常用的几个（下面精读时全会遇到）：

| 指令 | 干什么 | 大白话 |
|------|--------|--------|
| `FROM` | 指定"从哪个基础镜像开始" | 先找一个半成品打底，别从零开始 |
| `WORKDIR` | 设定之后命令的工作目录 | "cd 到这个目录再干活" |
| `COPY` | 把宿主机的文件拷进镜像 | 把你的代码搬进去 |
| `RUN` | 在**构建镜像时**执行一条命令 | 烤的过程中做一步（如编译、装依赖） |
| `EXPOSE` | 声明容器会用哪个端口 | 一个"文档式"标注（不等于开端口） |
| `ENTRYPOINT` / `CMD` | 容器**启动时**默认跑什么命令 | 成品端上桌后，第一口怎么吃 |

⚠️ 特别注意一个初学最容易混的点：**`RUN` 是"造镜像时"执行，`ENTRYPOINT`/`CMD` 是"容器跑起来时"执行**。前者是烤的过程，后者是端上桌之后。后面精读会反复印证。

---

## 三、精读 `backend/Dockerfile`（后端，多阶段构建）

打开 `backend/Dockerfile`，全文就 15 行，但设计得很讲究。它分成**两个阶段**，我们分段看。

### 第一阶段：构建（用 Maven 打出 jar）

```dockerfile
# ---- 构建阶段：用 Maven 打出可执行 jar ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# 阿里云 Maven 镜像，加速依赖下载
COPY settings.xml /root/.m2/settings.xml
COPY pom.xml .
COPY src ./src
RUN mvn -B clean package -DskipTests
```

逐行拆：

- **`FROM maven:3.9-eclipse-temurin-21 AS build`**
  打底用一个**已经装好 Maven 3.9 + JDK 21** 的官方镜像。为什么要它？因为编译 Java 代码需要完整的 JDK 和 Maven 工具链。末尾 `AS build` 是给这个阶段**起个名字叫 `build`**，第二阶段要用到这个名字（记住它）。
- **`WORKDIR /app`**
  之后的操作都在镜像里的 `/app` 目录进行（相当于 `cd /app`，目录不存在会自动建）。
- **`COPY settings.xml /root/.m2/settings.xml`**
  把项目里的 `settings.xml`（配了阿里云 Maven 镜像源）拷进 Maven 的配置位置，这样下依赖走国内源，快得多。
- **`COPY pom.xml .` 和 `COPY src ./src`**
  把依赖清单 `pom.xml` 和源代码 `src/` 拷进镜像的 `/app` 下。`.` 就是当前 `WORKDIR`（`/app`）。
- **`RUN mvn -B clean package -DskipTests`**
  **在构建镜像的过程中**真正执行 Maven 打包：`-B` 批处理模式（不搞交互，日志干净），`-DskipTests` 跳过测试（部署镜像时通常测试已在别处跑过，这里图快）。这一步跑完，`/app/target/` 下就生成了可执行的 jar 包。

> 到这里，第一阶段的"产物"只有一个我们要的东西：那个 **jar 包**。但这个 `build` 镜像本身很**臃肿**——它装了整套 Maven、JDK、下载的一堆依赖缓存、源码……几百 MB 甚至上 G。这些**运行时根本用不到**。

### 第二阶段：运行（精简 JRE 跑 jar）

```dockerfile
# ---- 运行阶段：精简 JRE 跑 jar ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/rbac-server-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

逐行拆：

- **`FROM eclipse-temurin:21-jre`**
  **重新**用一个干净的、只有 **JRE**（Java 运行环境，不含编译工具）的小镜像打底。注意：又出现一个 `FROM`，这就开启了**第二个阶段**，和上面的 `build` 阶段是两个独立的"房间"。为什么用 JRE 而不是 JDK？因为运行 jar 只需要 JRE，JRE 比 JDK 小很多。
- **`WORKDIR /app`**
  第二阶段是全新的镜像，工作目录要重新设。
- **`COPY --from=build /app/target/rbac-server-0.0.1-SNAPSHOT.jar app.jar`** ← **全篇最关键的一行**
  `--from=build` 的意思是：**从刚才那个 `build` 阶段里，把它的产物拷过来**。这里只拷了那一个 jar 包，重命名为 `app.jar`。**Maven、JDK、源码、依赖缓存……那些臃肿的东西一律不带过来。**
- **`EXPOSE 8080`**
  声明这个应用会监听 8080（Spring Boot 默认端口）。注意 `EXPOSE` 只是个**文档标注**，不会真的把端口开给外界——真正对外还得靠 `docker run -p` 或 compose 的 `ports:`（阶段 1 讲过）。
- **`ENTRYPOINT ["java", "-jar", "app.jar"]`**
  定义容器**启动时**默认执行的命令：`java -jar app.jar`，也就是把后端跑起来。这行**不是**构建时执行的，是等你 `docker run` 这个镜像时才执行。

### 为什么要分两个阶段？—— 多阶段构建的精髓

用一张图看清楚：

```
  阶段 build（临时的、臃肿的）              阶段 2（最终的、精简的）
 ┌───────────────────────────┐           ┌──────────────────────────┐
 │ maven + JDK21             │           │ 只有 JRE21               │
 │ 源码 src/                 │  只把 jar  │ app.jar  ◄───────────────┼── COPY --from=build
 │ 一堆依赖缓存               │  拷过去 →  │                          │
 │ 编译产物 target/xxx.jar    │           │ ENTRYPOINT java -jar ... │
 └───────────────────────────┘           └──────────────────────────┘
        构建完就被丢弃                         这个才是最终镜像 rbac-backend
        （不进最终镜像）
```

> 🔑 **多阶段构建的核心思想：编译需要重工具（Maven+JDK），运行只需轻环境（JRE）。用第一个阶段做完编译、只把成品 jar 拎进第二个干净阶段，最终镜像就只剩"JRE + 一个 jar"，又小又干净。** 那个臃肿的 build 阶段构建完就被丢弃，不会进最终镜像。
>
> 好处很实在：镜像从可能 800MB+ 缩到 200MB 上下——传得快、起得快、攻击面还小（不含编译器等无关软件）。

---

## 四、精读 `frontend/Dockerfile`（前端，同样的套路）

前端 `frontend/Dockerfile` 用的是**一模一样的多阶段思路**，只是工具换成了前端的：

```dockerfile
# ---- 构建阶段：npm 打出静态文件 ----
FROM node:22 AS build
WORKDIR /app
# npm 走国内镜像，加速依赖下载
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
RUN npm ci
COPY . .
# build-only 只跑 vite build（跳过 type-check，首次部署更省心）
RUN npm run build-only

# ---- 运行阶段：nginx 发静态文件 + 反代后端 ----
FROM nginx:1.27
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

对着后端的理解来看，你应该能自己读懂大半了。挑几个关键点和"不一样的地方"讲：

- **`FROM node:22 AS build`**：前端要用 Node.js + npm 来打包，所以打底用 `node:22`，同样起名 `build`。
- **`RUN npm config set registry https://registry.npmmirror.com`**：把 npm 源换成国内镜像，加速下依赖（和后端换 Maven 阿里云源一个道理）。
- **`COPY package*.json ./` 然后 `RUN npm ci`**：**先只拷依赖清单再装依赖，最后才 `COPY . .` 拷全部源码**——这个顺序不是随便排的，是为了吃到"构建缓存"（下一节专门讲）。`npm ci` 是按锁文件精确安装依赖。
- **`RUN npm run build-only`**：真正执行前端打包，产物是一堆静态文件，落在 `/app/dist`。
- **第二阶段 `FROM nginx:1.27`**：前端打包出来的是**纯静态文件**（HTML/CSS/JS），不需要 Node 运行，只要一个 Web 服务器发出去就行——所以第二阶段换成轻量的 **nginx**。
- **`COPY nginx.conf /etc/nginx/nginx.conf`**：把项目里的 nginx 配置拷进去（它负责发页面 + 把 `/api` 反代给后端，阶段 6 细讲）。
- **`COPY --from=build /app/dist /usr/share/nginx/html`** ← 又是那关键的一行：从 `build` 阶段只把打包好的 `dist/` 静态文件拷进 nginx 的网站根目录。Node、node_modules、源码统统不带。
- 注意前端这份**没有 `ENTRYPOINT`/`CMD`**：因为 `nginx:1.27` 基础镜像**自带**了启动 nginx 的默认命令，我们不用重复写。

> 🔑 两份 Dockerfile 是**同一个模式的两次运用**：`重工具阶段编译 → 只把产物拷进轻运行阶段`。后端是 `Maven/JDK → JRE+jar`，前端是 `Node/npm → nginx+静态文件`。看懂一个，另一个自然通。

---

## 五、`docker build`：怎么用这份食谱烤出镜像

Dockerfile 写好后，用 `docker build` 来执行它。在项目里，这一步其实是 compose 帮你做的（阶段 3 讲），但先看清底层命令：

```bash
# 在 backend/ 目录下（这里有 Dockerfile）
docker build -t rbac-backend .
```

- `-t rbac-backend`：给烤出来的镜像**起名（tag）**叫 `rbac-backend`。
- 最后那个 `.`：叫**构建上下文**，指"把当前目录作为构建的素材来源"。Dockerfile 里 `COPY pom.xml .` 能拷到东西，就是因为它从这个上下文目录里找文件。

对照项目 `deploy/docker-compose.yml`，后端服务是这么写的：

```yaml
  backend:
    build:
      context: ../backend      # 到 backend/ 目录，用那里的 Dockerfile 构建
    image: rbac-backend        # 构建出的镜像叫这个名
```

看到了吗——compose 里的 `build:` 就等价于你手动 `docker build`；`image:` 就等价于 `-t`。**这又是一次"手动命令 ↔ compose 字段"的对应**，和阶段 1 结尾那张表一脉相承。

> 🔑 `image: mysql:8.4` = 直接用现成镜像（pull）；`build: ...` = 用 Dockerfile 现场烤一个。你项目里 `mysql/redis/caddy/nginx` 是前者，`backend/frontend` 是后者。

---

## 六、构建缓存：为什么 `COPY` 的顺序有讲究

回头看两份 Dockerfile 一个共同的细节：**都先拷依赖清单、装依赖，最后才拷全部源码**。

```dockerfile
COPY pom.xml .          # 后端：先拷 pom
RUN mvn ... package     #        再打包（含下依赖）
```

```dockerfile
COPY package*.json ./   # 前端：先拷 package.json
RUN npm ci              #        再装依赖
COPY . .                #        最后才拷源码
```

原因是 Docker 构建有**分层缓存**：Dockerfile 每一条指令生成镜像的一层，**只要这条指令和它上面的都没变，Docker 就直接复用上次的缓存层，不重跑**。

依赖清单（`pom.xml`/`package.json`）不常变，源码天天改。把"装依赖"放在"拷源码"**前面**，意味着：你改了业务代码但没动依赖时，重新 build 会**命中依赖层的缓存**，跳过漫长的下依赖，只重跑后面的编译——快非常多。

要是反过来先 `COPY . .` 再装依赖，那你每改一行代码，缓存就从拷源码那层开始全部失效，每次都得重新下一遍依赖，慢到怀疑人生。

> 🔑 **变动少的放前面，变动多的放后面**——这是写 Dockerfile 的黄金顺序，专门为了最大化利用构建缓存。你项目这两份 Dockerfile 都遵守了。

---

## 动手练习（本节）

> 这节可以只读不敲（构建后端要下不少依赖，耗时）；想动手就挑 1、4 做。

1. **看懂两份文件的对称性**：把 `backend/Dockerfile` 和 `frontend/Dockerfile` 并排打开，在纸上填这张表：
   | | 后端 | 前端 |
   |---|---|---|
   | 构建阶段基础镜像 | ? | ? |
   | 构建工具 | Maven | ? |
   | `--from=build` 拷的产物是什么 | ? | ? |
   | 运行阶段基础镜像 | ? | ? |
2. **找关键行**：在两份文件里各自圈出那行 `COPY --from=build ...`，用一句话说清它"从哪拷、拷什么、丢下了什么"。
3. **想清楚 RUN vs ENTRYPOINT**：后端的 `RUN mvn ... package` 和 `ENTRYPOINT ["java","-jar","app.jar"]`，哪个是"造镜像时"跑的、哪个是"容器启动时"跑的？
4.（可选，耗时）**真构建一次前端镜像**：`cd frontend && docker build -t my-frontend-test .`，构建完 `docker images` 看看 `my-frontend-test` 多大。再和 `node:22` 基础镜像的大小对比，感受多阶段构建"瘦身"的效果。练完 `docker rmi my-frontend-test` 删掉。

**自检问题**：

- 为什么 MySQL 用 `image: mysql:8.4` 而后端用 `build:`？两者得到镜像的方式有何不同？
- 用自己的话解释"多阶段构建"，以及它为什么能让镜像变小。
- `--from=build` 里的 `build` 是从哪来的？（提示：看第一个 `FROM` 那行的结尾。）
- 为什么两份 Dockerfile 都"先拷依赖清单、装依赖，最后才拷源码"？和什么机制有关？
- `EXPOSE 8080` 会让外界直接能访问 8080 吗？不能的话真正对外靠什么？

---

> 下一节（阶段 3）：前面两节我们把"单个容器"（阶段 1）和"自己的镜像怎么来"（阶段 2）都打通了。从这节起正式进入 **Compose**——我们会写出/读懂第一个服务（`mysql`），搞清 `docker-compose.yml` 的基本骨架，以及 `.env` 文件里的密码是怎么被 `${...}` 语法读进来的。
