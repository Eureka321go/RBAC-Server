# Docker-Compose 学习 · 交接文档（HANDOFF）

> 用途：记录这套 docker-compose 学习文档的进度、约定和下一步，方便**换一个新会话**时无缝继续。
> 下次开新对话，把这份文档发给我（或让我读它）即可对齐上下文。

最后更新：2026-07-15

---

## 一、这是在做什么

给**基本零 Docker 基础**的学习者写一套 docker-compose 学习文档，**以本项目真实的 `deploy/` 配置为教材**逐块精读，风格对齐已有的 `docs/learning-spring-boot/`。文档放在 `docs/learning-docker/`。

完整计划（含每节大纲、教学点）见：`~/.claude/plans/declarative-nibbling-island.md`。

---

## 二、学习者偏好（重要，务必遵守）

- **零 Docker 基础**：概念要从头讲，但使用准确的技术定义和项目实例，不使用做菜、宴席、集装箱等生活化类比。
- **教学方式**：精读本项目 `deploy/docker-compose.yml`、`backend/Dockerfile`、`frontend/Dockerfile`、`deploy/config/*`，不写抽象教程。
- **每节带练习**：文档末尾要有 2-4 个动手练习 + 自检问题。
- **节奏**：**一次只写一节，写完停下等确认**，再写下一节。别一口气全写完。
- **语言**：面向学习者的解释全用简体中文；命令、字段名、文件路径保持原样。
- **答疑要存档**：学习者实操中问的真实问题，整理成"课堂答疑"追加到对应章节末尾（见 `01` 的示例）。

---

## 三、每节文档统一模板（对齐 learning-spring-boot 风格）

参考 `docs/learning-spring-boot/00-项目全局地图.md`。每节固定包含：

1. 开头：一句话学习目标 +「读完你能……」。
2. 先给出技术定义、执行模型和使用边界，再用本项目配置证明。
3. 本项目实证：贴 `deploy/` 真实片段，**逐行讲每个字段为什么这么写**（不虚构示例，动笔前先 `Read` 真实文件核对）。
4. 使用“概念/字段↔本项目配置↔实际作用”对照表。
5. 关键结论用 `> 🔑` 引用块突出。
6. 末尾：动手练习 + 自检问题。
7. 承上启下：预告下一节。
8. 最后加 `## 附：答案与解析`，用 `<details>` 折叠逐题作答（避免滚动时剧透）。见 `03` 的示例。

---

## 四、进度总览

| 文件 | 主题 | 状态 |
|------|------|------|
| `00-为什么需要Docker与Compose.md` | 全局地图、镜像/容器/仓库/compose 概念、`deploy/` 鸟瞰 | ✅ 已完成 |
| `01-Docker基础-镜像容器仓库.md` | `docker pull/run/ps/logs/exec/rm`、端口映射、手动跑 mysql、数据丢失实验、+课堂答疑3条 | ✅ 已完成 |
| `02-Dockerfile精读-把应用打成镜像.md` | 多阶段构建、逐行读 backend/frontend Dockerfile、构建缓存、`build:`↔`docker build` | ✅ 已完成 |
| `03-Compose入门-第一个服务.md` | compose 是什么、四个顶层键、逐字段对回 `docker run`、`restart`/`command`、`.env` 变量替换 `${VAR:-默认}`、`config`/`up`/`ps`/`logs`/`down` | ✅ 已完成 |
| `04-服务编排-网络依赖与健康检查.md` | 自定义 `networks`、服务名即 DNS、`ports` vs 内网互通、`healthcheck` 四字段、`depends_on` 两种写法对比、启动时序 | ✅ 已完成 |
| `05-数据持久化-卷与配置挂载.md` | 命名卷 vs bind mount、卷的真实位置、`initdb.d` 只在空目录时跑、"出厂设置 vs 运行时配置"、`:ro`、`down` vs `down -v` 实操实验 | ✅ 已完成（**前面欠的 4 个扣已全部还清**） |
| `06-分层profile与生产反代HTTPS.md` | `profiles` 判定规则/三种激活方式、`config --services` 预演、nginx↔caddy 抢 80、`expose` 是纯声明、三级递减暴露面、Caddyfile 逐行、ACME HTTP-01 与 80 端口的两个用途、`caddy-data` 与 LE 限流、两个 nginx.conf 的考古 | ✅ 已完成（**compose 文件 214 行至此全部读完**） |
| `07-运维实战与排错.md` | 按"想知道什么"反查命令、`logs`+`ps -a` 两步定位、Alpine 没 bash、`up -d` 增量比对、`--build` 判据、`system df` 与磁盘考古（**挖出 01 实验的孤儿匿名卷**）、症状→怎么查清单、收掉 mysql/redis ports 与防火墙两根弦 | ✅ 已完成（正文七节全部结束） |
| `附录-命令速查表.md` | 按场景分组速查（只记两条/看状态/看日志/进容器/起停/构建上线/清理/症状→怎么查/本项目速查/红区），每条带回指 | ✅ 已完成 |

> 🎉 **全系列（00-07 + 附录）已全部写完。**

---

## 五、下一步：只剩一笔勘误 + 后续维护

**全系列已写完，没有"下一节"了。** 新会话接手时，工作模式从"写新章节"切换为**维护**：

1. **答疑存档**（主要模式）：学习者实操中问的真实问题 → 整理成「课堂答疑」追加到对应章节末尾（`01`、`03` 有现成示例）。
2. **随项目更新**：`deploy/` 配置变了（比如做了下面第 3 条、或加了 `docker-compose.override.yml`），对应章节的引用片段和行号要跟着核对。
3. **`07` 第八节埋的伏笔**：`handoff.md` 待办 #1（换默认密码）真做了之后，`07` §8.3 那条"公网上跑着 `rbac_123`"的证据链就该更新。

**⚠️ 唯一一笔明确待办：`05` 有一处机制讲错了，`07` 已经修正，但 `05` 本身还没打补丁。**

- **错在哪**：`05` 第二节 + 自检答案 2、9 说"`01` 实验的数据丢在**容器可写层**"。实际上 `mysql:8.4` / `redis:7.4` 镜像都声明了 `VOLUME`（`docker image inspect mysql:8.4 --format '{{json .Config.Volumes}}'` → `{"/var/lib/mysql":{}}`），所以数据其实进了**自动创建的匿名卷**；`docker rm` 后卷成了**孤儿**，数据没被删、还占着磁盘。
- **结论不受影响**（重新 run 会新建另一个匿名卷 → 表现仍是"数据没了"），但机制和后果都更糟（永久垃圾）。
- **证据在学习者本机**：`docker volume ls` 里那两个哈希卷（创建于 2026-07-14 07:37 和 07:43，正是做 `01` 实验的时间），里面是完整 MySQL 数据目录含 `rbac` 库，共约 205MB。
- `07` 第 6.3-6.4 节已把这段写成"考古"高潮并明确指出 `05` 不准。**建议给 `05` 加一个指向 `07` 的勘误提示**（学习者已知悉此事，等他决定）。
- 对照组：`caddy:2.8` 的 `Config.Volumes` 是 `null`，所以 `06` 讲的"不挂 `caddy-data` 证书就没了"才是真·可写层丢失。

**已还清、无遗留**：`06` 留的两根弦（mysql/redis 的 `ports` 暴露面、防火墙这道 compose 之外的防线）已由 `07` 第八节收掉，并串起了 `handoff.md` 待办 #1（线上仍是默认密码 `rbac_123`）+ `docs/ops/01` 第 43 行（服务器没 `.env`，走 compose 兜底默认值）这条完整证据链。

---

## 六、学习者已实操到的状态 & 已解答的疑问

- 环境：Mac mini，Docker Desktop 已装好可用（`docker compose` 版本 v5.2.0）。**本地只跑着 `rbac-mysql`、`rbac-redis` 两个容器**（占用宿主机 3306/6379），backend/frontend/caddy **本地没跑**——虽然它们不带 profile、`config --services` 默认就列出 5 个。写练习时注意：**本地做不了 caddy 相关的实操**（`06` 因此把 caddy 练习都设计成思考题，实操只用 `config` 和 nginx）。
- 已亲手做过阶段 1 的 `docker run mysql`（做了两次），踩到并理解了**端口冲突**（3306 被项目占用 → 换 13306）。**那两次实验留下的匿名卷仍在本机**，是 `07` 考古那一节的实物证据，学习者可能会问"要不要删"（可删，占 205MB，纯纪念品）。
- 本机镜像现状（写 `07` 时实测）：`mysql:8.4`、`redis:7.4`、一个 1.12GB 的悬空镜像（`<untagged>`，`rbac-mysql` 正基于它跑），外加**写 `07` 时为验证 Alpine 无 bash 而 pull 的 `caddy:2.8`**（69MB，`07` 练习 4 会用到，留着有用）。
- 已解答并存档在 `01` 答疑区的三个问题：
  1. `port is already allocated` 端口冲突原因与解法。
  2. `mysql-data` 为何在项目目录找不到 → 命名卷 vs bind mount。
  3. 冒号右边 `/var/lib/mysql` 是容器内路径、挂载"左盖右"的语义。
- 口头解答过（未存档，阶段 5 可自然带过）：**代码不会自动进镜像，全靠 `COPY` + 构建上下文（`build.context`）**。
- 已存档在 `03` 答疑区的问题：
  - Q1：`backend` 的 `environment` 是不是 `ENTRYPOINT ["java","-jar","app.jar"]` 的运行参数？→ 不是。环境变量 ≠ 命令行参数；`java -jar app.jar` 一字未变，是 Spring Boot 主动读环境变量（`application.yml` 里的 `${DB_HOST:localhost}`）。文档里画了 `.env` → compose 替换 → 容器 env → Spring 占位符解析的**三段接力图**，并对比了 Compose 的 `${VAR:-默认}` 与 Spring 的 `${VAR:默认}` 差一个 `-`。

---

## 七、验证方式（写完各节后可选做）

- 文档引用的 `docker-compose.yml`/`Dockerfile`/`.env`/`Caddyfile` 片段，逐字段与仓库实际文件核对一致。
- 实机：`cd deploy && docker compose config` 可解析确认；默认栈 `up -d` 后 `docker compose ps` 应列出 mysql/redis/backend/frontend/caddy，其中 mysql/redis 最终应显示 `healthy`。
