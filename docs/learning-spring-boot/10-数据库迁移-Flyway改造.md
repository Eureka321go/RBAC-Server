# 阶段 10 · 数据库迁移：从 spring.sql.init 到 Flyway

> 本篇承接 [`09-配置体系与多环境-单元3实现.md`](./09-配置体系与多环境-单元3实现.md)。单元 3 做完多环境后暴露了一个真实问题：**本地库结构漂移**（`sys_dept` 停在双语旧设计 `dept_name_zh/_en`，而代码已是单列 `dept_name`），启动时 `data.sql` 直接报 `Unknown column 'dept_name'`。
>
> 根因是 `spring.sql.init`（`schema.sql`/`data.sql`）**只能做一次性初始化、不会演进已存在的表**。本篇把项目迁移到 **Flyway**——生产级的版本化数据库迁移，从此库结构像代码一样被版本管理。

---

## 零、改动清单

| 类型 | 文件 | 改动 |
|------|------|------|
| 依赖 | `pom.xml` | 加 `flyway-core` + `flyway-mysql`（MySQL 必需后者） |
| 迁移 | `resources/db/migration/V1__init_schema.sql` | 由 `db/schema.sql` 迁入（结构基线） |
| 迁移 | `resources/db/migration/R__seed_data.sql` | 由 `db/data.sql` 迁入（可重复种子） |
| 删除 | `resources/db/schema.sql`、`resources/db/data.sql` | 内容已迁走，避免两套并存 |
| 配置 | `application.yml` | 加 `spring.flyway`（enabled + baseline-on-migrate） |
| 配置 | `application-{dev,test,prod}.yml` | 移除全部 `spring.sql.init.*`（交给 Flyway） |

---

## 一、为什么 `sql.init` 不够，Flyway 好在哪

| 维度 | `spring.sql.init`（原方案） | Flyway（新方案） |
|------|----------------------------|-------------------|
| 定位 | 本地/测试的**一次性初始化** | 生产级 **schema 版本管理** |
| 认不认"改了哪" | 不认，每次跑全量脚本 | 有 `flyway_schema_history` 记录执行到第几版 |
| 改已存在的表 | 改不动（`CREATE TABLE IF NOT EXISTS` 跳过旧表） | 每次一条增量 `V2__xxx.sql` |
| 幂等靠什么 | 硬凑 `IF NOT EXISTS`/`INSERT IGNORE` | 版本表天然幂等，只跑没跑过的 |
| 可追溯 | 无 | 迁移历史可查、可审计 |
| 生产可用 | ❌（要么不敢开、要么危险） | ✅ 标准做法 |

一句话：`sql.init` 是"每次都想把库摆成某个样子"，Flyway 是"记录库怎么一步步演进到今天"。**后者才能安全地改生产库**。

---

## 二、Flyway 的三个核心概念

### 2.1 版本迁移 `V<版本>__<描述>.sql`

- 命名：`V1__init_schema.sql`、`V2__add_xxx.sql`……**版本号严格递增、只往前**。
- 每个文件**只执行一次**，执行后记进 `flyway_schema_history`，之后**永不重跑、也不许改**（改了 checksum 对不上会校验失败）。
- 本项目 `V1__init_schema.sql` 就是全部建表语句的**基线**。

### 2.2 可重复迁移 `R__<描述>.sql`

- 命名：`R__seed_data.sql`，**没有版本号**。
- 在所有 V 版本迁移**之后**运行；**内容（checksum）变了就重跑**，没变就跳过。
- 特别适合**种子/参考数据**：以后加菜单、字典，直接改这个文件即可，配合 `INSERT IGNORE` 反复执行也安全。这就是本项目把 `data.sql` 放成 `R__` 而非 `V2__` 的原因。

### 2.3 迁移历史表 `flyway_schema_history`

Flyway 自动在库里建的账本，记录每条迁移的版本、描述、类型、checksum、是否成功。本次验证跑出来长这样：

| installed_rank | version | description | type | success |
|---|---|---|---|---|
| 1 | 1 | init schema | SQL | 1 |
| 2 | (null) | seed data | SQL | 1 |

（version 为 null 的那条就是 `R__` 可重复迁移。）

---

## 三、配置怎么写（各环境统一）

公共 `application.yml`：

```yaml
spring:
  flyway:
    enabled: true
    baseline-on-migrate: true   # 关键：见第四节
    baseline-version: 1
```

- Flyway 默认扫描 `classpath:db/migration`，无需额外指定 locations。
- dev/test/prod **都开启、启动时自动迁移**（你选的方案）：应用一启动，Flyway 就把没执行过的迁移按序补上。
- 三个 profile 的 `spring.sql.init.*` 已全部删除——建表灌数据的活彻底交给 Flyway。

---

## 四、`baseline-on-migrate`：已上线的库怎么平滑接管

这是本次最关键的一招。**你阿里云线上库已经有全套表**（当初 `sql.init` 建的，是正确的单列 `dept_name` 结构），但**没有 `flyway_schema_history`**。直接上 Flyway 会怎样？

- `baseline-on-migrate: true` + `baseline-version: 1`：Flyway 发现"库非空但没有迁移历史" → **把现有结构收编为 V1 基线**，在历史表里记一条 baseline，**不重跑 V1 的建表 DDL**（不会去 `CREATE TABLE` 已存在的表）。
- 之后 `R__seed_data.sql` 照常跑一次（`INSERT IGNORE` 幂等，线上已有种子则为空操作）。
- 将来你加的 `V2__…` 才会被真正执行。

**全程非破坏性**：线上数据一行不动，只是多了一张 `flyway_schema_history` 账本。下次部署（`SPRING_PROFILES_ACTIVE=prod`）自动完成收编。

> ⚠️ 对**全新空库**（如测试用的 `rbac_test`、临时验证库）：库是空的，Flyway 不走 baseline，直接从 V1 建表 + R__ 灌种子，一步到位。

---

## 五、以后怎么改库结构（实操规范）

**铁律：`V1__init_schema.sql` 一旦上线就当它是"历史"，永远不要再改它。** 任何结构调整都新增一个 V 文件。

例：真要把双语列彻底改成单列（假设某环境还留着旧列），新增：

```sql
-- src/main/resources/db/migration/V2__dept_rename_bilingual_to_single.sql
ALTER TABLE sys_dept ADD COLUMN dept_name VARCHAR(64) NOT NULL DEFAULT '' AFTER parent_id;
UPDATE sys_dept SET dept_name = dept_name_zh;
ALTER TABLE sys_dept DROP COLUMN dept_name_zh, DROP COLUMN dept_name_en;
```

下次启动，dev/test/prod 都会在各自的库上自动执行这条 V2，历史表新增一行 `2 | ... | success`。这就是"用迁移平滑演进、而不是删库重建"的正确姿势。

---

## 六、本地旧库：先重建一次，之后一劳永逸

Flyway **救不了已经漂移的本地库**——`baseline-on-migrate` 会把你本地那张**双语旧表**当成 V1 采纳，接着 `R__seed` 仍会撞 `dept_name`。所以本地要先重建一次，让它从干净的 V1 长出来：

```bash
# 1. 删本地旧库、建空库（root 密码见 deploy/.env）
docker exec rbac-mysql mysql -uroot -prbac_root_123 \
  -e "DROP DATABASE rbac; CREATE DATABASE rbac CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"

# 2. 启动后端（IDEA 点运行即可）
#    空库 → Flyway 跑 V1 建表 + R__ 灌种子 → 起来即正常
```

> 这一步只影响你**本地** Docker 里的库，与阿里云线上无关；线上结构本就正确，靠第四节的 baseline 平滑接管。

---

## 七、验证结果（真实日志）

用一次性临时库 `rbac_flyway_verify`（不碰你的 `rbac` 库）端到端验证：

```
Successfully validated 2 migrations
Creating Schema History table `flyway_schema_history` ...
Current version of schema: << Empty Schema >>
Migrating schema to version "1 - init schema"
Migrating schema with repeatable migration "seed data"
Successfully applied 2 migrations, now at version v1
Started RbacServerApplication in 7.125 seconds
```

- `flyway_schema_history`：V1 `init schema` + R__ `seed data`，两条均 success。
- `sys_dept`：单列 `dept_name`、3 行种子，正确。
- 共建 21 张表（20 业务表 + 1 张 Flyway 历史表）。
- `mvn test`：5 个单测全绿（纯 Mockito，不受影响）。

**一个无害告警**：日志有 `Flyway upgrade recommended: MySQL 8.4 is newer than ... latest supported is 8.1`。这是 Flyway 10.20.1（Spring Boot 3.4.1 托管版本）对 MySQL 8.4 的"未测试"提示，实测建表/迁移完全正常，可忽略；要消除可自行升级 Flyway 版本，但会脱离 Spring Boot 的依赖管理，非必要不动。

---

## 八、承上启下

- 本篇把 09 暴露的"库漂移"从根上解决：库结构进入版本管理，dev/test/prod 走同一套迁移。
- 与 09 的关系：09 解决"配置怎么分环境"，10 解决"库结构怎么分环境地演进"——配置与 schema 这两条线现在都类型/版本可控了。
- 延伸练习：给下一个真实需求写第一条 `V2__…` 迁移，体验"改代码 = 改库"的完整闭环；进一步可了解 expand-contract（扩张-收缩）实现**不停机**的破坏性变更。
