# 阶段 12 · 可观测性：Actuator 与业务指标

> 本篇对应 [`07-Spring-Boot进阶知识缺口与学习路线.md`](./07-Spring-Boot进阶知识缺口与学习路线.md) **§3.3 可观测性与健康检查**。07 提出的问题是："只看控制台日志无法判断线上系统是否健康"，并给出了实践建议——"增加健康检查，并为审批成功、审批失败、审批耗时建立指标"。本篇就是这条建议的落地记录：引入 Spring Boot Actuator（暴露 health/info/metrics/prometheus），并给工作流审批、登录两条关键链路埋上 Micrometer 指标。
>
> 承接关系：09 解决"配置怎么分环境"，10 解决"库结构怎么演进"，本篇解决"系统起来之后怎么知道它是不是真的健康、慢在哪"——三者共同构成 07 §3 生产就绪清单里已经补齐的部分。

---

## 零、改动清单

| 类型 | 文件 | 改动 |
|------|------|------|
| 依赖 | `pom.xml` | 加 `spring-boot-starter-actuator`（无 version，由 parent 管理）+ `micrometer-registry-prometheus`（`scope=runtime`） |
| 配置 | `application.yml` | 新增 `management:`（暴露 health/info/metrics/prometheus，开探针组，`show-details: when-authorized`）+ `info:`（应用名/描述） |
| 配置 | `application-prod.yml` | 新增 `management.endpoints.web.exposure.include: health,info`（生产收敛，不暴露 metrics/prometheus） |
| 安全 | `SecurityConfig.java` | `authorizeHttpRequests` 里新增两条 `requestMatchers`：health 匿名放行，其余 actuator 端点要求 `monitor:view` 权限 |
| 新增 | `common/observability/WorkflowMetrics.java` | 封装审批成功/失败计数+耗时、登录成功/失败计数的 Micrometer 埋点组件 |
| 埋点 | `TaskService.approve(...)` | try/finally 包住 `workflowEngine.approve`，记 `workflow.approve` 计数 + `workflow.approve.duration` 耗时 |
| 埋点 | `AuthService.login(...)` | 在既有的登录日志 try/catch 里，同步记 `auth.login` 成功/失败计数 |

---

## 一、为什么只看控制台日志不够

写业务代码时，"报错了就看日志"是够用的排查方式：日志里有异常堆栈、有具体是哪个用户哪次请求出的错。但线上运维要回答的是另一类问题，日志天生答不好：

- **"系统现在健不健康？"** —— 日志是事件流，你得主动去翻；没有一个"当前状态"的快照。容器编排（K8s/Docker）也没法"读日志"来判断要不要重启或摘流量。
- **"审批平均要多久？是不是比昨天慢了？"** —— 日志里一条条打印耗时，人工没法算 P99、算趋势；日志文件越滚越大，事后统计成本很高。
- **"这次慢是 JVM GC 的锅，还是数据库连接池打满了？"** —— 日志通常只记业务层面的信息，JVM 内部状态（堆内存、线程数、GC 次数）不会自己出现在业务日志里。

这三类问题分别对应 Actuator 要解决的三件事：**健康检查**（health）、**业务指标**（自定义 Counter/Timer）、**基础设施指标**（JVM/连接池等自动暴露）。日志负责"发生了什么、为什么"，指标负责"现在状态如何、趋势怎样"——两者互补，不是二选一。

---

## 二、本项目改了什么

### 2.1 依赖：`pom.xml`

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<!-- Prometheus 抓取端点（/actuator/prometheus） -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <scope>runtime</scope>
</dependency>
```

`spring-boot-starter-actuator` 自带 Micrometer 核心（`MeterRegistry` 等），本身就能让 `/actuator/metrics` 工作；`micrometer-registry-prometheus` 是**多一种输出格式**——把同一份指标数据额外按 Prometheus 文本协议暴露在 `/actuator/prometheus`，方便被 Prometheus Server 抓取。二者是"有没有指标系统"和"指标用什么格式对外"两件事，缺后者也能看指标（走 `/actuator/metrics/{name}`），只是接不上 Prometheus 生态。

### 2.2 `management` 配置：`application.yml`

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      probes:
        enabled: true          # 启用 liveness / readiness 探针组
      show-details: when-authorized   # 详情仅对已认证用户可见
  info:
    env:
      enabled: true
info:
  app:
    name: ${spring.application.name}
    description: RBAC 权限管理系统
```

`exposure.include` 是白名单——Actuator 默认只暴露 `health`，其它端点必须显式列出才会挂到 HTTP 上（哪怕挂了还要过 `SecurityConfig` 的鉴权）。这是双重防御：先"端点存不存在"，再"能不能访问"。

### 2.3 生产收敛：`application-prod.yml`

```yaml
# ── Actuator：生产收敛暴露端点，不把 prometheus 明细暴露给公网 ──
management:
  endpoints:
    web:
      exposure:
        include: health,info
```

同一个 `management.endpoints.web.exposure.include` 键，在 `application.yml`（公共）写的是 `health,info,metrics,prometheus`，在 `application-prod.yml` 里覆盖成 `health,info`——Spring Boot 的 profile 配置合并规则是"同名叶子键，后加载的 profile 覆盖公共配置"，`prod` 激活时这里会整体替换，而不是在公共值上追加。这正是 09 单元讲过的多环境配置分层用法在这里的实战：**同一份代码，生产比开发少暴露两个端点**。

### 2.4 SecurityConfig 端点保护

```java
.authorizeHttpRequests(auth -> auth
        .requestMatchers(WHITELIST).permitAll()   // 白名单路径放行（登录/刷新/探活/错误页）
        // actuator 健康探针匿名可访问（供容器 liveness/readiness 探测）
        .requestMatchers("/actuator/health/**", "/actuator/health").permitAll()
        // 其余管理端点需要监控查看权限，避免泄露配置/指标
        .requestMatchers("/actuator/**").hasAuthority("monitor:view")
        .anyRequest().authenticated())            // 其余所有请求：必须已认证（否则 → 401）
```

`health` 单独放行是必须的——容器编排要在**应用还没登录态、甚至可能还没准备好签发 Token 的阶段**就能探活，不能要求探针带认证信息。而 `metrics`/`prometheus`/`env` 等其它端点会泄露配置项、依赖版本、JVM 参数、内部指标名，收敛到 `monitor:view` 权限之后。

### 2.5 `WorkflowMetrics`：业务指标埋点组件

```java
@Component
public class WorkflowMetrics {

    private final MeterRegistry registry;

    public WorkflowMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** 计时用采样，在业务方法开始时创建。 */
    public Timer.Sample startSample() {
        return Timer.start(registry);
    }

    /** 记录一次审批结果与耗时（毫秒）。 */
    public void recordApprove(boolean success, long millis) {
        registry.counter("workflow.approve", "result", success ? "success" : "fail").increment();
        registry.timer("workflow.approve.duration").record(millis, TimeUnit.MILLISECONDS);
    }

    /** 记录一次登录结果。 */
    public void recordLogin(boolean success) {
        registry.counter("auth.login", "result", success ? "success" : "fail").increment();
    }
}
```

`MeterRegistry` 是 Actuator/Micrometer 自动配置好的 Bean，直接构造器注入即可，不用手写 `@Bean`。`registry.counter(name, tag...)` / `registry.timer(name)` 是懒创建：同名同 tag 的指标第一次调用时创建，之后复用同一个 Meter 实例，不会每次 new 出新对象。`startSample()` 目前预留未用（本项目审批耗时用 `System.currentTimeMillis()` 手工计时），保留作为以后想用 `Timer.Sample` 语法糖时的入口。

### 2.6 `TaskService.approve`：审批埋点

```java
public void approve(Long taskId, String comment) {
    long start = System.currentTimeMillis();
    boolean ok = false;
    try {
        workflowEngine.approve(taskId, comment);
        ok = true;
    } finally {
        metrics.recordApprove(ok, System.currentTimeMillis() - start);
    }
}
```

用 `finally` 而不是在 try 末尾直接调用，是为了**无论成功还是抛异常都要记一次指标**——`ok` 默认 `false`，只有 `workflowEngine.approve(...)` 真正跑完没抛异常才置为 `true`。耗时统计同理覆盖两种路径，异常没有被吞掉（`finally` 不影响异常继续往外抛）。

### 2.7 `AuthService.login`：登录埋点

```java
logService.recordLogin(request.getUsername(), true, "登录成功", loginIp, userAgent);
metrics.recordLogin(true);
return loginVO;
} catch (BusinessException e) {
    logService.recordLogin(request.getUsername(), false, e.getMessage(), loginIp, userAgent);
    metrics.recordLogin(false);
    throw e;
} catch (RuntimeException e) {
    metrics.recordLogin(false);
    throw e;
}
```

这里有两个 `catch`，顺序不能换（`BusinessException` 是 `RuntimeException` 的子类，子类必须写在前面，否则编译不过）：

- **`catch (BusinessException e)`**：密码错、账号禁用等**业务性**登录失败。这类失败原本就要调 `logService.recordLogin(false, ...)` 落库审计日志，现在紧邻它加一行 `metrics.recordLogin(false)`，保证"日志记了一条失败"和"指标加了一次 fail"永远同步。
- **`catch (RuntimeException e)`**：数据库异常、Token 签发失败等**基础设施性**失败。这类异常不会落 `logService`（现有审计日志设计只覆盖业务失败），但对可观测性来说恰恰是最需要被看见的——数据库抖动导致登录失败，`auth.login{result=fail}` 应该照样涨。第一版实现只捕了 `BusinessException`，评审时发现这个覆盖面缺口，才补上了这个第二 `catch`（两个 catch 分支都不吞异常，末尾都 `throw e`，行为语义不变，只是多记了一次指标）。

---

## 三、原理：health 端点 vs liveness / readiness 探针

Actuator 的 `/actuator/health` 本质是一堆 `HealthIndicator` 聚合出的一个总状态（`UP`/`DOWN`），本项目没有写任何自定义 `HealthIndicator`，能看到的组件全部来自自动配置——检测到 `DataSource` Bean 就自动加一个 `db` 探测（跑一条校验 SQL），检测到 Redis 连接工厂就自动加一个 `redis` 探测（`PING`），再加上磁盘空间等内置项。

`probes.enabled: true` 额外打开了两个**探针组**（本质是对同一批 `HealthIndicator` 按用途分组）：

| 探针 | 端点 | 默认只反映什么 | 回答的问题 |
|------|------|----------------|------------|
| **Liveness** | `/actuator/health/liveness` | `LivenessStateHealthIndicator`——JVM 进程是否还活着、有没有死锁/内部状态损坏到需要重启 | "要不要杀掉这个容器重启？" |
| **Readiness** | `/actuator/health/readiness` | `ReadinessStateHealthIndicator`——应用是否**声明自己**准备好接受流量（启动完成、未在优雅停机中） | "现在能不能把流量转发给它？" |

**关键点也是最容易误解的地方**：Spring Boot 默认的 readiness 组**并不包含** `db`/`redis` 这些依赖检测——它只反映应用自身的 `ApplicationAvailability` 状态（是否跑完了启动流程、是否开始优雅停机）。本项目目前也没有把 `db`/`redis` 显式加进 readiness 组（如需要，得配 `management.endpoint.health.group.readiness.include=readinessState,db,redis`）。真正会体现 `db`/`redis` 健康状况的是**顶层 `/actuator/health`**（聚合全部 indicator），而不是 `/actuator/health/readiness`。这一点直接对应第六节的自测题，先记住结论，下节展开回答。

---

## 四、原理：Micrometer 三种指标类型，本项目各用在哪

Micrometer 是 Spring Boot Actuator 底层的指标门面（类似 SLF4J 之于日志），`MeterRegistry` 是它的核心接口，最常用三种 Meter：

| 类型 | 语义 | 只增不减？ | 本项目的例子 |
|------|------|------------|--------------|
| **Counter** | 累计发生次数 | 是（只增，重启归零） | `workflow.approve{result=success\|fail}`、`auth.login{result=success\|fail}` |
| **Timer** | 一段耗时的次数+总时长分布（自带 count/sum/max，可配百分位） | 计数部分只增 | `workflow.approve.duration`（审批耗时，毫秒） |
| **Gauge** | 某一时刻的瞬时值，可增可减 | 否 | 本项目**没有**手写 Gauge，但 Actuator 自动配置替你暴露了一批：JVM 堆内存 `jvm.memory.used`、线程数 `jvm.threads.live`、HikariCP 活跃连接数 `hikaricp.connections.active` 都是 Gauge |

区分方式很直观：Counter 答"发生了几次"（只能变多）；Timer 是"Counter + 耗时分布"的组合体，专门给"一次操作花了多久"这种场景用；Gauge 答"现在是多少"（此刻的连接池活跃数、此刻的堆内存占用，随时可能回落）。

本项目的 `tag("result", "success"/"fail")` 用法是 Micrometer 的**维度**（dimensional metrics）——`workflow.approve` 不是两个指标名，而是一个指标名配不同 tag 值，查询时既能看总量也能按 `result` 拆开看成功率，这是 Micrometer 相对"打点式"埋点（每个状态一个变量名）的核心优势。

---

## 五、`show-details=when-authorized` 与端点鉴权为什么重要

`/actuator/health` 默认只返回 `{"status":"UP"}` 这样一个总状态，不暴露每个组件的细节；`show-details: when-authorized` 打开后，**已认证用户**能看到展开的组件明细：

```json
{
  "status": "UP",
  "components": {
    "db": { "status": "UP", "details": { "database": "MySQL", "validationQuery": "..." } },
    "redis": { "status": "UP", "details": { "version": "7.4.x" } },
    "diskSpace": { "status": "UP", "details": { "total": ..., "free": ... } }
  }
}
```

这些细节（数据库类型、Redis 版本、磁盘容量）对匿名探针没有意义，却是攻击者侦察内网拓扑的现成情报——这就是为什么不能让所有人看，配合 `SecurityConfig` 里 `/actuator/**` 要求 `monitor:view` 权限，形成"health 总状态匿名可查（供探针用）、health 明细 + metrics/prometheus 等其它端点必须鉴权"的两级暴露面。

需要留意 `when-authorized` 的判定粒度：它默认只看**是否已认证**（有没有合法身份），不看是哪个角色/权限。也就是说，如果只配了 `show-details: when-authorized` 而不额外限制 `roles`，**任何登录用户**（哪怕只是普通业务账号，没有 `monitor:view`）访问 `/actuator/health` 时都能看到组件明细——只是访问不了 `/actuator/metrics` 等被 `SecurityConfig` 拦住的端点而已。若想进一步收窄"谁能看 health 明细"，需要额外配 `management.endpoint.health.roles: MONITOR`（配合 `management.security.roles` 或自定义 `RoleVoter`），本项目目前未做这层收紧，属于第七节的踩坑点之一，留作进阶练习。

---

## 六、结合本项目回答 07 的两道自测题

### 6.1 "应用显示进程还活着是否就代表它能正常提供服务？"

**不代表。** 结合第三节的结论：

- **Liveness**（`/actuator/health/liveness`）只回答"JVM 进程有没有死"——进程活着，但如果 MySQL 连不上、Redis 连不上，登录/权限校验全部失败，用户看到的是清一色 500，而 liveness 探针照样返回 `UP`（容器不会被杀，因为"活着"和"能干活"是两回事）。
- **Readiness**（`/actuator/health/readiness`）默认也**不**检测 `db`/`redis`——它只反映应用是否走完了启动流程、有没有在优雅停机。本项目没有把 `db`/`redis` 加进 readiness 组，所以现状是：即使数据库整个宕掉，readiness 探针**依然显示 `UP`**，K8s 不会把它从负载均衡里摘掉，请求还是会被转发进来然后失败。
- 想真正判断"能不能提供服务"，要看**顶层 `/actuator/health`**（聚合了 `db`/`redis` 两个自动配置的 indicator），或者手动把它们纳入 readiness 组。这是本项目当前的一个真实缺口，对应第七节踩坑点。

一句话：liveness = "要不要重启我"，readiness（本项目现状）= "我启动完了没"，都不等于"下游依赖是否健康"——这也是很多团队上线后才踩到的坑。

### 6.2 "一次审批耗时突然升高，应该看哪些指标和日志？"

按"业务指标 → 基础设施指标 → 日志"的顺序排查：

1. **`workflow.approve.duration`**（本项目自建 Timer）：先确认确实是 approve 这一步慢了，还是别的接口也慢（区分"局部业务慢"还是"整体系统慢"）。
2. **`workflow.approve{result=fail}` 计数是否同时升高**：耗时升高常伴随失败率升高（比如乐观锁冲突重试、超时），两个指标一起看能判断是"单纯变慢"还是"开始出错"。
3. **HikariCP 连接池指标**（`hikaricp.connections.active`/`hikaricp.connections.pending`）：approve 内部要写 `wf_process_task`/`wf_process_instance`，如果连接池被打满，新请求要排队等连接，直接表现为耗时升高。
4. **JVM 指标**（`jvm.gc.pause`、`jvm.memory.used`）：如果 Full GC 频繁或堆内存告急，STW 会拖慢所有请求，不只是 approve。
5. **数据库慢查询日志 / MySQL 自身指标**：审批涉及乐观锁 `@Version` 更新，如果并发审批冲突多，会有大量重试或锁等待，这类信息指标层面可能看不细，需要回落到数据库慢日志确认具体 SQL。
6. **应用日志**：最后核对具体某几次慢请求的 traceId/时间点，看有没有异常堆栈（超时异常、连接拒绝），把"指标发现异常"和"日志定位原因"串起来。

指标负责**快速定位在哪一层**，日志负责**具体是哪次请求、什么原因**——这正是第一节说的"两者互补"。

---

## 七、踩坑点

**a) actuator 路径带不带 `/api`？—— 不带。**

本项目所有业务接口都在 `server.servlet.context-path: /api` 下，浏览器/前端实际访问的是 `/api/actuator/health`。但 `SecurityConfig` 里的 `requestMatchers("/actuator/health/**", ...)`、`requestMatchers("/actuator/**")` **都不带 `/api` 前缀**——因为 `requestMatchers` 匹配的是 Servlet 容器内部的路径，**相对 context-path**，和项目里 `WHITELIST`（`/auth/login` 而不是 `/api/auth/login`）用的是同一套约定。第一次配置的人很容易照着 curl 测试的完整 URL（带 `/api`）去写 matcher，导致规则完全不生效（要么该放行的被拦，要么该拦的漏放）。

**b) 未带 Token 访问受保护 actuator 端点，返回的是 401，不是 403。**

这条容易和"敏感端点应该 403"的直觉搞反，结合 11 篇讲过的 Security 异常分发链路重新过一遍：

- `SecurityConfig` 里 `.requestMatchers("/actuator/**").hasAuthority("monitor:view")` 只是声明了**授权规则**——请求需要具备这个权限。
- 请求真正落地时先经过**认证**判断：`ExceptionTranslationFilter` 发现当前请求是**匿名**的（没带 Token 或 Token 无效），会把授权失败包装成 `AccessDeniedException`，但由于发起者是匿名用户（`AnonymousAuthenticationToken`），Spring Security 会转而调用 **`AuthenticationEntryPoint`** 而不是 `AccessDeniedHandler`——这是 Security 内部的固定策略：**匿名用户被拒绝访问受保护资源，统一视为"未认证"，走 401**。
- 只有**已经带着合法 Token、已认证，但权限不够**（比如普通用户拿着有效身份访问 `/api/actuator/metrics`，没有 `monitor:view`）时，才会真正走 `RestAccessDeniedHandler` 返回 **403**。

对照第六节前的映射：`/actuator/health`、`/actuator/health/**` 匿名 200 放行；不带 Token 访问 `/actuator/metrics` 等其它端点 → **401**；带 Token 但账号没有 `monitor:view` → **403**。这条在 A1 实现阶段一度被写成"预期 403"，走读代码后订正为 401——写文档/测试时以这条为准。

**c) prometheus 依赖要 `scope=runtime`；生产端点已收敛。**

`micrometer-registry-prometheus` 只在运行时把已采集的指标数据编码成 Prometheus 文本格式，编译期代码不直接引用它的类，所以标 `scope=runtime`——既表达了真实的依赖关系，也避免它被打进编译期 classpath 造成误用。`application-prod.yml` 把 `management.endpoints.web.exposure.include` 收窄成 `health,info`，意味着生产环境即使加了这个依赖，`/actuator/prometheus`、`/actuator/metrics` 也不会被暴露出来——真要接 Prometheus 抓取，得先有意识地把 `prometheus` 重新加回生产的 exposure 列表，并配合权限收紧。

**d) `monitor:view` 权限码目前只是约定，还没有账号能实际访问敏感端点。**

`SecurityConfig` 里写的 `hasAuthority("monitor:view")` 只是**代码层面声明了这个权限标识字符串**，本项目权限体系里的权限码是要落到 `sys_permission` 表并分配给角色（参考 04 篇的授权设计）才会真正生效。目前数据库里还没有 `monitor:view` 这条权限记录，也没有分配给任何角色——意味着**除了内置超管**（超管在本项目里通常走"角色包含全部权限"或专门判断绕过 `hasAuthority` 检查的逻辑，具体以 04 篇为准）外，**现在没有任何账号能真正访问 `/api/actuator/metrics` 等受保护端点**，即便它们已经在代码里"开了口子"。这是留待后续任务的收尾工作：在权限管理模块里补上这个权限码、分配给运维/监控角色。

**e)（进阶提示）`show-details=when-authorized` 不等于"按角色收窄"。**

第五节已经展开：这个配置项默认只判断"是否已认证"，不看具体权限/角色。所以哪怕 `monitor:view` 还没分配给任何人（见 d），**任何一个能登录系统的普通用户**访问 `/api/actuator/health` 时依然能看到 `db`/`redis`/`diskSpace` 的详情（因为 health 单独放行到"已认证即可"这一档，没有卡在 `hasAuthority("monitor:view")` 这条规则里——回看 2.4 的代码，health 那条 matcher 是 `permitAll()`，比"已认证"还宽）。如果安全要求是"只有运维角色能看 health 明细"，需要额外配置 `management.endpoint.health.roles` 并调整 Security 规则做角色级收紧，这不是"改一个开关"就能自动获得的效果。

---

## 八、承上启下

- 本篇把 07 §3.3 的可观测性缺口从"知道要做"落到"代码里真的有"：Actuator 暴露端点、Security 分层保护、Micrometer 三类指标各自的落点、审批与登录两条关键链路的埋点全部对齐到真实代码。
- 与其它篇的关系：09 讲配置分环境、10 讲库结构怎么演进、11 讲一次请求的执行链，本篇讲"系统跑起来之后怎么被看见"——四篇合起来覆盖了 07 §2~§3 里"配置、迁移、执行链、可观测性"四块生产就绪能力。
- 延伸练习：
  1. 把 `db`/`redis` 显式加进 readiness 组（`management.endpoint.health.group.readiness.include`），验证数据库断开时 readiness 是否会真的变 `DOWN`。
  2. 给 `TaskService.reject`/`transfer` 补上和 `approve` 对称的埋点（目前只有 approve 有，reject/transfer 是指标空白区）。
  3. 把 `monitor:view` 权限码落库、分配给一个测试角色，端到端验证"带 Token + 有权限"访问 `/actuator/metrics` 确实返回 200，闭环第七节 d 条的遗留问题。
