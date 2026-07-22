# 04 · JOIN 与查询优化

> **学习目标**：搞懂 MySQL 怎么执行 JOIN，并把本项目那条四表 JOIN 拆到每一行都有理由。

**读完你能**：

- 说清 JOIN 的两种算法（NLJ / Hash Join）分别在什么时候用，并量化它们的差距
- 说清"小表驱动大表"里的**"小"到底指什么**（不是表小）
- 逐行读懂 `SysMenuMapper` 的四表 JOIN，包括为什么要连 `sys_role`
- 说清**超管为什么要短路掉整条 JOIN**，并把它讲成一个完整的优化案例
- **炸出幽灵菜单**，并说清桥表不带 `deleted` 的代价
- 回答"`IN` 和 `EXISTS` 哪个快"——用实测，而不是背 2012 年的结论

---

## 〇、先说清楚：为什么需要 JOIN

多数教程会说"JOIN 是为了少几次数据库往返"。**这个理由不够硬**——练习册 01 已经证明，`用户 → 角色 → 菜单` 用三条单表 `SELECT` 手工走完全可行，多两次往返在局域网里也就零点几毫秒。

**JOIN 的第一个真实动机，是有些结果单表查询根本产不出来。**

### 实证：`GROUP BY` 产不出 0 行

> 还练习册 D 组 17-18 的扣。

`sys_role` 有 3 个角色。数一下每个角色配了多少菜单：

```sql
SELECT r.role_code, COUNT(*) AS 菜单数
FROM sys_role r JOIN sys_role_menu rm ON rm.role_id = r.id
WHERE r.deleted = 0
GROUP BY r.id, r.role_code;
```

```
+--------------+-----------+
| role_code    | 菜单数    |
+--------------+-----------+
| super_admin  |        48 |
| system_admin |        48 |
+--------------+-----------+
```

**只有两行。`audit_admin` 不见了。**

它不是"菜单数是 0"，它是**整行消失了**。原因：`INNER JOIN` 要求两边都有匹配，而 `sys_role_menu` 里**一行 `audit_admin` 的记录都没有**（HANDOFF 记的实测：96 行全被 role 1 和 role 2 平分，各 48）。没有匹配行 → 连参与 `GROUP BY` 的资格都没有 → **`COUNT` 根本没机会返回 0**。

> 🔑 **`GROUP BY` 只能对"存在的行"分组。不存在的行，聚合函数是变不出来的。**
>
> 这个 bug 极其隐蔽：**它不报错，只是少了一行。** 如果这是个"角色权限统计"报表，`audit_admin` 会安静地从报表上消失，没人会注意到。

**修法：`LEFT JOIN`**

```sql
SELECT r.role_code, COUNT(rm.menu_id) AS 菜单数
FROM sys_role r LEFT JOIN sys_role_menu rm ON rm.role_id = r.id
WHERE r.deleted = 0
GROUP BY r.id, r.role_code;
```

```
+--------------+-----------+
| role_code    | 菜单数    |
+--------------+-----------+
| audit_admin  |         0 |     ← 回来了
| super_admin  |        48 |
| system_admin |        48 |
+--------------+-----------+
```

### 但 `LEFT JOIN` 有个坑：`COUNT(*)` 会数错

```sql
SELECT r.role_code, COUNT(*) AS 错的菜单数
FROM sys_role r LEFT JOIN sys_role_menu rm ON rm.role_id = r.id
WHERE r.deleted = 0
GROUP BY r.id, r.role_code;
```

```
+--------------+-----------------+
| role_code    | 错的菜单数      |
+--------------+-----------------+
| audit_admin  |               1 |     ← 应该是 0！
| super_admin  |              48 |
| system_admin |              48 |
+--------------+-----------------+
```

**`audit_admin` 变成了 1。**

原因：`LEFT JOIN` 保留左表的行，右表的列全填 `NULL`。所以 `audit_admin` **确实有一行**（`rm.*` 全是 `NULL`）。

- `COUNT(*)` = **数行数**，不看内容 → 这一行算进去 → **1**
- `COUNT(rm.menu_id)` = **数「这一列非 NULL 的个数」** → `NULL` 不计 → **0**

> 🔑 **`COUNT(*)` 数行，`COUNT(列名)` 数非 NULL 值。平时它们结果一样，`LEFT JOIN` 之后就不一样了。**
>
> **`LEFT JOIN` + `COUNT(*)` 是一个经典错误组合**：`LEFT JOIN` 好不容易把 0 行补回来了，`COUNT(*)` 又把它数成 1。**必须用 `COUNT(右表的某列)`。**

**这就是 JOIN 的第一个真实动机**：不是"省两次往返"，是**只有 `LEFT JOIN` 能表达"这一边可以没有"**。

---

## 一、NLJ：JOIN 的基本执行模型

**嵌套循环连接**（Nested Loop Join）就是它字面的意思：

```
for (驱动表的每一行 r1) {          ← 外层循环，只跑一遍
    for (被驱动表中匹配 r1 的行 r2) {   ← 内层，对每个 r1 跑一次
        输出 (r1, r2)
    }
}
```

**关键：外层跑 1 遍，内层跑 N 遍**（N = 驱动表过滤后的行数）。所以**内层那步的效率会被放大 N 倍**——这是理解一切 JOIN 优化的起点。

### 实证

在 `rbac_lab` 建一张 100 行的部门维表（`dept_dim`），和 100 万行的 `user_big` 连：

```sql
EXPLAIN ANALYZE
SELECT COUNT(*) FROM user_big u JOIN dept_dim d ON u.dept_id = d.dept_id
WHERE d.dept_name = '部门50';
```

```
-> Aggregate: count(0)  (cost=19901 rows=1) (actual time=3.56..3.56 rows=1 loops=1)
    -> Nested loop inner join  (cost=10056 rows=98450) (actual time=0.712..3.28 rows=10000 loops=1)
        -> Filter: (d.dept_name = '部门50')  (cost=10.2 rows=10) (actual time=0.657..0.672 rows=1 loops=1)
            -> Table scan on d  (cost=10.2 rows=100) (actual time=0.00996..0.0292 rows=100 loops=1)
        -> Covering index lookup on u using idx_dept (dept_id=d.dept_id)
           (cost=119 rows=9845) (actual time=0.0473..2.1 rows=10000 loops=1)
```

**3.56 毫秒**，从 100 万行里捞出 1 万行。逐层读：

- **驱动表是 `d`**（100 行的小表），`Filter` 之后 `actual rows=1` —— **只剩 1 行**
- **被驱动表是 `u`**，走 `Covering index lookup on u using idx_dept` —— 拿 `d.dept_id` 去索引里查
- 外层只有 1 行 → **内层只跑了 1 轮** → 快

> 🔑 **NLJ 快不快，取决于内层能不能走索引。** 内层走索引 = 每轮是一次树查找；内层没索引 = 每轮一次全表扫描 → 总代价 `N × 全表`，这才是"JOIN 慢"的真实原因。

---

## 二、Hash Join：MySQL 8 的新武器

如果内层**没有索引可用**呢？

MySQL 8.0.18 引入了 **Hash Join**：把一边（**build 侧**，通常是小的那边）读进内存建一张哈希表，再扫另一边（**probe 侧**）逐行去哈希表里探测。

**同样的查询，用 `IGNORE INDEX` 把索引拿掉**：

```sql
EXPLAIN ANALYZE
SELECT COUNT(*) FROM user_big u IGNORE INDEX(idx_dept) JOIN dept_dim d ON u.dept_id = d.dept_id
WHERE d.dept_name = '部门50';
```

```
-> Aggregate: count(0)  (cost=1.01e+6 rows=1) (actual time=193..193 rows=1 loops=1)
    -> Inner hash join (u.dept_id = d.dept_id)  (cost=999414 rows=98450) (actual time=2.76..193 rows=10000 loops=1)
        -> Table scan on u  (cost=604 rows=994345) (actual time=2.54..152 rows=1e+6 loops=1)
        -> Hash
            -> Filter: (d.dept_name = '部门50')  (cost=10.2 rows=10) (actual time=0.136..0.15 rows=1 loops=1)
                -> Table scan on d  (cost=10.2 rows=100) (actual time=0.0895..0.117 rows=100 loops=1)
```

**193 毫秒。** 对比：

| 方案 | 算法 | 耗时 |
|------|------|------|
| 有索引（优化器自选） | **NLJ + 索引查找** | **3.56 ms** |
| 无索引可用 | **Hash Join** | **193 ms** |

**54 倍。**

读法：`Hash` 那一支是 **build 侧**——它挑了过滤后只剩 1 行的 `d` 来建哈希表（**明智**）；`Table scan on u` 是 probe 侧，**实打实扫了 100 万行**（`actual rows=1e+6`）。

> 🔑 **Hash Join 慢，不是因为哈希慢，是因为它必须把 probe 侧**全部扫一遍**。** 而 NLJ + 索引只需要几次树查找。
>
> **但别因此觉得 Hash Join 是坏东西**——它的对手不是"NLJ + 索引"，而是"**NLJ 无索引**"（那是 `N × 全表扫描`，会更惨）。**在没有索引可用时，Hash Join 是救命的**。

### 关于 BNL：一个会过时的知识点

老资料会讲 **BNL**（Block Nested Loop，块嵌套循环）：无索引时，把驱动表批量塞进 `join_buffer`，减少内层表的扫描次数。

**MySQL 8.0.20 起，BNL 已被移除，它的场景全部由 Hash Join 接管。**

但开关还在（本机 8.4.10 实测 `SELECT @@optimizer_switch`）：

```
block_nested_loop=on
hash_join=on
batched_key_access=off
```

> ⚠️ **`block_nested_loop=on` 现在控制的是 Hash Join 的启用，不再是真的 BNL。** 这个开关名是为了兼容留下的。
>
> **面试提示**：如果你说"无索引时会走 BNL"，遇到较真的面试官会被追问版本。**准确的说法是："8.0.20 之前是 BNL，之后被 Hash Join 取代了，但那个 `optimizer_switch` 的名字还留着。"** 这句话本身就能证明你不是背的八股。

---

## 三、驱动表：「小表驱动大表」里的「小」指什么

NLJ 的模型决定了：**驱动表的行数 = 内层要跑的轮数**。所以驱动表当然越小越好。

**但"小"不是指表的行数，是指「过滤后的行数」。**

### 实证：强制换驱动表

`STRAIGHT_JOIN` 可以强制让左边的表当驱动表：

```sql
EXPLAIN ANALYZE
SELECT COUNT(*) FROM user_big u STRAIGHT_JOIN dept_dim d ON u.dept_id = d.dept_id
WHERE d.dept_name = '部门50';
```

```
-> Inner hash join (d.dept_id = u.dept_id)  (cost=201461 rows=9943) (actual time=221..239 rows=10000 loops=1)
    -> Filter: (d.dept_name = '部门50')  ... (actual time=0.0257..0.0365 rows=1 loops=1)
    -> Hash
        -> Covering index scan on u using idx_dept  (cost=101737 rows=994345) (actual time=0.655..117 rows=1e+6 loops=1)
                                                                                            ↑ 整棵索引扫完
```

**239 毫秒**（vs 优化器自选的 3.56 ms）。

**注意它连算法都被迫改了**：被强制先扫 `user_big` 之后，NLJ + 索引这条路就没了，只能退化成 Hash Join，而且 build 侧成了 100 万行的 `u`。

| 驱动表 | 算法 | 耗时 | 倍数 |
|--------|------|------|------|
| `dept_dim`（过滤后 1 行）| NLJ + 索引 | **3.56 ms** | 1× |
| `user_big`（100 万行）| Hash Join | **239 ms** | **67×** |

> 🔑 **"小表驱动大表"的准确说法是「过滤后结果集小的表当驱动表」。**
>
> 一张 100 万行的表，如果 `WHERE` 能把它过滤到 1 行，它就该当驱动表；一张 100 行的表，如果没有任何过滤条件，它反而可能不该当。**优化器看的是 `rows × filtered`**（`03` §六讲的那个乘积），不是表的大小。

**这也回答了 `03` 留的问题**：那条四表 JOIN 为什么执行顺序是 `ur → r → m → rm`，而不是 SQL 里写的 `m → rm → ur → r`？因为 `WHERE ur.user_id = 2` 是**整条 SQL 唯一的常量入口**，`ur` 过滤后只剩 1 行——**它是"最小"的那个**。

> ⚠️ **`STRAIGHT_JOIN` 是给你验证用的，不是给你日常用的。** 你今天觉得该让 A 驱动 B，明天数据分布变了就是错的。`03` §八已经证明**优化器的选择会随环境漂移**——把选择权焊死在 SQL 里，等于赌数据永远不变。

---

## 四、项目实证：`SysMenuMapper` 的四表 JOIN

`backend/src/main/java/com/rbac/system/menu/mapper/SysMenuMapper.java:14-24`。**这段代码本身就带着逐行中文注释**，我们逐条验证它，并补上注释没说的部分。

```java
@Select("""
        SELECT DISTINCT m.permission_code FROM sys_menu m               -- 只取权限码列，DISTINCT 去重；m 是 sys_menu 的别名
        JOIN sys_role_menu rm ON rm.menu_id = m.id                      -- 菜单 ←→ 角色 的桥（按 menu_id 拼接）
        JOIN sys_user_role ur ON ur.role_id = rm.role_id               -- 角色 ←→ 用户 的桥（按 role_id 拼接）
        JOIN sys_role r ON r.id = ur.role_id                           -- 连角色表，仅为下面过滤"禁用角色"
        WHERE ur.user_id = #{userId}                                   -- 入口：只看这个用户的角色（使用参数占位符，防 SQL 注入）
          AND m.deleted = 0 AND m.status = 'ENABLED'                   -- 菜单未被逻辑删除、且处于启用
          AND r.deleted = 0 AND r.status = 'ENABLED'                   -- 角色未被逻辑删除、且处于启用（禁用角色的权限不生效）
          AND m.permission_code IS NOT NULL AND m.permission_code <> ''  -- 权限码非 null 且非空串：只留按钮(BUTTON)，排除目录/菜单
        """)
List<String> selectPermissionCodesByUserId(Long userId);
```

### 四张表怎么串起来的

RBAC 的核心链路是 `用户 → 角色 → 菜单`，中间隔着**两座桥**：

```
sys_user_role (ur)  ──role_id──>  sys_role (r)
      │                                （只为过滤禁用角色）
   user_id = ?
      │
      └──role_id──>  sys_role_menu (rm)  ──menu_id──>  sys_menu (m)
```

- `ur` 是**入口**：`WHERE ur.user_id = ?`，唯一的常量条件
- `rm` 是**第二座桥**：从角色跳到菜单
- `m` 是**目的地**：真正要的 `permission_code`
- `r` **不在链路上**——它只为一件事存在：**过滤掉被禁用的角色**

### 为什么必须连 `sys_role`

这是最容易被问的一个设计点。链路 `ur → rm → m` 已经能拿到菜单了，`r` 看着多余。

**但少了它，禁用一个角色就不生效。** `ur` 里只有 `user_id` 和 `role_id`，**它不知道这个角色是不是被禁用了**——那个信息在 `sys_role.status` 里。不连 `r`，就没法写 `r.status = 'ENABLED'`。

> 🔑 **`JOIN sys_role r` 不是为了取数据，是为了取「过滤条件」。** 它连出来的列一个都没进 `SELECT`。
>
> **这是 JOIN 的第二个真实动机**：**你要的过滤条件长在另一张表上。**

### 执行计划逐行读（`03` 已跑过，这里补 JOIN 视角）

用 `user_id = 2`（`test`，`system_admin`）：

```
+----+-------+--------+--------------+---------+---------------------------+------+----------+--------------------------------------------+
| id | table | type   | key          | key_len | ref                       | rows | filtered | Extra                                      |
+----+-------+--------+--------------+---------+---------------------------+------+----------+--------------------------------------------+
|  1 | ur    | ref    | uk_user_role | 8       | const                     |    1 |   100.00 | Using index; Using temporary               |
|  1 | r     | eq_ref | PRIMARY      | 8       | rbac.ur.role_id           |    1 |    33.33 | Using where                                |
|  1 | m     | ALL    | NULL         | NULL    | NULL                      |   48 |     2.08 | Using where; Using join buffer (hash join) |
|  1 | rm    | eq_ref | uk_role_menu | 16      | rbac.ur.role_id,rbac.m.id |    1 |   100.00 | Using index; Distinct                      |
+----+-------+--------+--------------+---------+---------------------------+------+----------+--------------------------------------------+
```

**执行顺序 `ur → r → m → rm`，和 SQL 写的顺序完全不同**（§三已解释：`ur` 过滤后只剩 1 行，是最小的）。

**`m` 那行的 `hash join` 是怎么回事**：`sys_menu` 只有 48 行，`m` 和前面的 `ur`/`r` **之间没有任何直接连接条件**（`m` 是通过 `rm` 才和它们发生关系的）。优化器决定：先把 `ur⋈r` 的结果（1 行）和 `m` 的 48 行**做一次笛卡尔积**，再用 `rm` 去验证每一对合不合法。

`EXPLAIN ANALYZE` 里写得很直白：

```
-> Inner hash join (no condition)  (cost=6.43 rows=0.00694) (actual time=3.3..3.33 rows=40 loops=1)
                    ↑ 「no condition」= 没有连接条件 = 笛卡尔积
```

> **这就是 `03` 留的那个问题的答案**：`Inner hash join (no condition)` 不是 bug，是优化器算过账——`1 × 48 = 48` 对组合，代价微不足道，比绕路便宜。**只有在小表上它才敢这么干。**

**`rm` 那行的 `Distinct`**：

```
-> Limit: 1 row(s)  (cost=1.3 rows=1) (actual time=0.0232..0.0232 rows=1 loops=40)
    -> Single-row covering index lookup on rm using uk_role_menu (role_id=ur.role_id, menu_id=m.id)
```

`loops=40` = 上一层出了 40 行，这步跑了 40 轮。`Limit: 1 row(s)` = **因为最外层有 `DISTINCT`，找到一条匹配就够了**，不用继续找。

**`key_len=16`** = `uk_role_menu (role_id, menu_id)` 两列吃满，`ref` 也印证：`rbac.ur.role_id, rbac.m.id`。**这个桥表被查得非常干净**——两列都给了，且是覆盖索引（`Using index`），**完全不回表**。

---

## 五、超管短路：一个完整的优化案例

**这是本项目最值得讲的一个优化，但它藏在 Java 里，光看 SQL 发现不了。**

`SysMenuMapper` 有**两套**方法：

| 用户 | 权限码 | 菜单树 | 走 JOIN 吗 |
|------|--------|--------|-----------|
| 普通用户 | `selectPermissionCodesByUserId`（四表 JOIN） | `selectVisibleMenusByUserId`（四表 JOIN） | ✅ |
| **超管** | `selectAllPermissionCodes`（**单表**） | `selectAllVisibleMenus`（**单表**） | ❌ **短路** |

分叉点在 `LoginUserAssembler.java:59-61` 和 `AuthService.java:152-153`，用 `roleCodes.contains("super_admin")` 三元表达式选路。

超管走的是：

```sql
SELECT DISTINCT permission_code FROM sys_menu
WHERE deleted = 0 AND status = 'ENABLED'
  AND permission_code IS NOT NULL AND permission_code <> ''
```

**一张表，零 JOIN。**

### 为什么可以这么干

因为**超管的 JOIN 结果恒等于全表**。实测（HANDOFF 记录）：`super_admin` 配了全部 **48** 个菜单，`sys_menu` 一共就 **48** 行——**JOIN 出来的结果集，和不 JOIN 直接查全表，完全一样。**

既然结果一样，那三次 JOIN + `DISTINCT` 去重就是纯浪费。

> 🔑 **用一个布尔判断（`roleCodes.contains("super_admin")`）换掉一条四表 JOIN，是"用业务知识优化查询"的典型。**
>
> **优化器永远做不到这一步**——它不知道"超管"这个业务概念，也不知道"超管必然配了所有菜单"这条业务不变式。**这类优化只能人来做。**

### ⚠️ 一个必须澄清的误解

**练习册 01 手工三步数出 `admin` = 48 个菜单，但真实应用压根不这么算。**

练习册走的是 `用户 → 角色 → 菜单` 三步链路；应用对超管走的是 `SELECT * FROM sys_menu WHERE deleted=0 AND status='ENABLED'`。

**结果恰好都是 48，但路径完全不同。**

（练习册 §三末尾已就此加过说明。这里再强调一次，因为这是最容易形成错误心智模型的地方：**别以为超管也走 JOIN。**）

### 这个设计的代价

短路是有代价的——**它把"超管权限全开"这条规则从数据里搬进了代码里**。

现在 `sys_role_menu` 里 `super_admin` 那 48 行配置**其实是死数据**：应用查超管权限时根本不读它。**如果哪天有人从超管角色里删掉几个菜单，界面上不会有任何变化**——因为代码根本不看那张表。

> **这是个值得在面试里讲的取舍**：性能上赚了（省掉四表 JOIN），一致性上亏了（配置和实际行为脱节）。**能说出"我知道这里亏了什么"，比只说"这里做了优化"高一个层次。**

---

## 六、桥表不带 `deleted`：炸一个幽灵菜单出来

> 还练习册 §四 + 自检 2/4 的扣。

### 事实

```sql
SHOW CREATE TABLE sys_role_menu\G
```

```sql
CREATE TABLE `sys_role_menu` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `role_id` bigint NOT NULL COMMENT '角色 ID',
  `menu_id` bigint NOT NULL COMMENT '菜单 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_menu` (`role_id`,`menu_id`)
) ENGINE=InnoDB AUTO_INCREMENT=289 DEFAULT CHARSET=utf8mb4 COMMENT='角色菜单关联表'
```

**三列。没有 `deleted`，没有审计五件套。**

（顺带：`AUTO_INCREMENT=289` 但只有 **96** 行——和 `sys_user_role` 的 `12 vs 5` 是同一个成因：改配置时"先全删再全插"，每改一次烧掉一批自增值。`02` §四已讲过。）

**后果**：主表 `sys_menu` 用 `deleted=1` 软删，**桥表却是硬删**。两种删除语义并存，**桥表自己没有能力表达"这条授权失效了"**。

### 炸给你看

`rbac` 库只读，在 `rbac_lab` 建等价复制品（`g_menu` / `g_role_menu` / `g_user_role`，结构照抄）。user 7 挂 role 2，role 2 配了 3 个菜单：

```sql
SELECT m.permission_code FROM g_menu m
JOIN g_role_menu rm ON rm.menu_id = m.id
JOIN g_user_role ur ON ur.role_id = rm.role_id
WHERE ur.user_id = 7 AND m.deleted = 0 AND m.status = 'ENABLED';
```

```
+---------------------+
| permission_code     |
+---------------------+
| system:user:list    |
| system:user:delete  |
| finance:report:view |
+---------------------+
```

**管理员把「财务报表」这个菜单逻辑删除**：

```sql
UPDATE g_menu SET deleted = 1 WHERE id = 3;

SELECT COUNT(*) AS 桥表还剩几行 FROM g_role_menu;
-- 3        ← 授权行原封不动
```

**主表软删了，桥表纹丝不动**——那条"role 2 有 menu 3"的授权**还在**。

**写对了**（带 `m.deleted = 0`，也就是项目的真实写法）：

```
+--------------------+
| system:user:list   |
| system:user:delete |
+--------------------+
```
✅ 2 个，正确。

**漏了 `m.deleted = 0`**：

```sql
SELECT m.permission_code FROM g_menu m
JOIN g_role_menu rm ON rm.menu_id = m.id
JOIN g_user_role ur ON ur.role_id = rm.role_id
WHERE ur.user_id = 7 AND m.status = 'ENABLED';    -- 少了一个条件
```

```
+---------------------+
| system:user:list    |
| system:user:delete  |
| finance:report:view |     ← 幽灵！已删除的菜单，权限照发
+---------------------+
```

**❌ 被删掉的 `finance:report:view` 权限，依然发给了用户。**

**更隐蔽的一种**——只查桥表，连主表都不 JOIN：

```sql
SELECT rm.menu_id FROM g_role_menu rm JOIN g_user_role ur ON ur.role_id = rm.role_id
WHERE ur.user_id = 7;
```

```
+---------+
| menu_id |
|       1 |
|       2 |
|       3 |     ← 必炸，且你连过滤的机会都没有
+---------+
```

**这条 SQL 无药可救**：桥表没有 `deleted` 列，**你想过滤都没得滤**。必须 JOIN 主表。

> 🔑 **桥表不带 `deleted`，等于把"过滤已删除数据"的责任，转嫁给了每一条碰它的 SQL。**
>
> **漏一次就是一个权限泄漏。** 而且它不报错、不抛异常——**只是悄悄多发一个权限**。这不是查询 bug，**是安全 bug**（对照 `CLAUDE.md` 的安全红线："前端隐藏只是体验，敏感操作后端必须再鉴权"——如果后端鉴权用的权限集本身就是脏的，那道防线就塌了）。

### 那给桥表加个 `deleted` 不就行了？

**别急。** 这正好会重蹈 `uk_user_username` 的覆辙。

`sys_role_menu` 上有 `UNIQUE KEY uk_role_menu (role_id, menu_id)`。如果加 `deleted` 并把唯一键改成 `(role_id, menu_id, deleted)`：

- `deleted` 只有 0/1 两个值
- → **同一个 `(role_id, menu_id)` 最多只能软删一次**
- → 第二次给这个角色配这个菜单、再删，**撞唯一键**

**这和 `00` 自检 4 / `01` §四.3 说的 `uk_user_username (username, deleted)` 只允许软删一份重复，是同一个洞。**

> **`07` 会把这条线串起来算总账**：逻辑删除、零外键、桥表硬删、唯一键带 `deleted`——**这几件事是同一个哲学的四个面**，各自的取舍和代价要放在一起看才说得清。

**本节的结论只有一句**：**桥表走硬删，是这个项目的既成事实；每一条碰桥表的 JOIN 都必须自己过滤主表的 `deleted = 0`，一次都不能漏。** `SysMenuMapper` 的四个方法**全都记得过滤**——这一点它做对了。

---

## 七、子查询 vs JOIN：一个过时的面试题

**"`IN` 和 `EXISTS` 哪个快？"** —— 这题的标准答案在 MySQL 8 里已经变了。

老结论（MySQL 5.5 及更早）：`IN` 子查询会被低效地反复执行，`EXISTS` 更好。**这个结论现在是错的。**

### 实测

```sql
-- IN
EXPLAIN ANALYZE SELECT COUNT(*) FROM user_big u
 WHERE u.dept_id IN (SELECT d.dept_id FROM dept_dim d WHERE d.dept_name='部门50')\G
```

```
-> Aggregate: count(0)  (cost=19754 rows=1) (actual time=2.04..2.04 rows=1 loops=1)
    -> Nested loop inner join  (cost=9909 rows=98450) (actual time=0.796..1.82 rows=10000 loops=1)
        -> Table scan on <subquery2>  (cost=11.5..13.9 rows=10) (actual time=0.169..0.169 rows=1 loops=1)
            -> Materialize with deduplication  (cost=11.3..11.3 rows=10) ...
                -> Filter: (d.dept_name = '部门50')  (cost=10.2 rows=10) ...
                    -> Table scan on d  (cost=10.2 rows=100) ...
        -> Covering index lookup on u using idx_dept (dept_id=`<subquery2>`.dept_id)  (cost=1035 rows=9845) ...
```

```sql
-- EXISTS
EXPLAIN ANALYZE SELECT COUNT(*) FROM user_big u
 WHERE EXISTS (SELECT 1 FROM dept_dim d WHERE d.dept_id=u.dept_id AND d.dept_name='部门50')\G
```

```
-> Aggregate: count(0)  (cost=19754 rows=1) (actual time=1.23..1.23 rows=1 loops=1)
    -> Nested loop inner join  (cost=9909 rows=98450) (actual time=0.0533..1.01 rows=10000 loops=1)
        -> Table scan on <subquery2>  (cost=11.5..13.9 rows=10) ...
            -> Materialize with deduplication  (cost=11.3..11.3 rows=10) ...
                -> Filter: (d.dept_name = '部门50')  ...
                    -> Table scan on d  ...
        -> Covering index lookup on u using idx_dept (dept_id=`<subquery2>`.dept_id) ...
```

**两个计划一模一样**，连 `cost=19754` 都分毫不差。

| 写法 | `cost` | 计划 |
|------|--------|------|
| `JOIN` | 19901 | NLJ + 索引 |
| `IN` 子查询 | **19754** | **半连接 + 物化 + NLJ + 索引** |
| `EXISTS` | **19754** | **同上，完全一致** |

> 🔑 **MySQL 8 会把 `IN` 和 `EXISTS` 都改写成「半连接」（semi-join），最终跑的是同一个计划。**
>
> `Materialize with deduplication` = 把子查询结果**物化成临时表并去重**，`<subquery2>` 就是它。之后就是一次普通的 NLJ。
>
> **所以"`IN` 慢、`EXISTS` 快"是 2012 年的知识。** 现在该答："**MySQL 8 里两者会被优化器改写成同一个半连接计划，我实测过 `cost` 完全相同。真正决定快慢的是子查询的表能不能用上索引、以及物化后的结果集有多大——不是你写 `IN` 还是 `EXISTS`。**"

**什么时候还是有区别**：子查询里有 `NULL` 时（`NOT IN` 遇到 `NULL` 会返回空集，`NOT EXISTS` 不会）——**这是语义差别，不是性能差别**，而且是个经典陷阱。

---

## 八、`DISTINCT` 的代价

那条四表 JOIN 开头就是 `SELECT DISTINCT m.permission_code`。**为什么需要它？**

因为一个用户可能挂**多个角色**，多个角色可能**配了同一个菜单**。JOIN 会把每条路径都展开成一行 → **同一个 `permission_code` 出现多次**。

代价在执行计划里看得很清楚：

```
| ur | ... | Using index; Using temporary |
                            ↑ 为 DISTINCT 建的临时表
```

```
-> Table scan on <temporary>  (cost=9.27..9.27 rows=0.00694) (actual time=4.77..4.78 rows=40 loops=1)
    -> Temporary table with deduplication  (actual time=4.77..4.77 rows=40 loops=1)
```

**`Temporary table with deduplication`** —— 所有结果先落进一张临时表，去重后再读出来。

**但 `DISTINCT` 也带来了一个优化**：

```
-> Limit: 1 row(s)  (actual time=0.0232..0.0232 rows=1 loops=40)
    -> Single-row covering index lookup on rm using uk_role_menu (...)
```

**`Limit: 1 row(s)`** —— 优化器意识到"反正要去重，`rm` 里找到一条匹配就够了"，于是加了短路。

> 🔑 **`DISTINCT` 是笔双向的账**：付出一张临时表，换回一个"找到就停"的短路。在本项目 40 行的规模上，两边都无所谓。
>
> **但要知道它在大结果集上会疼**：临时表可能落盘（`Using temporary` + 大 `rows`），这是个真实的性能悬崖。

**能不能不用 `DISTINCT`**？可以——用 `EXISTS` 改写（"存在一条路径能到达这个菜单"），语义上就不产生重复。但对 40 行的规模，**这属于没必要的聪明**。

---

## 九、对照表：概念 ↔ 本项目 ↔ 实际作用

| 概念 | 本项目 / 实验对应 | 实际作用 |
|------|------------------|---------|
| JOIN 的动机①：补 0 行 | `audit_admin` 在 `INNER JOIN` 下**整行消失** | **只有 `LEFT JOIN` 能表达"这边可以没有"** |
| `COUNT(*)` vs `COUNT(列)` | `LEFT JOIN` 后 `audit_admin` = **1 vs 0** | `COUNT(*)` 数行，`COUNT(列)` 数非 NULL |
| JOIN 的动机②：借过滤条件 | `JOIN sys_role r` 一列都没进 `SELECT` | **只为 `r.status='ENABLED'`** |
| NLJ | `dept_dim`（1 行）驱动 `user_big` | **3.56 ms**；内层走索引才快 |
| Hash Join | `IGNORE INDEX` 后 | **193 ms**（54×）；probe 侧要全扫 |
| BNL | **8.0.20 起已移除** | 开关 `block_nested_loop` 现在控制 hash join |
| 驱动表 | `STRAIGHT_JOIN` 强制大表驱动 | **239 ms**（67×），且算法被迫退化 |
| "小表"的真义 | `ur` 过滤后 1 行 → 排第一 | **`rows × filtered` 最小，不是表最小** |
| JOIN 顺序重排 | 写 `m→rm→ur→r`，跑 `ur→r→m→rm` | 优化器按过滤后大小挑 |
| `hash join (no condition)` | `ur⋈r` (1 行) × `m` (48 行) | **笛卡尔积**；小表上比绕路便宜 |
| 业务知识优化 | **超管短路掉整条 JOIN** | 优化器永远做不到；代价是配置与行为脱节 |
| 桥表硬删 | `sys_role_menu` **无 `deleted`**，`AUTO_INCREMENT=289` / 96 行 | **每条 JOIN 必须自己滤主表 `deleted=0`** |
| 幽灵菜单 | 漏 `m.deleted=0` → 已删权限照发 | **安全 bug，不报错** |
| `IN` vs `EXISTS` | `cost` **都是 19754**，计划完全相同 | MySQL 8 都改写成半连接 |
| `DISTINCT` | `Temporary table with deduplication` | 付一张临时表，换 `Limit: 1 row(s)` 短路 |

---

## 面试怎么问

### Q1：JOIN 有哪几种算法？

**要点**：

1. **NLJ**（嵌套循环）：外层每一行，去内层找匹配。**内层能走索引就快**（一次树查找），走不了就是 `N × 全表`。
2. **Hash Join**（8.0.18+）：小的一边建哈希表（build 侧），另一边逐行探测（probe 侧）。**无索引时的救命方案。**
3. **BNL**：**8.0.20 起已被移除**，场景全部由 Hash Join 接管。

**用数据说话**：
> 我做过受控对照：100 万行的 `user_big` 和 100 行的部门维表连，被驱动表能走索引时是 **NLJ，3.56 ms**；用 `IGNORE INDEX` 把索引拿掉，退化成 **Hash Join，193 ms——54 倍**。
>
> 但要说清：**Hash Join 慢不是因为哈希慢，是因为它必须把 probe 侧全扫一遍**（执行计划里 `actual rows=1e+6`）。它的对手不是"NLJ + 索引"，而是"NLJ 无索引"——那是 N 次全表扫描，更惨。

**加分（能区分背书和实践）**：
> 有个细节：`optimizer_switch` 里到现在还有 `block_nested_loop=on`，但 8.0.20 之后**它控制的其实是 Hash Join**，名字只是为了兼容留着的。所以说"无索引走 BNL"在 8.0.20 之后已经不准确了。

### Q2：什么是"小表驱动大表"？

**要点**：NLJ 里**驱动表的行数 = 内层要跑的轮数**，所以驱动表越小越好。

**但关键在这句**：**"小"不是指表小，是指「`WHERE` 过滤之后的结果集小」。**

**用项目举例**：
> 本项目那条四表 JOIN，SQL 里写的顺序是 `sys_menu → sys_role_menu → sys_user_role → sys_role`，**但执行顺序是 `sys_user_role → sys_role → sys_menu → sys_role_menu`**。优化器把 `sys_user_role` 提到最前，因为 `WHERE ur.user_id = ?` 是整条 SQL 唯一的常量入口，**过滤后只剩 1 行**——它不是最小的表，但它是过滤后最小的结果集。

**用数据说话**：
> 我用 `STRAIGHT_JOIN` 强制换驱动表验证过：优化器自选（小表驱动）**3.56 ms**，强制让 100 万行的表驱动 **239 ms，67 倍**。而且**算法都被迫退化了**——先扫大表之后，NLJ + 索引那条路就没了，只能走 Hash Join。

**加分**：**`STRAIGHT_JOIN` 是验证工具，不是日常写法。** 数据分布会变，把选择权焊死在 SQL 里等于赌它永远不变。

### Q3：`IN` 和 `EXISTS` 哪个快？

**这题在钓鱼**——很多人会背 2012 年的结论"`EXISTS` 比 `IN` 快"。

**正确答法**：
> **在 MySQL 8 里没有区别。** 优化器会把两者都改写成**半连接**（semi-join）。我实测过同一个查询的两种写法，**执行计划完全一致，连 `cost` 都是同一个数字 19754**，都是 `Materialize with deduplication` 把子查询物化成临时表，然后一次普通的 NLJ。
>
> "`IN` 慢"是 MySQL 5.5 及更早的问题（子查询会被反复执行）。**真正决定快慢的是子查询的表能不能用上索引、物化后的结果集多大——不是你写 `IN` 还是 `EXISTS`。**

**加分（把性能问题拉回语义问题）**：
> 它们**确实**有一个区别，但是**语义上的，不是性能上的**：`NOT IN` 的子查询里只要出现一个 `NULL`，整个结果就是空集；`NOT EXISTS` 不会。**这才是该关心的坑。**

### Q4：你们项目那条四表 JOIN 讲一下

**这是白送分，但要讲出层次。**

> 是 `SysMenuMapper.selectPermissionCodesByUserId`，走 RBAC 的核心链路 `用户 → 角色 → 菜单`，中间隔着两座桥表 `sys_user_role` 和 `sys_role_menu`。入口是 `WHERE ur.user_id = ?`。
>
> **有个设计点值得说**：它还连了第四张表 `sys_role`，**而 `sys_role` 的列一个都没进 `SELECT`**。连它纯粹是为了 `r.status = 'ENABLED'`——桥表里只有 `user_id` 和 `role_id`，**它不知道这个角色是不是被禁用了**，那个信息在 `sys_role` 里。**这是 JOIN 的另一个动机：你要的过滤条件长在别的表上。**

**杀手锏（讲出优化器做不到的事）**：
> 但**真实登录时超管根本不跑这条 SQL**。代码里用 `roleCodes.contains("super_admin")` 分了两套路——超管走单表 `SELECT * FROM sys_menu WHERE deleted=0 AND status='ENABLED'`，零 JOIN。
>
> 因为**超管的 JOIN 结果恒等于全表**（实测：超管配了全部 48 个菜单，`sys_menu` 一共就 48 行），三次 JOIN + `DISTINCT` 是纯浪费。**用一个布尔判断换掉一条四表 JOIN——这类优化优化器永远做不到，它不知道"超管"是什么。**

**再加一层（能讲出取舍 = 加分）**：
> 这个短路也有代价：**它把"超管权限全开"从数据搬进了代码**。现在 `sys_role_menu` 里超管那 48 行配置其实是死数据——有人从超管角色里删掉几个菜单，界面上不会有任何变化，因为代码根本不读它。**性能赚了，一致性亏了。**

### Q5：你在项目里发现过什么设计风险？

**（`02` 的 Q6 答的是性能问题，这题答设计问题，两题可以配合用。）**

> `sys_role_menu` 这张桥表**只有三列**：`id` / `role_id` / `menu_id`，**没有 `deleted`，也没有审计字段**。而它连接的主表 `sys_menu` 是**逻辑删除**的。
>
> **两种删除语义并存**，后果是：桥表**自己没有能力表达"这条授权失效了"**——菜单被软删后，授权行原封不动地留着。
>
> 我在实验库照结构复制了一套验证过：把一个菜单 `UPDATE ... SET deleted=1` 之后，桥表纹丝不动；这时候**只要哪条 JOIN 漏写了 `m.deleted = 0`，那个已删菜单的权限就照发给用户**。更糟的是"只查桥表不 JOIN 主表"的写法——**它连过滤的机会都没有**，因为桥表压根没这一列。
>
> **这不是查询 bug，是安全 bug**：不报错、不抛异常，只是悄悄多发一个权限。

**必须补的一句（否则显得只会挑毛病）**：
> 项目目前**是对的**——`SysMenuMapper` 的四个方法全都记得过滤主表。**风险在于它依赖每个人每次都记得**。
>
> 而且"那给桥表加个 `deleted` 不就行了"是个陷阱：唯一键 `uk_role_menu (role_id, menu_id)` 要跟着变成三列，`deleted` 只有 0/1 → **同一对 `(role_id, menu_id)` 只能软删一次**，第二次就撞唯一键。**这和 `uk_user_username (username, deleted)` 只允许软删一个同名用户，是同一个洞。**

**为什么这个答案好**：发现问题 → **动手复现**（不是空谈）→ 说清危害等级（安全而非性能）→ **承认现状是对的**（不夸大）→ 指出真正的风险是"依赖人不犯错" → **连提出的修法自己都能证伪**。

### Q6：`COUNT(*)` 和 `COUNT(列名)` 有区别吗？

**要点**：`COUNT(*)` **数行数**；`COUNT(列名)` 数**该列非 NULL 的个数**。

**平时一样，`LEFT JOIN` 之后就不一样了——这是重点。**

**用项目举例**：
> 本项目有个角色 `audit_admin` 一个菜单都没配。用 `INNER JOIN` 统计每个角色的菜单数，**它整行消失了**——不是显示 0，是没这一行，因为 `INNER JOIN` 要求两边都有匹配。
>
> 改成 `LEFT JOIN` 把它捞回来，如果用 `COUNT(*)` 会显示 **1**——因为 `LEFT JOIN` 确实产生了一行（右表列全是 `NULL`），`COUNT(*)` 数行不看内容。**必须用 `COUNT(rm.menu_id)`，`NULL` 不计，才是 0。**
>
> **`LEFT JOIN` + `COUNT(*)` 是个经典错误组合**：好不容易补回来的 0 行，又被数成了 1。

**加分**：`COUNT(*)` 在 InnoDB 里**不会真的去读每一列**，优化器会挑一个最小的索引扫——所以 `COUNT(*)` 不比 `COUNT(1)` 慢，这两个是完全等价的，**别信"`COUNT(1)` 更快"那套说法**。

---

## 动手练习

> `rbac` 库只读；写操作全在 `rbac_lab`。

1. **让 `audit_admin` 回来**：不用 `LEFT JOIN`，用别的写法统计出"每个角色的菜单数（含 0）"。（提示：子查询也能做，试试哪种计划更好）

2. **`COUNT` 陷阱**：解释为什么 `LEFT JOIN` + `COUNT(*)` 会把 0 数成 1，然后构造一个"`COUNT(*)` 和 `COUNT(列)` 结果相同"的 `LEFT JOIN` 查询。

3. **驱动表实验**：用 `dept_dim` 和 `user_big`，构造一个**优化器选错驱动表**的查询（提示：`03` §五讲的 `filtered` 猜测，想办法骗它），再用 `STRAIGHT_JOIN` 纠正，对比 `EXPLAIN ANALYZE`。

4. **逼出 Hash Join**：不用 `IGNORE INDEX`，让 `user_big` 和 `dept_dim` 的 JOIN 走 Hash Join。（提示：连接条件上做点手脚，`02` §六有现成的四种姿势）

5. **炸幽灵菜单**：用 `g_menu` / `g_role_menu` / `g_user_role` 复现本节 §六 的实验，然后回答：如果**角色**被逻辑删除（不是菜单），会不会也有幽灵？`SysMenuMapper` 防住了吗？

6. **给超管短路挑刺**：`selectAllVisibleMenus` 对超管返回全部启用菜单。构造一个"配置和实际行为脱节"的场景——从 `sys_role_menu` 里删掉超管的几行（**在 `rbac_lab` 的复制品上做**），证明界面不受影响。

7. **（思考题，无标准答案）** 如果 `sys_menu` 涨到 10 万行、用户平均挂 5 个角色、每个角色配 200 个菜单，这条四表 JOIN 还扛得住吗？你会怎么改？（提示：想想 `DISTINCT` 的临时表、想想缓存该放哪一层）

---

## 自检问题

1. 为什么说"JOIN 的第一个动机不是省往返"？举一个单表查询根本做不到的例子。

2. `INNER JOIN` 让 `audit_admin` 消失了。这个 bug 为什么特别危险？

3. NLJ 什么时候快、什么时候慢？决定性因素是哪一个？

4. "小表驱动大表"里的"小"指什么？举一个"表很大但该当驱动表"的例子。

5. 那条四表 JOIN 里，`JOIN sys_role r` 连出来的列一个都没进 `SELECT`。那为什么必须连它？

6. 超管为什么不走 JOIN？这个优化优化器能自动做到吗？为什么？它的代价是什么？

7. `sys_role_menu` 没有 `deleted` 列。这件事把什么责任转嫁给了谁？漏了会怎样？

8. "给桥表加个 `deleted` 就好了"——这个提议错在哪？它和 `uk_user_username` 有什么关系？

9. `IN` 和 `EXISTS` 哪个快？如果面试官坚持说 `EXISTS` 快，你怎么回应？

---

## 下一节预告

到这里，**查询侧的知识基本闭环了**：`02` 讲索引怎么组织数据、`03` 讲优化器怎么读它、`04` 讲多表怎么拼。**全都是"读"。**

**`05` 开始转向"写"，而写的世界是另一套规则。**

本节其实已经踩到门槛了：§六 说 `sys_role_menu` 改配置的实现是"**先全删再全插**"（`UserService.java:224-230` 的 `replaceRoles`，`AUTO_INCREMENT=289` 而只有 96 行就是它烧出来的）。

**这个写法有个致命问题：如果"删完了、还没插完"的那一瞬间，别的请求正好在查这个用户的权限，会看到什么？**

- 答案取决于**事务隔离级别**和 **MVCC**——`05` 的主题。
- 而 `01` §一 埋的扣也在这里收：**InnoDB 为什么存不了一个行数计数器？** 因为不同事务看到的行数本来就不一样。
- 项目里 **14 处 `@Transactional`**，其中 `DefinitionService` / `WorkflowEngineImpl` 写的是 `@Transactional(rollbackFor = Exception.class)`，而 `RoleService` / `UserService` / `DictService` 是**裸的 `@Transactional`**。**这个不一致会导致什么？**（提示：checked 异常默认不回滚）
- `replaceRoles` **为什么必须在事务里**？如果不在，最坏会发生什么？

**`05-事务与隔离级别.md` 是本套的第二个重头戏**：ACID、四级隔离、脏读/不可重复读/幻读、MVCC、undo log、ReadView。会开**两个 `docker exec` 会话**手动 `BEGIN`，把每一种异常现象**当场演出来**。

---

## 附：答案与解析

<details>
<summary><b>练习 1：不用 LEFT JOIN 让 audit_admin 回来</b></summary>

**标量子查询**：

```sql
SELECT r.role_code,
       (SELECT COUNT(*) FROM sys_role_menu rm WHERE rm.role_id = r.id) AS 菜单数
FROM sys_role r WHERE r.deleted = 0;
```

```
+--------------+-----------+
| role_code    | 菜单数    |
+--------------+-----------+
| super_admin  |        48 |
| system_admin |        48 |
| audit_admin  |         0 |
+--------------+-----------+
```

**为什么这次 0 出得来**：因为**主查询是 `sys_role` 的单表扫描**，3 个角色一个不少；子查询只是给每一行**算一个值**。`audit_admin` 那行的子查询返回 0——**它从来没有"消失"的机会**。

**哪种更好**：

`EXPLAIN` 会显示 `DEPENDENT SUBQUERY`（`03` §二讲过）——**外层每出一行，子查询跑一次**。3 行跑 3 次，无所谓；但如果角色有 10 万个，就是 10 万次。

**`LEFT JOIN` 版本是一次扫描 + 一次聚合，扩展性更好。** 标量子查询胜在**可读性**，而且当"要统计的东西有好几种"时（同时要菜单数、用户数、日志数），`LEFT JOIN` 多个表会产生**行数爆炸**（笛卡尔积），那时标量子查询反而是对的。

**结论：小数据量看可读性，大数据量看计划。别背"子查询一定慢"。**

</details>

<details>
<summary><b>练习 2：COUNT 陷阱</b></summary>

**为什么 0 被数成 1**：

`LEFT JOIN` 保留左表所有行，右表无匹配时**把右表的列全填 `NULL`**。所以 `audit_admin` **确实产生了一行**，只是 `rm.id` / `rm.role_id` / `rm.menu_id` 全是 `NULL`。

- `COUNT(*)` = 数**行**，不看内容 → 这行算数 → **1**
- `COUNT(rm.menu_id)` = 数**该列非 NULL 的个数** → `NULL` 不计 → **0**

**构造"两者相同"的查询**：只要**保证右表一定有匹配**，就没有 `NULL` 行，两者必然相同：

```sql
SELECT r.role_code, COUNT(*) AS a, COUNT(rm.menu_id) AS b
FROM sys_role r LEFT JOIN sys_role_menu rm ON rm.role_id = r.id
WHERE r.deleted = 0 AND r.role_code <> 'audit_admin'      -- 把没配菜单的角色排除掉
GROUP BY r.id, r.role_code;
```

两列都是 48 / 48。

> **这恰恰说明问题的隐蔽性**：只要数据里**碰巧**每个角色都配了菜单，这个 bug 就永远不发作。**它等着某一天有人建了个空角色。**

</details>

<details>
<summary><b>练习 3 / 4：驱动表与 Hash Join</b></summary>

**练习 4 最简单的解法**——在连接列上套函数（`02` §六.1 的姿势）：

```sql
EXPLAIN ANALYZE SELECT COUNT(*) FROM user_big u JOIN dept_dim d
 ON u.dept_id = d.dept_id + 0        -- 让索引用不上
 WHERE d.dept_name = '部门50';
```

或者隐式类型转换：`ON u.dept_id = CAST(d.dept_id AS CHAR)`。

**要点**：Hash Join 出现的**充要条件是"被驱动表没有可用索引"**，而不是"数据量大"。把索引废掉的任何一种姿势都能触发它。

**练习 3 的思路**：`dept_dim` 上没有任何索引，也没做过直方图 → 优化器对 `d.dept_name='部门50'` 只能**硬编码猜 10%**（`03` §六），即"100 行里有 10 行匹配"。而**实际只有 1 行**。

计划里能直接看到这个误差：

```
-> Filter: (d.dept_name = '部门50')  (cost=10.2 rows=10) (actual time=0.657..0.672 rows=1 loops=1)
                                              ↑ 估 10        ↑ 实际 1
```

**估算大了 10 倍。** 在这个查询里它恰好没导致选错（`dept_dim` 仍然是较小的一边），但**如果两张表的规模再接近一点，这个 10 倍误差就足以让它挑错驱动表**。

**这就是 `03` §六那句话的实战意义**：`filtered` 的猜测会连乘，JOIN 越多越容易翻车。

</details>

<details>
<summary><b>练习 5：角色被删会不会也有幽灵</b></summary>

**会——但项目防住了。**

`sys_user_role` 同样没有 `deleted`（三列：`id`/`user_id`/`role_id`，HANDOFF 实测）。所以角色被逻辑删除后，`sys_user_role` 里那条"用户挂这个角色"的记录**也原封不动地留着**。

**如果 SQL 只走 `ur → rm → m` 而不连 `sys_role`，被删角色的权限就会照发。**

**而这恰恰就是 `JOIN sys_role r` 存在的第二个理由**：

```sql
JOIN sys_role r ON r.id = ur.role_id
...
AND r.deleted = 0 AND r.status = 'ENABLED'
```

`r.deleted = 0` 挡的是"角色被软删"，`r.status = 'ENABLED'` 挡的是"角色被禁用"。**两件事，一条 JOIN 同时解决。**

> **所以 §四 说"`JOIN sys_role r` 仅为过滤禁用角色"其实说少了**——代码注释写的是"仅为过滤禁用角色"，但它**同时**在防"已删除角色"的幽灵。**这条 JOIN 比它的注释更重要。**

**这个练习的价值**：它说明 `SysMenuMapper` 那条 SQL 的每一个条件都不是装饰——**四张表、六个过滤条件，少任何一个都是一个权限泄漏。**

</details>

<details>
<summary><b>练习 6：证明超管配置是死数据</b></summary>

在 `rbac_lab` 的复制品上（**别动 `rbac`**）：

```sql
-- 模拟：把超管的部分授权删掉
DELETE FROM g_role_menu WHERE role_id = 1 AND menu_id IN (1,2);

-- 超管走的那条 SQL（单表，压根不读桥表）
SELECT DISTINCT permission_code FROM g_menu
WHERE deleted = 0 AND status = 'ENABLED' AND permission_code IS NOT NULL AND permission_code <> '';
-- 结果不变，一个权限都没少
```

**因为这条 SQL 里根本没有 `g_role_menu`。** 你把桥表整个 `TRUNCATE` 掉，超管的权限也纹丝不动。

**这就是"配置与行为脱节"的实证**：管理员在界面上给超管角色**取消勾选**几个菜单，点保存，数据库确实改了，**但超管登录后什么都没变**。

**该怎么看这件事**：

- **不是 bug**——超管本来就该权限全开，这是业务规则。
- **但它是个"沉默的谎言"**：界面允许你配置一个**不起作用**的东西。更好的做法是**界面上直接禁用超管的菜单配置**，或者给个提示"超管权限恒为全部，此配置不生效"。
- **面试价值**：能说出"这个优化在性能上是对的，但它在产品层面留了个坑"，比只说"这里做了短路优化"高一个层次。

</details>

<details>
<summary><b>自检答案</b></summary>

**1.** 因为"省往返"只是个量的差别（几条 SQL vs 一条），而**有些结果单表根本产不出来**。例子：`audit_admin` 一个菜单都没配，用 `INNER JOIN` + `GROUP BY` 统计时**它整行消失**——`GROUP BY` 只能对存在的行分组，**不存在的行，`COUNT` 变不出 0**。只有 `LEFT JOIN` 能表达"这一边可以没有"。

**2.** 因为**它不报错，只是少了一行**。没有异常、没有告警、SQL 语法完全正确。如果这是个统计报表，`audit_admin` 会安静地消失，**除非有人正好知道该有 3 个角色，否则永远发现不了**。而且它有条件触发——只要数据里碰巧每个角色都配了菜单，就永远不发作，**等着某天有人建个空角色**。

**3.** **决定性因素：内层（被驱动表）能不能走索引。**
- 内层走索引 → 每轮一次树查找 → 快（实测 3.56 ms）
- 内层没索引 → 每轮一次全表扫描 → **总代价 `N × 全表`** → 这才是"JOIN 慢"的真相

（MySQL 8 里内层没索引时通常已经不走 NLJ 了，优化器会改用 Hash Join，193 ms——虽然比 NLJ+索引慢 54 倍，但比 `N ×` 全表扫描强得多。）

**4.** **"小"指「`WHERE` 过滤之后的结果集小」，不是表的行数小。** 优化器看的是 `rows × filtered`。

**例子**：本项目的 `sys_user_role`（如果涨到几百万行）配上 `WHERE ur.user_id = ?` —— **过滤后只剩 1 行**，它照样该当驱动表。反过来，一张 100 行但没有任何过滤条件的维表，**100 行全要进内层循环**，反而可能不该当驱动表。

**5.** 因为**要的过滤条件长在 `sys_role` 上**。链路 `ur → rm → m` 确实能拿到菜单，但 `sys_user_role` 里只有 `user_id` 和 `role_id`，**它不知道这个角色是不是被禁用/被删除了**——那个信息在 `sys_role.status` 和 `sys_role.deleted` 里。不连 `r`，就写不出 `r.status='ENABLED' AND r.deleted=0`。

**这是 JOIN 的第二个动机：借过滤条件，而不是借数据。** 证据：`r` 的列一个都没进 `SELECT`。

**6.** **因为超管的 JOIN 结果恒等于全表**（实测：超管配了全部 48 个菜单，`sys_menu` 就 48 行），三次 JOIN + `DISTINCT` 是纯浪费。

**优化器做不到。** 它不知道"超管"这个业务概念，更不知道"超管必然配了所有菜单"这条**业务不变式**。优化器只能看统计信息，看不懂业务。**这类优化只能人来做。**

**代价**：把规则从**数据**搬进了**代码**。`sys_role_menu` 里超管那 48 行成了死数据——改它不会有任何效果，因为代码根本不读。**性能赚了，一致性亏了。**

**7.** **把"过滤已删除数据"的责任，从数据库转嫁给了每一条碰它的 SQL。**

漏了的后果：**已被逻辑删除的菜单，权限照发给用户**。而且——
- **不报错、不抛异常**，只是悄悄多一个权限 → **这是安全 bug，不是查询 bug**
- 最糟的写法是"只查桥表不 JOIN 主表"：**连过滤的机会都没有**，因为桥表压根没有 `deleted` 这一列

**8.** 错在**唯一键**。`uk_role_menu (role_id, menu_id)` 得跟着变成 `(role_id, menu_id, deleted)`，而 `deleted` 只有 0/1 两个值 → **同一对 `(role_id, menu_id)` 最多只能软删一次**，第二次配置+删除就撞唯一键 `Duplicate entry`。

**这和 `uk_user_username (username, deleted)` 是同一个洞**：软删一个 `zhangsan` 没问题，再软删第二个 `zhangsan` 就撞键（`00` 自检 4 / `01` §四.3 已埋，`07` 算总账）。

**根源**：**`deleted` 是个布尔，而"删除过几次"是个计数。** 用布尔去承载历史，只能记住一次。（真想解决得换思路：删除时间戳、或把历史行挪去归档表。）

**9.** **MySQL 8 里没有区别**——优化器把两者都改写成**半连接**。实测两种写法的执行计划完全一致，**`cost` 都是 19754**，都是 `Materialize with deduplication` + NLJ。

**如果面试官坚持 `EXISTS` 快**：别硬顶，给证据 + 给台阶——
> "这个结论在 MySQL 5.5 及更早是对的，那时 `IN` 子查询确实会被反复执行。但 8.0 之后优化器会做半连接改写，我实测过两种写法的 `EXPLAIN ANALYZE`，计划和 cost 完全一样。**不过 `NOT IN` 和 `NOT EXISTS` 确实有区别——子查询里有 `NULL` 时 `NOT IN` 会返回空集**，那个坑是真的。"

**这个回应的好处**：承认了对方结论的历史正确性、给了可验证的证据、**还主动送上一个真实的坑**——把"纠正面试官"变成了"补充信息"。

</details>
