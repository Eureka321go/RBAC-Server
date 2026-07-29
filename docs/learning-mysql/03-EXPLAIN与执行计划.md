# 03 · EXPLAIN 与执行计划

> **学习目标**：把 `EXPLAIN` 的每一列拆开，从"看现象"升级到"知道它为什么这么选"。

**读完你能**：

- 说清 `EXPLAIN` 到底执行不执行你的查询（答案比你以为的微妙）
- 按等级读懂 `type`，并说清 `const` 和 `ref` 的分界线在哪
- **手算 `key_len`**，并识破同一个数字的两种不同成因
- 说清 `rows` 是从哪个表里读出来的、为什么永远不精确、以及它什么时候干脆不看统计信息
- 说清 `filtered` 的 `10.00` 是**硬编码的猜测**，以及直方图什么时候有用、什么时候被无视
- 说清 `Using index` 和 `Using index condition` 的区别，并量化 ICP 值多少钱
- **理解执行计划是不稳定的**——同样的 SQL、同样的数据、同样的统计信息，计划可以不一样

---

## 〇、开工前：本节的数字为什么会"对不上"

先打个预防针，因为它本身就是本节的核心内容。

`02` 里 `user_big` 的 `rows` 一直显示 **995090**。本节你会看到 **995835**、**995224**、**994345**——同一张表，一行都没增没删。

**这不是笔误。** `rows` 是个估算值，每次 `ANALYZE TABLE` 都会给出一个新的数字。§四会把这件事查到底。在那之前，看到 `rows` 的尾数对不上，不用怀疑自己。

> 🔑 **本节的第一课，也是最反直觉的一课：EXPLAIN 输出的很多数字不是"测量"，是"估算"，甚至是"猜"。**

实验环境沿用 `02` 的 `rbac_lab`（`user_big` / `menu_big` 各 100 万行），`rbac` 库仍然只读。

---

## 一、EXPLAIN 到底执行不执行你的查询

标准答案是"不执行，只给计划"。**这个答案有例外，而且例外能被看见。**

### 实证：EXPLAIN 真的去读了表

`user_big` 的 `username` 是唯一的，`uk_username_deleted (username, deleted)` 是唯一索引。查一个存在的用户名：

```sql
EXPLAIN SELECT * FROM user_big WHERE username='user_0500000' AND deleted=0;
```

```
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+--------------------------------+
| id | select_type | table | partitions | type | possible_keys | key  | key_len | ref  | rows | filtered | Extra                          |
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+--------------------------------+
|  1 | SIMPLE      | NULL  | NULL       | NULL | NULL          | NULL | NULL    | NULL | NULL |     NULL | no matching row in const table |
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+--------------------------------+
```

整行几乎全是 `NULL`，`Extra` 写着 **`no matching row in const table`**。

**MySQL 怎么知道"没有匹配行"的？** 它只能是**真的去查了**。

这行数据确实存在，但它的 `deleted` 是 1：

```sql
SELECT id, username, deleted FROM user_big WHERE username='user_0500000';
```

```
+--------+--------------+---------+
| id     | username     | deleted |
+--------+--------------+---------+
| 924635 | user_0500000 |       1 |
+--------+--------------+---------+
```

所以 `username='user_0500000' AND deleted=0` 匹配 0 行。而 MySQL **在优化阶段就把这一行读出来了**，发现没有，于是整个查询被判定为"恒空"，计划直接退化成一行 `NULL`。

> 🔑 **`EXPLAIN` 不执行查询——但对 `const` 访问是例外：常量表在优化期就被读取了。**
>
> 原因很实际：如果一张表最多只返回 1 行，优化器**提前把这一行读出来**，就能把它当常量代入后续的计算（比如决定 JOIN 顺序）。这个动作叫**常量表优化**（const table optimization）。

换成一个 `deleted=0` 的用户名，计划就正常了：

```sql
EXPLAIN SELECT * FROM user_big WHERE username='user_0500001' AND deleted=0;
```

```
type   possible_keys        key                  key_len  ref          rows  Extra
const  uk_username_deleted  uk_username_deleted  259      const,const  1     Using index
```

### 三种输出格式

| 写法 | 执行吗 | 给什么 | 什么时候用 |
|------|--------|--------|-----------|
| `EXPLAIN <sql>` | 否（`const` 除外） | 表格，12 列 | 日常首选 |
| `EXPLAIN FORMAT=JSON <sql>` | 否 | JSON，**带成本数字** | 想知道优化器算了多少钱 |
| `EXPLAIN FORMAT=TREE <sql>` | 否 | 树状，看得清嵌套 | 复杂 JOIN / 子查询 |
| **`EXPLAIN ANALYZE <sql>`** | **是，真跑** | 树状 + **估算 vs 实际** | **验证优化器猜得准不准** |

`FORMAT=JSON` 是唯一能看到成本的：

```sql
EXPLAIN FORMAT=JSON SELECT * FROM user_big WHERE dept_id=50\G
```

```json
{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "16952.00"
    },
    "table": {
      "table_name": "user_big",
      "access_type": "ref",
      "key": "idx_dept",
      "used_key_parts": ["dept_id"],
      "key_length": "8",
      "rows_examined_per_scan": 18560,
      "rows_produced_per_join": 18560,
      "filtered": "100.00",
      "cost_info": {
        "read_cost": "15096.00",
        "eval_cost": "1856.00",
        "prefix_cost": "16952.00",
        "data_read_per_join": "10M"
      }
    }
  }
}
```

`query_cost` 就是 `02` §七说的"优化器算的那笔账"。**它是个无量纲的数，不是毫秒**，只用来和别的方案比大小。

`used_key_parts` 这个字段值得单独记一笔：**它直接告诉你索引吃了哪几列**，比手算 `key_len` 省事——不过面试官问的是 `key_len`，所以 §三还是得会算。

> ⚠️ **`EXPLAIN ANALYZE` 会真的执行查询。** 在生产库上对一条慢 SQL 跑它，等于把这条慢 SQL 又跑了一遍。`DELETE` / `UPDATE` 更要当心。

---

## 二、逐列拆解：12 列各是什么

先给全表，后面挑重点列展开。

| 列 | 含义 | 最该注意的 |
|----|------|-----------|
| `id` | 查询块的编号 | **越大越先执行**；相同则从上往下 |
| `select_type` | 这个块是什么角色 | `SIMPLE` / `PRIMARY` / `SUBQUERY` / `DEPENDENT SUBQUERY` / `DERIVED` / `UNION` |
| `table` | 操作哪张表 | `<derived2>` / `<union1,2>` 这种尖括号是**临时结果** |
| `partitions` | 命中哪些分区 | 本项目没分区，恒为 `NULL` |
| **`type`** | **访问方式** | **最重要的一列**，见 §二 |
| `possible_keys` | 候选索引 | **列在这里 ≠ 用了**（`02` §七的重点） |
| `key` | 实际用的索引 | `NULL` = 没用索引 |
| **`key_len`** | **用了索引的前几个字节** | 能反推吃了几列，见 §三 |
| `ref` | 和索引比较的是什么 | `const` = 常量；`rbac.ur.role_id` = 上一张表的列 |
| **`rows`** | **预计要检查多少行** | **估算值**，见 §四 |
| **`filtered`** | **检查完剩百分之几** | **经常是硬编码的猜测**，见 §五 |
| **`Extra`** | **补充说明** | 信息量最大，见 §六 |

### `id` 和 `select_type`：多行计划怎么读

在真实的 `rbac` 库上跑（只读，安全）：

**相关子查询**

```sql
EXPLAIN SELECT username, (SELECT COUNT(*) FROM sys_user_role ur WHERE ur.user_id=u.id) AS c FROM sys_user u;
```

```
+----+--------------------+-------+-------+------------------+---------+-----------+------+-------------+
| id | select_type        | table | type  | key              | key_len | ref       | rows | Extra       |
+----+--------------------+-------+-------+------------------+---------+-----------+------+-------------+
|  1 | PRIMARY            | u     | index | uk_user_username | 259     | NULL      |    4 | Using index |
|  2 | DEPENDENT SUBQUERY | ur    | ref   | uk_user_role     | 8       | rbac.u.id |    1 | Using index |
+----+--------------------+-------+-------+------------------+---------+-----------+------+-------------+
```

- `DEPENDENT SUBQUERY` = **相关子查询**：它依赖外层的 `u.id`，所以**外层每出一行，它就得跑一次**。`ref` 列写着 `rbac.u.id`，把这个依赖关系写死了。
- 注意 `u` 的 `rows=4`——**但 `sys_user` 有 5 行**。又一个估算不准的例子（§四）。
- 顺带：`uk_user_username` 的 `key_len=259`。记住这个数，§三 会算给你看，它和实验库里的 `uk_username_deleted` **完全同构**。

**派生表**

```sql
EXPLAIN SELECT * FROM (SELECT role_id, COUNT(*) c FROM sys_role_menu GROUP BY role_id) t WHERE t.c > 10;
```

```
+----+-------------+---------------+-------+--------------+---------+------+-------------+
| id | select_type | table         | type  | key          | key_len | rows | Extra       |
+----+-------------+---------------+-------+--------------+---------+------+-------------+
|  1 | PRIMARY     | <derived2>    | ALL   | NULL         | NULL    |   96 | NULL        |
|  2 | DERIVED     | sys_role_menu | index | uk_role_menu | 16      |   96 | Using index |
+----+-------------+---------------+-------+--------------+---------+------+-------------+
```

`table` 是 **`<derived2>`**——尖括号表示这不是真表，是 **id=2 那个块产出的临时结果**。`id=2` 比 `id=1` 大，所以**先跑 id=2**，把结果物化成 `<derived2>`，`id=1` 再扫它。

**UNION**

```sql
EXPLAIN SELECT username FROM sys_user WHERE id=1 UNION SELECT username FROM sys_user WHERE id=2;
```

```
+----+--------------+------------+-------+---------+---------+-------+------+-----------------+
| id | select_type  | table      | type  | key     | key_len | ref   | rows | Extra           |
+----+--------------+------------+-------+---------+---------+-------+------+-----------------+
|  1 | PRIMARY      | sys_user   | const | PRIMARY | 8       | const |    1 | NULL            |
|  2 | UNION        | sys_user   | const | PRIMARY | 8       | const |    1 | NULL            |
|  3 | UNION RESULT | <union1,2> | ALL   | NULL    | NULL    | NULL  | NULL | Using temporary |
+----+--------------+------------+-------+---------+---------+-------+------+-----------------+
```

第三行的 `<union1,2>` 是**合并 1 和 2 的临时表**，`Using temporary` 就是 `UNION` **去重**的代价。（`UNION ALL` 不去重，这一行会消失——面试常考。）

> 🔑 **读多行 EXPLAIN 的规矩：`id` 大的先执行；`id` 相同则从上往下；`table` 带尖括号的是临时结果，不是真表。**

---

## 三、`type`：访问方式的等级

`type` 是最该先看的一列。**它描述的是"怎么定位到行"**，不是"用没用索引"。

从好到坏（只列本项目能见到的）：

| `type` | 含义 | 要检查多少行 |
|--------|------|-------------|
| `const` | 主键 / 唯一索引**全字段**等值 | **最多 1 行**，且优化期就读完了 |
| `eq_ref` | JOIN 时，对左表每行，右表**唯一索引**命中 1 行 | 每次 1 行 |
| `ref` | 非唯一索引等值，或**唯一索引只给了部分列** | 若干行 |
| `range` | 索引上的范围（`<` `BETWEEN` `IN`） | 一段 |
| `index` | **全索引扫描** | **全部**（但扫的是更瘦的索引树） |
| `ALL` | **全表扫描** | **全部** |

### `const` 和 `ref` 的分界线

这条线画在**"能不能保证最多一行"**上，`uk_username_deleted (username, deleted)` 能干净地演示：

```sql
-- 只给第一列
EXPLAIN SELECT id FROM user_big WHERE username='user_0500001';
```

```
type  key                  key_len  ref    rows  Extra
ref   uk_username_deleted  258      const  1     Using index
```

```sql
-- 两列都给
EXPLAIN SELECT id FROM user_big WHERE username='user_0500001' AND deleted=0;
```

```
type   key                  key_len  ref          rows  Extra
const  uk_username_deleted  259      const,const  1     Using index
```

**同一个索引、同一行数据、`rows` 都是 1，`type` 却不同。**

原因：唯一约束是建在 **`(username, deleted)` 这个组合**上的，不是建在 `username` 上。只给 `username`，理论上可以有 `(user_0500001, 0)` 和 `(user_0500001, 1)` 两行——**MySQL 不能保证只有一行，所以只能是 `ref`**。补上 `deleted`，唯一性被锁死，才升级成 `const`。

> 🔑 **`const` 要求"唯一索引的每一列都给了等值条件"。少给一列就掉到 `ref`。**
>
> `ref` 列也跟着变：`const` → `const,const`，**它在告诉你拿几个常量去比**。

**这解释了 `02` 的一个结论**：`02` 说真库 `sys_user` 按 `username + deleted` 查是 `type=const`，**和表大小无关**。现在你知道为什么了——`const` 压根不扫，它在优化期直接把那一行读出来了。5 行也好，100 万行也好，都是 1 次树查找。

### `eq_ref`：JOIN 里最好的情况

`eq_ref` 只在 JOIN 中出现。在真实 `rbac` 库的四表 JOIN 里（§八 完整分析）：

```
| id | select_type | table | type   | key     | key_len | ref             | rows |
|  1 | SIMPLE      | r     | eq_ref | PRIMARY | 8       | rbac.ur.role_id |    1 |
```

读法：**对 `ur` 出的每一行，拿它的 `role_id` 去 `sys_role` 的主键上查，保证命中 1 行。** `ref` 列 `rbac.ur.role_id` 明确写出了"用谁的值去查"。

`eq_ref` 和 `const` 的区别：`const` 比的是**字面常量**，`eq_ref` 比的是**上一张表的列**（所以不能提前算）。

### `index` 不是"命中索引"

`02` 已经强调过一次，这里补上完整输出：

```sql
EXPLAIN SELECT id FROM user_big WHERE deleted=1;
```

```
type   possible_keys        key                  key_len  rows    filtered  Extra
index  uk_username_deleted  uk_username_deleted  259      995090  10.00     Using where; Using index
```

`key` 有值、`Extra` 还写着 `Using index`，看起来很美——**但 `rows=995090`，它扫了整棵索引树**。

跳过了联合索引的第一列 `username`，没法做树查找；但要的 `id` 和 `deleted` 索引里都有，**扫索引比扫表便宜**（索引树更瘦），于是选了 `type=index`。

> 🔑 **`index` = 全索引扫描，`ALL` = 全表扫描。两个都是"全扫"，只是扫的对象不同。**
>
> **`Extra: Using index`（覆盖索引）和 `type=index`（全索引扫描）是两回事，名字像而已。** 上面这行两个同时出现，恰好是最容易看混的组合。真正"命中索引"是 `const` / `eq_ref` / `ref` / `range`。

---

## 四、`key_len`：手算，并识破陷阱

> 还 `02` 的扣：`02` 用 `258 → 259` 证明"吃了几列"，但只粗算了一次，说了"`03` 详讲"。

### 公式

`key_len` = **索引中被实际使用的那几列，在索引里各占多少字节，加总**。

单列的字节数：

| 情况 | 字节数 |
|------|--------|
| `BIGINT` | 8 |
| `INT` | 4 |
| `TINYINT` | 1 |
| `DATETIME`（MySQL 5.6+） | 5 |
| `CHAR(n)` | `n × 字符集最大字节数` |
| `VARCHAR(n)` | `n × 字符集最大字节数` **+ 2**（变长，要存长度） |
| **可为 NULL 的列** | **再 + 1**（要存 NULL 标志位） |

utf8mb4 的"最大字节数"是 **4**。

### 实测四个例子

`user_big` 的定义（`02` 建的，`SHOW CREATE TABLE` 实测）：

```sql
`username` varchar(64) NOT NULL,
`nickname` varchar(64) DEFAULT NULL,     -- 可空
`dept_id`  bigint NOT NULL,
`status`   varchar(16) NOT NULL,
`deleted`  tinyint NOT NULL,
```

| 查询 | `key` | `key_len` | 怎么算出来的 |
|------|-------|-----------|-------------|
| `WHERE dept_id=50` | `idx_dept` | **8** | `BIGINT` = 8 |
| `WHERE status='DISABLED'` | `idx_status` | **66** | `16 × 4 = 64`，`+2`（变长） = 66 |
| `WHERE username='...'` | `uk_username_deleted` | **258** | `64 × 4 = 256`，`+2` = 258 |
| `WHERE username='...' AND deleted=0` | `uk_username_deleted` | **259** | `258 + 1`（`TINYINT NOT NULL`） = 259 |

四个全部实跑对得上。

### 陷阱：同一个 259，两种成因

```sql
EXPLAIN SELECT id FROM user_big WHERE nickname='昵称5000';
```

```
type  key           key_len  ref    rows  Extra
ref   idx_nickname  259      const  1     Using index
```

**`idx_nickname` 只有一列，`key_len` 也是 259。**

算给你看：`nickname` 是 `varchar(64)` 且**可空** → `64 × 4 = 256`，`+2`（变长），**`+1`（NULL 标志）** = **259**。

> 🔑 **`uk_username_deleted` 的 259 = "吃满了两列"；`idx_nickname` 的 259 = "一列，但它可以为 NULL"。**
>
> **同一个数字，含义完全不同。`key_len` 只能配合索引定义读，不能单独看。**

这也是"能不能为 NULL"的真实代价之一：**每个可空列进索引都要多背 1 个字节**，还堵死了 `key_len` 的直读。

### `key_len` 能干什么

它是**唯一能看出"联合索引吃了几列"的一列**。看真实 `rbac` 库的四表 JOIN：

```
| table | type | key          | key_len | ref                       |
| ur    | ref  | uk_user_role | 8       | const                     |
| rm    | eq_ref| uk_role_menu | 16      | rbac.ur.role_id,rbac.m.id |
```

- `uk_user_role (user_id, role_id)` 两列都是 `BIGINT`，满打满算 16。**实际 `key_len=8` → 只吃了 `user_id` 一列**。合理：SQL 里只有 `WHERE ur.user_id = #{userId}`，没给 `role_id`。**这就是最左前缀在真实项目里的样子。**
- `uk_role_menu (role_id, menu_id)` **`key_len=16` → 两列都吃满了**，`ref` 列也印证了：`rbac.ur.role_id, rbac.m.id`，两个值都有。

**面试价值**：被问"怎么确认我的联合索引用全了"，答"看 `key_len`，拿索引定义逐列加字节数比对；MySQL 8 还可以直接看 `EXPLAIN FORMAT=JSON` 的 `used_key_parts`"——比背概念强得多。

---

## 五、`rows`：它从哪来，为什么永远不准

> 还 `02` 的扣：`rows` 一直显示 `995090` 而不是 `1000000`，估算值从哪来？

### 它就是从这张表里读出来的

```sql
SELECT * FROM mysql.innodb_table_stats WHERE database_name='rbac_lab';
```

```
+---------------+------------+---------------------+--------+----------------------+--------------------------+
| database_name | table_name | last_update         | n_rows | clustered_index_size | sum_of_other_index_sizes |
+---------------+------------+---------------------+--------+----------------------+--------------------------+
| rbac_lab      | user_big   | 2026-07-16 15:29:24 | 995090 |                 5032 |                     7058 |
| rbac_lab      | menu_big   | 2026-07-16 15:16:21 | 996084 |                 4070 |                     4401 |
+---------------+------------+---------------------+--------+----------------------+--------------------------+
```

**`n_rows = 995090`。** 就是它——`02` 里每个 `EXPLAIN` 反复出现的那个数字，来自 `mysql.innodb_table_stats` 这张**真实存在的系统表**。`last_update` 停在 `02` 那次 `ANALYZE` 的时刻。

`information_schema.tables.TABLE_ROWS` 读的也是这里，所以它一样不准——**别拿它当行数用**。

### 为什么不精确：只采样 20 页

```sql
SHOW VARIABLES LIKE 'innodb_stats_persistent%';
```

```
+--------------------------------------+-------+
| Variable_name                        | Value |
+--------------------------------------+-------+
| innodb_stats_persistent              | ON    |
| innodb_stats_persistent_sample_pages | 20    |
+--------------------------------------+-------+
```

**`ANALYZE TABLE` 只随机读 20 个叶子页**，数出平均每页多少行，再乘以总页数。

`user_big` 的聚簇索引有 **5032 页**——它只看了 **20 页，0.4%**，就外推出了整张表。

把采样页数调到极端，看它有多依赖运气：

```sql
ALTER TABLE user_big STATS_SAMPLE_PAGES=2;    ANALYZE TABLE user_big;
ALTER TABLE user_big STATS_SAMPLE_PAGES=2000; ANALYZE TABLE user_big;
```

| 采样页数 | `n_rows` | 真实值 | 误差 |
|---------|---------|--------|------|
| **2** | **747684** | 1000000 | **−25%** |
| 20（默认） | 995835 | 1000000 | −0.4% |
| 2000 | 995224 | 1000000 | −0.5% |

**采 2 页时误差 25%**——优化器要是拿着这个数去算账，选错计划毫不意外。

同一个默认设置，连着跑几次 `ANALYZE TABLE`，结果也不一样（本节实测到的：995090、995835、994345）。**因为每次随机采的 20 页不同。**

> 🔑 **`rows` 永远不会等于真实行数**，哪怕采样 2000 页也是 995224。因为它的算法是"页数 × 每页平均行数"，**这个乘法天生是估算**。

顺带解释一个 `02` 里的坑：HANDOFF 记着"`information_schema` 的 `index_length` 第一次查显示 0.0，必须先 `ANALYZE TABLE`"——同一个原因，**这些数字全是 `ANALYZE` 时才算的**，不是实时维护的。

### `n_diff`：优化器对"有几个不同值"的认知

```sql
SELECT index_name, stat_name, stat_value, sample_size FROM mysql.innodb_index_stats
 WHERE database_name='rbac_lab' AND table_name='user_big' AND stat_name='n_diff_pfx01';
```

默认 20 页采样：

```
+---------------------+--------------+------------+-------------+
| index_name          | stat_value   | sample_size |
+---------------------+--------------+-------------+
| idx_dept            |          95  |          20 |     ← 真实 100
| idx_status          |           1  |           3 |     ← 真实 2
| idx_nickname        |      998704  |          20 |     ← 真实 1000000
| uk_username_deleted |      998355  |          20 |     ← 真实 1000000
+---------------------+--------------+-------------+
```

采样 2000 页后：

```
| idx_dept            |         100  |        1325 |     ← 精确了
| idx_status          |           2  |        1326 |     ← 精确了
| idx_nickname        |     1000000  |        1687 |     ← 精确了
| uk_username_deleted |     1000000  |        1695 |     ← 精确了
```

**`n_diff` 采够了能精确，`n_rows` 采多少都不精确**——因为前者是"数出来的"，后者是"乘出来的"。

注意 `idx_status` 默认采样时 `n_diff = 1`：**优化器认为 `status` 列只有一个值**。真实是 2 个（99:1）。

### 但是——`rows` 有时候根本不看这些统计

这里是本节最容易被讲错的地方。

把 `idx_dept` 的 `n_diff` 从 95 折腾到 100 再到 101，然后每次都查同一条 SQL：

```sql
EXPLAIN SELECT * FROM user_big WHERE dept_id=50;
```

| `n_diff(idx_dept)` | `n_rows` | 如果 `rows = n_rows / n_diff` | **实际 `rows`** |
|-------------------|---------|------------------------------|----------------|
| 95 | 995090 | 10474 | **18560** |
| 100 | 995224 | 9952 | **18560** |
| 101 | 994345 | 9845 | **18560** |

**统计信息换了三轮，`rows` 纹丝不动，恒等 18560。**

> 🔑 **对等值条件，MySQL 走的是「索引下潜」（index dive）：它真的到 B+ 树里，找到范围的两端，数中间大概有多少行。**
>
> **下潜读的是树本身，不是采样统计**——所以它和 `ANALYZE` 无关，永远给同一个数。

代价是它**不准**：真实 `dept_id=50` 有 **10000** 行，它估 **18560**，**高估 1.86 倍**。`status='DISABLED'`（真实 10000 行）估 **18798**，同样约 1.9 倍。

### 下潜有个天花板：半张表

`status='ENABLED'` 真实占 **99%**（990000 行）。看它估多少：

| 那次 `ANALYZE` 后的 `n_rows` | `status='ENABLED'` 的 `rows` | 是 `n_rows` 的 |
|---------------------------|----------------------------|--------------|
| 995090（`02` 实测） | 497545 | **正好一半** |
| 995224 | 497612 | **正好一半** |
| 994345 | 497172 | **正好一半** |

**三次都是不多不少正好一半。** 一个占 99% 的值，被估成了 50%。

`02` 把这个现象记成了"优化器估成 **50:50**"。**数字是对的，但这个解释不对**——它不是"以为两个值各占一半"。证据：上表第 3 行的 `n_diff` 是 **1**（优化器认为只有一个值），按"均分"的说法应该估 `994345 / 1 = 994345`，实际却还是一半。

**造一张已知倾斜的表来判决**（`rbac_lab` 里新建 `t_skew`，A 占 70%、B 占 20%、C 占 10%，`n_rows=992800`，`n_diff=2`）：

```sql
EXPLAIN SELECT * FROM t_skew WHERE v='A';   -- 真实 700000
EXPLAIN SELECT * FROM t_skew WHERE v='B';   -- 真实 200000
EXPLAIN SELECT * FROM t_skew WHERE v='C';   -- 真实 100000
```

| 值 | 真实行数 | 真实占比 | **估算 `rows`** | 偏差 |
|----|---------|---------|----------------|------|
| A | 700000 | 70% | **496400** = `992800 / 2` **正好一半** | 被压到 50% |
| B | 200000 | 20% | **320870** | 高估 1.60 倍 |
| C | 100000 | 10% | **169400** | 高估 1.69 倍 |

**判决**：如果公式是 `n_rows / n_diff`，三个值应该**全部**等于 `992800 / 2 = 496400`。它们不是。B 和 C 各走各的下潜估算，只有**真实占比 70% 的 A 被压到了正好一半**。

> 🔑 **下潜估算有个上限：不超过半张表。** 所以任何"占比超过 50% 的值"，`rows` 都会显示成 `n_rows / 2`。
>
> **这才是 `02` 那个 497545 的真正来源——不是"假设 50:50"，是撞到了天花板。**

**这一点纠正了 `02` 的措辞**（数字无误，机制说法要改）。也顺带说明：**看到 `rows` 正好是表的一半，别以为优化器算出了什么，那多半是它在说"我数不清了，反正很多"。**

---

## 六、`filtered`：一个经常在猜的百分比

> 还 `02` 的扣：`filtered` 出现过 `10.00` / `29.12` / `34.55` / `100.00`，没解释。

**定义**：`rows` 是**按 `key` 定位后要检查的行数**；`filtered` 是这些行里，**再经过 `WHERE` 剩余条件过滤后，还剩百分之几**。

**真正参与后续步骤的行数 = `rows × filtered%`。** 这个乘积才是重点，尤其在 JOIN 里。

### `10.00` 是硬编码的

把 `status` 上的索引删掉（`rbac_lab` 可以随便折腾），逼它全表扫：

```sql
ALTER TABLE user_big DROP INDEX idx_status;
EXPLAIN SELECT * FROM user_big WHERE status='ENABLED';    -- 真实 99%
EXPLAIN SELECT * FROM user_big WHERE status='DISABLED';   -- 真实 1%
```

```
type  key   rows    filtered  Extra
ALL   NULL  995090  10.00     Using where      ← ENABLED
ALL   NULL  995090  10.00     Using where      ← DISABLED
```

**两个都是 `10.00`。** 一个占 99%，一个占 1%，优化器给出同一个答案。

> 🔑 **没有任何统计信息可用时，MySQL 对 `列 = 常量` 的选择度就是**硬编码猜 **10%**。
>
> **`filtered=10.00` 的意思基本等于"我不知道"。** `02` 里那些 `10.00` 全是这么来的。

### 直方图：让它真的知道分布

```sql
ANALYZE TABLE user_big UPDATE HISTOGRAM ON status WITH 16 BUCKETS;
```

```
+-------------------+-----------+----------+---------------------------------------------------+
| Table             | Op        | Msg_type | Msg_text                                          |
+-------------------+-----------+----------+---------------------------------------------------+
| rbac_lab.user_big | histogram | status   | Histogram statistics created for column 'status'. |
+-------------------+-----------+----------+---------------------------------------------------+
```

存在 `information_schema.column_statistics`：

```json
{
  "buckets": [
    ["base64:type254:RElTQUJMRUQ=", 0.01002135231316726],
    ["base64:type254:RU5BQkxFRA==",  1.0]
  ],
  "data-type": "string",
  "null-values": 0.0,
  "sampling-rate": 0.07389222257756171,
  "histogram-type": "singleton",
  "number-of-buckets-specified": 16
}
```

读法：

- 值是 base64 编的（`RElTQUJMRUQ=` = `DISABLED`，`RU5BQkxFRA==` = `ENABLED`）
- 第二个数是**累积频率**：`DISABLED` 累积到 **0.01002**（≈1%），`ENABLED` 累积到 1.0 → 它自己占 `1 − 0.01002` ≈ **99%**。**分布抓准了。**
- `histogram-type: singleton` = 不同值的个数没超过桶数，**每个值单独一个桶，无需近似**（值多了会变成 `equi-height`，等高直方图）
- `sampling-rate: 0.0739` = 采了 7.4% 的数据，**比 `n_rows` 的 20 页认真得多**

现在再看（索引仍然是删掉的状态）：

```
type  key   rows    filtered  Extra
ALL   NULL  995090  99.00     Using where      ← ENABLED
ALL   NULL  995090   1.00     Using where      ← DISABLED
```

**`99.00` 和 `1.00`——和真实分布分毫不差。**

### 但直方图有个大前提：这列不能有索引

把 `idx_status` 加回来，直方图**原样保留**，再看：

```sql
ALTER TABLE user_big ADD INDEX idx_status (status);
EXPLAIN SELECT * FROM user_big WHERE status='ENABLED';
```

```
type  key         key_len  rows    filtered  Extra
ref   idx_status  66       497545  100.00    NULL
```

**`filtered` 变回 `100.00`，`rows` 变回那个撞了天花板的 497545。直方图被完全无视了。**

> 🔑 **列上有可用索引时，优化器优先用索引统计（下潜），不看直方图。**
>
> **直方图是给"没有索引的列"准备的**——比如你不想为一个低选择度的列建索引（`02` §七的结论），但又希望优化器知道它的真实分布。
>
> 这一点是网上讲直方图时最常漏掉的：**在一个已经有索引的列上建直方图，做的是无用功。**

（实验做完已把 `idx_status` 加回、直方图删掉，`rbac_lab` 恢复原状。）

### `filtered` 会连乘，误差会滚雪球

回到真实 `rbac` 库的四表 JOIN（§八）。它的 `EXPLAIN ANALYZE`：

```
-> Nested loop inner join  (cost=6.77 rows=0.00694) (actual time=4.21..4.26 rows=40 loops=1)
                                    ↑ 估算 0.00694 行            ↑ 实际 40 行
```

**估 0.00694 行，实际 40 行——差了近 6000 倍。**

`0.00694` 从哪来？`0.00694 = 1/144 = (1/3) × (1/48)`。而计划里恰好有这两个数：

- `r` 的 `filtered = 33.33` = **1/3**（`sys_role` 3 行，`WHERE r.deleted=0 AND r.status='ENABLED'` 猜的）
- `m` 的 `filtered = 2.08` = **1/48**（`sys_menu` 48 行，四个条件叠加后猜的）

> 🔑 **`filtered` 是概率，多张表 JOIN 时这些概率会相乘。** 每个都是猜的，**猜的误差也跟着相乘**——两个猜测就能把估算带到实际值的 1/6000。
>
> **这就是 JOIN 越多、执行计划越容易翻车的根本原因**，也是 `EXPLAIN ANALYZE` 的价值：**只有它能把"估算"和"实际"摆在一起给你看。**

---

## 七、`Extra`：信息量最大的一列

### `Using index`：覆盖索引

`02` 已经讲透。一句话：**要的列索引里全有，不回表**。

### `Using index condition`：ICP，到底下推了什么

> 还 `02` 的扣：`02` 明说"别和 `Using index` 搞混，ICP 是另一回事，`03` 讲"。

**索引条件下推**（Index Condition Pushdown）：把**能用索引列判断的 `WHERE` 条件**，从 server 层**下推到存储引擎层**，让它**在回表之前**先筛一遍。

用 `uk_username_deleted (username, deleted)` 演示。条件里 `username` 是范围、`deleted` 是等值——`deleted` 在索引里有，但因为前面是范围，**它不能用来缩小扫描区间**，只能逐条判断：

```sql
SELECT * FROM user_big
 WHERE username BETWEEN 'user_0500001' AND 'user_0600000' AND deleted=1;
```

（这个区间有 10 万个用户名，其中 `deleted=1` 的只有 1000 个。用 `BETWEEN` 不用 `LIKE`，正好绕开 HANDOFF 记的那个坑——`username` 里的 `_` 是 `LIKE` 的通配符。）

**ICP 关掉**：

```sql
SET optimizer_switch='index_condition_pushdown=off';
EXPLAIN ANALYZE SELECT * FROM user_big WHERE username BETWEEN 'user_0500001' AND 'user_0600000' AND deleted=1\G
```

```
-> Filter: ((user_big.deleted = 1) and (user_big.username between 'user_0500001' and 'user_0600000'))
   (cost=93562 rows=20792) (actual time=0.113..52.6 rows=1000 loops=1)
    -> Index range scan on user_big using uk_username_deleted over (...)
       (cost=93562 rows=207916) (actual time=0.102..50 rows=99999 loops=1)
                                                              ↑ 引擎吐出 99999 行
```

**ICP 打开**：

```sql
SET optimizer_switch='index_condition_pushdown=on';
```

```
-> Index range scan on user_big using uk_username_deleted over (...),
   with index condition: ((user_big.deleted = 1) and (user_big.username between ...))
   (cost=93562 rows=207916) (actual time=1.7..7.55 rows=1000 loops=1)
                                                  ↑ 引擎直接只吐 1000 行
```

**两轮实测，结果稳定**：

| | 引擎吐给 server 的行数 | 耗时 |
|---|---|---|
| ICP **关** | **99999** → server 再过滤成 1000 | **52.6 ms** |
| ICP **开** | **1000** | **7.55 ms** |

> 🔑 **ICP 关**：索引扫出 99999 条 → **每条都回表捞完整行** → 交给 server → server 发现 99% 不满足 `deleted=1`，**扔掉**。**回表 99999 次，白干 98999 次。**
>
> **ICP 开**：引擎拿到索引条目就地判断 `deleted=1`，**不满足的直接跳过，根本不回表** → **只回表 1000 次**。
>
> **回表少了 100 倍，快了约 7 倍。**

在 `EXPLAIN` 里的差别只有 `Extra` 一格：

| | `Extra` |
|---|---|
| ICP 关 | `Using where` |
| ICP 开 | `Using index condition` |

**`Using index condition` 是好事**，看到它说明 MySQL 帮你省了回表。（ICP 默认就是开的，这里关掉只为对照。）

**和 `Using index` 的区别**：

| | 含义 | 回表吗 |
|---|------|--------|
| `Using index` | **覆盖索引**：要的列索引里全有 | **完全不回表** |
| `Using index condition` | **ICP**：用索引列先筛掉一批 | **回表，但只回该回的那些** |

一个是"根本不用回"，一个是"少回几次"。

### `Using where`：最没信息量的一格

**只是说"server 层还要再过滤一遍"**，它**不代表有问题**，也**不代表没用索引**。上面 ICP 关掉的例子里，`Using where` 和 `range` 是同时出现的。

### `Using filesort`：排序没能顺着索引

```sql
EXPLAIN SELECT * FROM user_big WHERE dept_id=50 ORDER BY nickname;   -- Using filesort
EXPLAIN SELECT * FROM user_big WHERE dept_id=50 ORDER BY id;         -- Extra 为 NULL
```

`idx_dept` 是 `(dept_id, id)`——**`dept_id` 相同时，条目本来就按 `id` 排好了**，所以 `ORDER BY id` 直接顺着读，不用排序。换成 `ORDER BY nickname`，索引里没有这个顺序，只能取完再排 → `Using filesort`。

> ⚠️ **`filesort` 不一定用文件。** 数据量小就在内存里排（`sort_buffer_size`），大了才落盘。**名字有误导性**，看到它别立刻慌，要结合 `rows` 判断。

### `Using temporary`：需要临时表

`GROUP BY`、`DISTINCT`、`UNION` 去重都可能用到。真实 `rbac` 库：

```sql
EXPLAIN SELECT role_id, COUNT(*) FROM sys_role_menu GROUP BY role_id ORDER BY COUNT(*) DESC;
```

```
type   key           key_len  rows  Extra
index  uk_role_menu  16       96    Using index; Using temporary; Using filesort
```

三个 `Extra` 同时出现，逐个读：

- `Using index` = 覆盖索引，`sys_role_menu` 只有 `id/role_id/menu_id`，都在索引里 → **不回表**
- `Using temporary` = `GROUP BY` 要建临时表聚合
- `Using filesort` = `ORDER BY COUNT(*)` 排的是**聚合结果**，任何索引都帮不上 → 只能排

**好消息坏消息同时出现，这很正常。** 96 行的表，无所谓。

---

## 八、执行计划是不稳定的

**这一节是本节最重要的发现，也是 `02` 没能证明的一件事。**

`02` §七实测了优化器的临界点：`WHERE dept_id <= N`，**N=13 走 `range`，N=14 翻 `ALL`**。`02` 同时留了一句谨慎的话：

> 这个百分比不是常数……它取决于**回表的代价**——行有多宽、**数据在不在 Buffer Pool 里**、是机械盘还是 SSD。

**本节把这句话从"说法"变成了"实测"。**

### 现象：同一条 SQL，今天的计划和 `02` 不一样

数据一行没变，`mysql.innodb_table_stats.last_update` 还停在 `02` 那一刻（统计信息也没变），跑同一条 SQL：

```sql
EXPLAIN SELECT * FROM user_big WHERE dept_id <= 5;
```

`02`：`range`。**今天：`ALL`。**

而且 `rows` 的估算和 `02` **一模一样**（N=1 → 18564，N=10 → 206718，逐个对得上）。**行数估算没变，决策变了。**

### 归因：回表要随机读聚簇索引，而它当时是热的

`02` 刚灌完 100 万行，聚簇索引整个躺在 Buffer Pool 里 → **回表几乎不花 I/O** → 索引方案很划算 → 撑到 13% 才翻。

今天容器跑了一天，`user_big` 的聚簇索引早被挤出去了：

```sql
SELECT index_name, COUNT(*) AS pages_cached FROM information_schema.innodb_buffer_page
 WHERE table_name LIKE '%user_big%' GROUP BY index_name;
```

```
+---------------------+--------------+
| index_name          | pages_cached |
+---------------------+--------------+
| PRIMARY             |          155 |     ← 总共 5032 页，只剩 3%
+---------------------+--------------+
```

**PRIMARY 只剩 3% 在内存**，回表 = 随机磁盘 I/O，贵得多 → 优化器早早放弃索引。

### 验证：把它读热，看临界点会不会自己爬回去

```sql
-- created_at 只存在于聚簇索引里，强制走 PRIMARY 全扫，把它读进 Buffer Pool
SELECT COUNT(created_at) FROM user_big FORCE INDEX (PRIMARY);
```

反复读热，每次都重新找临界点：

| PRIMARY 缓存页数 | 占 5032 页 | **临界点 N** |
|-----------------|-----------|-------------|
| 155 | 3% | **3 ~ 5** |
| 3707 | 74% | **7 ~ 8** |
| 4169 | 83% | **10 ~ 12** |
| 4775 | 95% | **11 ~ 12** |
| （`02`，刚灌完） | ≈100% | **13 ~ 14** |

> 🔑 **单调、可复现：缓存越多 → 回表越便宜 → 优化器越愿意用索引 → 临界点越高。**
>
> **同样的 SQL、同样的数据、同样的统计信息、同样的 MySQL——只因为缓存状态不同，执行计划就翻了。**

MySQL 8 的成本模型里有两个常量（`mysql.engine_cost`）：

```
+------------------------+---------------+
| cost_name              | default_value |
+------------------------+---------------+
| io_block_read_cost     |             1 |
| memory_block_read_cost |          0.25 |
+------------------------+---------------+
```

**InnoDB 会把"这个索引有百分之几在 Buffer Pool 里"报告给优化器**，优化器按这个比例在 `1` 和 `0.25` 之间加权。缓存比例一变，算出来的账就变。**上面那张表就是这个机制在动。**

顺带一提，本节写 ICP 实验时也被它咬过一次：同一条 SQL 连跑两次，第一次选了全表扫描（343ms），第二次选了索引范围扫描（59ms）——**因为第一次的 `EXPLAIN ANALYZE` 自己把表读热了**。重跑两轮才拿到稳定结果。

### 这意味着什么

1. **`02` 的 13% 不是个可复现的常数**，本节在同一台机器上就量到了 3%、7%、10%、11% 四个不同的临界点。**`02` 说"别背 30%"是对的，但连它自己的 13% 也别背。**
2. **线上"同一条 SQL 平时很快、偶尔巨慢"，这是一个真实成因**：半夜跑了个大批量任务，把 Buffer Pool 洗了一遍，第二天早高峰这条 SQL 的计划就可能翻脸。
3. **压测的第一遍结果不能信**：冷缓存和热缓存是两个世界。要么预热，要么跑够多轮取稳态。

> 🔑 **面试可以直接用**：被问"为什么执行计划会突然变"，多数人只会答"统计信息过期了，`ANALYZE TABLE` 一下"。**但统计信息没过期也会变**——Buffer Pool 的冷热就能让它变，我实测过一张 100 万行的表，临界点在 3% 和 13% 之间来回跑。

---

## 九、项目实证：四表 JOIN 的执行计划

`backend/src/main/java/com/rbac/system/menu/mapper/SysMenuMapper.java:14-24`，`selectPermissionCodesByUserId` —— 本项目最复杂的一条 SQL。拿真实的 `rbac` 库跑（只读）。

用 `user_id = 2`（`test`，挂 `system_admin` 角色）：

```sql
EXPLAIN
SELECT DISTINCT m.permission_code FROM sys_menu m
JOIN sys_role_menu rm ON rm.menu_id = m.id
JOIN sys_user_role ur ON ur.role_id = rm.role_id
JOIN sys_role r ON r.id = ur.role_id
WHERE ur.user_id = 2
  AND m.deleted = 0 AND m.status = 'ENABLED'
  AND r.deleted = 0 AND r.status = 'ENABLED'
  AND m.permission_code IS NOT NULL AND m.permission_code <> '';
```

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

### 第一件该注意的事：顺序变了

**SQL 里写的顺序**：`m` → `rm` → `ur` → `r`
**实际执行的顺序**：**`ur` → `r` → `m` → `rm`**

> 🔑 **你写的 JOIN 顺序不是执行顺序。优化器会重排。**
>
> 它把 `ur` 提到最前面是有道理的：`WHERE ur.user_id = 2` 是**整条 SQL 唯一的常量入口**，先用它把结果集缩到 1 行，后面每一步都在这 1 行的基础上展开。**这就是"小表驱动大表"在真实计划里的样子**——只不过"小"不是指表本身小，而是**过滤后小**。

### 逐行读

**第 1 行 `ur`**：`type=ref`，`key=uk_user_role`，**`key_len=8`**（两列共 16，只吃了 `user_id`——最左前缀），`ref=const`（拿常量 2 去查），`rows=1`。
`Extra: Using index` = `sys_user_role` 只有 `id/user_id/role_id`，要的 `role_id` 索引里就有，**不回表**。
`Using temporary` = 为最外层的 `DISTINCT` 准备的临时表。

**第 2 行 `r`**：`type=eq_ref`，走主键，`ref=rbac.ur.role_id` —— **拿上一行的 `role_id` 查主键，命中 1 行**。
`filtered=33.33` = **1/3**：`sys_role` 有 3 行，优化器对 `r.deleted=0 AND r.status='ENABLED'` 完全没有统计信息，**猜的**（§六）。

**第 3 行 `m`**：**`type=ALL`，全表扫描 `sys_menu`。**
这不是问题——`sys_menu` 只有 **48 行**，全扫比走索引再回表便宜。**和 `02` §七"5 行的表优化器不屑于走索引"是同一个道理，也和 §八 的临界点是同一笔账。**
`filtered=2.08` = **1/48**，同样是猜的。
`Using join buffer (hash join)` = **MySQL 8 的 hash join**。为什么这里用它、它和 NLJ 有什么区别，**`04` 详讲**。

**第 4 行 `rm`**：`type=eq_ref`，`key_len=16` → `uk_role_menu (role_id, menu_id)` **两列吃满**，`ref` 也印证了：`rbac.ur.role_id, rbac.m.id`。
`Using index` = 不回表；`Distinct` = 找到一条就够了，**不必继续找重复的**。

### 用 `EXPLAIN ANALYZE` 看它猜得准不准

```
-> Table scan on <temporary>  (cost=9.27..9.27 rows=0.00694) (actual time=4.77..4.78 rows=40 loops=1)
    -> Temporary table with deduplication  (actual time=4.77..4.77 rows=40 loops=1)
        -> Nested loop inner join  (cost=6.77 rows=0.00694) (actual time=4.21..4.26 rows=40 loops=1)
            -> Inner hash join (no condition)  (cost=6.43 rows=0.00694) (actual time=3.3..3.33 rows=40 loops=1)
                -> Filter: ((m.status = 'ENABLED') and (m.deleted = 0) and (m.permission_code is not null) and (m.permission_code <> ''))
                   (cost=17.4 rows=1) (actual time=1.45..1.46 rows=40 loops=1)
                    -> Table scan on m  (cost=17.4 rows=48) (actual time=0.726..0.739 rows=48 loops=1)
                -> Hash
                    -> Nested loop inner join  (cost=0.7 rows=0.333) (actual time=0.292..0.293 rows=1 loops=1)
                        -> Covering index lookup on ur using uk_user_role (user_id=2)
                           (cost=0.35 rows=1) (actual time=0.272..0.273 rows=1 loops=1)
                        -> Filter: ((r.status = 'ENABLED') and (r.deleted = 0))  (cost=0.283 rows=0.333) ...
                            -> Single-row index lookup on r using PRIMARY (id=ur.role_id)  (cost=0.283 rows=1) ...
            -> Limit: 1 row(s)  (cost=1.3 rows=1) (actual time=0.0232..0.0232 rows=1 loops=40)
                -> Single-row covering index lookup on rm using uk_role_menu (role_id=ur.role_id, menu_id=m.id)
                   (cost=1.3 rows=1) (actual time=0.0231..0.0231 rows=1 loops=40)
```

读法：每个节点都是 `(cost=… rows=估算) (actual time=首行..末行 rows=实际 loops=跑了几轮)`。

**四个必须看懂的地方**：

1. **`rows=0.00694` vs `actual rows=40`** —— 估算差了近 6000 倍。就是 §六说的 `filtered` 连乘：`(1/3) × (1/48) = 1/144 = 0.00694`。
2. **`loops=40`** —— 最后那个 `rm` 的查找**跑了 40 轮**，因为上一层出了 40 行。`actual time=0.0231` 是**单轮**的时间，不是总时间。**这是 `EXPLAIN ANALYZE` 最容易读错的地方**：总耗时要乘以 `loops`。
3. **`Limit: 1 row(s)`** —— `DISTINCT` 让优化器意识到"`rm` 里找到一条匹配就够了"，于是加了个短路。
4. **`Table scan on m` 的 `actual rows=48`，`Filter` 之后还是 `40`** —— 48 行里 40 行满足条件，**真实选择度是 83%，优化器猜的是 2.08%（1/48）**。差了 40 倍。

### 但真实登录时，超管根本不跑这条 SQL

`SysMenuMapper` 里有**两套**方法。`LoginUserAssembler.java:59-61` 和 `AuthService.java:152-153` 用 `roleCodes.contains("super_admin")` 分叉：

| 用户 | 走哪个方法 | 有 JOIN 吗 |
|------|-----------|-----------|
| 普通用户（如 `test`） | `selectPermissionCodesByUserId`（四表 JOIN） | ✅ |
| **超管**（`admin`、`wangqiang`） | `selectAllPermissionCodes`（**单表**） | ❌ **短路** |

所以上面这个执行计划**只在普通用户登录时才会发生**。超管走的是：

```sql
SELECT DISTINCT permission_code FROM sys_menu WHERE deleted = 0 AND status = 'ENABLED' AND ...
```

**为什么要短路**：超管的 JOIN 结果**恒等于全表**，白付三次 JOIN + 去重的代价。**用一个布尔判断换掉一条四表 JOIN，是"用业务知识优化查询"的典型。** `04` 会展开。

---

## 十、对照表：概念 ↔ 本项目 ↔ 实际作用

| 概念 | 本项目 / 实验对应 | 实际作用 |
|------|------------------|---------|
| `EXPLAIN` 不执行 | **例外**：`no matching row in const table` | `const` 表在优化期就被读了 |
| `EXPLAIN ANALYZE` | 四表 JOIN 估 0.00694 / 实际 40 | **唯一能对比估算与实际的工具**；会真跑 |
| `id` 大的先执行 | `<derived2>`、`<union1,2>` | 尖括号 = 临时结果，不是真表 |
| `type=const` | 真库登录 `username+deleted` | 唯一索引**全列**等值，与表大小无关 |
| `type=ref` | 只给 `username`（少一列） | 不能保证唯一 → 掉级 |
| `type=eq_ref` | 四表 JOIN 的 `r` / `rm` | JOIN 里最好的情况 |
| `type=index` | `SELECT id WHERE deleted=1` | **全索引扫描，不是"命中索引"** |
| `key_len` | `uk_user_role` 的 **8**（共 16） | **唯一能看出联合索引吃了几列的一列** |
| `key_len` 陷阱 | `idx_nickname` 也是 **259** | 可空列 +1 字节 ≠ 吃了两列 |
| `rows` 来源 | `mysql.innodb_table_stats.n_rows` | **20 页采样外推**，永不精确 |
| 索引下潜 | `dept_id=50` 恒等 18560 | 读 B+ 树，**与统计信息无关**；高估约 1.9 倍 |
| 下潜天花板 | `ENABLED` 恒等 `n_rows/2` | 占比 >50% 一律显示成一半 |
| `filtered=10.00` | 无索引无直方图时 | **硬编码猜测**，等于"我不知道" |
| 直方图 | `status` → `99.00` / `1.00` | 精确抓分布，**但列上有索引就不用它** |
| `filtered` 连乘 | `(1/3)×(1/48)=0.00694` | JOIN 越多，估算误差越滚越大 |
| `Using index` | `sys_role_menu` 全列在索引 | 覆盖索引，**完全不回表** |
| `Using index condition` | ICP：99999 → 1000 行 | **少回表 100 倍，快 7 倍** |
| `Using filesort` | `ORDER BY nickname` | 索引给不出这个顺序；**不一定用文件** |
| `Using temporary` | `DISTINCT` / `GROUP BY` / `UNION` | 要建临时表 |
| **计划不稳定** | **缓存 3% → 临界点 3；95% → 临界点 11** | **同 SQL 同数据同统计，计划照样翻** |
| JOIN 顺序重排 | 写 `m→rm→ur→r`，跑 `ur→r→m→rm` | 优化器按"过滤后最小"挑驱动表 |

---

## 面试怎么问

### Q1：`EXPLAIN` 会执行我的 SQL 吗？

**要点**：**基本不会，但有例外**——`const` 表在优化期就被读了。

**杀手锏（能证明你真的动手看过）**：
> 我见过一个直接的证据：对一个"存在但被逻辑删除"的用户名跑 `EXPLAIN SELECT * FROM t WHERE username='x' AND deleted=0`，输出整行是 `NULL`，`Extra` 写着 **`no matching row in const table`**。**MySQL 要能说出"没有匹配行"，只能是它真的去读了。** 这就是常量表优化——最多返回一行的表，优化器提前把它读出来当常量用。

**必须补的一句**：**`EXPLAIN ANALYZE` 是真跑的**，别在生产库上对着慢 SQL 用，更别对 `UPDATE`/`DELETE` 用。

### Q2：`type` 有哪些？`const` 和 `ref` 差在哪？

**别背 `system > const > eq_ref > ref > range > index > ALL` 就完事**，讲分界线：

- **`const`**：唯一索引 / 主键的**每一列**都给了等值 → 保证 ≤1 行 → 优化期直接读出来。
- **`ref`**：**保证不了唯一**——非唯一索引，**或者唯一索引只给了部分列**。
- **`eq_ref`**：JOIN 里的 `const`，只是比较的值来自上一张表而不是字面常量。

**用项目举例（这个例子很干净）**：
> `sys_user` 上是 `UNIQUE KEY uk_user_username (username, deleted)`。只写 `WHERE username=?` 是 **`ref`**（`key_len=258`），补上 `AND deleted=0` 才是 **`const`**（`key_len=259`）。**同一个索引、同一行数据、`rows` 都是 1，就因为唯一性能不能被保证，`type` 差一级。** 而项目里 `@TableLogic` 会自动补 `deleted=0`，所以登录查询实际是 `const`。

**必须澄清的坑**：**`type=index` 不是"用上索引了"，它是全索引扫描**，和 `ALL` 一样是全扫，只是扫的树更瘦。

### Q3：`key_len` 怎么算？它能告诉你什么？

**要点**：`key_len` = 索引中**被实际使用的列**的字节数之和。
`VARCHAR(n)` utf8mb4 = `n×4 + 2`（变长长度）；**可空再 +1**；`BIGINT`=8，`TINYINT`=1，`DATETIME`=5。

**它的唯一用途**：**看出联合索引到底吃了几列。**

**用项目举例**：
> 本项目的四表 JOIN 里，`sys_user_role` 的 `uk_user_role (user_id, role_id)` 两列都是 `BIGINT`，吃满该是 16。**实际 `key_len=8`——只吃了 `user_id`。** 合理，因为 SQL 里只有 `WHERE ur.user_id=?`。同一个计划里 `sys_role_menu` 的 `uk_role_menu` 是 `key_len=16`，**两列吃满了**。

**加分（很少有人说得出）**：
> 有个陷阱：`key_len` 相同不代表情况相同。我实验表里 `uk_username_deleted(username,deleted)` 吃满两列是 **259**，而单列索引 `idx_nickname` 也是 **259**——因为 `nickname` 可空，`64×4+2+1`。**同一个数字，一个是"吃了两列"，一个是"一列但可空"。** 所以 `key_len` 必须对着索引定义读。MySQL 8 里也可以直接看 `EXPLAIN FORMAT=JSON` 的 `used_key_parts`，省得手算。

### Q4：`rows` 是怎么来的？准吗？

**要点（分两种，多数人只知道第一种）**：

1. **表的行数估算**来自 `mysql.innodb_table_stats.n_rows`，由 `ANALYZE TABLE` **随机采样 `innodb_stats_persistent_sample_pages`（默认 20）个叶子页**外推。
2. **但等值 / 范围条件的 `rows` 走的是「索引下潜」**——真的到 B+ 树里数，**不看采样统计**。

**用数据说话**：
> 我在 100 万行的表上量过：默认采 20 页，`n_rows` 是 995090；改成采 **2 页 → 747684，误差 25%**；采 2000 页 → 995224。**采多少都到不了 1000000**，因为算法本身是"页数 × 每页平均行数"。而且连着跑两次 `ANALYZE`，数字都不一样。
>
> 但同一张表 `WHERE dept_id=50`，我把统计信息的 `n_diff` 折腾成 95、100、101 三个值，**`rows` 纹丝不动，永远是 18560**——**这说明它压根没看统计信息，走的是索引下潜。** 代价是下潜也不准：真实 10000 行，它估 18560，高估 1.86 倍。

**加分（几乎没人知道）**：
> 下潜有个上限：**不超过半张表**。我那列 `status` 的 `ENABLED` 真实占 99%，`rows` 永远显示成 `n_rows/2`，一次不差。我还专门造了张 70/20/10 的表验证：**占 70% 的值被压成正好 50%**，占 20% 和 10% 的则各走各的估算。**所以看到 `rows` 正好是表的一半，那不是算出来的，是它在说"很多，我数不清"。**

### Q5：`filtered` 是什么？

**要点**：`rows` 是**按索引定位后要检查的行数**，`filtered` 是**再经 `WHERE` 剩余条件过滤后剩百分之几**。真正往下传的行数 = `rows × filtered%`。

**关键认识**：**它经常是硬编码的猜测。**

**用数据说话**：
> 我把索引删掉，让一个 99% 的值和一个 1% 的值都走全表扫描——**两个 `filtered` 都是 `10.00`**。这是 MySQL 对 `列=常量` 在无统计时的**硬编码猜测：10%**。**看到 `filtered=10.00`，基本就是"优化器不知道"。**

**追问"怎么办"→ 直方图**：
> `ANALYZE TABLE t UPDATE HISTOGRAM ON status WITH 16 BUCKETS`。建完再看，`filtered` 变成 **99.00 和 1.00**，和真实分布分毫不差。
>
> **但有个大坑**：**列上有可用索引时，优化器优先走索引下潜，直方图会被完全无视。** 我实测过——加回索引，`filtered` 立刻变回 `100.00`。**所以直方图是给"没索引的列"用的**：比如一个低选择度的列你不想给它建索引，又想让优化器知道它的真实分布。

**再加一层（JOIN 的杀手）**：
> `filtered` 会**相乘**。项目里那条四表 JOIN，`sys_role` 猜 `33.33`（1/3）、`sys_menu` 猜 `2.08`（1/48），乘起来 `0.00694`——**而实际是 40 行，差了近 6000 倍**。**JOIN 越多，猜测误差滚得越大，这就是复杂 JOIN 计划容易翻车的根本原因。**

### Q6：`Using index` 和 `Using index condition` 有什么区别？

**要点**：

| | 是什么 | 回表吗 |
|---|-------|--------|
| `Using index` | **覆盖索引**：要的列索引里全有 | **完全不回表** |
| `Using index condition` | **ICP**：把能用索引列判断的条件下推到引擎层，**回表前先筛** | **回表，但只回该回的** |

**用数据说话**：
> 我量化过 ICP。条件是 `username BETWEEN a AND b AND deleted=1`，索引是 `(username, deleted)`——`username` 是范围，所以 `deleted` 缩不了扫描区间，只能逐条判断。
>
> **ICP 关**：索引扫出 **99999 行**，**每行都回表**，捞完整行交给 server，server 一看 99% 不满足 `deleted=1`，扔掉 → **52.6 ms**。
> **ICP 开**：引擎拿到索引条目就地判 `deleted=1`，不满足的**根本不回表** → 只吐 **1000 行** → **7.55 ms**。
>
> **回表少 100 倍，快 7 倍。而 `EXPLAIN` 里的差别只有 `Extra` 那一格。**

**加分**：`Using where` 最没信息量，它只说"server 层还要再过滤"，**既不代表有问题，也不代表没走索引**。

### Q7：执行计划为什么会突然变？（**这题能拉开差距**）

**多数人只答一半**：统计信息过期了，`ANALYZE TABLE` 一下。

**另一半（很少有人说）**：**统计信息没变，计划照样能变。**

**用数据说话（这是个很强的答案）**：
> 我实测过一次。同一条 SQL、同一张 100 万行的表、数据一行没动、`innodb_table_stats.last_update` 都没变过——**`WHERE dept_id<=5` 昨天走 `range`，今天翻成 `ALL`**。行数估算也完全一致（N=1 都是 18564），**变的只有决策**。
>
> 原因是 **Buffer Pool 的冷热**。走索引要回表，回表是**随机读聚簇索引页**。刚灌完数据时聚簇索引全在内存，回表几乎不花 I/O，索引方案很划算；跑了一天被挤出去后，回表变成随机磁盘 I/O，优化器就早早放弃索引。
>
> 我把它读热验证过，临界点跟着缓存比例单调爬：**缓存 3% → 临界点 3%；74% → 7%；83% → 10%；95% → 11%；刚灌完（≈100%）→ 13%**。
>
> 机制上，MySQL 8 的 `mysql.engine_cost` 里有 `io_block_read_cost=1` 和 `memory_block_read_cost=0.25`，**InnoDB 会把"这个索引有多少比例在 Buffer Pool 里"报给优化器**，按比例在这两个数之间加权。

**这个答案的价值**：
1. 直接解释了线上"同一条 SQL 平时快、偶尔巨慢"——**半夜的批量任务把 Buffer Pool 洗了**。
2. 顺带说明**压测第一轮的数据不能信**，冷热缓存是两个世界。
3. 也说明**任何"超过 X% 就不走索引"的说法都别背**——**连我自己测出来的 13% 都不是常数。**

---

## 动手练习

> 全部在 `rbac_lab` 做。`rbac` 库只读。

1. **`key_len` 侦探**：不看 `EXPLAIN`，先手算下面三个查询的 `key_len`，再跑 `EXPLAIN` 对答案。
   ```sql
   SELECT id FROM user_big WHERE status='ENABLED';
   SELECT id FROM user_big WHERE nickname='昵称1';
   SELECT id FROM user_big WHERE username='user_0000001' AND deleted=0;
   ```

2. **把 `const` 逼成 `ref`**：写两个查询，走**同一个索引**、返回**同一行**，但一个 `type=const`、一个 `type=ref`。解释分界线在哪。

3. **复现 `no matching row in const table`**：找一个 `deleted=1` 的用户名，构造出这个 `Extra`。再解释：为什么 MySQL 不等到执行时才发现"没有匹配行"？

4. **让 `filtered` 说真话**：`nickname` 上有索引 `idx_nickname`。
   （a）给 `dept_id` 建直方图，观察 `filtered` 变不变，解释原因。
   （b）想办法让这个直方图**真的生效**。（提示：§六的大前提）

5. **量化 ICP**：用 `menu_big`（`permission_code` + `idx_perm`）设计一个 ICP 收益明显的查询，关掉 ICP 对比 `EXPLAIN ANALYZE` 的 `rows` 和耗时。（提示：需要一个"范围 + 一个索引里有但缩不了区间的条件"）

6. **重现计划翻转**：把 `user_big` 的聚簇索引读热，记录 `WHERE dept_id<=N` 的临界点；然后想办法把它挤出 Buffer Pool（提示：`menu_big` 也有 100 万行，Buffer Pool 只有 128MB），再测一次。

7. **（思考题，无标准答案）** `EXPLAIN` 显示 `rows=497545`，正好是表的一半。你能得出什么结论？不能得出什么结论？

---

## 自检问题

1. `EXPLAIN` 到底执行不执行查询？举一个能证明你答案的具体输出。

2. `type=index` 和 `Extra: Using index` 名字很像，各是什么意思？它们能同时出现吗？同时出现说明什么？

3. `uk_username_deleted(username, deleted)` 吃满两列是 `key_len=259`，`idx_nickname` 单列也是 `key_len=259`。为什么？这说明读 `key_len` 时必须配合什么？

4. `rows` 和 `filtered`，哪个更可能是"猜的"？如果 `EXPLAIN` 显示 `rows=1000000, filtered=10.00`，你觉得最终会返回多少行？你有多大把握？

5. 为什么在一个已经有索引的列上建直方图是无用功？那直方图该建在什么列上？

6. `Using index` 和 `Using index condition` 都提到了 index，都是好事吗？它们省掉的是同一件事吗？

7. 数据没变、统计信息没变、SQL 没变，执行计划变了。可能吗？如果可能，举一个机制。

8. `02` 说临界点是 13%，本节测出 3%、7%、10%、11%。到底谁对？这件事对"背面试题"这个习惯有什么启发？

---

## 下一节预告

本节把 `EXPLAIN` 的每一列拆开了，但**刻意跳过了一个东西**：那条四表 JOIN 的 `Extra` 里写着 **`Using join buffer (hash join)`**，我们只说了"`04` 讲"。

`04` 要回答的问题，本节已经攒了一堆：

- **`Using join buffer (hash join)` 是什么？** MySQL 8 的 hash join 什么时候用、和 NLJ / BNL 怎么选？
- **为什么执行顺序是 `ur → r → m → rm`，而不是我写的顺序？** 优化器凭什么重排？"小表驱动大表"里的"小"，到底指什么小？
- **`Inner hash join (no condition)`** —— 一个**没有连接条件**的 hash join，这是什么鬼？
- **`loops=40`** 意味着 `rm` 那步跑了 40 次。JOIN 的代价是怎么乘起来的？
- 项目里的桥表 `sys_role_menu` **不带 `deleted`**——每条碰它的 JOIN 都得自己过滤主表的 `deleted=0`。**漏了会怎样？** `04` 演示怎么炸出幽灵菜单。
- 练习册 D 组发现的：**`GROUP BY` 不会产出 0 行**，`audit_admin` 直接从统计里消失了。**这才是 `04` 讲 JOIN 的第一个真实动机**——不是"省两次往返"，是 `LEFT JOIN` 才补得回那个 0。

**`04-JOIN与查询优化.md` 会把 `SysMenuMapper` 那条四表 JOIN 逐行拆到底**，并把"超管为什么要短路掉整条 JOIN"讲成一个完整的优化案例。

---

## 附：答案与解析

<details>
<summary><b>练习 1：key_len 侦探</b></summary>

**手算**：

| 查询 | 列定义 | 算式 | `key_len` |
|------|--------|------|-----------|
| `status='ENABLED'` | `varchar(16) NOT NULL` | `16×4 + 2` | **66** |
| `nickname='昵称1'` | `varchar(64) DEFAULT NULL` | `64×4 + 2 + 1` | **259** |
| `username=? AND deleted=0` | `varchar(64) NOT NULL` + `tinyint NOT NULL` | `(64×4+2) + 1` | **259** |

**实测全部吻合。**

**重点**：后两个都是 259，但**成因完全不同**——一个是"可空列的 NULL 标志位"，一个是"吃满了两列"。`key_len` 必须对着索引定义读。

</details>

<details>
<summary><b>练习 2：把 const 逼成 ref</b></summary>

```sql
-- const
EXPLAIN SELECT id FROM user_big WHERE username='user_0500001' AND deleted=0;
-- type=const, key_len=259, ref=const,const

-- ref
EXPLAIN SELECT id FROM user_big WHERE username='user_0500001';
-- type=ref,   key_len=258, ref=const
```

同一个索引 `uk_username_deleted`，同一行数据，`rows` 都是 1。

**分界线：能不能保证"最多一行"。**

唯一约束建在 `(username, deleted)` **这个组合**上。只给 `username`，理论上可以存在 `(user_0500001, 0)` 和 `(user_0500001, 1)` 两行——MySQL **不能证明**只有一行，所以只能是 `ref`。补上 `deleted`，唯一性锁死，升级 `const`。

**注意 `ref` 那一列也跟着变**：`const` → `const,const`，它在告诉你拿了几个常量去比。

</details>

<details>
<summary><b>练习 3：no matching row in const table</b></summary>

```sql
SELECT id, username, deleted FROM user_big WHERE username='user_0500000';
-- id=924635, deleted=1

EXPLAIN SELECT * FROM user_big WHERE username='user_0500000' AND deleted=0;
```

```
| id | select_type | table | type | key  | rows | Extra                          |
|  1 | SIMPLE      | NULL  | NULL | NULL | NULL | no matching row in const table |
```

**为什么不等到执行时**：因为 `const` 表最多返回一行，**优化器提前读出来就能把它当常量代入后续计算**——比如决定 JOIN 顺序、把这个值直接代进别的条件。这就是**常量表优化**。

代价是 `EXPLAIN` 不再"零副作用"。收益是：一旦发现这行不存在，**整个查询立刻判定为恒空，后面什么都不用做了**。上面那行输出里 `table` 都是 `NULL`——计划被彻底短路了。

</details>

<details>
<summary><b>练习 4：让 filtered 说真话</b></summary>

**(a) 直接建，没用**：

```sql
ANALYZE TABLE user_big UPDATE HISTOGRAM ON dept_id WITH 16 BUCKETS;
EXPLAIN SELECT * FROM user_big WHERE dept_id=50;
-- rows=18560, filtered=100.00   ← 和建之前一模一样
```

**原因**：`dept_id` 上有 `idx_dept`。**列上有可用索引时，优化器走索引下潜，直方图被无视。**

**(b) 让它生效——把索引拿掉**：

```sql
ALTER TABLE user_big DROP INDEX idx_dept;
EXPLAIN SELECT * FROM user_big WHERE dept_id=50;
-- ALL, filtered=1.00      ← 100 个值均匀分布，1% 正确！

-- 记得加回来
ALTER TABLE user_big ADD INDEX idx_dept (dept_id);
```

**结论**：直方图和索引在"估选择度"这件事上**是替代关系，不是叠加关系**，而且**索引优先**。

**那直方图到底给谁用**：给**你不想建索引、但分布很偏的列**。典型场景就是 `02` §七的结论——`status` / `deleted` 这种低选择度列不该建索引，**但优化器又需要知道它们的真实分布**（否则就是 `filtered=10.00` 硬猜）。**这时直方图是唯一的解**：零维护成本（不随写入更新）、零写入代价，只在 `ANALYZE` 时算一次。

</details>

<details>
<summary><b>练习 5：量化 ICP</b></summary>

关键是构造**"范围条件 + 一个索引里有但缩不了区间的条件"**。`menu_big` 只有 `idx_perm(permission_code)` 单列索引，**单列索引没法演示 ICP**（没有"第二列"可推）。

所以正确答案是：**得先建一个联合索引**，或者改用 `user_big` 的 `uk_username_deleted`：

```sql
SET optimizer_switch='index_condition_pushdown=off';
EXPLAIN ANALYZE SELECT * FROM user_big
 WHERE username BETWEEN 'user_0500001' AND 'user_0600000' AND deleted=1\G
-- Index range scan ... actual rows=99999   →  Filter → rows=1000    52.6ms

SET optimizer_switch='index_condition_pushdown=on';
-- Index range scan ..., with index condition ... actual rows=1000    7.55ms
```

**要点**：
- **`EXPLAIN` 里唯一的差别是 `Extra`**（`Using where` vs `Using index condition`），`rows`/`key`/`type` 全都一样——**必须用 `EXPLAIN ANALYZE` 才看得见 99999 → 1000 这个真实差别。**
- ICP 的收益 = **省掉的回表次数**。这里省了 98999 次。
- **陷阱**：如果查询是覆盖索引（`SELECT id, username`），压根不回表，**ICP 就没有意义了**——`Extra` 会显示 `Using index`，不会有 `Using index condition`。

</details>

<details>
<summary><b>练习 6：重现计划翻转</b></summary>

```sql
-- 1. 读热聚簇索引
SELECT COUNT(created_at) FROM user_big FORCE INDEX (PRIMARY);
SELECT index_name, COUNT(*) FROM information_schema.innodb_buffer_page
 WHERE table_name LIKE '%user_big%' GROUP BY index_name;
-- PRIMARY 约 4700+/5032 页
EXPLAIN SELECT * FROM user_big WHERE dept_id<=11;   -- range

-- 2. 用 menu_big 把它挤出去（Buffer Pool 只有 128MB = 8192 页）
SELECT COUNT(*) FROM menu_big FORCE INDEX (PRIMARY);
SELECT COUNT(*) FROM menu_big FORCE INDEX (idx_perm);

-- 3. 再测
EXPLAIN SELECT * FROM user_big WHERE dept_id<=11;   -- 大概率翻成 ALL
```

**为什么挤得动**：`user_big` 聚簇 5032 页 + 索引 7058 页 = 12090 页，`menu_big` 又是 8471 页，**合计远超 8192 页的 Buffer Pool**。LRU 一定会把先来的踢出去。

**这个练习的真正目的**：让你亲手看见**"执行计划是环境的函数，不是 SQL 的函数"**。同一条 SQL 在你的开发机、测试库、生产库上可以是三个计划。

</details>

<details>
<summary><b>练习 7（思考题）：rows 正好是表的一半</b></summary>

**能得出的结论**：

**这个值的真实占比大概率超过 50%**，触发了索引下潜的天花板，被压到了 `n_rows/2`。

**不能得出的结论**（这才是重点）：

- ❌ **不能说"它占 50%"**。本节实测：真实 99% 显示成 50%，真实 70% 也显示成 50%。**天花板之上的信息全丢了。**
- ❌ **不能说"优化器算出了 50:50 的分布"**。`02` 当时就是这么记的，**数字对、解释错**。证据：把 `n_diff` 改成 1（"只有一个值"），`rows` 仍然是一半——如果真是"按不同值均分"，那该显示 `n_rows/1`。
- ❌ **不能拿它估算返回行数**。真正返回多少要看 `rows × filtered%`，而 `filtered` 常常也是猜的。

**该做什么**：直接 `SELECT COUNT(*)` 数一遍，或者跑 `EXPLAIN ANALYZE` 看 `actual rows`。**`EXPLAIN` 的 `rows` 是给优化器比价用的，不是给你当行数用的。**

</details>

<details>
<summary><b>自检答案</b></summary>

**1.** **基本不执行，但 `const` 表例外**——常量表在优化期就被读了。证据：`EXPLAIN SELECT * FROM user_big WHERE username='user_0500000' AND deleted=0` 输出 `Extra: no matching row in const table`，整行 `NULL`。**MySQL 能说出"没有匹配行"，只能是真的读了。** 另外 `EXPLAIN ANALYZE` 是完整执行的。

**2.**
- `type=index` = **全索引扫描**（扫完整棵索引树，是"全扫"的一种，只比 `ALL` 好一点点）
- `Extra: Using index` = **覆盖索引**（要的列索引里全有，不回表）

**能同时出现**，而且这正是最容易看混的组合：
```
SELECT id FROM user_big WHERE deleted=1;
→ type=index, Extra: Using where; Using index, rows=995090
```
含义是：**跳过了联合索引首列，没法树查找，只好把整棵索引树扫一遍；但要的列索引都有，所以不用回表。** 翻译成人话：**没走对索引（全扫），但至少省了回表。**

**3.** 因为 `nickname` 是 `varchar(64) DEFAULT NULL`：`64×4 + 2（变长）+ 1（NULL 标志）= 259`；而 `uk_username_deleted` 是 `(64×4+2) + 1（tinyint）= 259`。**巧合。**

**必须配合索引定义读**——光看 `key_len` 这个数字，无法区分"吃了两列"和"一列但可空"。MySQL 8 可以用 `EXPLAIN FORMAT=JSON` 的 `used_key_parts` 直接看吃了哪几列。

**4.** **`filtered` 更可能是猜的。** `rows` 至少还基于索引下潜（读了真实的 B+ 树，虽然会高估约 1.9 倍）；`filtered` 在没有直方图、条件又不能用索引时，**就是硬编码的 10%**。

`rows=1000000, filtered=10.00` → 名义预测 `1000000 × 10% = 100000` 行。

**把握：几乎没有。** `filtered=10.00` 是"我不知道"的同义词。真实值可能是 1，也可能是 99 万。要知道真相：`EXPLAIN ANALYZE` 看 `actual rows`。

**5.** 因为**列上有可用索引时，优化器优先用索引下潜估选择度，直方图被完全无视**。实测：`status` 建了直方图后 `filtered` 是 99.00/1.00；把 `idx_status` 加回来，立刻变回 `100.00`。

**直方图该建在**：**分布很偏、但你又不想给它建索引的列**。这正好接上 `02` §七的结论——`status`/`deleted` 这类低选择度列不该建索引（选择度太低，建了优化器也不用，还白付写入和空间成本），**但优化器仍然需要知道它们的分布**，否则就只能 `filtered=10.00` 硬猜。**直方图填的就是这个空**：不随写入更新（零维护）、只在 `ANALYZE` 时算一次。

**6.** **都是好事，但省的不是同一件事。**
- `Using index`（覆盖索引）= **完全不回表**
- `Using index condition`（ICP）= **回表，但只回该回的那些**

一个是"根本不用回"，一个是"少回几次"。实测 ICP 把回表从 99999 次砍到 1000 次（52.6ms → 7.55ms）。

**顺带**：如果一个查询已经是覆盖索引，ICP 就无从谈起了（都不回表，还推什么）。

**7.** **完全可能。** 机制：**Buffer Pool 的冷热**。

走二级索引要回表，**回表是随机读聚簇索引页**。MySQL 8 的成本模型里 `io_block_read_cost=1`、`memory_block_read_cost=0.25`，**InnoDB 会把"这个索引有多少比例在 Buffer Pool 里"报告给优化器**，按比例加权。

实测：`user_big` 的聚簇索引缓存 3% 时，`WHERE dept_id<=5` 是 `ALL`；读热到 95% 后，同一条 SQL 变成 `range`。**数据、统计信息、SQL 全没动。**

**8.** **两边都对，而且这正是重点。**

`02` 的 13% 是"刚灌完数据、缓存全热"时测的；本节的 3%/7%/10%/11% 是缓存比例分别为 3%/74%/83%/95% 时测的。**两组数据不矛盾，它们是同一条曲线上的不同点。** `02` 自己也写了"这个百分比取决于……数据在不在 Buffer Pool 里"——本节只是把那句话测出来了。

**对"背面试题"的启发**：

- **"超过 30% 就不走索引"是错的**，"13% 是临界点"也是错的——**任何一个具体数字都是错的**，因为它是环境的函数。
- 该背的是**机制**（走索引要回表，回表代价随命中行数线性涨，涨过全表扫描就翻转），**以及"它会变"这件事本身**。
- **面试真正的加分点不是报出一个数字，而是说出"我测过，而且我知道它为什么会变"。** 背数字的人遇到追问"为什么是这个数"就露馅了；懂机制的人可以从任何一个数字反推出环境。

</details>
