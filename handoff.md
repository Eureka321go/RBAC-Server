# RBAC 系统 —— 部署交接文档（handoff）

> 更新时间：2026-07-14
> 用途：记录部署当前进度、线上环境、待办与恢复方法，便于下次继续。
> 完整原理与步骤见 `docs/09-部署上线指南.md`（第八节实战记录、第九节踩坑）。

---

## 一、当前状态：✅ 已上线跑通

前后端 + 中间件已通过 Docker Compose 部署到阿里云轻量服务器，**admin 可正常登录**。

- 访问地址：`http://106.15.89.180`
- 四容器运行中：`rbac-mysql` / `rbac-redis` / `rbac-backend` / `rbac-frontend`

---

## 二、线上环境速查

| 项 | 值 |
|----|----|
| 服务器 | 阿里云轻量应用服务器，Ubuntu 24.04 |
| 公网 IP | `106.15.89.180` |
| SSH | `ssh root@106.15.89.180`（密码登录） |
| 代码目录 | `/root/project/RBAC-Server` |
| 部署分支 | `feat/rbac-mvp` |
| 编排文件 | `deploy/docker-compose.yml`（起 mysql+redis+backend+frontend） |
| 镜像加速器 | `/etc/docker/daemon.json` → `https://docker.m.daocloud.io` |
| 代码来源 | GitHub 私有库 + 服务器 Deploy Key（只读）|
| 对外端口 | 仅 80（防火墙放行 22/80，未开 3306/6379）|

---

## 三、代码提交状态

- ✅ **已提交并 push（线上跑的就是这些）**
  - `e47cd61` 部署文件：Dockerfile / compose / nginx / application.yml 环境变量化
  - `6ede998` 文档：docs/09 实战+踩坑、本 handoff
- ⏳ **本地未提交（与部署无关，一直没动）**
  - 5 个 Java config：`AuditMetaObjectHandler` / `LocaleConfig` / `MybatisPlusConfig` / `RedisConfig` / `LoginUser`（**你的独立 WIP**）
  - `deploy/config/nginx/nginx.conf`（旧的 profile-extra 用，非线上必需）
  - `docs/learning/07-…学习路线.md`（未跟踪）

---

## 四、日常运维命令（在服务器 `deploy/` 目录下）

```bash
cd /root/project/RBAC-Server/deploy
docker compose ps                      # 看容器状态
docker compose logs --tail=50 backend  # 看后端日志
docker compose restart backend         # 重启某个服务
docker compose down                     # 停全部（保留数据）
docker compose up -d                    # 起全部（不重新编译，快）
```

## 五、改了代码后怎么更新线上（标准循环）

```bash
# 1) 开发机：提交并推送
git add <改动> && git commit -m "..." && git push origin feat/rbac-mvp

# 2) 服务器：拉取并重建
cd /root/project/RBAC-Server && git pull origin feat/rbac-mvp
cd deploy && docker compose up -d --build   # 有代码改动才加 --build
```

> 若服务器 `git pull` 报 divergent，部署机无本地改动，直接 `git reset --hard origin/feat/rbac-mvp`。

---

## 六、下次可继续的待办（按优先级）

1. **[安全] 换掉默认密码**（当前仍是 `rbac_123` / `rbac_redis_123` / 默认 JWT secret）。
   做法：服务器 `deploy/` 下建 `.env` 填强密码（`MYSQL_PASSWORD` / `REDIS_PASSWORD` / `RBAC_JWT_SECRET`），`docker compose down && up -d`。⚠️ MySQL 改密码需先清旧数据卷或进容器改，注意别丢数据。
2. **[访问] 配域名 + HTTPS**：域名解析到 IP，nginx 挂 Let's Encrypt 证书（或用 Caddy 自动签），改走 `https://`，防火墙加 443。
3. **[稳定] 给 backend 加 healthcheck**，让编排能感知后端就绪/自愈。
4. **[整理] 决定 5 个 Java WIP 去留**：由你判断是否单独成一次提交。
5. **[进阶] CI/CD**：GitHub Actions 构建镜像推仓库，服务器只 `pull`，免每次现场编译（首次编译约 13 分钟）。

---

## 七、下次开场怎么说

直接告诉我要做哪条待办即可，例如：
- 「帮我把线上默认密码换成强密码」
- 「帮我给这台服务器配域名和 HTTPS」
- 「我改了后端代码，帮我更新到线上」

我会自动加载部署记忆，接着这份文档继续。
