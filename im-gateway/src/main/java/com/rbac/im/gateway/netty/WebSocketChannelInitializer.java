package com.rbac.im.gateway.netty;

import com.rbac.im.gateway.auth.GatewayJwtVerifier;
import com.rbac.im.gateway.kafka.InboundProducer;
import com.rbac.im.gateway.registry.ChannelRegistry;
import com.rbac.im.gateway.registry.RouteService;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.handler.timeout.IdleStateHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class WebSocketChannelInitializer extends ChannelInitializer<SocketChannel> {

    private final GatewayJwtVerifier verifier;
    private final ChannelRegistry registry;
    private final RouteService routeService;
    private final InboundProducer inboundProducer;
    private final int idleSeconds;

    public WebSocketChannelInitializer(GatewayJwtVerifier verifier,
                                       ChannelRegistry registry,
                                       RouteService routeService,
                                       InboundProducer inboundProducer,
                                       @Value("${im.gateway.heartbeat-idle-seconds}") int idleSeconds) {
        this.verifier = verifier;
        this.registry = registry;
        this.routeService = routeService;
        this.inboundProducer = inboundProducer;
        this.idleSeconds = idleSeconds;
    }

    @Override
    protected void initChannel(SocketChannel ch) {
        ch.pipeline()
                .addLast(new HttpServerCodec()) // 字节 -> HTTP 对象
                .addLast(new HttpObjectAggregator(65536)) // 把分片的 HTTP 拼成完整请求
                .addLast(new HandshakeAuthHandler(verifier, registry, routeService)) // ← 自定义：升级前鉴权
                .addLast(new WebSocketServerProtocolHandler("/im"))  // ← 完成 WS 握手
                .addLast(new IdleStateHandler(idleSeconds, 0, 0)) // ← 心跳超时检测
                .addLast(new ImFrameHandler(inboundProducer, registry, routeService)); //← 业务帧处理
    }
}
