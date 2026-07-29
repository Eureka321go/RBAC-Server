package com.rbac.im.gateway.netty;

import com.rbac.im.gateway.auth.AuthResult;
import com.rbac.im.gateway.auth.GatewayJwtVerifier;
import com.rbac.im.gateway.registry.ChannelRegistry;
import com.rbac.im.gateway.registry.RouteService;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.*;
import io.netty.util.AttributeKey;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/** 在 WebSocket 升级前读取 ?token=&deviceId=，校验失败直接 401 关闭。 */
public class HandshakeAuthHandler extends SimpleChannelInboundHandler<HttpRequest> {
    // 往包裹上贴的标签
    public static final AttributeKey<Long> USER_ID = AttributeKey.valueOf("imUserId"); // 这个 key 是全局注册的，字符串相同就是同一个 key
    public static final AttributeKey<String> DEVICE_ID = AttributeKey.valueOf("imDeviceId"); // 这个 key 是全局注册的，字符串相同就是同一个 key

    private final GatewayJwtVerifier verifier;
    private final ChannelRegistry registry;
    private final RouteService routeService;

    public HandshakeAuthHandler(GatewayJwtVerifier verifier,
                                ChannelRegistry registry,
                                RouteService routeService) {
        this.verifier = verifier;
        this.registry = registry;
        this.routeService = routeService;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, HttpRequest req) {
        Map<String, String> q = parseQuery(req.uri());  // 从 /im?token=xx&deviceId=yy 取参数
        AuthResult r = verifier.verify(q.get("token"));
        if (!r.ok()) {
            reject(ctx);  // 401 + close
            return;
        }
        String deviceId = q.getOrDefault("deviceId", "default");
        ctx.channel().attr(USER_ID).set(r.userId()); // 细节 A：身份挂到 Channel 上
        ctx.channel().attr(DEVICE_ID).set(deviceId);
        registry.add(r.userId(), deviceId, ctx.channel()); // 登记本机连接表
        routeService.register(r.userId(), deviceId);  // 登记 Redis 全局路由
        // 重置 uri 到纯路径，交给后续 WebSocketServerProtocolHandler 完成升级
        // 但下一个工位 WebSocketServerProtocolHandler("/im") 是按路径精确匹配的, 看到带 query 的 uri 会匹配失败，握手不了。所以这里用 URI.create(uri).getPath() 剥掉 query，只留 /im 再往下传。
        req.setUri(URI.create(req.uri()).getPath());  // 细节 B：uri 洗回纯路径
        ctx.pipeline().remove(this); // 细节 C：把自己从流水线拆掉
        ctx.fireChannelRead(io.netty.util.ReferenceCountUtil.retain(req)); // 把请求交给下一个工位
    }

    private void reject(ChannelHandlerContext ctx) {
        FullHttpResponse resp = new DefaultFullHttpResponse(
                HttpVersion.HTTP_1_1, HttpResponseStatus.UNAUTHORIZED);
        resp.headers().set(HttpHeaderNames.CONTENT_LENGTH, 0);
        ctx.writeAndFlush(resp).addListener(f -> ctx.close());
    }

    private Map<String, String> parseQuery(String uri) {
        Map<String, String> m = new HashMap<>();
        int i = uri.indexOf('?');
        if (i < 0) return m;
        for (String pair : uri.substring(i + 1).split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                m.put(pair.substring(0, eq),
                        java.net.URLDecoder.decode(pair.substring(eq + 1), java.nio.charset.StandardCharsets.UTF_8));
            }
        }
        return m;
    }
}
