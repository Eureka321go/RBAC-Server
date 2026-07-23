package com.rbac.im.gateway.netty;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.gateway.kafka.InboundProducer;
import com.rbac.im.gateway.protocol.Envelope;
import com.rbac.im.gateway.registry.ChannelRegistry;
import com.rbac.im.gateway.registry.RouteService;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.timeout.IdleStateEvent;

public class ImFrameHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {

    private final InboundProducer inboundProducer;
    private final ChannelRegistry registry;
    private final RouteService routeService;
    private final ObjectMapper mapper = new ObjectMapper();

    public ImFrameHandler(InboundProducer inboundProducer,
                          ChannelRegistry registry,
                          RouteService routeService) {
        this.inboundProducer = inboundProducer;
        this.registry = registry;
        this.routeService = routeService;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, TextWebSocketFrame frame) throws Exception {
        Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
        String deviceId = ctx.channel().attr(HandshakeAuthHandler.DEVICE_ID).get();
        Envelope env = mapper.readValue(frame.text(), Envelope.class);
        if ("SEND".equals(env.getOp())) {
            env.setSenderId(userId);       // 以连接身份为准，忽略客户端伪造
            env.setDeviceId(deviceId);
            inboundProducer.send(env);
            // 立即回执：告诉客户端服务器已接收（seq 稍后由推送带回）
            Envelope ack = new Envelope();
            ack.setOp("ACK");
            ack.setClientMsgId(env.getClientMsgId());
            ack.setCid(env.getCid());
            ctx.writeAndFlush(new TextWebSocketFrame(mapper.writeValueAsString(ack)));
        }
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent) {
            ctx.close();   // 心跳超时，关闭连接
        }
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
        String deviceId = ctx.channel().attr(HandshakeAuthHandler.DEVICE_ID).get();
        if (userId != null && deviceId != null) {
            registry.remove(userId, deviceId);
            routeService.unregister(userId, deviceId);
        }
    }
}
