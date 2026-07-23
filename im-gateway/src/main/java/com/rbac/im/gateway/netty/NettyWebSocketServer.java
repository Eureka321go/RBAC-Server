package com.rbac.im.gateway.netty;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class NettyWebSocketServer {

    private static final Logger log = LoggerFactory.getLogger(NettyWebSocketServer.class);

    private final WebSocketChannelInitializer initializer;
    private final int port;

    private EventLoopGroup boss;
    private EventLoopGroup worker;
    private ChannelFuture channelFuture;

    public NettyWebSocketServer(WebSocketChannelInitializer initializer,
                                @Value("${im.gateway.ws-port}") int port) {
        this.initializer = initializer;
        this.port = port;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() throws InterruptedException {
        boss = new NioEventLoopGroup(1);
        worker = new NioEventLoopGroup();
        ServerBootstrap b = new ServerBootstrap();
        b.group(boss, worker)
                .channel(NioServerSocketChannel.class)
                .option(ChannelOption.SO_BACKLOG, 1024)
                .childOption(ChannelOption.SO_KEEPALIVE, true)
                .childHandler(initializer);
        channelFuture = b.bind(port).sync();
        log.info("IM Netty WebSocket 网关已监听端口 {}", port);
    }

    @PreDestroy
    public void stop() {
        if (channelFuture != null) channelFuture.channel().close();
        if (boss != null) boss.shutdownGracefully();
        if (worker != null) worker.shutdownGracefully();
    }
}
