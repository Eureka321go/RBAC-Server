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
