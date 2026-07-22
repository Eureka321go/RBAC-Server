# MySQL 学习 · 交接文档（HANDOFF）

> 用途：记录这套 MySQL 学习文档的进度、约定和下一步，方便**换一个新会话**时无缝继续。
> 下次开新对话，把这份文档发给我（或让我读它）即可对齐上下文。

最后更新：2026-07-17

---

## 一、这是在做什么

给一位**会写 CRUD、但不懂原理**的学习者写一套 MySQL 学习文档，**目标是面试**。文档放在 `docs/learning-mysql/`，风格对齐已完结的 `docs/learning-docker/`（9 篇）和 `docs/learning-spring-boot/`（8 篇）。

完整计划见：`~/.claude/plans/mysql-docs-rippling-stearns.md`。

### 和前两套的根本差别（重要）

Docker 那套能"纯精读 `deploy/`"，因为 `deploy/` 自包含。**MySQL 不行**：

- **项目有真素材的**：20 张表 DDL、四表 JOIN（`SysMenuMapper`）、逻辑删除、`@Version` 乐观锁、14 处 `@Transactional`、数据权限过滤 SQL。
- **项目完全没有的**：EXPLAIN / 索引原理、事务隔离级别与锁、子查询 / 聚合、慢查询日志、`my.cnf`、备份、分库分表。**而这些正是面试考点的大头。**

所以本套的方法是**「考点为主线，项目真表当实验台」**：先讲原理 → 用项目真实表/SQL 证明 → 项目里没有的，用 `rbac_lab` 实验库灌数据亲手验。

---

## 二、学习者偏好（务必遵守）

- **会 CRUD，不懂原理**：不必从"表是什么"讲起，直接切原理。但 B+ 树、MVCC、ReadView 这些要从头讲清。
- **目标是面试**：每节必须有 `## 面试怎么问` 专栏（本套相对 Docker 系列**新增**的固定栏目）。
- **不用生活化类比**：不用做菜、宴席、集装箱这类比方，用准确技术定义和项目实例。
- **节奏：一次只写一节，写完停下等确认**，别一口气全写完。
- **语言**：解释全用简体中文；命令、字段名、文件路径保持原样。
- **不虚构**：贴的每个片段动笔前先 `Read` 核对；贴的每条命令输出必须**实跑过**。
- **答疑要存档**：学习者实操中问的真实问题 → 整理成「课堂答疑」追加到对应章节末尾。

---

## 三、每节统一模板

1. 开头：一句话学习目标 +「读完你能……」
2. 先给技术定义、执行模型、使用边界，**再**用项目配置/代码证明
3. 项目实证：贴真实片段**逐行讲每处为什么这么写**
4. 「概念 ↔ 本项目 ↔ 实际作用」对照表
5. 关键结论用 `> 🔑` 引用块突出
6. **`## 面试怎么问`**：3-5 个高频问法 + 参考答法要点 + 「用项目举例怎么答」
7. 末尾：动手练习 + 自检问题
8. 承上启下：预告下一节
9. `## 附：答案与解析`，用 `<details>` 折叠逐题作答（避免滚动剧透）

---

## 四、实验环境（已实测确认）

本机 Docker Desktop 跑着 `rbac-mysql`（`mysql:8.4`，实测版本 **8.4.10**）和 `rbac-redis`，均 healthy，占宿主机 3306 / 6379。

**真库只读、实验另起**：

| 用途 | 做法 |
|------|------|
| 读真实 schema、跑 EXPLAIN | 进 `rbac` 库，**只 SELECT / EXPLAIN / SHOW，不写** |
| 索引、深分页、执行计划实验 | 新建 `rbac_lab` 库造 `user_big` 灌 100 万行 |
| 事务隔离级别、锁、死锁实验 | 开**两个** `docker exec` 会话手动 `BEGIN` 对照 |

**连库命令（本地 `deploy/.env` 存在，root 密码 `rbac_root_123`）**：

```bash
docker exec -it rbac-mysql mysql -uroot -prbac_root_123 --default-character-set=utf8mb4
```

> ⚠️ `--default-character-set=utf8mb4` **不能省**：不加的话所有中文 COMMENT 显示成 `?`（已实测）。这本身是 `01` 的一个教学点。

**现状实测**：`rbac` 库 20 张表，全 InnoDB。行数很少（`sys_role_menu` 96 行最多，`sys_menu` 48，`sys_user` 5，工作流表基本空），**所以真库跑 EXPLAIN 全是全表扫描，看不出索引效果**——这正是要另起 `rbac_lab` 的原因。
容器里还有一个 `demo` 库（来历不明，疑似早期实验残留，未深究）。

> 注：记忆里"操作类任务走 Chrome UI 不用 SQL"是针对**操作 RBAC 系统本身**（建用户/配角色）；MySQL 学习必须走 CLI，不冲突。

### `rbac_lab` 现状（`02` 已建好，`03`+ 可直接用，**不用重灌**）

| 表 | 规模 | 结构 / 用途 |
|----|------|------------|
| `digits` | 10 行 | 0-9，6 张交叉连接生成 10^6 序列 |
| **`user_big`** | **100 万行** | 照抄 `sys_user`。索引：`PRIMARY(id)`、`uk_username_deleted(username,deleted)`、`idx_dept(dept_id)`、`idx_status(status)`、`idx_nickname(nickname)`。**数据分布是刻意设计的**：`username` 全不同；`dept_id` 100 个值各 1 万行（**临界点实验靠它**）；`status`/`deleted` 均 99:1（低选择度实验靠它） |
| **`menu_big`** | **100 万行** | `permission_code VARCHAR(128)` + `idx_perm`，格式 `system:modXXXX:list/create/update/delete`。**LIKE 前缀实验专用** |
| `t_auto` / `t_uuid` | 各 20 万行 | UUID vs 自增主键对照（8.5MB/517 页 vs 14.6MB/899 页） |
| `t_ai` | 3 行 | `AUTO_INCREMENT` 不回退的最小演示 |
| **`t_skew`** | **100 万行** | **（`03` 新建）** `v VARCHAR(16)` + `idx_v`，**A 70% / B 20% / C 10%** 的已知倾斜。**下潜天花板的判决实验靠它**，`08` 讲统计信息或倾斜时可直接复用 |
| **`dept_dim`** | **100 行** | **（`04` 新建）** `dept_id` / `dept_name`，**故意不建任何索引**。NLJ vs Hash Join、驱动表实验靠它。无索引是**特性不是疏忽**——`filtered` 只能硬猜 10%（实际 1 行），`04` 练习 3 用了这个误差 |
| **`g_menu` / `g_role_menu` / `g_user_role`** | 3 / 3 / 1 行 | **（`04` 新建）** 照抄 `sys_menu`/`sys_role_menu`/`sys_user_role` 结构的最小复制品，**桥表同样不带 `deleted`**。**幽灵菜单实验台**（`rbac` 只读，炸不了真库）。`g_menu` 的 id=3 已被置为 `deleted=1`，**复现实验前注意这个初始状态**。`05`/`06`/`07` 讲逻辑删除或并发可直接复用 |

⚠️ **`03` 动过实验库，已全部复原，但有两处永久变化**：
1. **`user_big` 的 `n_rows` 现在是 994345**（`02` 时是 995090）。`03` 反复 `ANALYZE` 过，**每次 20 页随机采样都给新数字**（本节见过 995090/995835/995224/994345）。**`04`+ 看到 `rows` 尾数和 `02` 对不上是正常的**，`03` §〇 已就此给学习者打过预防针。
2. `03` 期间曾 `DROP INDEX idx_status` / 建过直方图 / 改过 `STATS_SAMPLE_PAGES`，**均已恢复**（5 个索引齐全、`column_statistics` 为空、`STATS_SAMPLE_PAGES=DEFAULT`）。

灌数据脚本全文在 `02` §〇，**2.4 秒**跑完。整库 `DROP DATABASE rbac_lab` 可随时重来。

⚠️ **两个反复踩到的坑，`03` 注意**：
1. **`information_schema` 的 `index_length` 是懒更新的**——第一次查显示 `0.0`，**必须先 `ANALYZE TABLE`** 才有真值。
2. **`user_big.username` 形如 `user_0500000`，里面的 `_` 是 LIKE 通配符**！`LIKE 'user_05000%'` 的可用前缀只有 `'user'` → `type=range` 但实扫 100 万行。**做 LIKE 实验请用 `nickname`（`昵称N`，无下划线）或 `menu_big`。** `02` §六.4 已把这个坑写成教学点（"`type=range` 不代表扫得少"）。

---

## 五、进度总览

| 文件 | 主题 | 状态 |
|------|------|------|
| `00-全局地图与实验环境.md` | 20 张表**五组**分类、RBAC 核心链路（两座桥）、邻接表存树、审计五件套/逻辑删除/枚举落库三约定、连库与 `--default-character-set` 坑、真库只读 vs `rbac_lab` | ✅ 已完成 |
| `01-存储引擎-字符集-字段类型.md` | InnoDB vs MyISAM（含"为何不能存行数计数器"）、Dynamic 行格式、utf8mb3 存不了 emoji、**排序规则悬案破案 + emoji 反转**、BIGINT 主键/TINYINT 布尔/VARCHAR 枚举/DATETIME vs TIMESTAMP | ✅ 已完成 |
| `练习册-01-核心链路手工查询.md` | **（学习者点播加练，插在 `01` 和 `02` 之间）** 不用 JOIN、三条 SELECT 手工走 `用户→角色→菜单`（admin = **48** 个菜单 = 全表）；20 题分四组：A 单表定位 / B 三步链路变体 / C 反向链路 / D 聚合与集合。答案全部实跑 | ✅ 已完成 |
| `02-索引原理.md` **（重头戏）** | B+ 树（16KB 页/扇出/树高 3 层）、聚簇 vs 二级、**回表**、覆盖索引、`uk_user_username` 最左前缀、索引失效五姿势、**优化器临界点实测 13%~14%**。**6 笔扣全还清**，另挖出 `UserService.like()` 真实索引失效 | ✅ 已完成 |
| `03-EXPLAIN与执行计划.md` | EXPLAIN 12 列逐格拆、`const` 表在优化期就被读（`no matching row in const table`）、`key_len` 手算 + **259 的两种成因**、`rows` 来源与索引下潜、**下潜天花板 = 半张表（修正 `02` 措辞）**、`filtered=10.00` 是硬编码猜测、直方图（**有索引就被无视**）、ICP 量化（99999→1000 行，52.6→7.55ms）、**执行计划随 Buffer Pool 冷热翻转**、四表 JOIN 真实计划。**`02` 的 5 笔扣全还清** | ✅ 已完成 |
| `04-JOIN与查询优化.md` | JOIN 的两个真实动机（`LEFT JOIN` 补 0 行 / 借过滤条件）、`COUNT(*)` vs `COUNT(列)`、NLJ vs Hash Join **实测 54 倍**、**BNL 已于 8.0.20 移除**、驱动表（`STRAIGHT_JOIN` 实测 67 倍）、四表 JOIN 逐行拆、**超管短路案例**、**幽灵菜单实炸**、`IN`/`EXISTS` 同计划（cost 都是 19754）、`DISTINCT` 双向账。**2 笔扣全还清** | ✅ 已完成 |
| `05-事务与隔离级别.md` **（重头戏）** | ACID、四级隔离、MVCC、undo log、ReadView | ⬜ 未开始 |
| `06-锁.md` | 行锁/间隙锁/临键锁、死锁、悲观 vs 乐观、FOR UPDATE | ⬜ 未开始 |
| `07-项目里的四个设计决策.md` | 逻辑删除取舍、零外键、数据权限递归、深分页 | ⬜ 未开始 |
| `08-慢查询-连接池-线上排错.md` | 慢查询日志、PROCESSLIST、连接池、mysqldump、分库分表 | ⬜ 未开始 |
| `附录-面试考点速查表.md` | 按考点分组，一句话答案 + 回指章节 | ⬜ 未开始 |

---

## 六、已挖到的"活教材"（写对应章节时务必用上）

### 1. 排序规则三处声明不一致 → `01` 的高潮

**声明的和实际生效的对不上**，实测证据链：

| 层级 | 声明/实际 | 值 |
|------|-----------|-----|
| 服务器 | `docker-compose.yml` 的 `--collation-server` | `utf8mb4_unicode_ci` ✅ 生效 |
| 库 | `deploy/config/mysql/init/01-init.sql` 的 `DEFAULT COLLATE` | `utf8mb4_unicode_ci` ✅ 生效 |
| **表** | `backend/src/main/resources/db/schema.sql` 只写 `DEFAULT CHARSET = utf8mb4` | **实际 `utf8mb4_0900_ai_ci`** ❌ |

- 实测：`SELECT DISTINCT table_collation FROM information_schema.tables WHERE table_schema='rbac'` → **只有 `utf8mb4_0900_ai_ci` 一个值**；用 `unicode_ci` 的表数量为 **0**。
- 机制（讽刺点）：表级**只写 CHARSET 不写 COLLATE**，MySQL 8 就用该字符集的**默认**排序规则（`utf8mb4_0900_ai_ci`），反而**覆盖**了库的继承。**这行什么都不写，表反倒会继承 `utf8mb4_unicode_ci`——写了才坏事。**
- 影响：`_0900_ai_ci` vs `_unicode_ci` 的排序/比较规则不同（Unicode 版本、重音/大小写敏感度）；且**跨库 JOIN 时排序规则不一致会报 `Illegal mix of collations`**。目前项目单库，暂未爆雷。
- ✅ **`01` 已破案并写完**，三个实验全部实跑：
  1. **三张对照表**（`lab_tmp` 库默认 `unicode_ci`）：`t1` 什么都不写 → `unicode_ci` ✅；`t2` 只写 `DEFAULT CHARSET=utf8mb4`（项目写法）→ `0900_ai_ci` ❌；`t3` 都写 → `unicode_ci` ✅。
  2. **反转（本节高潮）**：实测 `'😀' = '😃' COLLATE utf8mb4_unicode_ci` → **1（相等！）**，`0900_ai_ci` → 0。因 `unicode_ci` 基于 UCA 4.0.0（2003），emoji 无排序权重 → 彼此全等。`unicode_ci` + 唯一键插两个不同 emoji → `ERROR 1062 Duplicate entry '?'`；`0900_ai_ci` 则存下 2 个。**项目"写错"的值行为反而更对。**
  3. **爆雷实证**：`rbac.sys_user` JOIN 一张 `unicode_ci` 表 → `ERROR 1267 Illegal mix of collations`（建表时不报错，跑到那条 SQL 才炸）。
- **`01` 给出的修法结论**：统一到 `utf8mb4_0900_ai_ci`——改 compose 的 `--collation-server` + `01-init.sql` 的 `DEFAULT COLLATE`，**让声明追上现实，一张表都不用动**（改表要 `ALTER TABLE ... CONVERT TO` 全量重建 20 张）。⚠️ **这只是文档里的建议，尚未改动任何代码**，等学习者决定。
- 实验残留已清理（`lab_tmp` 已 `DROP`）。

### 2. 客户端字符集乱码 → `01` 的实操点

不加 `--default-character-set=utf8mb4`，`SHOW CREATE TABLE rbac.sys_user\G` 的中文 COMMENT 全是 `?`。加上即正常。已实测。

### 3. `SysMenuMapper` 四表 JOIN → `04` 的主教材

`backend/src/main/java/com/rbac/system/menu/mapper/SysMenuMapper.java:14-24`，**已经带着逐行中文注释**（`DISTINCT` 去重、三座桥怎么拼、`#{}` 防注入、为什么连 `sys_role` 只为过滤禁用角色）。几乎是写好的教材，直接精读即可。

### 4. `uk_user_username (username, deleted)` → `02` 讲最左前缀 + `07` 讲取舍

`schema.sql:42`，实测 `SHOW CREATE TABLE` 确认。缺陷：`deleted` 只有 0/1，**只允许软删一份重复**——删了 `zhangsan` 再删第二个 `zhangsan` 会撞唯一键。

### 5. 全库零外键

实测 `grep -ci "FOREIGN KEY" schema.sql` = **0**。关系全靠应用层维护 → `07` 的设计决策讨论。（`00` 已在「面试怎么问 Q4」抛出这个事实，埋了扣。）

### 6. `@Transactional` 写法不统一 → `05` 的引子

`DefinitionService` / `WorkflowEngineImpl` 用 `@Transactional(rollbackFor = Exception.class)`，而 `RoleService` / `UserService` / `DictService` 是裸的 `@Transactional`。天然的"checked 异常默认不回滚"讲解入口。

### 7·补. `audit_admin` 权限全开但零菜单 → 「两条轴」的活反例（练习册 01 已用）

实测：`sys_role` 里 `audit_admin`（id=3）`data_scope = ALL`，但 `sys_role_menu` 里 **一行都没有**（96 行全被 role 1 和 role 2 平分，各 48）。lina（id=4）挂的就是它 → 登录后菜单树是空的。

**数据权限全开 + 菜单权限为零**，是"菜单权限管入口、数据权限管行，两条独立的轴"的完美反例。练习册 01 的 B 组 9/12 题就是围着它设计的，`07` 讲数据权限时可以直接复用这个例子。

另：`super_admin`（48）和 `system_admin`（48）的菜单**差集为 0**，完全一致 —— 两个角色的区别**只在 `data_scope`**（`ALL` vs `OWN_DEPT_CHILD`）。

### 7·补二. `wangqiang` 也是超管 → 曾怀疑是 bug，**已核实：代码是对的**（勿再重查）

实测 `sys_user_role`：user 1（admin）和 **user 5（wangqiang）都挂 role_id = 1（super_admin）**。超管**不唯一**。

一度怀疑"禁止删超管"是硬编码 `userId != 1`（那样 `wangqiang` 就能被删）。**已查证，此怀疑不成立**：

- `UserService.java:219-222` 的 `isSuperAdmin(Long userId)` 是 `roleMapper.selectRolesByUserId(userId).stream().anyMatch(r -> SUPER_ADMIN.equals(r.getRoleCode()))` —— 查角色比对 `role_code`，**正确写法**。
- 同一模式全仓一致：`SecurityUtils.java:47`、`LoginUserAssembler.java:59`、`AuthService.java:152` 都是 `roleCodes.contains("super_admin")`，没有一处硬编码 id。

✅ **结论：这是本项目做对了的地方**，可当正面例子（`07` 讲 Service 二次校验时用）。**别再去查了。**

### 7·补三. 超管走旁路，根本不走 JOIN → `04` 必须提，否则学习者会误解

`SysMenuMapper` 有**两套**方法，超管和普通用户走**完全不同的代码路径**：

| 用户 | 权限码 | 菜单树 | 走 JOIN 吗 |
|------|--------|--------|-----------|
| 普通用户 | `selectPermissionCodesByUserId`（四表 JOIN） | `selectVisibleMenusByUserId`（四表 JOIN） | ✅ |
| **超管** | `selectAllPermissionCodes`（**单表**） | `selectAllVisibleMenus`（**单表**） | ❌ **短路** |

分叉点：`LoginUserAssembler.java:59-61` 和 `AuthService.java:152-153` 用 `roleCodes.contains("super_admin")` 三元表达式选路。

⚠️ **对练习册 01 的影响（重要）**：练习册手工三步数出 admin = 48 个菜单，而**真实应用压根不这么算** —— 它直接 `SELECT * FROM sys_menu WHERE deleted=0 AND status='ENABLED'`。结果恰好都是 48，但**路径完全不同**。练习册 §三末尾已就此加了说明，`04` 讲 JOIN 时**必须挑明这个分叉**，否则学习者会以为超管也走 JOIN。

这也是个好教材：为什么要短路？因为超管的 JOIN 结果**恒等于全表**，白白付出三次 JOIN + `DISTINCT` 去重的代价。用一个布尔判断换掉一条四表 JOIN，是典型的"用业务知识优化查询"。

### 7·补四. `sys_user_role` 的 `AUTO_INCREMENT=12` 但只有 5 行 → 桥表硬删的实证（机制已找到）

`SHOW CREATE TABLE sys_user_role` 实测：三列（`id/user_id/role_id`），**无 `deleted`、无审计五件套**，`UNIQUE KEY uk_user_role (user_id, role_id)`，`AUTO_INCREMENT=12`。

自增计数器 12 vs 实际 5 行 → 历史上插过 11 行、**真删了 6 行**（`DELETE` 而非 `deleted=1`）。

**机制已定位**：`UserService.java:224-230` 的 `replaceRoles(userId, roleIds)` —— 改角色的实现是 **先 `delete` 掉该用户所有关联行、再逐条 `insert`**。每次改一次角色就消耗若干自增值。这坐实了"桥表走硬删"不是猜测。

练习册 01 自检 2 已用（含 `SHOW CREATE TABLE` 真实输出）。顺带是 `02` 讲 `AUTO_INCREMENT` 不回退的现成素材。另：`replaceRoles` 的"全删再全插"写法本身也值得 `05`/`06` 讨论（并发下的丢更新、以及它为什么必须在事务里）。

### 8·补. **`UserService.page()` 的 `.like()` 正在让索引失效** → `02` 已用，`07`/`08` 可复用（**新挖到，已核实**）

`UserService.java:75-77` 的用户列表搜索：

```java
.like(StringUtils.hasText(query.getUsername()), SysUser::getUsername, query.getUsername())
.like(StringUtils.hasText(query.getNickname()), SysUser::getNickname, query.getNickname())
.like(StringUtils.hasText(query.getPhone()),    SysUser::getPhone,    query.getPhone())
```

**MyBatis-Plus 的 `.like()` 生成 `%值%`（两侧通配）→ 索引必然失效。** 不是猜的，**已翻 MP 3.5.9 源码核实**（`~/.m2/repository/com/baomidou/mybatis-plus-core/3.5.9/`）：

- `AbstractWrapper.java:175`：`like(...)` → `likeValue(..., SqlLike.DEFAULT)`；`likeRight(...)` → `SqlLike.RIGHT`
- `SqlUtils.concatLike()`：`LEFT` → `%str`；`RIGHT` → `str%`；**`default` → `%str%`**

**代价已量化**（`user_big` 100 万行，`idx_nickname`）：`LIKE '%昵称5000%'` **166ms**（扫 100 万行）vs `LIKE '昵称5000%'` **0.046ms**（扫 111 行）= **3600 倍**，两者返回**相同的 111 行**。

⚠️ **`02` 给的结论是「记成技术债，现在别改」**，理由：① `sys_user` 才 5 行、全库 720KB，改了零收益；② `%值%`→`值%` 是**产品语义的改变**（包含匹配 vs 前缀匹配），不是纯技术优化；③ 若产品坚持包含匹配，**MySQL 里没有索引解**，得上 FULLTEXT 或 ES。**`07`/`08` 复用时别改这个口径**（别写成"应该立刻改成 likeRight"）。

同类还有 `AssigneeOptionService.java:38` 的 `.like(SysUser::getUsername, normalizedKeyword)`。

> 这条是**面试「你发现过什么性能问题」的王牌答案**，`02` 的 Q6 已按"定位代码行 → 查源码验证 → 量化 → 说清为何不改 → 说清将来怎么改"的结构写好。

### 8. HikariCP 只配 4 个参数 → `08` 的坑

`application.yml` 只有 `pool-name` / `minimum-idle: 5` / `maximum-pool-size: 20` / `connection-timeout: 30000`，**缺 `max-lifetime` / `idle-timeout` / `leak-detection-threshold`**。

---

---

## 六·补、已埋的扣（后续章节必须还）

`00` 写作时故意埋下、后面要收的伏笔：

| 埋在哪 | 扣是什么 | 谁来还 |
|--------|---------|--------|
| ~~`00` 末尾预告~~ | ~~排序规则悬案~~ | ✅ **`01` §三已还**（含 emoji 反转） |
| ~~`00` §三.3~~ | ~~枚举用 `VARCHAR(16)` 的账~~ | ✅ **`01` §四.3 已还**（三方案对比表 + 丢掉 DB 约束的代价） |
| ~~`00` 自检 5~~ | ~~传输乱码 vs 数据真坏了怎么区分~~ | ✅ **`01` §二已还**（`SELECT HEX()` 看原始字节） |
| `00` §三.2 + 自检 4；`01` §四.3 结尾 | `uk_user_username` 只允许软删**一份**同名记录；且「枚举无 DB 约束」与「零外键」是同一哲学，**说了 `07` 会把这条线串起来** | `07` |
| `00` §二 邻接表 | 查子孙要递归 → 本项目在 Java 内存里递归，没用 `WITH RECURSIVE` | `07` |
| `00` §三.1；**`01` §四.4 结尾又强调了一次** | `created_at` 没有 `DEFAULT CURRENT_TIMESTAMP`，由 Java 填 → **绕过应用直接 `INSERT` 会是 NULL**，"`08` 会展开这笔账" | `08` |
| ~~`00` §四.3 + 自检 3~~ | ~~5 行的表优化器不屑于走索引，临界点实测~~ | ✅ **`02` §七已还**（`dept_id<=13` 走 range / `<=14` 翻 ALL；`FORCE INDEX` 验证优化器正确：133ms vs 143ms）。⚠️ 但**同时修正了 `00` 的说法**：真库 5 行的 `sys_user` 按 `username+deleted` 查是 **`type=const`**，唯一索引全值匹配与表大小无关。`03` 若再提临界点，口径要一致 |
| `00` 练习 4 答案 | CLI 手写 SQL 不会自动加 `deleted=0`，应用会 → "SQL 查得到、应用查不到" | `07` 逻辑删除那节呼应 |
| ~~**`01` §四.1**~~ | ~~二级索引会各存一份主键值~~ | ✅ **`02` §二已还**（`SELECT id,dept_id` → `Using index` 反证叶子存主键；且实测 3 个二级索引 79.7MB > 数据 78.6MB） |
| ~~**`01` §四.1 追问**~~ | ~~"为什么不用 UUID 做主键"~~ | ✅ **`02` §三已还**（20 万行实测：UUID 14.6MB/899 页 vs 自增 8.5MB/517 页 = **1.7 倍**） |
| ~~**`01` 自检 4**~~ | ~~用 `COLLATE` 临时救 `ERROR 1267` 会让索引失效~~ | ✅ **`02` §六.3 已还**（`COLLATE unicode_ci` → rows=995090 失效；`COLLATE 0900_ai_ci` → rows=1。**给 `01` 的排序规则结论补了第 4 条论据**：报错是显性的、`COLLATE` 止血是隐性的） |
| **`01` §一 + 自检 1** | **MVCC**：不同事务看到的行数不同 → 所以 InnoDB 存不了行数计数器，"`05` 会回到这里" | `05` |
| ~~**练习册 01 · D组 20 答案**~~ | ~~`LIKE 'system:user:%'` 能用索引，`LIKE '%:delete'` 索引失效~~ | ✅ **`02` §六.4 已还**（`menu_big` 100 万行实测：前缀 **0.26ms** vs 左通配 **135ms** = 519 倍） |
| ~~**练习册 01 · 自检 2**~~ | ~~`AUTO_INCREMENT` 只增不减、删行不回退~~ | ✅ **`02` §四已还**（删 3 行计数器停在 6、重插跳到 id=6；另发现 `user_big` 一行没删但计数器 1048561 vs max_id 1000000 = 批量插入按 2 的幂预分配后丢弃） |
| ~~**练习册 01 · §四 + 自检 2/4**~~ | ~~桥表不带 `deleted` → 幽灵菜单~~ | ✅ **`04` §六已演示怎么炸**（`g_*` 复制品：软删 menu 3 后桥表纹丝不动 → 漏 `m.deleted=0` 则 `finance:report:view` 权限照发；"只查桥表"的写法**连过滤机会都没有**）。**`04` 定性为「安全 bug 而非查询 bug」**，并已证伪"加个 `deleted` 就好了"（唯一键要变三列 → 只能软删一次 → 同一个洞）。**账仍留给 `07` 算**（`04` 明说了"本节结论只有一句：桥表硬删是既成事实，每条 JOIN 必须自己滤"） |
| ~~**练习册 01 · D组 17-18 答案**~~ | ~~`GROUP BY` 不会产出 0 行~~ | ✅ **`04` §〇 已还，口径照练习册的定调没改**（"JOIN 的第一个动机不是省往返"）。实测：`INNER JOIN` → `audit_admin` 整行消失；`LEFT JOIN`+`COUNT(rm.menu_id)` → 0 ✅；**`LEFT JOIN`+`COUNT(*)` → 1** ❌（经典错误组合，`04` 单独立了一节）|
| **练习册 01 · 自检 3** | 5 个用户 `dept_id` 全是 1 → 数据权限**看不出差别**，"`07` 讲数据权限前得先补一棵真部门树" | `07` |

### `04` 新埋的扣（`05` 必须还，预告里已明写）

`04` 末尾的「下一节预告」**已经把这几条列给学习者了**，`05` 要逐个回答：

| 扣 | 具体 | 素材现成 |
|----|------|---------|
| **`replaceRoles` 的并发窗口** | `04` §六 点出改配置是"**先全删再全插**"（`UserService.java:224-230`）。**预告直接问："如果'删完了、还没插完'的那一瞬间，别的请求正好在查这个用户的权限，会看到什么？"** | `g_*` 复制品可双会话演；`AUTO_INCREMENT=289 / 96 行` 是它的实证 |
| **`01` §一 + 自检 1 的 MVCC 扣** | InnoDB 为什么存不了行数计数器 → 不同事务看到的行数不同。**`04` 预告已明确接上这条线** | `05` 双会话 |
| **`@Transactional` 写法不统一** | `DefinitionService`/`WorkflowEngineImpl` 用 `rollbackFor=Exception.class`，`RoleService`/`UserService`/`DictService` 是裸的 → checked 异常默认不回滚 | 见上文「活教材 6」 |
| **`replaceRoles` 为什么必须在事务里** | 不在事务里最坏会发生什么 | 同上 |

**⚠️ 别漏还扣。** Docker 系列的经验是：埋了不还，学习者会记得（`06` 留的两根弦最后是 `07` 收的）。
~~`02` 一次要还 6 笔~~ → ✅ 已还清（6/6）。~~`03` 要还 5 笔~~ → ✅ 已还清（5/5）。~~`04` 要还 2 笔~~ → ✅ 已还清（2/2）。**`05` 要还 4 笔。**
~~`02` 一次要还 6 笔~~ → ✅ **`02` 已全部还清（6/6），每笔都有实跑证据。**
`04` 要还 2 笔，且**练习册已经把"JOIN 的第一个真实动机"定调成 `LEFT JOIN` 补 0 行**（不是"省两次往返"）——写 `04` 时别改口径。

### `02` 新埋的扣（`03` 必须还，预告里已明写）

`02` 末尾的「下一节预告」**已经把这 5 个问题白纸黑字列给学习者了**，`03` 必须逐个回答：

| 扣 | 具体 | 证据现成 |
|----|------|---------|
| `rows` 估算不准 | 一直显示 `995090`/`994345` 而非 `1000000` | 采样统计，`02` 多处出现 |
| **统计信息失真** | `status` 实际 99:1，优化器估成 **50:50**（`rows=497545`）→ **害它错误地用了索引** | `02` §七实测；**直方图 `ANALYZE TABLE ... UPDATE HISTOGRAM ON status` 是解法，`02` 只点名没展开** |
| `filtered` 列 | `02` 里出现过 `10.00`/`29.12`/`34.55`/`100.00`，没解释 | 现成 |
| `Using index` vs `Using index condition` | `02` 明说"别搞混，ICP 是另一回事，`03` 讲" | `dept_id<=N` 的 range 查询会出 ICP |
| `key_len` 怎么算 | `02` 用 258→259 证明"吃了几列"，但只在练习 3 的答案里粗算了一次，说了"`03` 详讲" | `uk_username_deleted` 现成 |

另：`02` §一明确标注了**树高 3 层是「算出来的、不是测出来的」**（`size - n_leaf_pages` 含段内预留页，不能当非叶子页数）。**`03` 别不小心把这个差值说成实测值。**（`03` 已注意，没提树高。）

✅ **`03` 已把这 5 笔全还清**，每笔都有实跑证据，详见下面「`03` 的三个重大发现」。

### `03` 的三个重大发现（`04`+ 必读，别推翻口径）

**1. 执行计划会随 Buffer Pool 冷热翻转 —— `03` §八，本套目前最强的面试素材**

`02` §七测出临界点 13%/14%，并留了一句"这个百分比取决于……数据在不在 Buffer Pool 里"。**`03` 把这句话测出来了**：数据一行没变、`innodb_table_stats.last_update` 还停在 `02` 那一刻（统计信息也没变）、`rows` 估算与 `02` 逐个吻合（N=1 都是 18564，N=10 都是 206718），**但决策变了**。

用 `SELECT COUNT(created_at) FROM user_big FORCE INDEX (PRIMARY)` 逐步读热聚簇索引，临界点单调爬升：

| PRIMARY 缓存页 / 5032 | 比例 | 临界点 N |
|---|---|---|
| 155 | 3% | **3~5** |
| 3707 | 74% | **7~8** |
| 4169 | 83% | **10~12** |
| 4775 | 95% | **11~12** |
| （`02`，刚灌完） | ≈100% | **13~14** |

机制：`mysql.engine_cost` 的 `io_block_read_cost=1` / `memory_block_read_cost=0.25`，InnoDB 把"索引有多少比例在 Buffer Pool"报给优化器加权。回表 = 随机读聚簇索引页，聚簇索引热则回表便宜 → 索引方案撑得更久。

> ⚠️ **口径**：`02` 的 13% 和 `03` 的 3/7/10/11% **不矛盾，是同一条曲线上的不同点**。`03` 明确写了"连 `02` 自己的 13% 也别背"。**`04`/`07`/`08` 别再把任何一个具体百分比当常数引用。**
> ⚠️ 另一个后果：**测一次不算数**。`03` 写 ICP 实验时被咬过——同一条 SQL 第一次选全表扫描（343ms）、第二次选索引范围扫描（59ms），因为第一次的 `EXPLAIN ANALYZE` 自己把表读热了。**跑两轮再写进文档。**

**2. 修正 `02` 的一处解释：`rows=497545` 不是"估成 50:50"，是下潜撞了天花板**

`02` 记的是"`status` 实际 99:1，优化器估成 **50:50**（rows=497545）"。**数字对，解释错。**

- 反证：`n_diff(idx_status)` 默认采样时是 **1**（不是 2）。若真按"不同值均分"，该估 `n_rows/1`，实际仍是 `n_rows/2`。
- 三次不同 `n_rows` 下都是不多不少正好一半：995090→497545、995224→497612、994345→497172。
- **判决实验**：`03` 在 `rbac_lab` 新建 `t_skew`（A 70% / B 20% / C 10%，`n_rows=992800`，`n_diff=2`）。若公式是 `n_rows/n_diff`，三者应全部 = 496400。实测：**A（70%）= 496400 正好一半（被压）**，B = 320870，C = 169400。**公式证伪。**

> 🔑 真机制：**等值条件走「索引下潜」（读真实 B+ 树，与采样统计无关）**，证据是 `dept_id=50` 在 `n_diff` 被折腾成 95/100/101 三个值时 **`rows` 恒等 18560**。下潜**高估约 1.6~1.9 倍**（真实 10000 → 18560），且**结果上限为半张表**。
> **`04`+ 引用时请用「下潜 + 天花板」，别再写「50:50 均分」。**

**3. 直方图在有索引的列上是无用功**

- 无索引 + 无直方图 → `filtered` 恒 **10.00**（**MySQL 对 `列=常量` 的硬编码猜测**，这就是 `02` 里那些 `10.00` 的出处）
- 无索引 + 有直方图 → `ENABLED` **99.00** / `DISABLED` **1.00**（精确）
- **有索引 + 有直方图 → `filtered` 变回 100.00，直方图被完全无视**

> 🔑 **直方图是给「没索引的列」用的**——正好接 `02` §七"低选择度列不该建索引"的结论：不建索引，但要让优化器知道分布，直方图是唯一解。**网上讲直方图最常漏这一点。**

---

## 七、与已有文档的边界

- `docs/learning-spring-boot/02-数据层与数据模型.md` 已从 **Java 侧**讲过 MyBatis-Plus（`BaseEntity`、自动填充、`@TableLogic`、`LambdaQueryWrapper`、`Page`+插件）。本套一律从**数据库侧**讲，不重复 Java API 用法，需要时回指。
- ⚠️ 该文档说"14 张表"，而 `schema.sql` 现已 20 张（工作流表后加的）。**在 `00` 提一句勘误提示即可，不改那份文档。**
- `docs/learning-docker/05-数据持久化-卷与配置挂载.md` 已讲过 `initdb.d` 只在空卷时跑、`mysql-data` 命名卷。本套 `00` 提一句回指，不重复。

---

## 八、验证方式

- 引用的 `schema.sql` / Mapper / `application.yml` / `docker-compose.yml` 片段，逐字与仓库实际文件核对。
- 文档里的每条命令和 SQL **实跑一遍**再写进去，贴真实输出。
- 环境自检：
  ```bash
  docker exec rbac-mysql mysql -uroot -prbac_root_123 --default-character-set=utf8mb4 \
    -e "SELECT VERSION(); SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='rbac';"
  ```
  应返回 `8.4.10` 与 `20`。
- 全程只对 `rbac` 库 SELECT/EXPLAIN/SHOW；写操作一律在 `rbac_lab`。
