# 运维：域名与 HTTPS 配置（Caddy 自动证书）

> 更新时间：2026-07-14
> 适用环境：阿里云轻量服务器 `106.15.89.180`，Docker Compose 部署
> 域名：`www.eureka32.top`（已 ICP 备案）
> 关联文档：`docs/09-部署上线指南.md`、根目录 `handoff.md`（待办 #2）

---

## 一、目标与架构

让 `https://www.eureka32.top` 能带「锁」访问后台，HTTP 自动跳 HTTPS。

在现有前端 nginx 前面加一层 **Caddy** 作为唯一对外入口：

```
外网:443 (HTTPS) ─► Caddy ─(内网 http)─► frontend(nginx) ─► /api ─► backend
     :80  (HTTP) ─► Caddy 自动 301 跳 443
```

- **Caddy 只做两件事**：自动申请/续期 Let's Encrypt 证书 + TLS 终结，然后把流量转发给 frontend 容器。
- **frontend 容器不动**：继续发 SPA 静态文件、反代 `/api`，只是从「对外」改成「内网 expose」。
- **前端无需重新构建**：代码走相对路径 `/api`，换域名/HTTPS 无影响。

---

## 二、概念澄清：Caddyfile vs 证书

| 东西 | 是什么 | 要不要手动申请 |
|------|-------|--------------|
| **Caddyfile** | 文本配置文件，声明「域名 → 转发到哪」 | ❌ 不用申请，写好放 `deploy/config/caddy/Caddyfile` 即可 |
| **HTTPS 证书** | 浏览器地址栏的「锁」，Let's Encrypt 免费签发 | ✅ 需要，但 **Caddy 启动时全自动申请 + 到期自动续**，无需人工干预 |

**前提**：Caddy 申请证书时，Let's Encrypt 会反向访问该域名做验证。所以**必须先让域名解析到服务器、80/443 端口开放，再部署**，否则证书申请失败。

---

## 三、涉及的文件（已入库）

### `deploy/config/caddy/Caddyfile`
```
www.eureka32.top {
    reverse_proxy frontend:80
}
```

### `deploy/docker-compose.yml`（关键改动）
- `frontend` 服务：`ports: ["80:80"]` → 改为 `expose: ["80"]`（收进内网）。
- 新增 `caddy` 服务：对外 `80:80` + `443:443`，挂载 Caddyfile，用 `caddy-data` / `caddy-config` 卷持久化证书。
- `volumes:` 新增 `caddy-data`、`caddy-config`。

> `caddy-data` 卷持久化证书，重建容器不会重新申请，避免触发 Let's Encrypt 限流。

---

## 四、操作步骤（按顺序，别跳）

### ① 配 DNS 解析（域名服务商控制台）
加一条 A 记录：
- 主机记录：`www`
- 类型：`A`
- 记录值：`106.15.89.180`

配完在本机验证解析生效：
```bash
ping www.eureka32.top   # 解析出 106.15.89.180 才继续
```

### ② 放行 443 端口
- 阿里云控制台 → 轻量服务器 → 防火墙 → 放行 `443/TCP`。
- 服务器上若开了 ufw：`ufw allow 443/tcp`。
- 80 保持开启（Let's Encrypt 验证要走）。

### ③ 部署（标准更新循环）
```bash
# 开发机：提交推送
git add deploy/ && git commit -m "feat: 接入 Caddy 自动 HTTPS" && git push origin feat/rbac-mvp

# 服务器：拉取重建
cd /root/project/RBAC-Server && git pull origin feat/rbac-mvp
cd deploy && docker compose up -d --build
```

### ④ 验证
```bash
docker compose ps                     # rbac-caddy 为 Up
docker compose logs --tail=40 caddy   # 出现 "certificate obtained successfully" = 成功
```
浏览器开 `https://www.eureka32.top`，有锁、能登录即完成；访问 `http://` 会自动跳 `https://`。

---

## 五、注意事项与坑

- **顺序**：DNS 必须先生效、端口先开，再部署。否则 Caddy 日志会反复报证书申请失败。
- **证书限流**：Let's Encrypt 每域名每周有签发上限。反复删 `caddy-data` 卷重建可能触发限流，正常运维不要删这个卷。
- **X-Forwarded-Proto**：Caddy → frontend 是内网 http，后端收到的协议头是 `http`。当前用 JWT 放请求头（非 Cookie），不受影响；日后若接入依赖「是否 HTTPS」的功能（Secure Cookie、生成绝对回调 URL），需在 nginx 层透传真实协议。
- **apex 域名**：本配置只覆盖 `www.eureka32.top`。若还想用裸域 `eureka32.top`，需另加一条 A 记录并在 Caddyfile 加一行域名。

---

## 六、完成后

把 `handoff.md` 待办 #2 标记为已完成，访问地址从 `http://106.15.89.180` 更新为 `https://www.eureka32.top`。
