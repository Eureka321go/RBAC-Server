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

    /** 流式读取，超过上限即中断（不信 Content-Length）。包级可见仅为单测直调，逻辑不变。 */
    static String readCapped(InputStream in, long maxBytes) throws Exception {
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
