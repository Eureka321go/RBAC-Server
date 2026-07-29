# 设计：给用户加「个人简介 profile」字段（Flyway V2 实战）

> 目标：用一个最小的字段透传功能，实战体验 Flyway 的**第一条增量迁移 `V2__`**，
> 走通"改代码 = 改库"的完整闭环。承接 `docs/learning-spring-boot/10-数据库迁移-Flyway改造.md`。
> 由本人（学习者）亲自实现，本文档为实现清单与教学要点。

## 范围

- 后端 only（不含前端表单）。
- 给 `sys_user` 加一列 `profile`（个人简介），只在**新增 / 编辑 / 详情**透传，不涉及任何业务逻辑。
- DTO 加 `@Size(max=500)` 长度校验，配 i18n message key。

## 一、迁移（本次主角）

新建 `src/main/resources/db/migration/V2__user_add_profile.sql`：

```sql
ALTER TABLE `sys_user`
  ADD COLUMN `profile` VARCHAR(500) NULL COMMENT '个人简介' AFTER `remark`;
```

### 三条铁律（这次要体会的核心）

1. **绝不改 `V1__init_schema.sql`。** V1 已在本地/线上的 `flyway_schema_history` 记过账
   （线上是 baseline 收编），改它会导致 checksum 校验失败、启动报错。加字段一律新增 V 文件。
2. **版本号严格递增。** 当前最大 V1，故新文件为 `V2__`；描述段 `user_add_profile`
   用下划线，Flyway 转成 "user add profile" 记入历史表 description。
3. **非破坏性变更。** `ADD COLUMN` 可空、无默认，对线上已有数据一行不动（老用户 `profile` 为 NULL）。

## 二、代码改动（6 处，全部照抄现有 `remark` 的写法）

| # | 文件 | 改动 |
|---|------|------|
| 1 | `entity/SysUser.java` | 加 `private String profile;` |
| 2 | `dto/UserCreateRequest.java` | 加 `@Size(max = 500, message = "{valid.profile.size}") private String profile;` |
| 3 | `dto/UserUpdateRequest.java` | 同上 |
| 4 | `service/UserService.java` `create()` | `setRemark` 后加 `user.setProfile(req.getProfile());` |
| 5 | `service/UserService.java` `update()` | 同上 |
| 6 | `vo/UserVO.java` | 加 `private String profile;` + `from()` 里 `vo.setProfile(u.getProfile());` |

i18n（3 个文件各加一行 `valid.profile.size`）：

- `i18n/messages.properties`：`valid.profile.size=个人简介不能超过 500 字`
- `i18n/messages_zh_CN.properties`：同上
- `i18n/messages_en_US.properties`：`valid.profile.size=Profile must not exceed 500 characters`

说明：MyBatis-Plus 驼峰↔下划线自动映射 `profile`↔`profile`，无需改 mapper/XML。

## 三、验证闭环

1. 启动后端，日志应出现 `Migrating schema to version "2 - user add profile"`；
   `flyway_schema_history` 多一行（version=2, success=1）。**本地无需删库**，Flyway 自动补跑 V2。
2. 调新增用户接口传 `profile`，再查详情能取回 → 端到端通。
3. 传超过 500 字的 `profile`，返回 400 校验错误（`valid.profile.size`）→ 校验生效。

## 非目标（YAGNI）

- 不加前端表单、不加列表列展示。
- 不加业务逻辑（不参与搜索/权限/审计）。
- 不动 `R__seed_data.sql`（无需给种子用户补 profile）。
