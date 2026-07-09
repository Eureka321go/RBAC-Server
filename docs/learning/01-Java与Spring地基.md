# 阶段 1 · Java + Spring Boot 地基（用本项目真实代码讲）

> 目标：读完这份，你再打开项目里任何一个 `.java` 文件，**不再满眼陌生符号**。
> 我们不背语法书，全程拿项目里的真实代码当教材。看不懂的地方，对话里随时问我。

---

## 一、先学会"读懂一个 Java 文件的套路"

几乎每个 Java 文件都是这个固定结构。拿最简单的 `SysUser.java` 举例：

```java
package com.rbac.system.user.entity;          // ① 我是谁：这个文件属于哪个包

import com.rbac.common.domain.BaseEntity;      // ② 我要用到别处的东西：先声明进来
import lombok.Data;

@Data                                          // ③ 注解：给这个类"贴标签/加功能"
@TableName("sys_user")
public class SysUser extends BaseEntity {      // ④ 类的定义：这是一个叫 SysUser 的类

    private String username;                    // ⑤ 字段：这个类"有什么数据"
    private String nickname;
    // ...
}
```

五个部分，逐个理解：

| 部分 | 是什么 | 生活类比 |
|------|--------|----------|
| ① `package` | **包声明**：本文件所在的"文件夹路径"，必须和目录一致 | 你家的"省市区街道"地址 |
| ② `import` | **导入**：本文件要用到的、写在别的文件里的类，先报备 | 做菜前把要用的调料摆上台 |
| ③ `@注解` | **注解**：给类/方法/字段"贴标签"，框架看到标签就帮你做事 | 快递箱上贴的"易碎""加急"贴纸 |
| ④ `class` | **类的定义**：一张"设计图纸" | "用户"这个概念的模板 |
| ⑤ 字段/方法 | 类里"有什么数据、能干什么" | 图纸上的零件清单 |

> 🔑 记住这个套路，以后打开任何文件，先扫一眼"包 → 导入 → 注解 → 类 → 内容"，方向感立刻就有了。

---

## 二、类（class）与对象（object）——最核心的概念

**类 = 图纸，对象 = 按图纸造出来的实物。**

`SysUser` 类是一张"用户图纸"，它规定了一个用户"有哪些数据"：

```java
public class SysUser extends BaseEntity {
    private Long   deptId;    // 部门ID
    private String username;  // 用户名
    private String nickname;  // 昵称
    private String password;  // 密码
    private String status;    // 状态
    // ...
}
```

这只是图纸。程序运行时，会按图纸造出一个个**具体的对象**，比如：

```java
SysUser user = new SysUser();       // new = 按图纸造一个实物
user.setUsername("zhangsan");       // 往这个实物里塞数据
user.setStatus("ENABLED");
```

> 你在 `UserService.create()` 里看到的 `SysUser user = new SysUser();` 就是这个意思——造一个空白用户对象，再把前端传来的数据一项项塞进去。

**`private` 是什么？** 表示这个字段"私有"，外部不能直接 `user.username` 去读写，必须通过 `user.getUsername()` / `user.setUsername(...)` 方法。这是 Java 的"封装"惯例（数据藏起来，只留门口）。

---

## 三、getter/setter 和 Lombok 的 `@Data`（解开一个大疑惑）

你一定会疑惑：`SysUser` 里明明只写了字段，**没写 `getUsername()` 方法**，为什么代码里到处在 `user.getUsername()`？

答案是那行 **`@Data` 注解**（来自 Lombok 库）：

```java
@Data                          // ← 这一个注解，等于自动生成了下面这一堆方法
public class SysUser {
    private String username;
    // 编译时 Lombok 偷偷帮你补上：
    //   public String getUsername()          { return username; }
    //   public void   setUsername(String x)  { this.username = x; }
    //   ...每个字段都补一对 get/set
    //   还有 toString()、equals()、hashCode()
}
```

**`@Data` = "帮我把所有字段的 get/set 等样板代码自动生成"**。所以项目里的实体、DTO、VO 你都只看到字段、看不到 get/set，但都能调用——全是 `@Data` 的功劳。

> 这就是"注解帮你干活"的第一个活例子：你贴个标签，工具替你写代码。

### `@EqualsAndHashCode(callSuper = true)` —— 继承场景的相等判断

`SysUser` 头上除了 `@Data`，还单独写了一行 `@EqualsAndHashCode(callSuper = true)`。它管的是"**两个对象算不算相等**"：

- `equals()` 判断"内容是否相等"，`hashCode()` 给对象一个"数字指纹"（`HashMap`/`HashSet` 靠它找元素）。
- 默认 Java 认死理：只有"内存里同一个对象"才相等，内容一样的两个 `new` 也判不等。`@EqualsAndHashCode` 就是"**帮我按字段自动生成**逐字段比较的 equals/hashCode"。

其实 `@Data` 已经包含了 `@EqualsAndHashCode`，为什么还要单独再写一个？**关键在 `callSuper = true`**：

- `SysUser extends BaseEntity`，`id` 等字段是从父类继承的。
- Lombok 生成 equals 时**默认只比本类字段，会漏掉父类的 `id`**！
- `callSuper = true` = "比较时**也带上父类字段（尤其 `id`）**"。对数据库实体，`id` 恰恰最能区分两条记录，漏了它会出"不同 id 却判相等"的诡异 bug。

> 记忆点：**凡是 `extends BaseEntity` 的实体，都要配 `@EqualsAndHashCode(callSuper = true)`**，把父类字段纳入相等判断（顺便消掉 Lombok 的警告）。项目里你会看到这个组合几乎遍布每个实体。

### 💡 Lombok 本质：全部是"编译期"生成，零运行时开销

Lombok 走 Java 的**注解处理器**机制：在**编译**（`mvn compile`）那一刻，把标签翻译成真正的方法代码，**写进 `.class` 字节码**里。

- 源码 `.java` 里看不到 `getUsername()`，但**编译出的 `.class` 里真有**——不是运行时反射临时造，所以没有性能损耗。
- 这也解释了一个现象：**IDE 必须装 Lombok 插件**，否则编辑器读 `.java` 源码看不到这些方法会飘红；但命令行 `mvn compile` 从不需要插件，因为编译过程本身就带 Lombok。

常见 Lombok 注解（都是同一套编译期机制）：

| 注解 | 编译时生成 |
|------|-----------|
| `@Data` | get/set + toString + equals + hashCode + 构造器（大礼包） |
| `@Getter` / `@Setter` | 只生成 get / 只生成 set |
| `@EqualsAndHashCode` / `@ToString` | 只生成对应方法 |
| `@NoArgsConstructor` / `@AllArgsConstructor` | 无参 / 全参构造器 |
| `@Slf4j` | 自动塞一个日志对象 `log` |

---

## 四、接口（interface）与继承（extends / implements）

项目里三个高频关键字，一次讲清：

### `extends`（继承）——"我是某某的升级版，自动拥有它的一切"

```java
public class SysUser extends BaseEntity { ... }
```

意思：`SysUser` **继承** `BaseEntity`，于是 `BaseEntity` 里的字段（`id`、`createdAt`、`createdBy`、`deleted`…）`SysUser` **自动就有**，不用重写。

> 这就是阶段 0 说的"每张表都有的公共字段"的实现方式——公共字段写一次放 `BaseEntity`，14 个实体全 `extends` 它，一处修改处处生效。你打开的 `SysUser` 里看不到 `id` 字段，但它有 `getId()`，就是从父类继承来的。

### `interface`（接口）——"只定义能做什么，不写怎么做"

```java
public interface SysUserPostMapper extends BaseMapper<SysUserPost> {
    List<Long> selectPostIdsByUserId(Long userId);   // 只声明，没有方法体（没有 { ... }）
}
```

接口是"能力清单/契约"：只说"能查某用户的岗位ID列表"，不说具体怎么查。**谁来实现？**——MyBatis-Plus 在运行时自动实现（回顾阶段 0 的 `@MapperScan`）。

### `implements`（实现接口）

```java
public class Result<T> implements Serializable { ... }
```

`Result` **实现** `Serializable` 接口——表示"我这个对象可以被序列化（转成字节流传输/存储）"。这里你只要知道 `implements XXX` = "我承诺具备 XXX 这种能力"即可。

> 一句话区分：`extends` 继承一个"爹"（拿它的现成东西）；`implements` 履行一份"契约"（承诺我有某能力）。

---

## 五、注解 `@xxx` 到底有哪些类型？

注解你已经见了好几个了。按"谁来看这个标签"分三类，帮你归档：

| 类别 | 例子 | 谁在看它、做什么 |
|------|------|------------------|
| **Lombok 注解**（省样板代码） | `@Data`、`@EqualsAndHashCode` | 编译时自动生成 get/set 等代码 |
| **Spring / 框架注解**（登记组件、配路由、鉴权） | `@Service`、`@RestController`、`@GetMapping`、`@PreAuthorize`、`@TableName` | 程序启动/运行时，框架据此装配和调度 |
| **校验注解**（自动校验入参） | `@NotBlank`、`@Size`、`@Pattern` | 请求进来时，框架自动检查数据合不合规 |

看 `UserCreateRequest`（前端"创建用户"传进来的数据）里的校验注解：

```java
@NotBlank(message = "{valid.username.notBlank}")   // 用户名不能为空
@Size(min = 2, max = 32, message = "{valid.username.size}")  // 长度 2~32
private String username;

@Pattern(regexp = "ENABLED|DISABLED", ...)         // 状态只能是这两个值之一
private String status;
```

> 好处：不用你在代码里手写 `if (username == null) ...` 一堆判断，贴上注解，框架在请求进门时自动帮你拦下不合规的数据（阶段 5 会看它怎么触发）。
> 那个 `{valid.username.notBlank}` 是国际化的"文案编号"，不是真正的提示语——真正的中英文提示在 `i18n/messages_*.properties` 里，阶段 5 讲。

---

## 六、泛型 `<T>`——"类型占位符"

你已经在好几处见过尖括号 `<>`，这叫**泛型**。它是一个"**类型占位符**"，让同一套代码能装不同类型的数据。

看统一响应 `Result<T>`：

```java
public class Result<T> {     // T 是占位符，代表"某种还没确定的类型"
    private int code;
    private String message;
    private T data;          // data 到底是什么类型？用的时候才定
}
```

用的时候把 `T` 换成具体类型：

- `Result<UserVO>` → data 是一个用户对象
- `Result<List<UserVO>>` → data 是一串用户
- `Result<Void>` → data 为空（如删除操作，只需告诉你成功没成功）

好处：**一个 `Result` 类，服务所有接口的返回**，而且编译器能帮你检查类型不会装错。

其他你会遇到的泛型：
- `List<Long>` → 一串 Long 类型的值（如 `roleIds` 角色ID列表）
- `BaseMapper<SysUser>` → 专门操作 `SysUser` 的数据层
- `Map<Long, String>` → 键是 Long、值是 String 的映射表（如"部门ID → 部门名"）

> 记忆点：尖括号里写的是"**这个容器/工具，这次要处理的是什么类型**"。

---

## 七、Lambda 与 Stream——处理"一串数据"的现代写法

这是新手看项目最容易懵的地方，但其实就一个套路。看 `UserService` 里真实的一段：

```java
List<UserVO> vos = page.getRecords().stream()      // ① 把一串 SysUser 变成"流水线"
        .map(UserVO::from)                          // ② 每个 SysUser 都转成 UserVO
        .collect(Collectors.toList());              // ③ 把结果收集成一个 List
```

用大白话翻译这三步：

1. `.stream()` — 把一个列表变成"传送带/流水线"，准备逐个加工。
2. `.map(...)` — **对传送带上每个元素做同一种转换**。这里 `UserVO::from` 表示"每个 `SysUser` 都调用 `UserVO.from()` 转成 `UserVO`"。
3. `.collect(Collectors.toList())` — 把加工完的元素**重新收集成一个新列表**。

整句话 = "把一串用户实体（`SysUser`），逐个转换成展示对象（`UserVO`），得到一串新列表。"

**Lambda 是什么？** 就是"**临时的、匿名的小函数**"。比如另一段：

```java
.map(r -> new CurrentUserVO.RoleBriefVO(r.getId(), r.getRoleCode(), r.getRoleName()))
```

`r -> new ...(...)` 读作："**给我一个 r，我就返回一个新的 RoleBriefVO**"。`->` 左边是输入，右边是输出。它就是个没名字的小加工函数，喂给 `.map()` 用。

对比一下：如果不用 Stream，同样的事要写成——

```java
List<UserVO> vos = new ArrayList<>();
for (SysUser u : page.getRecords()) {     // 传统 for 循环，逐个遍历
    vos.add(UserVO.from(u));
}
```

两种写法效果完全一样。`stream().map().collect()` 只是更简洁的现代写法。**你现在能"读懂"它就够了，暂时不必自己写。**

---

## 八、Spring 核心：IoC 与依赖注入（DI）

这是理解整个项目"零件怎么拼起来"的关键。

**问题**：`UserService` 干活时需要用到 `SysUserMapper`（查数据库）、`PasswordEncoder`（加密密码）、`DataScopeService`（算数据权限）等一堆"帮手"。这些帮手对象**谁来创建、谁来递给它**？

**传统做法（不用 Spring）**：自己 new。

```java
SysUserMapper userMapper = new SysUserMapper(); // 你得自己造每个帮手，累且乱
```

**Spring 做法（IoC = 控制反转）**：你**不自己造**，只要"声明我需要谁"，Spring 启动时**自动帮你造好并递进来**。这个"自动递进来"的过程叫**依赖注入（DI）**。

看 `UserService` 真实的构造函数——本项目统一用**构造器注入**：

```java
@Service                                        // ← 标签：告诉 Spring"我是个组件，请管理我"
public class UserService {

    private final SysUserMapper userMapper;      // 我需要的帮手，先声明成字段
    private final PasswordEncoder passwordEncoder;
    private final DataScopeService dataScopeService;
    // ...

    // 构造函数：列出"我需要哪些帮手"，Spring 启动时自动把它们传进来
    public UserService(SysUserMapper userMapper,
                       PasswordEncoder passwordEncoder,
                       DataScopeService dataScopeService, ...) {
        this.userMapper = userMapper;            // 接住 Spring 递进来的帮手，存起来
        this.passwordEncoder = passwordEncoder;
        this.dataScopeService = dataScopeService;
    }
}
```

你从头到尾**没有 `new SysUserMapper()`**，但 `userMapper` 就是有值、能用。这就是依赖注入：**"我只报需求，对象由框架供给。"**

**Bean 是什么？** 被 Spring 管理起来、能被注入给别人的对象，就叫一个 "Bean"。谁会成为 Bean？——**贴了这些"组件标签"的类**：

| 标签注解 | 贴在哪种类上 | 含义 |
|----------|--------------|------|
| `@RestController` | 接口层（Controller） | 我负责接 HTTP 请求、返回 JSON |
| `@Service` | 业务层（Service） | 我负责业务逻辑 |
| `@Component` | 通用组件（如过滤器、切面） | 我是个通用零件 |
| `@Configuration` | 配置类 | 我负责"生产"一些 Bean（如 `PasswordEncoder`） |

> 这几个注解**本质都是"请 Spring 把我登记成 Bean、纳入管理"**，只是名字按用途分了工，读代码时更一目了然。
> 顺带解释一个疑问：`PasswordEncoder` 能被注入，是因为 `SecurityConfig` 这个 `@Configuration` 类里有个 `@Bean` 方法专门生产它（阶段 3 会看到）。

---

## 九、Spring Boot：把一切"自动装配 + 一键启动"

Spring 本身配置很繁琐，**Spring Boot** 是它的"傻瓜套餐"，主打两件事：

1. **起步依赖（Starter）**：`pom.xml` 里写一行 `spring-boot-starter-web`，就自动带齐"做 Web 接口需要的一整套库"，不用你一个个找。回顾阶段 0，本项目 `pom.xml` 里的 `spring-boot-starter-web / -security / -data-redis / -validation / -aop` 就是这样一包包引进来的。
2. **自动配置（Auto-Configuration）**：`@SpringBootApplication` 一贴，Boot 就根据你引了哪些库，**自动帮你配好大部分东西**（连数据库、开 Web 服务器…），你只需在 `application.yml` 里填少量参数（数据库地址、密码、端口）。

回顾 `application.yml` 里你现在能读懂的：

```yaml
server:
  port: 8080            # 程序监听 8080 端口
  servlet:
    context-path: /api  # 所有接口地址统一加前缀 /api
```

所以 `UserController` 上写的是 `/system/users`，真实访问地址是 `http://localhost:8080` + `/api` + `/system/users`。

---

## 十、把前九节串起来：一条最小链路

现在你具备了读懂"一个请求怎么在三层间流动"的全部基础。看查询用户列表这条链：

```java
// ① 接口层 UserController —— @RestController Bean，负责接请求
@GetMapping                                        // 对应 GET /api/system/users
@PreAuthorize("hasAuthority('system:user:list')")  // 校验注解：要有这个权限码
public Result<PageResult<UserVO>> page(UserQuery query) {
    return Result.success(userService.page(query)); // 转交给注入进来的 userService
}
```
```java
// ② 业务层 UserService —— @Service Bean，被注入了 userMapper、dataScopeService
public PageResult<UserVO> page(UserQuery query) {
    DataScopeQuery scope = dataScopeService.calculate();   // 算数据权限（阶段4）
    // ... 用 Wrappers 拼查询条件 ...
    IPage<SysUser> page = userMapper.selectPage(...);      // ③ 调数据层查库
    List<UserVO> vos = page.getRecords().stream()          // Stream：实体→VO
            .map(UserVO::from).collect(Collectors.toList());
    return PageResult.of(vos, ...);
}
```
```java
// ③ 数据层 SysUserMapper —— 空接口，实现由 MyBatis-Plus 自动生成
public interface SysUserMapper extends BaseMapper<SysUser> { }
```

**读这段你现在应该能认出的东西**：`@RestController`/`@Service`（Bean 标签）、`@GetMapping`/`@PreAuthorize`（框架注解）、`Result<...>`/`PageResult<...>`（泛型）、`userService`/`userMapper`（注入进来的帮手）、`stream().map().collect()`（Stream 转换）、`extends BaseMapper<SysUser>`（继承+泛型的空接口）。

> 🎉 如果这段你大致能读懂，阶段 1 的地基就打牢了——**你已经能"认识"项目里绝大多数代码的骨架了**，剩下的是往里填血肉（数据、认证、权限）。

---

## 十一、阶段 1 小测

用自己的话回答，答不出的对话里补：

1. `SysUser` 类里没写 `getUsername()` 方法，为什么代码里能 `user.getUsername()`？靠的是哪个注解？
2. `extends` 和 `implements` 有什么区别？各举本项目一个例子。
3. `SysUser extends BaseEntity`，那 `SysUser` 里没写 `id` 字段，它到底有没有 `id`？为什么？
4. `Result<T>` 里的 `<T>` 是干嘛的？`Result<UserVO>` 和 `Result<Void>` 有什么不同？
5. 用大白话解释这句在做什么：`list.stream().map(UserVO::from).collect(Collectors.toList())`。
6. `UserService` 从没 `new SysUserMapper()`，为什么它的 `userMapper` 却能用？这个机制叫什么？
7. `@RestController`、`@Service`、`@Configuration` 三个注解的共同本质是什么？

---

> ✅ **下一站：阶段 2 — 数据层与数据模型**。
> 我们会深入 14 张表的结构和关系，讲透 `BaseEntity` 的公共字段、逻辑删除、审计字段自动填充，以及 MyBatis-Plus 的 `BaseMapper`、`LambdaQueryWrapper` 查询、分页 `Page`——把"数据到底怎么存、怎么取"这条底座彻底打通。
