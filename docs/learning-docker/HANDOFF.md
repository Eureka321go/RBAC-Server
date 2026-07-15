# Docker-Compose 学习 · 交接文档（HANDOFF）

> 用途：记录这套 docker-compose 学习文档的进度、约定和下一步，方便**换一个新会话**时无缝继续。
> 下次开新对话，把这份文档发给我（或让我读它）即可对齐上下文。

最后更新：2026-07-14

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
| `06-分层profile与生产反代HTTPS.md` | `profiles` 分层、应用层、Caddy 自动 HTTPS、`expose` vs `ports` | ⬜ **下一节，从这里开始** |
| `07-运维实战与排错.md` | 常用命令、看日志、进容器、更新上线、常见坑 | ⬜ 待写 |
| `附录-命令速查表.md` | docker/compose 命令一页速查 | ⬜ 待写 |

> 可选提速：00+01 已分开写；若学习者想快，06+07 可考虑合并。默认按上表逐节推进。

---

## 五、下一步：写阶段 6

**动笔前先 `Read`**：`deploy/docker-compose.yml`（`nginx`/`rabbitmq` 的 `profiles: ["extra"]`、`kafka`/`elasticsearch`/`kibana` 的 `profiles: ["full"]`、`frontend` 的 `expose`、`caddy` 服务段）、`deploy/config/caddy/Caddyfile`、`frontend/nginx.conf`。

**阶段 6 要讲透的点**：
- **`profiles` 分层**：核心层（无 profile，默认起）/ `extra` / `full` 三层；`--profile extra up -d` 的用法；为什么要分层（按需启动，别让开发机跑满 ES+Kafka）。注意 compose 文件头部第 6-16 行的注释已经把分层和命令写清楚了，可直接引用。
- **`expose` vs `ports`**：`frontend` 只 `expose: "80"`（仅内网）、`caddy` 才 `ports: "80:80"/"443:443"`（唯一对外入口）。**`04` 已经把"`ports` 是对外开窗户、不是对内开门"讲透并明确预告了 `06` 深入**，这里要把它推到"纵深防护"的高度：backend 连 expose 都没有 → frontend 只 expose → caddy 才对外。
- **Caddy 自动 HTTPS**：读 `Caddyfile`；`caddy-data:/data` 持久化证书避免 Let's Encrypt 限流（**`05` 第六节已经讲了这个卷和 LE 限流，这里承接展开**）。
- 应用层三个服务（backend/frontend/caddy）为何不带 profile——它们跟核心层一起起。

**阶段 5 已还清的扣**：丢数据实验、卷的真实位置、`MYSQL_DATABASE` 不生效、`down` vs `down -v` 实验，四笔全部讲完，无遗留。

**再往后（阶段 7）预留要点**：常用命令汇总、看日志、进容器、更新上线流程（呼应 `docs/09-部署上线指南.md`、`docs/ops/`）、常见坑排错。

---

## 六、学习者已实操到的状态 & 已解答的疑问

- 环境：Mac mini，Docker Desktop 已装好可用。**项目的 `rbac-mysql`、`rbac-redis` 正在跑**（compose 已 up，占用宿主机 3306/6379）。
- 已亲手做过阶段 1 的 `docker run mysql`，踩到并理解了**端口冲突**（3306 被项目占用 → 换 13306）。
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
