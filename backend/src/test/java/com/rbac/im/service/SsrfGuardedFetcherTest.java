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

    /**
     * 安全边界回归：某 host 解析出多个 IP，其中一个是危险地址（云元数据端点）。
     * 只要单测桩恒定「只查 ips.get(0)」也能全绿，就说明 isUrlSafe 悄悄退化成只校验第一个解析 IP，
     * 而这里第一个 IP 是公网、第二个才危险 —— 必须整体拒绝，否则重开多 A 记录 SSRF 洞。
     */
    @Test
    void rejects_when_any_of_multiple_resolved_ips_is_dangerous() throws Exception {
        SsrfGuardedFetcher.HostResolver multiIpResolver = host -> List.of(
                InetAddress.getByName("93.184.216.34"),   // 公网，排第一
                InetAddress.getByName("169.254.169.254")  // 云元数据端点，危险，排第二
        );
        var f = new SsrfGuardedFetcher(props(), multiIpResolver,
                url -> { throw new AssertionError("不应发起请求"); });
        assertThat(f.fetch("http://multi-ip.example.com/a")).isEmpty();
    }

    @Test
    void follows_relative_redirect_location_resolved_against_current_hop() {
        var f = new SsrfGuardedFetcher(props(),
                resolver(Map.of("a.com", "93.184.216.34")),
                url -> url.equals("http://a.com/x")
                        ? new SsrfGuardedFetcher.Response(302, "/final", null, null)
                        : url.equals("http://a.com/final")
                            ? new SsrfGuardedFetcher.Response(200, null, "text/html", "<title>Final</title>")
                            : new SsrfGuardedFetcher.Response(404, null, null, null));
        Optional<SsrfGuardedFetcher.FetchResult> r = f.fetch("http://a.com/x");
        assertThat(r).isPresent();
        assertThat(r.get().finalUrl()).isEqualTo("http://a.com/final");
        assertThat(r.get().html()).contains("<title>Final</title>");
    }
}
