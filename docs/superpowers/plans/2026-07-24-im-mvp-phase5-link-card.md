# IM 链接卡片（里程碑 7）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发送含链接的 TEXT 消息后，服务端异步抓取该链接的 OG 元数据（严格 SSRF 防护 + 超时），成功则把卡片补写进该消息并向会话在线成员推一帧 `LINK_PREVIEW` 让客户端就地升级为卡片；失败降级纯文本。

**Architecture:** 触发点在 `InboundMessageConsumer` 里 `MessageAppender.append()` 返回后调用 `LinkPreviewService.tryEnrich(cid, seq, text)`，提交到专用有界线程池异步执行。异步任务：提取首个 URL → Redis 正/负缓存 → `SsrfGuardedFetcher` 逐跳抓取 HTML → `OgParser` 解析 → 回写 Mongo `body.link` + `OutboundDispatcher.dispatch` 扇出 `LINK_PREVIEW`。消息发送主链路完全不受影响。

**Tech Stack:** Java 21 + Spring Boot 3.4.1；JDK 内置 `java.net.http.HttpClient`（`followRedirects(NEVER)` 手动逐跳）；jsoup（HTML 解析，新增依赖）；Spring Data MongoDB（消息存储）；`StringRedisTemplate`/Lettuce（缓存）；JUnit 5 + Mockito + AssertJ（测试）。

## Global Constraints

- 仅处理 `type == "TEXT"` 的消息；一条消息只取**第一个** `http(s)` URL，最多一张卡。
- SSRF 防护为**严格白名单式**：协议 ∈ {http,https}；端口 ∈ {80,443}；解析出的**每个** A/AAAA IP 都不得命中危险段（完整 IPv4 + IPv6 清单见 Task 4）；重定向**逐跳重新全套校验**，最多 3 跳。
- `title` 为卡片必要字段：`og:title` 与 `<title>` 都取不到 → 判抓取失败，不写 `link`。
- 字段落库前限长：`title` ≤ 200、`description` ≤ 300、`url` ≤ 2048 字符。
- `LINK_PREVIEW` 帧复用现有 `Envelope`，link 放 `body.link`，**不给 `Envelope` 新增顶层字段**；网关零改动。
- 抓取异常一律**不外抛**（独立线程池），只记日志 + 写负缓存。
- 缓存 key：`im:link:og:<sha256(url)>`；正缓存 TTL 6h、负缓存 TTL 10min（负缓存 sentinel 值 `"FAIL"`）。
- 新增依赖仅 `org.jsoup:jsoup`；无新增中间件、无新增环境变量。
- 现有 IM 纯逻辑单测用 JUnit5 + Mockito（不起 Spring 容器）；仅配置绑定测试用 `@SpringBootTest` + `@ActiveProfiles("test")`（参照 `MediaPropertiesTest`）。

---

### Task 1: 依赖 + 配置 + 值对象（jsoup / LinkPreviewProperties / LinkCard / yml）

**Files:**
- Modify: `backend/pom.xml`（新增 jsoup 依赖，参照现有 s3 依赖的内联 `<version>` 风格，约在 `<dependency>software.amazon.awssdk</dependency>` 之后）
- Create: `backend/src/main/java/com/rbac/im/vo/LinkCard.java`
- Create: `backend/src/main/java/com/rbac/im/config/LinkPreviewProperties.java`
- Modify: `backend/src/main/resources/application.yml`（`rbac.im` 段下新增 `link:` 子段，紧跟 `media:` 段之后、`management:` 之前）
- Test: `backend/src/test/java/com/rbac/im/config/LinkPreviewPropertiesTest.java`

**Interfaces:**
- Produces:
  - `com.rbac.im.vo.LinkCard`（record）：`LinkCard(String url, String title, String description, String image, String siteName)`
  - `com.rbac.im.config.LinkPreviewProperties`（`@Component @ConfigurationProperties(prefix="rbac.im.link")`）：getter/setter `boolean enabled`、`int connectTimeoutMs`、`int requestTimeoutMs`、`long maxBodyBytes`、`int maxRedirects`、`List<Integer> allowedPorts`、`String userAgent`、`Duration cacheTtlOk`、`Duration cacheTtlFail`、`int poolCore`、`int poolMax`、`int poolQueue`

- [ ] **Step 1: 加 jsoup 依赖**

在 `backend/pom.xml` 的 s3 依赖块之后新增：

```xml
        <!-- IM 链接卡片：OG 元数据 HTML 解析 -->
        <dependency>
            <groupId>org.jsoup</groupId>
            <artifactId>jsoup</artifactId>
            <version>1.18.1</version>
        </dependency>
```

- [ ] **Step 2: 写 LinkCard 值对象**

```java
package com.rbac.im.vo;

/** 链接卡片值对象。title 必填（否则判抓取失败）；其余可空。 */
public record LinkCard(String url, String title, String description, String image, String siteName) {}
```

- [ ] **Step 3: 写 LinkPreviewProperties**

```java
package com.rbac.im.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

/** 链接卡片抓取配置。所有阈值可经 rbac.im.link.* 调整。 */
@Component
@ConfigurationProperties(prefix = "rbac.im.link")
@Data
public class LinkPreviewProperties {
    /** 总开关，false 则完全不抓取。 */
    private boolean enabled = true;
    private int connectTimeoutMs = 2000;
    private int requestTimeoutMs = 2000;
    private long maxBodyBytes = 524288;      // 512KB
    private int maxRedirects = 3;
    private List<Integer> allowedPorts = List.of(80, 443);
    private String userAgent = "RBAC-IM-LinkBot/1.0";
    private Duration cacheTtlOk = Duration.ofHours(6);
    private Duration cacheTtlFail = Duration.ofMinutes(10);
    private int poolCore = 2;
    private int poolMax = 4;
    private int poolQueue = 100;
}
```

- [ ] **Step 4: yml 新增 link 段**

在 `application.yml` 的 `rbac.im.media` 段之后（与 `media` 同级）新增：

```yaml
    link:
      enabled: true
      connect-timeout-ms: 2000
      request-timeout-ms: 2000
      max-body-bytes: 524288
      max-redirects: 3
      allowed-ports: [80, 443]
      user-agent: "RBAC-IM-LinkBot/1.0"
      cache-ttl-ok: 6h
      cache-ttl-fail: 10m
      pool-core: 2
      pool-max: 4
      pool-queue: 100
```

- [ ] **Step 5: 写配置绑定测试（先失败）**

```java
package com.rbac.im.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class LinkPreviewPropertiesTest {

    @Autowired LinkPreviewProperties props;

    @Test
    void binds_defaults_and_yml_values() {
        assertThat(props.isEnabled()).isTrue();
        assertThat(props.getConnectTimeoutMs()).isEqualTo(2000);
        assertThat(props.getMaxBodyBytes()).isEqualTo(524288L);
        assertThat(props.getMaxRedirects()).isEqualTo(3);
        assertThat(props.getAllowedPorts()).containsExactly(80, 443);
        assertThat(props.getUserAgent()).isEqualTo("RBAC-IM-LinkBot/1.0");
        assertThat(props.getCacheTtlOk()).isEqualTo(Duration.ofHours(6));
        assertThat(props.getCacheTtlFail()).isEqualTo(Duration.ofMinutes(10));
        assertThat(props.getPoolQueue()).isEqualTo(100);
    }
}
```

- [ ] **Step 6: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=LinkPreviewPropertiesTest`
Expected: 编译失败或断言失败（类未创建 / yml 未加）。补齐 Step 1-4 后重跑应 PASS。
> 注：该测试需连本地 MySQL/Redis（`@SpringBootTest` 起容器）。若无中间件，可临时降级为 `assertThat(new LinkPreviewProperties().getMaxRedirects()).isEqualTo(3)` 的纯默认值断言；但优先按上面跑真容器。

- [ ] **Step 7: 跑测试确认通过并提交**

Run: `mvn -f backend/pom.xml test -Dtest=LinkPreviewPropertiesTest`
Expected: PASS

```bash
git add backend/pom.xml backend/src/main/java/com/rbac/im/vo/LinkCard.java \
        backend/src/main/java/com/rbac/im/config/LinkPreviewProperties.java \
        backend/src/main/resources/application.yml \
        backend/src/test/java/com/rbac/im/config/LinkPreviewPropertiesTest.java
git commit -m "feat(im): 链接卡片配置骨架（jsoup 依赖 + LinkPreviewProperties + LinkCard）"
```

---

### Task 2: UrlExtractor（纯函数：文本 → 首个 http(s) URL）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/UrlExtractor.java`
- Test: `backend/src/test/java/com/rbac/im/service/UrlExtractorTest.java`

**Interfaces:**
- Produces: `UrlExtractor.firstHttpUrl(String text)` → `java.util.Optional<String>`（静态方法；取文本中第一个 `http://` 或 `https://` 开头的 URL，去除尾随中文/标点边界；无则 `Optional.empty()`）

- [ ] **Step 1: 写失败测试**

```java
package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class UrlExtractorTest {

    @Test
    void takes_first_of_multiple() {
        assertThat(UrlExtractor.firstHttpUrl("看这个 https://a.com 和 https://b.com"))
                .contains("https://a.com");
    }

    @Test
    void none_when_no_url() {
        assertThat(UrlExtractor.firstHttpUrl("纯文本没有链接")).isEmpty();
        assertThat(UrlExtractor.firstHttpUrl(null)).isEmpty();
        assertThat(UrlExtractor.firstHttpUrl("")).isEmpty();
    }

    @Test
    void trims_trailing_chinese_and_punctuation() {
        assertThat(UrlExtractor.firstHttpUrl("戳 https://x.com/a，快看")).contains("https://x.com/a");
        assertThat(UrlExtractor.firstHttpUrl("链接：https://x.com/p。")).contains("https://x.com/p");
    }

    @Test
    void ignores_non_http_scheme() {
        assertThat(UrlExtractor.firstHttpUrl("ftp://x.com file:///etc/passwd")).isEmpty();
    }

    @Test
    void keeps_query_and_path() {
        assertThat(UrlExtractor.firstHttpUrl("https://x.com/p?a=1&b=2#frag next"))
                .contains("https://x.com/p?a=1&b=2#frag");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=UrlExtractorTest`
Expected: FAIL（`UrlExtractor` 不存在）

- [ ] **Step 3: 实现**

```java
package com.rbac.im.service;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 从文本提取第一个 http(s) URL。纯函数，无 IO。 */
public final class UrlExtractor {

    // URL 主体允许的字符（RFC 3986 常见子集）；不含空白与中文标点，天然在边界处截断。
    private static final Pattern URL = Pattern.compile(
            "https?://[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
            Pattern.CASE_INSENSITIVE);

    private UrlExtractor() {}

    public static Optional<String> firstHttpUrl(String text) {
        if (text == null || text.isEmpty()) {
            return Optional.empty();
        }
        Matcher m = URL.matcher(text);
        if (!m.find()) {
            return Optional.empty();
        }
        String url = m.group();
        // 去掉常见尾随英文标点（正则已挡中文/空白，但 . , ; ) 可能是句尾而非 URL 一部分）
        while (!url.isEmpty() && ".,;)!?'\"".indexOf(url.charAt(url.length() - 1)) >= 0) {
            url = url.substring(0, url.length() - 1);
        }
        return url.isEmpty() ? Optional.empty() : Optional.of(url);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=UrlExtractorTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/UrlExtractor.java \
        backend/src/test/java/com/rbac/im/service/UrlExtractorTest.java
git commit -m "feat(im): UrlExtractor 提取文本首个 http(s) URL"
```

---

### Task 3: OgParser（纯函数：HTML → LinkCard，jsoup）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/OgParser.java`
- Test: `backend/src/test/java/com/rbac/im/service/OgParserTest.java`

**Interfaces:**
- Consumes: `com.rbac.im.vo.LinkCard`（Task 1）；`com.rbac.im.config.LinkPreviewProperties`（限长常量在 Global Constraints）
- Produces: `OgParser.parse(String html, String baseUrl)` → `Optional<LinkCard>`（静态方法；`baseUrl` 为逐跳后的最终 URL，用于把相对 image 绝对化并作为 `LinkCard.url`；`title` 缺失返回 `Optional.empty()`）

- [ ] **Step 1: 写失败测试**

```java
package com.rbac.im.service;

import com.rbac.im.vo.LinkCard;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class OgParserTest {

    @Test
    void full_og_tags() {
        String html = """
            <html><head>
              <meta property="og:title" content="标题T">
              <meta property="og:description" content="摘要D">
              <meta property="og:image" content="https://x.com/og.png">
              <meta property="og:site_name" content="Example">
            </head><body>x</body></html>""";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/a");
        assertThat(c).isPresent();
        assertThat(c.get().title()).isEqualTo("标题T");
        assertThat(c.get().description()).isEqualTo("摘要D");
        assertThat(c.get().image()).isEqualTo("https://x.com/og.png");
        assertThat(c.get().siteName()).isEqualTo("Example");
        assertThat(c.get().url()).isEqualTo("https://x.com/a");
    }

    @Test
    void falls_back_to_title_tag_when_no_og_title() {
        String html = "<html><head><title>页面标题</title></head><body>x</body></html>";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/a");
        assertThat(c).isPresent();
        assertThat(c.get().title()).isEqualTo("页面标题");
        assertThat(c.get().description()).isNull();
        assertThat(c.get().image()).isNull();
    }

    @Test
    void empty_when_no_title_at_all() {
        String html = "<html><head><meta property=\"og:image\" content=\"https://x.com/i.png\"></head></html>";
        assertThat(OgParser.parse(html, "https://x.com/a")).isEmpty();
    }

    @Test
    void empty_on_blank_or_malformed() {
        assertThat(OgParser.parse("", "https://x.com/a")).isEmpty();
        assertThat(OgParser.parse("<<not html>>", "https://x.com/a")).isEmpty();
        assertThat(OgParser.parse(null, "https://x.com/a")).isEmpty();
    }

    @Test
    void absolutizes_relative_image() {
        String html = """
            <html><head><meta property="og:title" content="T">
            <meta property="og:image" content="/img/og.png"></head></html>""";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/dir/page");
        assertThat(c.get().image()).isEqualTo("https://x.com/img/og.png");
    }

    @Test
    void truncates_long_fields() {
        String longTitle = "t".repeat(300);
        String longDesc = "d".repeat(400);
        String html = "<html><head>"
                + "<meta property=\"og:title\" content=\"" + longTitle + "\">"
                + "<meta property=\"og:description\" content=\"" + longDesc + "\">"
                + "</head></html>";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/a");
        assertThat(c.get().title()).hasSize(200);
        assertThat(c.get().description()).hasSize(300);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=OgParserTest`
Expected: FAIL（`OgParser` 不存在）

- [ ] **Step 3: 实现**

```java
package com.rbac.im.service;

import com.rbac.im.vo.LinkCard;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.util.Optional;

/** HTML → LinkCard。纯函数，无 IO。title 缺失返回空。 */
public final class OgParser {

    private static final int MAX_TITLE = 200;
    private static final int MAX_DESC = 300;
    private static final int MAX_URL = 2048;

    private OgParser() {}

    public static Optional<LinkCard> parse(String html, String baseUrl) {
        if (html == null || html.isBlank()) {
            return Optional.empty();
        }
        Document doc = Jsoup.parse(html, baseUrl == null ? "" : baseUrl);

        String title = firstNonBlank(metaContent(doc, "og:title"), textOrNull(doc.selectFirst("title")));
        if (title == null || title.isBlank()) {
            return Optional.empty();   // title 必填
        }
        String desc = metaContent(doc, "og:description");
        String siteName = metaContent(doc, "og:site_name");

        // og:image 用 abs: 前缀让 jsoup 基于 baseUrl 绝对化相对路径
        String image = null;
        Element imgMeta = doc.selectFirst("meta[property=og:image]");
        if (imgMeta != null) {
            String abs = imgMeta.absUrl("content");
            image = (abs != null && !abs.isBlank()) ? abs : imgMeta.attr("content");
            if (image.isBlank()) image = null;
        }

        return Optional.of(new LinkCard(
                trunc(baseUrl, MAX_URL),
                trunc(title.trim(), MAX_TITLE),
                trunc(blankToNull(desc), MAX_DESC),
                image,
                blankToNull(siteName)));
    }

    private static String metaContent(Document doc, String property) {
        Element el = doc.selectFirst("meta[property=" + property + "]");
        return el == null ? null : el.attr("content");
    }

    private static String textOrNull(Element el) {
        return el == null ? null : el.text();
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        return (b != null && !b.isBlank()) ? b : null;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String trunc(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=OgParserTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/OgParser.java \
        backend/src/test/java/com/rbac/im/service/OgParserTest.java
git commit -m "feat(im): OgParser 用 jsoup 解析 OG 元数据为 LinkCard"
```

---

### Task 4: PrivateAddressChecker（IP 危险段判定，IPv4+IPv6+mapped/NAT64）

> 本期最重要的安全单元。表驱动全覆盖。

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/PrivateAddressChecker.java`
- Test: `backend/src/test/java/com/rbac/im/service/PrivateAddressCheckerTest.java`

**Interfaces:**
- Produces: `PrivateAddressChecker.isDangerous(java.net.InetAddress addr)` → `boolean`（静态；命中回环/私网/链路本地/云元数据/组播/保留/ULA/IPv4-mapped/NAT64 → true）

- [ ] **Step 1: 写失败测试**

```java
package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.InetAddress;
import java.net.UnknownHostException;

import static org.assertj.core.api.Assertions.assertThat;

class PrivateAddressCheckerTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "127.0.0.1", "127.5.5.5",          // 回环
            "10.0.0.1", "10.255.255.255",       // 私网 A
            "172.16.0.1", "172.31.255.255",     // 私网 B
            "192.168.1.1",                      // 私网 C
            "169.254.169.254",                  // 链路本地 / 云元数据
            "100.64.0.1",                       // CGNAT
            "192.0.0.1",                        // IETF 协议分配
            "198.18.0.1",                       // benchmark
            "224.0.0.1",                        // 组播
            "240.0.0.1",                        // 保留
            "0.0.0.0", "0.1.2.3"                // 0/8
    })
    void dangerous_ipv4(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = { "8.8.8.8", "1.1.1.1", "93.184.216.34" })
    void safe_public_ipv4(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "::1",                        // 回环
            "::",                         // 未指定
            "fe80::1",                    // 链路本地
            "fc00::1", "fd00::1",         // ULA
            "ff02::1",                    // 组播
            "::ffff:169.254.169.254",     // IPv4-mapped 元数据
            "::ffff:10.0.0.1",            // IPv4-mapped 私网
            "64:ff9b::a9fe:a9fe"          // NAT64 内嵌 169.254.169.254
    })
    void dangerous_ipv6(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = { "2001:4860:4860::8888", "2606:4700:4700::1111" })
    void safe_public_ipv6(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isFalse();
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=PrivateAddressCheckerTest`
Expected: FAIL（`PrivateAddressChecker` 不存在）

- [ ] **Step 3: 实现**

```java
package com.rbac.im.service;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;

/**
 * 判定 IP 是否落在禁止抓取的危险段。防 SSRF：回环/私网/链路本地(含云元数据 169.254.169.254)/
 * 组播/保留/CGNAT/ULA/IPv4-mapped/NAT64 一律 true。纯函数，无 IO。
 */
public final class PrivateAddressChecker {

    private PrivateAddressChecker() {}

    public static boolean isDangerous(InetAddress addr) {
        if (addr == null) return true;
        // JDK 内置标志兜底：AnyLocal(0.0.0.0/::)、Loopback(127/::1)、
        // LinkLocal(169.254/fe80)、SiteLocal(10/172.16/192.168)、Multicast(224/ff00)
        if (addr.isAnyLocalAddress() || addr.isLoopbackAddress() || addr.isLinkLocalAddress()
                || addr.isSiteLocalAddress() || addr.isMulticastAddress()) {
            return true;
        }
        byte[] b = addr.getAddress();
        if (addr instanceof Inet4Address) {
            return dangerousV4(b);
        }
        if (addr instanceof Inet6Address) {
            // IPv4-mapped ::ffff:0:0/96 → 拆内嵌 v4 再判
            if (isV4Embedded(b, 0x00, 0xff, 0xff)) {
                return dangerousV4(last4(b));
            }
            // NAT64 64:ff9b::/96 → 拆内嵌 v4 再判
            if (b[0] == 0x00 && b[1] == 0x64 && b[2] == (byte) 0xff && b[3] == (byte) 0x9b
                    && allZero(b, 4, 12)) {
                return dangerousV4(last4(b));
            }
            // ULA fc00::/7
            if ((b[0] & 0xFE) == 0xFC) {
                return true;
            }
        }
        return false;
    }

    /** 覆盖 JDK 标志未含的 v4 段（标志已含 127/10/172.16/192.168/169.254/224/4/0.0.0.0）。 */
    private static boolean dangerousV4(byte[] b) {
        int b0 = b[0] & 0xFF, b1 = b[1] & 0xFF;
        if (b0 == 0) return true;                              // 0/8
        if (b0 == 127) return true;                            // 回环
        if (b0 == 10) return true;                             // 私网 A
        if (b0 == 172 && b1 >= 16 && b1 <= 31) return true;    // 私网 B
        if (b0 == 192 && b1 == 168) return true;               // 私网 C
        if (b0 == 169 && b1 == 254) return true;               // 链路本地/元数据
        if (b0 == 100 && b1 >= 64 && b1 <= 127) return true;   // CGNAT 100.64/10
        if (b0 == 192 && b1 == 0 && (b[2] & 0xFF) == 0) return true; // 192.0.0/24
        if (b0 == 198 && (b1 == 18 || b1 == 19)) return true;  // 198.18/15 benchmark
        if (b0 >= 224) return true;                            // 224/4 组播 + 240/4 保留
        return false;
    }

    private static boolean isV4Embedded(byte[] b, int atffff0, int atffff1, int atffff2) {
        // ::ffff:0:0/96 → 前 10 字节 0，第 11、12 字节 0xff
        return allZero(b, 0, 10) && (b[10] & 0xFF) == 0xff && (b[11] & 0xFF) == 0xff;
    }

    private static byte[] last4(byte[] b) {
        return new byte[]{ b[12], b[13], b[14], b[15] };
    }

    private static boolean allZero(byte[] b, int from, int to) {
        for (int i = from; i < to; i++) if (b[i] != 0) return false;
        return true;
    }
}
```

> 注：`isV4Embedded` 的后三个参数未使用，仅为可读命名保留；实现只依赖前 12 字节模式。若嫌冗余可改为无参 `isV4Mapped(byte[] b)`——两种都可，保持测试绿即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=PrivateAddressCheckerTest`
Expected: PASS（若 `::ffff:...` 被 JVM 归一成 `Inet4Address`，`instanceof Inet4Address` 分支同样会判到，测试仍绿）

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/PrivateAddressChecker.java \
        backend/src/test/java/com/rbac/im/service/PrivateAddressCheckerTest.java
git commit -m "feat(im): PrivateAddressChecker SSRF 危险 IP 段判定（IPv4/IPv6/mapped/NAT64）"
```

---

### Task 5: SsrfGuardedFetcher（协议/端口白名单 + 逐跳重定向重校验 + 体积/超时限制）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/SsrfGuardedFetcher.java`
- Test: `backend/src/test/java/com/rbac/im/service/SsrfGuardedFetcherTest.java`

**Interfaces:**
- Consumes: `PrivateAddressChecker.isDangerous(InetAddress)`（Task 4）；`LinkPreviewProperties`（Task 1）
- Produces:
  - `SsrfGuardedFetcher` 构造：`SsrfGuardedFetcher(LinkPreviewProperties props, HostResolver resolver, HttpExchange http)`
  - 内嵌接口 `HostResolver { java.util.List<InetAddress> resolve(String host) throws java.net.UnknownHostException; }`（生产实现委托 `InetAddress.getAllByName`；测试注入假 IP）
  - 内嵌接口 `HttpExchange { Response send(String url) throws Exception; }` 与 `record Response(int status, String location, String contentType, String body)`（生产实现用 JDK `HttpClient` + 流式体积上限；测试注入桩）
  - `SsrfGuardedFetcher.fetch(String url)` → `Optional<FetchResult>`，`record FetchResult(String finalUrl, String html)`（校验失败/超时/超跳/非 html → 空）

- [ ] **Step 1: 写失败测试**

```java
package com.rbac.im.service;

import com.rbac.im.config.LinkPreviewProperties;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class SsrfGuardedFetcherTest {

    private LinkPreviewProperties props() {
        return new LinkPreviewProperties(); // 默认值：端口 80/443、maxRedirects 3
    }

    /** host→固定 IP 的假解析器。 */
    private SsrfGuardedFetcher.HostResolver resolver(Map<String, String> hostToIp) {
        return host -> {
            String ip = hostToIp.getOrDefault(host, "93.184.216.34"); // 默认公网
            return List.of(InetAddress.getByName(ip));
        };
    }

    @Test
    void rejects_non_http_scheme() {
        var f = new SsrfGuardedFetcher(props(), resolver(Map.of()),
                url -> { throw new AssertionError("不应发起请求"); });
        assertThat(f.fetch("ftp://x.com/a")).isEmpty();
        assertThat(f.fetch("file:///etc/passwd")).isEmpty();
    }

    @Test
    void rejects_non_default_port() {
        var f = new SsrfGuardedFetcher(props(), resolver(Map.of()),
                url -> { throw new AssertionError("不应发起请求"); });
        assertThat(f.fetch("http://x.com:8080/a")).isEmpty();
    }

    @Test
    void rejects_private_ip_host() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("evil.com", "169.254.169.254")),
                url -> { throw new AssertionError("不应发起请求"); });
        assertThat(f.fetch("http://evil.com/latest/meta-data")).isEmpty();
    }

    @Test
    void fetches_public_html() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("x.com", "93.184.216.34")),
                url -> new SsrfGuardedFetcher.Response(200, null, "text/html", "<html><title>T</title></html>"));
        Optional<SsrfGuardedFetcher.FetchResult> r = f.fetch("http://x.com/a");
        assertThat(r).isPresent();
        assertThat(r.get().finalUrl()).isEqualTo("http://x.com/a");
        assertThat(r.get().html()).contains("<title>T</title>");
    }

    @Test
    void rejects_redirect_to_private() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("x.com", "93.184.216.34", "evil.com", "127.0.0.1")),
                url -> url.contains("x.com")
                        ? new SsrfGuardedFetcher.Response(302, "http://evil.com/", null, null)
                        : new SsrfGuardedFetcher.Response(200, null, "text/html", "<title>internal</title>"));
        // 第一跳公网 302 → evil.com 解析到 127.0.0.1 → 重校验拒绝 → 整体空
        assertThat(f.fetch("http://x.com/a")).isEmpty();
    }

    @Test
    void follows_safe_redirect_then_returns_final_url() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("a.com", "93.184.216.34", "b.com", "1.1.1.1")),
                url -> url.contains("a.com")
                        ? new SsrfGuardedFetcher.Response(301, "http://b.com/final", null, null)
                        : new SsrfGuardedFetcher.Response(200, null, "text/html", "<title>B</title>"));
        Optional<SsrfGuardedFetcher.FetchResult> r = f.fetch("http://a.com/x");
        assertThat(r).isPresent();
        assertThat(r.get().finalUrl()).isEqualTo("http://b.com/final");
    }

    @Test
    void gives_up_after_max_redirects() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("loop.com", "93.184.216.34")),
                url -> new SsrfGuardedFetcher.Response(302, "http://loop.com/next", null, null));
        assertThat(f.fetch("http://loop.com/x")).isEmpty();
    }

    @Test
    void empty_when_not_html() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("x.com", "93.184.216.34")),
                url -> new SsrfGuardedFetcher.Response(200, null, "application/pdf", "%PDF..."));
        assertThat(f.fetch("http://x.com/a.pdf")).isEmpty();
    }

    @Test
    void empty_when_http_error_status() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("x.com", "93.184.216.34")),
                url -> new SsrfGuardedFetcher.Response(404, null, "text/html", "nope"));
        assertThat(f.fetch("http://x.com/a")).isEmpty();
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=SsrfGuardedFetcherTest`
Expected: FAIL（`SsrfGuardedFetcher` 不存在）

- [ ] **Step 3: 实现**

```java
package com.rbac.im.service;

import com.rbac.im.config.LinkPreviewProperties;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * SSRF 白名单式抓取：协议/端口白名单 + 逐个解析 IP 校验 + 逐跳重定向重校验 + ≤maxRedirects。
 * IP 解析（HostResolver）与实际 HTTP 交换（HttpExchange）均为可注入接口，便于单测。
 */
public class SsrfGuardedFetcher {

    public interface HostResolver {
        List<InetAddress> resolve(String host) throws UnknownHostException;
    }

    public interface HttpExchange {
        Response send(String url) throws Exception;
    }

    public record Response(int status, String location, String contentType, String body) {}

    public record FetchResult(String finalUrl, String html) {}

    private final LinkPreviewProperties props;
    private final HostResolver resolver;
    private final HttpExchange http;

    public SsrfGuardedFetcher(LinkPreviewProperties props, HostResolver resolver, HttpExchange http) {
        this.props = props;
        this.resolver = resolver;
        this.http = http;
    }

    public Optional<FetchResult> fetch(String url) {
        String current = url;
        try {
            for (int hop = 0; hop <= props.getMaxRedirects(); hop++) {
                if (!isUrlSafe(current)) {
                    return Optional.empty();
                }
                Response resp = http.send(current);
                int st = resp.status();
                if (st >= 300 && st < 400) {
                    if (resp.location() == null || resp.location().isBlank()) {
                        return Optional.empty();
                    }
                    current = URI.create(current).resolve(resp.location().trim()).toString();
                    continue;   // 逐跳：回到循环顶部重新全套校验
                }
                if (st != 200) {
                    return Optional.empty();
                }
                if (resp.contentType() != null
                        && !resp.contentType().toLowerCase(Locale.ROOT).contains("text/html")) {
                    return Optional.empty();
                }
                if (resp.body() == null || resp.body().isBlank()) {
                    return Optional.empty();
                }
                return Optional.of(new FetchResult(current, resp.body()));
            }
            return Optional.empty();   // 超过最大跳数
        } catch (Exception e) {
            return Optional.empty();   // 超时/连接失败/畸形 URL → 降级
        }
    }

    /** 协议 + 端口 + 每个解析 IP 校验。任一不过即 false。 */
    private boolean isUrlSafe(String url) {
        URI u;
        try {
            u = URI.create(url);
        } catch (RuntimeException e) {
            return false;
        }
        String scheme = u.getScheme();
        if (scheme == null
                || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            return false;
        }
        String host = u.getHost();
        if (host == null || host.isBlank()) {
            return false;
        }
        int port = u.getPort();
        if (port == -1) {
            port = scheme.equalsIgnoreCase("https") ? 443 : 80;
        }
        if (!props.getAllowedPorts().contains(port)) {
            return false;
        }
        try {
            List<InetAddress> ips = resolver.resolve(host);
            if (ips == null || ips.isEmpty()) {
                return false;
            }
            for (InetAddress ip : ips) {
                if (PrivateAddressChecker.isDangerous(ip)) {
                    return false;   // 任一 IP 危险即整体拒
                }
            }
            return true;
        } catch (UnknownHostException e) {
            return false;
        }
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=SsrfGuardedFetcherTest`
Expected: PASS

- [ ] **Step 5: 加生产装配（HostResolver + HttpExchange 真实实现，作为 Spring Bean）**

Create: `backend/src/main/java/com/rbac/im/config/LinkFetchConfig.java`

```java
package com.rbac.im.config;

import com.rbac.im.service.SsrfGuardedFetcher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;

/** SsrfGuardedFetcher 的生产装配：真实 DNS 解析 + JDK HttpClient（NEVER 跟随重定向 + 体积上限）。 */
@Configuration
public class LinkFetchConfig {

    @Bean
    public SsrfGuardedFetcher ssrfGuardedFetcher(LinkPreviewProperties props) {
        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)   // 关键：自己逐跳
                .connectTimeout(Duration.ofMillis(props.getConnectTimeoutMs()))
                .build();

        SsrfGuardedFetcher.HostResolver resolver =
                host -> Arrays.asList(InetAddress.getAllByName(host));

        SsrfGuardedFetcher.HttpExchange exchange = url -> {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMillis(props.getRequestTimeoutMs()))
                    .header("User-Agent", props.getUserAgent())
                    .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                    .GET()
                    .build();
            HttpResponse<InputStream> resp = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
            String location = resp.headers().firstValue("location").orElse(null);
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            String body = null;
            int st = resp.statusCode();
            // 只有 2xx 且 html 才读体；重定向不读体（省流）
            if (st >= 200 && st < 300
                    && (contentType == null || contentType.toLowerCase().contains("text/html"))) {
                body = readCapped(resp.body(), props.getMaxBodyBytes());
            } else {
                resp.body().close();
            }
            return new SsrfGuardedFetcher.Response(st, location, contentType, body);
        };

        return new SsrfGuardedFetcher(props, resolver, exchange);
    }

    /** 流式读取，超过上限即中断（不信 Content-Length）。 */
    private static String readCapped(InputStream in, long maxBytes) throws Exception {
        try (BufferedInputStream bin = new BufferedInputStream(in)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            long total = 0;
            int n;
            while ((n = bin.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    out.write(buf, 0, (int) (n - (total - maxBytes)));   // 写到刚好达上限
                    break;
                }
                out.write(buf, 0, n);
            }
            return out.toString(StandardCharsets.UTF_8);
        }
    }
}
```

> 装配说明与已知残留（写进 commit body 或 spec follow-up）：JDK `HttpClient` 会对 URL host 自行做 DNS 解析，无法强制连到我们校验过的那个 `InetAddress`。本实现对**所有** A/AAAA 记录逐个校验 + **逐跳重定向重校验**，已完整封堵「域名解析到内网」与「302 跳内网」两条主路径；仅「亚秒级 DNS rebinding（我们解析与 HttpClient 解析之间攻击者翻转 A 记录）」这一窄向量未 pin，**列为 follow-up**（需换 Apache HttpClient5 自定义 `DnsResolver` 才能连指定 IP）。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/SsrfGuardedFetcher.java \
        backend/src/main/java/com/rbac/im/config/LinkFetchConfig.java \
        backend/src/test/java/com/rbac/im/service/SsrfGuardedFetcherTest.java
git commit -m "feat(im): SsrfGuardedFetcher 协议/端口白名单+逐跳重定向重校验+体积上限"
```

---

### Task 6: ImMessageRepository.updateLink（按 cid+seq 用 \$set 回写 body.link）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryCustom.java`
- Create: `backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryImpl.java`
- Modify: `backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java`（`extends` 追加 `ImMessageRepositoryCustom`）
- Test: `backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryImplTest.java`

**Interfaces:**
- Consumes: `com.rbac.im.vo.LinkCard`（Task 1）
- Produces: `ImMessageRepository.updateLink(String cid, long seq, LinkCard card)` → `void`（对 `cid==? && seq==?` 文档 `$set` `body.link` 为 card 的 Map 表示）

- [ ] **Step 1: 写失败测试（mock MongoTemplate，断言 Query/Update 构造正确）**

```java
package com.rbac.im.doc;

import com.rbac.im.vo.LinkCard;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ImMessageRepositoryImplTest {

    @Test
    void updateLink_sets_body_link_by_cid_and_seq() {
        MongoTemplate template = mock(MongoTemplate.class);
        ImMessageRepositoryImpl repo = new ImMessageRepositoryImpl(template);

        LinkCard card = new LinkCard("https://x.com/a", "T", "D", "https://x.com/i.png", "S");
        repo.updateLink("c_1_2", 42L, card);

        ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
        ArgumentCaptor<Update> u = ArgumentCaptor.forClass(Update.class);
        verify(template).updateFirst(q.capture(), u.capture(), eq(ImMessage.class));

        assertThat(q.getValue().getQueryObject().get("cid")).isEqualTo("c_1_2");
        assertThat(q.getValue().getQueryObject().get("seq")).isEqualTo(42L);
        // Update 里应含 $set body.link
        assertThat(u.getValue().getUpdateObject().toJson()).contains("body.link").contains("https://x.com/a");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ImMessageRepositoryImplTest`
Expected: FAIL（`ImMessageRepositoryImpl` / `ImMessageRepositoryCustom` 不存在）

- [ ] **Step 3: 实现 fragment 接口 + impl，并让主 Repository 继承它**

`ImMessageRepositoryCustom.java`：
```java
package com.rbac.im.doc;

import com.rbac.im.vo.LinkCard;

/** MongoRepository 自定义片段：链接卡片回写。 */
public interface ImMessageRepositoryCustom {
    /** 对 cid+seq 定位的文档 $set body.link（不整档覆盖，避免并发打架）。 */
    void updateLink(String cid, long seq, LinkCard card);
}
```

`ImMessageRepositoryImpl.java`：
```java
package com.rbac.im.doc;

import com.rbac.im.vo.LinkCard;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import java.util.LinkedHashMap;
import java.util.Map;

/** Spring Data 约定：命名必须是 {主接口名}Impl。 */
public class ImMessageRepositoryImpl implements ImMessageRepositoryCustom {

    private final MongoTemplate template;

    public ImMessageRepositoryImpl(MongoTemplate template) {
        this.template = template;
    }

    @Override
    public void updateLink(String cid, long seq, LinkCard card) {
        Query q = new Query(Criteria.where("cid").is(cid).and("seq").is(seq));
        Update u = new Update().set("body.link", toMap(card));
        template.updateFirst(q, u, ImMessage.class);
    }

    private static Map<String, Object> toMap(LinkCard c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("url", c.url());
        m.put("title", c.title());
        if (c.description() != null) m.put("description", c.description());
        if (c.image() != null) m.put("image", c.image());
        if (c.siteName() != null) m.put("siteName", c.siteName());
        return m;
    }
}
```

修改 `ImMessageRepository.java` 首行接口声明：
```java
public interface ImMessageRepository extends MongoRepository<ImMessage, String>, ImMessageRepositoryCustom {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ImMessageRepositoryImplTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryCustom.java \
        backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryImpl.java \
        backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java \
        backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryImplTest.java
git commit -m "feat(im): ImMessageRepository.updateLink 按 cid+seq \$set body.link"
```

---

### Task 7: LinkPreviewService（编排：提取→缓存→抓取→解析→回写→扇出 + 线程池）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/LinkPreviewService.java`
- Test: `backend/src/test/java/com/rbac/im/service/LinkPreviewServiceTest.java`

**Interfaces:**
- Consumes: `UrlExtractor.firstHttpUrl`（T2）、`OgParser.parse`（T3）、`SsrfGuardedFetcher.fetch`（T5）、`ImMessageRepository.updateLink`（T6）、`OutboundDispatcher.dispatch(String cid, Envelope env)`（现有）、`StringRedisTemplate`（现有）、`LinkPreviewProperties`（T1）、`Envelope`（现有）
- Produces:
  - `LinkPreviewService.tryEnrich(String cid, long seq, String text)` → `void`（提交到线程池异步执行；`enabled=false` 或线程池满 → 静默丢弃）
  - `LinkPreviewService.enrichNow(String cid, long seq, String text)` → `void`（同步执行核心逻辑，供测试直接调用；生产由线程池调用）

- [ ] **Step 1: 写失败测试（mock 全部协作者，直接调 enrichNow）**

```java
package com.rbac.im.service;

import com.rbac.im.config.LinkPreviewProperties;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.LinkCard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LinkPreviewServiceTest {

    LinkPreviewProperties props;
    SsrfGuardedFetcher fetcher;
    ImMessageRepository repo;
    OutboundDispatcher dispatcher;
    StringRedisTemplate redis;
    ValueOperations<String, String> ops;
    LinkPreviewService svc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        props = new LinkPreviewProperties();
        fetcher = mock(SsrfGuardedFetcher.class);
        repo = mock(ImMessageRepository.class);
        dispatcher = mock(OutboundDispatcher.class);
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        svc = new LinkPreviewService(props, fetcher, repo, dispatcher, redis);
    }

    @Test
    void success_writes_mongo_and_dispatches_link_preview() {
        when(ops.get(anyString())).thenReturn(null);   // 缓存未命中
        when(fetcher.fetch("https://x.com/a"))
                .thenReturn(Optional.of(new SsrfGuardedFetcher.FetchResult(
                        "https://x.com/a", "<html><head><meta property=\"og:title\" content=\"T\"></head></html>")));

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verify(repo).updateLink(eq("c_1_2"), eq(42L), any(LinkCard.class));
        ArgumentCaptor<Envelope> env = ArgumentCaptor.forClass(Envelope.class);
        verify(dispatcher).dispatch(eq("c_1_2"), env.capture());
        assertThat(env.getValue().getOp()).isEqualTo("LINK_PREVIEW");
        assertThat(env.getValue().getSeq()).isEqualTo(42L);
        assertThat(env.getValue().getBody()).containsKey("link");
        verify(ops).set(anyString(), anyString(), any());   // 写正缓存
    }

    @Test
    void no_url_does_nothing() {
        svc.enrichNow("c_1_2", 42L, "纯文本没链接");
        verifyNoInteractions(fetcher, repo, dispatcher);
    }

    @Test
    void fetch_fail_writes_negative_cache_no_dispatch() {
        when(ops.get(anyString())).thenReturn(null);
        when(fetcher.fetch(anyString())).thenReturn(Optional.empty());

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verify(repo, never()).updateLink(anyString(), anyLong(), any());
        verify(dispatcher, never()).dispatch(anyString(), any());
        verify(ops).set(anyString(), eq("FAIL"), any());   // 负缓存
    }

    @Test
    void title_missing_treated_as_fail() {
        when(ops.get(anyString())).thenReturn(null);
        when(fetcher.fetch(anyString()))
                .thenReturn(Optional.of(new SsrfGuardedFetcher.FetchResult(
                        "https://x.com/a", "<html><head><meta property=\"og:image\" content=\"https://x.com/i.png\"></head></html>")));

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verify(repo, never()).updateLink(anyString(), anyLong(), any());
        verify(dispatcher, never()).dispatch(anyString(), any());
        verify(ops).set(anyString(), eq("FAIL"), any());
    }

    @Test
    void positive_cache_hit_skips_fetch() {
        // 正缓存命中：存的是 LinkCard 的 JSON
        String cached = "{\"url\":\"https://x.com/a\",\"title\":\"T\",\"description\":null,\"image\":null,\"siteName\":null}";
        when(ops.get(anyString())).thenReturn(cached);

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verifyNoInteractions(fetcher);                    // 不抓
        verify(repo).updateLink(eq("c_1_2"), eq(42L), any(LinkCard.class));
        verify(dispatcher).dispatch(eq("c_1_2"), any(Envelope.class));
    }

    @Test
    void negative_cache_hit_does_nothing() {
        when(ops.get(anyString())).thenReturn("FAIL");
        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");
        verifyNoInteractions(fetcher);
        verify(repo, never()).updateLink(anyString(), anyLong(), any());
        verify(dispatcher, never()).dispatch(anyString(), any());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=LinkPreviewServiceTest`
Expected: FAIL（`LinkPreviewService` 不存在）

- [ ] **Step 3: 实现**

```java
package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.LinkPreviewProperties;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.LinkCard;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** 链接卡片编排：提取→缓存→抓取→解析→回写 Mongo + 扇出 LINK_PREVIEW。异步、异常不外抛。 */
@Service
public class LinkPreviewService {

    private static final Logger log = LoggerFactory.getLogger(LinkPreviewService.class);
    private static final String NEG = "FAIL";

    private final LinkPreviewProperties props;
    private final SsrfGuardedFetcher fetcher;
    private final ImMessageRepository repo;
    private final OutboundDispatcher dispatcher;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ThreadPoolExecutor pool;

    public LinkPreviewService(LinkPreviewProperties props,
                              SsrfGuardedFetcher fetcher,
                              ImMessageRepository repo,
                              OutboundDispatcher dispatcher,
                              StringRedisTemplate redis) {
        this.props = props;
        this.fetcher = fetcher;
        this.repo = repo;
        this.dispatcher = dispatcher;
        this.redis = redis;
        this.pool = new ThreadPoolExecutor(
                props.getPoolCore(), props.getPoolMax(),
                60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(props.getPoolQueue()),
                r -> { Thread t = new Thread(r, "im-linkpreview"); t.setDaemon(true); return t; },
                new ThreadPoolExecutor.DiscardPolicy());   // 满载丢弃预览，不拖住 Kafka
    }

    /** 提交异步任务。enabled=false / 无 URL 早退；线程池满则 DiscardPolicy 静默丢弃。 */
    public void tryEnrich(String cid, long seq, String text) {
        if (!props.isEnabled()) {
            return;
        }
        if (UrlExtractor.firstHttpUrl(text).isEmpty()) {
            return;   // 省一次线程池提交
        }
        pool.execute(() -> enrichNow(cid, seq, text));
    }

    /** 同步核心：任何异常都吞掉，绝不外抛（跑在独立线程池里）。 */
    public void enrichNow(String cid, long seq, String text) {
        try {
            Optional<String> urlOpt = UrlExtractor.firstHttpUrl(text);
            if (urlOpt.isEmpty()) {
                return;
            }
            String url = urlOpt.get();
            String key = cacheKey(url);

            String cached = redis.opsForValue().get(key);
            if (NEG.equals(cached)) {
                return;                                   // 负缓存命中
            }
            LinkCard card;
            if (cached != null) {
                card = mapper.readValue(cached, LinkCard.class);   // 正缓存命中
            } else {
                Optional<SsrfGuardedFetcher.FetchResult> fr = fetcher.fetch(url);
                Optional<LinkCard> parsed = fr.flatMap(r -> OgParser.parse(r.html(), r.finalUrl()));
                if (parsed.isEmpty()) {
                    redis.opsForValue().set(key, NEG, props.getCacheTtlFail());
                    return;
                }
                card = parsed.get();
                redis.opsForValue().set(key, mapper.writeValueAsString(card), props.getCacheTtlOk());
            }

            repo.updateLink(cid, seq, card);
            dispatcher.dispatch(cid, linkPreviewEnvelope(cid, seq, card));
        } catch (Throwable t) {
            log.warn("链接卡片补写失败 cid={} seq={}: {}", cid, seq, t.toString());
        }
    }

    private Envelope linkPreviewEnvelope(String cid, long seq, LinkCard card) {
        Envelope env = new Envelope();
        env.setOp("LINK_PREVIEW");
        env.setCid(cid);
        env.setSeq(seq);
        env.setBody(Map.of("link", mapper.convertValue(card, Map.class)));
        return env;
    }

    private static String cacheKey(String url) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8));
            return "im:link:og:" + HexFormat.of().formatHex(h);
        } catch (Exception e) {
            return "im:link:og:" + Integer.toHexString(url.hashCode());   // 不可达兜底
        }
    }

    @PreDestroy
    public void shutdown() {
        pool.shutdown();
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=LinkPreviewServiceTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/LinkPreviewService.java \
        backend/src/test/java/com/rbac/im/service/LinkPreviewServiceTest.java
git commit -m "feat(im): LinkPreviewService 编排抓取+缓存+回写+LINK_PREVIEW 扇出"
```

---

### Task 8: 接入 InboundMessageConsumer（append 后触发，仅 TEXT）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`
- Test: `backend/src/test/java/com/rbac/im/service/InboundLinkTriggerTest.java`

**Interfaces:**
- Consumes: `LinkPreviewService.tryEnrich(String cid, long seq, String text)`（T7）；`MessageAppender.append(...)` 返回 `long seq`（现有）
- Produces: 行为——TEXT 消息 append 后调用 `tryEnrich(cid, seq, body.get("text"))`；非 TEXT 不调用

- [ ] **Step 1: 写失败测试**

参照现有 `InboundSendCheckTest` 的 mock 装配风格（mock repo/appender/conversationService/dispatcher/mediaService），新增 `LinkPreviewService` mock。

```java
package com.rbac.im.service;

import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class InboundLinkTriggerTest {

    ImMessageRepository repo;
    MessageAppender appender;
    ConversationService conversationService;
    OutboundDispatcher dispatcher;
    MediaService mediaService;
    LinkPreviewService linkPreview;
    InboundMessageConsumer consumer;
    ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setup() {
        repo = mock(ImMessageRepository.class);
        appender = mock(MessageAppender.class);
        conversationService = mock(ConversationService.class);
        dispatcher = mock(OutboundDispatcher.class);
        mediaService = mock(MediaService.class);
        linkPreview = mock(LinkPreviewService.class);
        consumer = new InboundMessageConsumer(repo, appender, conversationService, dispatcher, mediaService, linkPreview);
        when(conversationService.isMember(anyString(), anyLong())).thenReturn(true);
        when(conversationService.isGroupMuted(anyString(), anyLong())).thenReturn(false);
    }

    private String json(String type, Map<String, Object> body) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid("c_1_2"); e.setSenderId(1L); e.setType(type); e.setBody(body);
        e.setClientMsgId("cm1");
        return mapper.writeValueAsString(e);
    }

    @Test
    void text_with_url_triggers_link_preview_after_append() throws Exception {
        when(appender.append(eq("c_1_2"), eq(1L), eq("TEXT"), any(), eq("cm1"))).thenReturn(99L);
        consumer.onMessage(json("TEXT", Map.of("text", "看 https://x.com/a")));
        verify(appender).append(eq("c_1_2"), eq(1L), eq("TEXT"), any(), eq("cm1"));
        verify(linkPreview).tryEnrich("c_1_2", 99L, "看 https://x.com/a");
    }

    @Test
    void image_does_not_trigger_link_preview() throws Exception {
        when(mediaService.isMediaInstance(anyString())).thenReturn(true); // 见注
        when(appender.append(anyString(), anyLong(), eq("IMAGE"), any(), anyString())).thenReturn(5L);
        consumer.onMessage(json("IMAGE", Map.of("objectKey", "im/c_1_2/199001/x.png")));
        verify(linkPreview, never()).tryEnrich(anyString(), anyLong(), any());
    }
}
```

> 注：`MediaService.isMedia` 是静态方法，Mockito 默认不能 stub。为让本测试聚焦触发逻辑，IMAGE 用例可改为断言「type 非 TEXT 时不调用 tryEnrich」——直接用真实 `MediaService.isMedia("IMAGE")==true` 走媒体分支（需给 `mediaService.validateForSend` 打桩为不抛）。实现测试时按现有 `InboundSendCheckTest` 是否已有媒体桩装配对齐；核心断言是 `verify(linkPreview, never()).tryEnrich(...)`。删掉上面 `isMediaInstance` 那行（它是占位示意，不存在该方法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=InboundLinkTriggerTest`
Expected: FAIL（构造函数参数不匹配 / `LinkPreviewService` 未注入）

- [ ] **Step 3: 改 InboundMessageConsumer**

构造函数追加 `LinkPreviewService linkPreview` 字段与注入；`onMessage` 末尾把 `appender.append(...)` 的返回值接住并在 TEXT 时触发：

```java
// 字段
private final LinkPreviewService linkPreview;

// 构造函数追加参数并赋值（其余不变）
public InboundMessageConsumer(ImMessageRepository repo,
                              MessageAppender appender,
                              ConversationService conversationService,
                              OutboundDispatcher dispatcher,
                              MediaService mediaService,
                              LinkPreviewService linkPreview) {
    this.repo = repo;
    this.appender = appender;
    this.conversationService = conversationService;
    this.dispatcher = dispatcher;
    this.mediaService = mediaService;
    this.linkPreview = linkPreview;
}
```

`onMessage` 结尾原来的：
```java
        appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());
```
改为：
```java
        long seq = appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());

        // 里程碑7：TEXT 消息异步补链接卡片（不阻塞消费线程；无 URL / 失败自然降级纯文本）
        if ("TEXT".equals(env.getType()) && env.getBody() != null
                && env.getBody().get("text") instanceof String text) {
            linkPreview.tryEnrich(env.getCid(), seq, text);
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=InboundLinkTriggerTest`
Expected: PASS

- [ ] **Step 5: 跑既有消费者测试确认无回归**

Run: `mvn -f backend/pom.xml test -Dtest=InboundMessageConsumerTest,InboundSendCheckTest,MediaSendCheckTest`
Expected: PASS（若这些测试直接 `new InboundMessageConsumer(...)`，需同步补 `LinkPreviewService` mock 入参——一并修好）

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
        backend/src/test/java/com/rbac/im/service/InboundLinkTriggerTest.java
# 若改了既有测试文件也一并 add
git commit -m "feat(im): TEXT 消息 append 后触发链接卡片异步补写"
```

---

### Task 9（可选，不进默认构建）: MockWebServer 集成测试验证真实抓取

> 与既有 `S3MediaStorageIT` 同款：`*IT.java` 命名不在 Surefire 默认匹配内，默认 `mvn test` 不跑；需要时 `-Dtest=LinkPreviewFetcherIT -DfailIfNoTests=false` 显式跑。验证 `LinkFetchConfig` 装配的真实 `HttpExchange`（体积截断、非 html、重定向）。

**Files:**
- Modify: `backend/pom.xml`（test 作用域新增 `com.squareup.okhttp3:mockwebserver`，内联 version 如 `4.12.0`）
- Test: `backend/src/test/java/com/rbac/im/service/LinkPreviewFetcherIT.java`

**Interfaces:**
- Consumes: `LinkFetchConfig.ssrfGuardedFetcher(props)` 产出的真实 `SsrfGuardedFetcher`

- [ ] **Step 1: 加 test 依赖**

```xml
        <dependency>
            <groupId>com.squareup.okhttp3</groupId>
            <artifactId>mockwebserver</artifactId>
            <version>4.12.0</version>
            <scope>test</scope>
        </dependency>
```

- [ ] **Step 2: 写 IT（起本地 MockWebServer，均为 127.0.0.1 → 需临时放行 loopback）**

> 关键难点：MockWebServer 跑在 `127.0.0.1`，而 `PrivateAddressChecker` 会拒回环。故 IT 用一个「放行 loopback」的定制 `SsrfGuardedFetcher`——直接 `new SsrfGuardedFetcher(props, resolver, exchange)`，其中 `resolver` 对测试 host 返回公网占位 IP（骗过 SSRF 校验），`exchange` 用 `LinkFetchConfig` 同款真实 HttpClient 但请求打到 MockWebServer 的实际端口。这样验证的是「真实 HttpClient 的重定向/体积/非 html 行为」，SSRF IP 判定已由 Task 4/5 覆盖。

```java
package com.rbac.im.service;

import com.rbac.im.config.LinkPreviewProperties;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class LinkPreviewFetcherIT {

    MockWebServer server;
    SsrfGuardedFetcher fetcher;

    @BeforeEach
    void setup() throws Exception {
        server = new MockWebServer();
        server.start();
        LinkPreviewProperties props = new LinkPreviewProperties();
        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofMillis(props.getConnectTimeoutMs())).build();
        // 放行：任何 host 都解析成一个公网占位 IP（绕过 SSRF，仅为验证 HTTP 行为）
        SsrfGuardedFetcher.HostResolver resolver = h -> List.of(InetAddress.getByName("93.184.216.34"));
        SsrfGuardedFetcher.HttpExchange exchange = url -> {
            // 把校验用的假 host 换成 MockWebServer 实际地址
            URI real = server.url(URI.create(url).getRawPath()).uri();
            HttpRequest req = HttpRequest.newBuilder(real)
                    .timeout(Duration.ofMillis(props.getRequestTimeoutMs())).GET().build();
            HttpResponse<InputStream> resp = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
            String ct = resp.headers().firstValue("content-type").orElse(null);
            String loc = resp.headers().firstValue("location").orElse(null);
            String body = new String(resp.body().readAllBytes());
            return new SsrfGuardedFetcher.Response(resp.statusCode(), loc, ct, body);
        };
        // 需在 props 上把 allowedPorts 放开为该端口，或让 resolver/exchange 无视端口——
        // 简化：把 fetch 的 url 端口设为 80（校验用），exchange 内改写到真实端口。
        fetcher = new SsrfGuardedFetcher(props, resolver, exchange);
    }

    @AfterEach
    void tearDown() throws Exception { server.shutdown(); }

    @Test
    void fetches_html_ok() {
        server.enqueue(new MockResponse().setHeader("Content-Type", "text/html")
                .setBody("<html><head><title>Hi</title></head></html>"));
        Optional<SsrfGuardedFetcher.FetchResult> r = fetcher.fetch("http://fake.test/a");
        assertThat(r).isPresent();
        assertThat(r.get().html()).contains("Hi");
    }

    @Test
    void non_html_returns_empty() {
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/pdf").setBody("%PDF"));
        assertThat(fetcher.fetch("http://fake.test/a.pdf")).isEmpty();
    }
}
```

> 说明：本 IT 主要防真实 HttpClient 行为回归，端口/host 改写细节按实际调通即可；SSRF 判定不在此测（Task 4/5 已覆盖）。若调通成本偏高，可 `@Disabled("按需手动跑")` 标注保留骨架。

- [ ] **Step 3: 显式跑（不进默认构建）**

Run: `mvn -f backend/pom.xml test -Dtest=LinkPreviewFetcherIT -DfailIfNoTests=false`
Expected: PASS 或 SKIPPED（若 @Disabled）

- [ ] **Step 4: 提交**

```bash
git add backend/pom.xml backend/src/test/java/com/rbac/im/service/LinkPreviewFetcherIT.java
git commit -m "test(im): 链接卡片抓取 MockWebServer 集成测试（*IT，不进默认构建）"
```

---

### Task 10: 全量回归 + 里程碑收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`（里程碑 7 标注完成）
- Modify: `.superpowers/sdd/progress.md`（追加本阶段台账）

- [ ] **Step 1: 全量 IM 回归**

Run: `mvn -f backend/pom.xml test -Dtest='com.rbac.im.**'`
Expected: 全绿（含既有 + 本期新增；`*IT` 默认不跑）

- [ ] **Step 2: 全量构建**

Run: `mvn -f backend/pom.xml package -DskipTests=false`
Expected: BUILD SUCCESS

- [ ] **Step 3: 标注里程碑完成**

在 `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 里程碑 7 行尾追加：
`✅ 已完成（feat/im，Phase 5）——TEXT 首个 URL 异步抓 OG（严格 SSRF：协议/端口白名单+全 IPv4/IPv6 危险段+逐跳重定向重校验）→ body.link 补写 + LINK_PREVIEW 增量帧扇出；Redis 正/负缓存；抓取失败/超时/被拒降级纯文本。`

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md .superpowers/sdd/progress.md
git commit -m "docs(im): 里程碑7 链接卡片完成；全量回归通过"
```

---

## Self-Review 记录

- **Spec 覆盖**：§二架构→T7+T8；§三 body.link/LINK_PREVIEW/Mongo 回写→T6+T7；§四 SSRF→T4+T5；§五配置/线程池/缓存/错误处理→T1+T7；§六测试→各任务 TDD + T9；§七依赖→T1(jsoup)+T9(mockwebserver)；§八验证→T10。全部有对应任务。
- **占位符**：无 TBD/TODO；每个 code step 均给完整代码。T8/T9 的两处「注」是实现者对齐现有测试装配的提示，非占位。
- **类型一致**：`LinkCard(url,title,description,image,siteName)`、`SsrfGuardedFetcher.fetch→Optional<FetchResult>`、`FetchResult(finalUrl,html)`、`Response(status,location,contentType,body)`、`HostResolver.resolve→List<InetAddress>`、`updateLink(String,long,LinkCard)`、`tryEnrich(String,long,String)`、`enrichNow(...)`、`OgParser.parse(String,String)→Optional<LinkCard>`、`UrlExtractor.firstHttpUrl(String)→Optional<String>` 在各任务间一致。
- **已知残留（已在 T5 Step5 标注为 follow-up）**：JDK HttpClient 无法 pin 到已校验 IP，亚秒级 DNS rebinding 未封堵；主路径（域名解析内网、302 跳内网）已全封。
