# 阶段 11 · Spring MVC 完整执行链（单元 5 精读正文）

> 本篇是 [`08-进阶学习计划-第一优先级.md`](./08-进阶学习计划-第一优先级.md) **单元 5**（07 §2.5）的精读正文，专门讲透 08 §5.2 原理清单里的 5 件事：
>
> 1. **Filter / Interceptor / ControllerAdvice / AOP** 的执行顺序与职责边界（谁在 Spring 之外、谁在 handler 前后、谁包业务方法、谁兜异常）；
> 2. **参数解析、JSON 反序列化、响应序列化**的过程；
> 3. **Jackson** 的日期 / 枚举 / 空值 / 未知字段策略；
> 4. **分组校验**（`@Validated(Group.class)`）+ **自定义校验注解**；
> 5. **404 / 参数格式错 / 业务异常**如何形成统一错误协议（HTTP 状态码 + 业务 code）。
>
> 读完你能对着本项目回答：一次工作流审批请求从进入到响应经过哪几环、每一环该管什么、每种失败长什么样、以及项目在这条链上**还缺哪几块**（都标成延伸练习）。
>
> 承接：Filter 与 `SecurityContext` 线程模型已在 [`03-认证与登录链路.md`](./03-认证与登录链路.md) 讲过，本篇不重讲登录，只把它放进"执行链"这张全景图里定位。

---

## 零、一句话地图：一次请求经过的每一环

以 `POST /api/workflow/tasks/{id}/approve` 为例，从 TCP 进来到 JSON 出去，**真实**经过的顺序是：

```
Servlet 容器（Tomcat）
  └─ Filter 链（Spring 之外，Servlet 规范层）
       ├─ ...Spring Security 内部一堆 Filter...
       ├─ JwtAuthenticationFilter        ← 本项目自定义，解析 JWT、写 SecurityContext
       └─ ExceptionTranslationFilter     ← 401/403 在这层就被拦掉直接返回（不进 DispatcherServlet）
  └─ DispatcherServlet（Spring MVC 入口）
       ├─ HandlerMapping：URL → 找到 TaskController.approve 这个 handler
       ├─ （HandlerInterceptor.preHandle）  ← 本项目【没有】拦截器，这一环是空的
       ├─ HandlerAdapter：
       │     ├─ 参数解析：@PathVariable id、@RequestBody → Jackson 反序列化成对象
       │     ├─ @Valid → Bean Validation 校验，失败抛 MethodArgumentNotValidException
       │     └─ 调用 Controller 方法
       │            └─ ★ AOP @Around（OperationLogAspect）在这里包住 Controller 方法
       │                   └─ Controller → Service（@Transactional + @Version 乐观锁）
       ├─ 返回值 Result<T> → HttpMessageConverter（Jackson）序列化成 JSON
       └─ 任一环抛异常 → @RestControllerAdvice（GlobalExceptionHandler）兜住转成统一 Result
  └─ Filter 链回程 → 响应写回客户端
```

> 🔑 **本篇要反复强调的三个"项目差异点"**（都是绝佳教学样本）：
> 1. 项目**没有任何 `HandlerInterceptor`**（搜 `WebMvcConfigurer` / `addInterceptors` 为 0 命中）——操作日志用 **AOP** 而不是拦截器，为什么？见第二节。
> 2. 项目**没有全局 MVC Jackson 定制**——`RedisConfig`、`RestAuthErrorWriter` 各自 `new ObjectMapper()`，注释明确"避免动全局 MVC 序列化"。全项目其实有**三个** `ObjectMapper`，MVC 那个是 Spring Boot 默认、没被改过。见第四节。
> 3. 项目**没有分组校验、没有自定义校验注解、没有 Java 枚举**——`status` 用 `@Pattern(regexp="ENABLED|DISABLED")` 的字符串校验顶替。这几处正好是把"会用"练成"能造"的延伸练习。见第四、五节。

---

## 一、执行链上的真实代码锚点（先认人）

| 环 | 文件 : 位置 | 角色 |
|----|-------------|------|
| Filter | `security/JwtAuthenticationFilter.java` L24（`OncePerRequestFilter`，`doFilterInternal` L37）| 解析 `Bearer` → 校验 Redis 会话 → 写 `SecurityContext`。注册见 `SecurityConfig` L61 `addFilterBefore(..., UsernamePasswordAuthenticationFilter.class)` |
| Security 出口 | `security/handler/JwtAuthenticationEntryPoint.java` L14 / `RestAccessDeniedHandler.java` | **401**（未认证）/ **403**（已认证无权限）在 Filter 层直接写响应，**不进** DispatcherServlet |
| Security 出口 | `security/handler/RestAuthErrorWriter.java` L14 | 401/403 的统一 JSON 写出工具，**自带一个 `new ObjectMapper()`**（L16） |
| 参数校验入口 | `auth/controller/AuthController.java` L34/L46（`@Valid @RequestBody`）；各 `*Controller` | `@Valid` 触发 Bean Validation |
| 校验 i18n | `common/config/LocaleConfig.java` `getValidator` L38 | 把 `MessageSource` 接进 `LocalValidatorFactoryBean`，让 `{key}` 文案随语言切换 |
| AOP | `system/log/aspect/OperationLogAspect.java` L34 `@Around("@annotation(logAnno)")` | 环绕通知记录耗时/结果/操作人；切在 **Controller 方法**上（`@Log` 标在 `UserController`/`TaskController` 等） |
| 统一异常 | `common/web/GlobalExceptionHandler.java` L19 `@RestControllerAdvice` | `BusinessException` L24 / 校验异常 L29 / `AccessDeniedException`→403 L36 / 兜底 `Exception`→500 L42 |
| 统一响应 | `common/Result.java` L14 | `code/message/data`，message 走 i18n |

---

## 二、Filter / Interceptor / ControllerAdvice / AOP：顺序与职责边界

这是本单元最容易混的四个东西。用一句话钉死每个的"位置"：

| 组件 | 在哪一层 | 拿得到什么 | 管什么（职责） | 本项目的例子 |
|------|----------|------------|----------------|--------------|
| **Filter** | Servlet 容器层，**Spring MVC 之外**、最外圈 | 原始 `HttpServletRequest/Response`（能改请求/响应流本身），**拿不到**哪个 Controller 方法会被调用 | 与业务无关的横切：认证、CORS、编码、限流、包装请求体 | `JwtAuthenticationFilter`（认证）；Spring Security 整条 Filter 链 |
| **Interceptor** | Spring MVC 内、DispatcherServlet 之后 | `handler`（**知道**将要调哪个 `HandlerMethod`），但**看不到方法参数值**、看不到返回对象 | 与 handler 相关但仍偏通用：登录态兜底、handler 级日志、`preHandle/postHandle/afterCompletion` | **项目没有**（`WebMvcConfigurer` 0 命中）→ **延伸练习** |
| **AOP（@Around 等）** | Spring Bean 方法调用层，**最里**、最细 | 目标方法的**参数值、返回值、抛出的异常**（`ProceedingJoinPoint`） | 方法级横切：事务、操作日志、缓存、重试 | `OperationLogAspect`（操作日志）；`@Transactional`（事务，本质也是 AOP） |
| **ControllerAdvice** | 全局，横切所有 Controller 的**出口** | 抛出的异常对象 / 全局响应 | 统一异常→统一响应、全局数据绑定、统一包装 | `GlobalExceptionHandler`（`@RestControllerAdvice`） |

**执行的嵌套关系**（洋葱模型，从外到内再回来）：

```
Filter.前  →  Interceptor.preHandle  →  AOP.环绕前  →  【Controller/业务方法】
                                                              │
Filter.后  ←  Interceptor.afterCompletion  ←  AOP.环绕后  ←──┘
                          （异常从内往外冒，最后被 ControllerAdvice 接住转成 Result）
```

### 2.1 为什么本项目操作日志用 AOP 而不是 Interceptor？——职责边界的活教材

看 `OperationLogAspect` 记了什么：`log.setParams(safeParams(point.getArgs()))`（L44）——它要拿**方法的实参**来序列化成操作参数。

- **Interceptor 拿不到方法参数值**（`preHandle` 只有 `handler`，参数还没解析/绑定完），所以想记"这次审批传了什么"，拦截器天生做不到。
- **AOP 的 `ProceedingJoinPoint.getArgs()` 能拿到已经解析绑定好的参数对象**，还能包住 `proceed()` 拿到返回值/异常、算耗时（L36/L47/L55）。

这就是职责边界的真实体现：**要方法级的入参/出参/耗时 → 用 AOP；只要 URL/handler 级别的前后钩子 → 用 Interceptor；要在框架之外改请求响应流 → 用 Filter。**

> 🔑 再补一个和单元 1/4 呼应的坑：AOP（含 `@Transactional`）**只拦"经过代理的、从外部进来的调用"**。`OperationLogAspect` 切的是 Controller 的 public 方法（外部 HTTP 进来必经代理），所以生效；如果某 Service 内部 `this.xxx()` 自调用另一个带 `@Log`/`@Transactional` 的方法，切面**不生效**——原因见 [`08` 单元 4 §4.2](./08-进阶学习计划-第一优先级.md)。

### 2.2 一个高频误区：401/403 根本没走到 ControllerAdvice

很多人以为所有异常都归 `@RestControllerAdvice`。**不是。** 看清楚：

- **未登录 401**：`SecurityConfig` L56 配了 `authenticationEntryPoint`，在 **Filter 层的 `ExceptionTranslationFilter`** 就把响应写了（`JwtAuthenticationEntryPoint` → `RestAuthErrorWriter.write(...401...)`）。请求**压根没进 DispatcherServlet**，`GlobalExceptionHandler` 看都看不到。
- **已认证但无权限 403**：`@PreAuthorize` 拒绝抛 `AuthorizationDeniedException`（`AccessDeniedException` 的子类），由 Security 的 `accessDeniedHandler`（`RestAccessDeniedHandler`）在 Filter 层返回。
- `GlobalExceptionHandler.handleAccessDenied`（L36）是**二道兜底**：万一某个 `AccessDeniedException` 逃到了 MVC 内部才由它接住转 403。

**结论**：认证/授权失败在**最外圈就短路返回**了，这正是"Filter 在 Spring 之外、最外层"的意义——它能在业务开始前就把请求拦回去。

---

## 三、参数解析 → JSON 反序列化 → 响应序列化

一次 `@RequestBody` 请求，参数是怎么从字节流变成 Java 对象、再变回 JSON 的：

```
请求体 (JSON bytes)
   │  HandlerMethodArgumentResolver 选中 @RequestBody
   ▼
RequestResponseBodyMethodProcessor
   │  找到能处理 application/json 的 HttpMessageConverter
   ▼
MappingJackson2HttpMessageConverter → Jackson ObjectMapper.readValue()
   │  反序列化成 LoginRequest / UserCreateRequest ...
   ▼
（若方法参数带 @Valid）→ 触发 Bean Validation 校验
   │  失败 → MethodArgumentNotValidException（进第六节的统一异常）
   ▼
Controller 方法拿到强类型对象
   ...业务...
   ▼
返回 Result<T>
   │  RequestResponseBodyMethodProcessor（因为类上是 @RestController = @Controller+@ResponseBody）
   ▼
MappingJackson2HttpMessageConverter → ObjectMapper.writeValueAsString()
   ▼
响应体 (JSON bytes)
```

几个要点：

- **不同参数注解走不同 Resolver**：`@RequestBody`（整个 body→对象）、`@PathVariable`（URL 模板变量，如 `tasks/{id}`）、`@RequestParam`（query/form）、`@RequestHeader` 各有各的解析器。本项目 `AuthController.login(@Valid @RequestBody LoginRequest, HttpServletRequest)` 就同时用了 body 解析和 Servlet 原生对象注入。
- **`@RestController`** = `@Controller` + `@ResponseBody`，所以返回的 `Result<T>` 会被 `HttpMessageConverter` 直接序列化进 body，而不是当视图名去找页面。
- **序列化/反序列化用的是同一套 MVC `ObjectMapper`**（Spring Boot 自动配置的那个 Bean），下一节专门讲它的策略。

---

## 四、Jackson 的日期 / 枚举 / 空值 / 未知字段策略

先说本项目现状（很重要）：**`application*.yml` 里没有任何 `spring.jackson.*` 配置，也没有自定义 MVC 层 `ObjectMapper`/`Jackson2ObjectMapperBuilderCustomizer`**。所以 **API 出入参走的是 Spring Boot 的默认 Jackson 策略**，未被改动。逐条对照：

| 维度 | Spring Boot 默认行为 | 本项目落到哪 |
|------|----------------------|--------------|
| **日期** | 自动注册 `JavaTimeModule`，`WRITE_DATES_AS_TIMESTAMPS=false` → `LocalDateTime` 序列化成 **ISO-8601 字符串**（`2026-07-22T10:00:00`），**不是**时间戳数字 | `BaseEntity.createdAt/updatedAt`（`LocalDateTime`，L29/L35）出参就是 ISO 字符串 |
| **枚举** | 默认按 `name()` 字符串序列化/反序列化 | 项目**没有 Java 枚举**：状态/菜单类型是 **String 字段 + `@Pattern` 正则**（`UserCreateRequest.status` L32 `@Pattern(regexp="ENABLED\|DISABLED")`）。API 契约要求固定字符串，但落库/传输都是普通 String |
| **空值** | 默认 `JsonInclude.ALWAYS` → **null 字段照样输出** | `Result.data` 为 null 时，响应里仍有 `"data":null`（见 `Result.success()` L28 传 null）。项目没设 `NON_NULL` |
| **未知字段** | Spring Boot 默认 `FAIL_ON_UNKNOWN_PROPERTIES=false` → 请求 JSON 里**多出来的字段被静默忽略**，不报错 | 前端多传字段不会 400；这既方便也意味着"拼错字段名不会被发现" |

> 🔑 全项目其实有**三个 `ObjectMapper`**，务必分清它们**各管各的、互不影响**：
> 1. **MVC 那个**（Spring Boot 自动配置的 Bean）——管 API 出入参，就是本节讲的默认策略。`OperationLogAspect` 构造器注入的 `ObjectMapper`（L27）复用的正是它，用来把操作参数序列化进日志。
> 2. **`RedisConfig` 里 `new ObjectMapper()`**（L29）——**故意单独建**，开了 `activateDefaultTyping` + 多态白名单（L36），为的是把 `LoginUser` 存进 Redis 还能带类型信息还原。注释写明"避免修改 Spring MVC 全局 JSON 序列化规则"——因为 defaultTyping 会往 JSON 里塞 `@class`，绝不能污染对外 API。
> 3. **`RestAuthErrorWriter` 里 `new ObjectMapper()`**（L16）——401/403 要在 Filter 层手写响应（此时还没到 MVC 的消息转换器），所以自备一个最朴素的 mapper。
>
> **这三者分离本身就是知识点**：需要特殊序列化策略（多态、脱离 MVC 上下文）时，**新建独立 `ObjectMapper`，不要动全局那个**，否则会连累所有对外接口。

### 4.x 延伸练习（项目缺什么）
- 若想让响应默认**不输出 null**，加 `spring.jackson.default-property-inclusion: non_null`（注意会全局改变所有接口，评估兼容性）。
- 若想统一日期格式为 `yyyy-MM-dd HH:mm:ss` + 指定时区，配 `spring.jackson.date-format` / `time-zone`，或对 `LocalDateTime` 用 `@JsonFormat`。
- 把 `status` 从"String + @Pattern"升级成真正的 **Java 枚举 + 自定义反序列化**（见下一节的自定义校验注解，二者常一起做）。

---

## 五、分组校验（`@Validated(Group)`）+ 自定义校验注解

**项目现状**：只用了 `@Valid` + 内置约束（`@NotBlank`/`@Size`/`@Pattern`），**没有分组校验、没有自定义 `ConstraintValidator`**（`grep ConstraintValidator` 0 命中）。所以本节 = 讲清机制 + 指出项目现成的改造点，都是**延伸练习**。

### 5.1 现在的写法（先看懂现状）

```java
// UserCreateRequest.java
@NotBlank(message = "{valid.username.notBlank}")   // {key} → 由 LocaleConfig.getValidator 接入 i18n
@Size(min = 2, max = 32, message = "{valid.username.size}")
private String username;

@Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
private String status;
```

- 触发点：Controller 方法参数上的 `@Valid`（如 `AuthController` L34）。校验失败 → `MethodArgumentNotValidException`（进第六节）。
- 文案 i18n：`message = "{key}"` 的花括号写法，靠 `LocaleConfig.getValidator`（L38）把 `MessageSource` 塞进 `LocalValidatorFactoryBean` 才生效——**这是校验消息能随 `Accept-Language` 切换的根**。

### 5.2 分组校验：解决"同一个 DTO，新增和修改校验规则不同"

典型场景：新增用户 `username` 必填；修改用户 `id` 必填、`username` 可不传。若共用一个 DTO，用**分组**区分：

```java
public interface Create {}
public interface Update {}

public class UserRequest {
    @NotNull(groups = Update.class)                 // 只在"修改"时校验必填
    private Long id;
    @NotBlank(groups = Create.class)                // 只在"新增"时校验必填
    private String username;
}

// Controller：用 @Validated 指定本次走哪个组（注意是 @Validated 不是 @Valid）
public Result<Void> create(@Validated(Create.class) @RequestBody UserRequest req) { ... }
public Result<Void> update(@Validated(Update.class) @RequestBody UserRequest req) { ... }
```

- `@Valid`（javax/jakarta）**不支持分组**；分组必须用 Spring 的 `@Validated`。
- 本项目 `UserCreateRequest` / `UserUpdateRequest` 是**两个独立 DTO**（没共用），所以暂时用不上分组——这也是一种合理选择。分组的价值在"字段大量重叠、只有必填规则不同"时才凸显。

### 5.3 自定义校验注解：把 `@Pattern("ENABLED|DISABLED")` 升级成可复用约束

项目里 `status` 用正则字符串校验，散落各处、改一次要改多处。标准做法是造一个注解 + 一个 `ConstraintValidator`：

```java
@Target({FIELD}) @Retention(RUNTIME)
@Constraint(validatedBy = EnumValueValidator.class)
public @interface EnumValue {
    String[] value();                                    // 允许的取值，如 {"ENABLED","DISABLED"}
    String message() default "{valid.enum.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class EnumValueValidator implements ConstraintValidator<EnumValue, String> {
    private Set<String> allowed;
    @Override public void initialize(EnumValue a) { allowed = Set.of(a.value()); }
    @Override public boolean isValid(String v, ConstraintValidatorContext ctx) {
        return v == null || allowed.contains(v);         // null 交给 @NotBlank 管，这里只管取值域
    }
}

// 用起来：
@EnumValue(value = {"ENABLED", "DISABLED"}, message = "{valid.status.pattern}")
private String status;
```

要点：`isValid` 里 **null 一般放行**（是否必填交给 `@NotBlank`/`@NotNull`），职责单一；`message` 同样用 `{key}` 走 i18n。

### 5.4 延伸练习
- 给 `UserCreateRequest.status` / 菜单 `menuType` 落地 `@EnumValue`，替换裸 `@Pattern`。
- 若把 `status` 改成真枚举，再配一个"字符串↔枚举"的 Jackson 反序列化，和第四节的枚举策略串起来。

---

## 六、统一错误协议：404 / 参数格式错 / 业务异常 → HTTP 状态 + 业务 code

这是"让所有失败都长一个样"的收口。先把本项目**真实的映射表**列出来（照着 `GlobalExceptionHandler` + Security handler 读）：

| 失败场景 | 谁抛/在哪层 | 谁处理 | **HTTP 状态** | **body 里的 code** | body message |
|----------|-------------|--------|:---:|:---:|------|
| 未登录 / 令牌无效 | Security Filter 层 | `JwtAuthenticationEntryPoint` | **401** | 401 | `auth.notLoggedIn` |
| 已认证但无权限 | `@PreAuthorize` | `RestAccessDeniedHandler`（+ Advice 兜底 L36）| **403** | 403 | `error.accessDenied` |
| 参数校验失败 | `@Valid` → `MethodArgumentNotValidException` | `GlobalExceptionHandler.handleValidation` L29 | **200** ⚠️ | **400** | 第一个字段错误的文案 |
| 业务异常（如并发冲突 `concurrentModified`、禁止删超管）| Service 抛 `BusinessException` | `handleBusiness` L24 | **200** ⚠️ | 业务码（`e.getCode()`）| `e.getMessage()`（i18n）|
| 兜底未知异常 | 任意未捕获 `Exception` | `handleException` L42 | **500** | 500 | `error.internal`（不泄露堆栈）|
| 访问不存在的路径 404 | 无 handler → Boot `/error` | **Spring Boot 默认**（非本项目 Advice）| **404** | —— | Boot 默认错误体 ⚠️ |

> ⚠️ **两个必须讲透的设计选择/缺口**：
>
> **(1) 业务异常与参数错返回 HTTP 200，靠 body 里的 `code` 区分。** 看代码：`handleBusiness`（L24）和 `handleValidation`（L29）**都没有 `@ResponseStatus`**，所以 HTTP 状态是默认的 200；错误信息全靠 `Result.code`（业务码 / 400）承载。只有 403（L37）、500（L43）显式标了 `@ResponseStatus`。
> - 这是"**HTTP 状态与业务 code 双轨**"的一种常见风格：HTTP 层只表达"传输是否成功"，业务成败看 body。前端拦截器统一判 `result.code === 200`。
> - **代价**要说清：这不符合 REST 严格语义（校验失败按 REST 应是 400 状态），监控/网关按 HTTP 状态统计会把这些当成功。面试被追问时，要能说出"这是团队约定的双轨协议，取舍是前端处理统一、但牺牲了 HTTP 语义"。
>
> **(2) 404 目前不是统一 `Result` 格式**——项目没配 `NoHandlerFoundException` 处理，也没设 `throw-exception-if-no-handler-found`，访问不存在路径会落到 Spring Boot 默认 `/error`（`/error` 还在 `SecurityConfig` 白名单 L30），返回的是 Boot 默认错误 JSON，**不是** `{code,message,data}`。→ **延伸练习**：见 6.2。

### 6.1 统一响应结构

```java
// Result.java —— 全链路唯一出口结构
public class Result<T> {
    private int code;        // 200 成功 / 400 参数 / 401 / 403 / 500 / 业务码
    private String message;  // 走 MessageUtils i18n
    private T data;
}
```

成功走 `Result.success(data)`（code=200），失败一律 `Result.error(code, message)`。**无论正常返回还是异常兜底，出去的都是这一个结构**——这就是"统一协议"的含义。

### 6.2 延伸练习（补齐 404 与更多异常）
- 加 `NoHandlerFoundException` 处理（配 `spring.mvc.throw-exception-if-no-handler-found=true` + `spring.web.resources.add-mappings=false`，再在 `GlobalExceptionHandler` 加 `@ExceptionHandler(NoHandlerFoundException.class)` 返回统一 404 `Result`）。
- 补 `HttpMessageNotReadableException`（body 不是合法 JSON）、`MethodArgumentTypeMismatchException`（`{id}` 传了非数字）、`HttpRequestMethodNotSupportedException`（405）等常见异常，都收敛成统一 `Result`。
- 决定是否把"参数错/业务错"的 HTTP 状态从 200 改成 400/422，与前端约定后统一调整（涉及全站，属大改）。

---

## 七、动手实践（对齐 08 §5.3）

1. **画时序图**：把第零节那张地图，针对 `POST /api/workflow/tasks/{id}/approve` 画成完整时序（Filter→DispatcherServlet→参数解析/@Valid→Controller→AOP 日志→Service 事务+乐观锁→Result 序列化 / 或异常→Advice）。标出 401/403 在哪一层短路。
2. **打印真实链路**：本地起服务，故意制造四种失败——不带 token（401）、越权（403）、`username` 传空（400）、并发审批同一 task（业务码 `workflow.instance.concurrentModified`）——用 curl 观察每个响应的 **HTTP 状态 vs body.code**，亲手验证第六节的映射表。
3. **补一块拼图（三选一）**：给项目加 `NoHandlerFoundException` 统一 404 / 造一个 `@EnumValue` 替换 `status` 的 `@Pattern` / 加一个 `HandlerInterceptor` 打印每个请求的 handler 与耗时，体会它和 AOP 的能力边界差异。

---

## 八、自检 & 面试

### 8.1 自检（对齐 08 §5.4）
1. `Filter`/`Interceptor`/AOP/`ControllerAdvice` 各自处理什么？项目里各自的例子是谁？（AOP=`OperationLogAspect`，Advice=`GlobalExceptionHandler`，Filter=`JwtAuthenticationFilter`，Interceptor=**没有**）
2. 操作日志为什么用 AOP 不用 Interceptor？（要拿方法实参 `getArgs()`，Interceptor 拿不到）
3. 401 和 403 在本项目分别由谁产生、在哪一层返回？为什么它们不进 `GlobalExceptionHandler`？
4. 业务异常返回的 HTTP 状态是多少？靠什么区分成败？这么设计的代价是什么？
5. 请求 JSON 多传一个字段会 400 吗？为什么？（不会，`FAIL_ON_UNKNOWN_PROPERTIES` 默认 false）
6. `RedisConfig` 为什么要单独 `new ObjectMapper()` 而不复用 MVC 那个？

### 8.2 面试怎么问（对齐 08 §5.5，可直接复用并补充）
- **Q：Filter / Interceptor / AOP / ControllerAdvice 区别？** Filter 在 Servlet 层（最外，改请求/响应流、拿不到 handler）；Interceptor 在 handler 前后（拿得到 handler、拿不到参数值）；AOP 包 Bean 方法（拿得到入参/返回/异常，最细）；ControllerAdvice 统一收异常/响应。举例：本项目 JWT 用 Filter、日志用 AOP、异常用 `@RestControllerAdvice`、**刻意没用 Interceptor**。
- **Q：`@RequestBody` 是怎么把 JSON 变成对象的？** `HandlerMethodArgumentResolver` 选中 `@RequestBody` → `MappingJackson2HttpMessageConverter` → Jackson `readValue`；返回值再由同一转换器 `writeValueAsString`。`@RestController` = `@Controller`+`@ResponseBody` 才让返回值直接进 body。
- **Q：Jackson 默认怎么处理未知字段 / 空值 / 日期？** Boot 默认忽略未知字段（不报错）、输出 null、`LocalDateTime` 按 ISO 字符串。要改用 `spring.jackson.*`，且改的是全局，需评估。
- **Q：`@Valid` 和 `@Validated` 区别？** `@Valid` 是标准注解、不支持分组；`@Validated` 是 Spring 的、支持 `groups`。分组用于"同一 DTO 在新增/修改时规则不同"。
- **Q：怎么设计统一异常处理？** `@RestControllerAdvice` 按异常类型分派 → 统一 `Result` + 合适状态码：业务异常带业务 code、校验异常取首个字段消息、鉴权失败在 Security 层就返回 401/403、兜底 500 不泄露堆栈。要能指出本项目"业务/参数错走 HTTP 200 双轨"的取舍。

---

## 承上启下

- 本篇把 08 单元 5 的 5 条原理清单全部展开，并把项目在这条链上的缺口（无 Interceptor、无分组/自定义校验、无枚举、无全局 Jackson 定制、404 未统一）逐一标成延伸练习。
- 与旧章不重复：Filter 与 `SecurityContext` 线程模型见 [`03-认证与登录链路.md`](./03-认证与登录链路.md)；`Result`/`GlobalExceptionHandler`/AOP 操作日志的基础介绍见 [`05-用户模块全链路精读.md`](./05-用户模块全链路精读.md)，本篇只补"执行链全景 + 四组件职责边界 + 序列化/校验/错误协议细节"。
- 下一步：进 07 的**第二优先级——测试体系**。本篇 §7.2 想真正跑起来（尤其带 JWT + `@PreAuthorize` 的 Controller 测试），正需要 `@WebMvcTest` + MockMvc + Spring Security Test 兜底。
