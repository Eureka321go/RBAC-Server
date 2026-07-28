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

// 收到消息帧(channelRead0)
// 心跳超时(userEvent Triggered)
// 连接断开清理(channelInactive)
public class ImFrameHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {

    private final InboundProducer inboundProducer; // —— 上行的出口,项目里自己写的类(kafka/InboundProducer.java),封装了"把消息发到Kafka im-inbound topic"这个动作。
    private final ChannelRegistry registry; // 本机连接表 维护本网关内存里userId → {deviceId → Channel} 的映射。只登记本机的连接(Channel对象没法跨进程)
    private final RouteService routeService; // 操作 Redis 里的route:user:<uid> —— 记录"某用户挂在哪台网关上",这是全局信息,所有网关和backend 都能查。
    private final ObjectMapper mapper = new ObjectMapper(); //JSON 翻译器- 是什么:Jackson 库的类(第三方,不是你写的),负责 Java 对象 ↔ JSON字符串互转。注意它和上面三个不同 —— 是当场 new 出来的,不是 Spring 注入的。

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
        if ("PING".equals(env.getOp())) {
            // 重新登记而不是只续 TTL：即使路由已过期，存量 WebSocket 也能通过下一次心跳自愈。
            routeService.register(userId, deviceId);
            // 心跳应答：回 PONG，供客户端存活看门狗判定连接健康（空闲连接不被误杀）
            Envelope pong = new Envelope();
            pong.setOp("PONG");
            pong.setTs(System.currentTimeMillis());
            ctx.writeAndFlush(new TextWebSocketFrame(mapper.writeValueAsString(pong)));
            return;
        }
        if ("SEND".equals(env.getOp())) {
            env.setSenderId(userId);       // 以连接身份为准，忽略客户端伪造
            env.setDeviceId(deviceId);
            inboundProducer.send(env);
            // 立即回执：告诉客户端服务器已接收（seq 稍后由推送带回）
            Envelope ack = new Envelope();
            ack.setOp("ACK");
            ack.setClientMsgId(env.getClientMsgId());
            // 原路往回发
            //  - write:把数据写进缓冲区,还没真出网卡
            //  - flush:把缓冲区的数据真正冲刷到网络
            //  - writeAndFlush:两步合一,写完立即发
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
    public void channelInactive(ChannelHandlerContext ctx) { // 连接断开（主动/被动）
        Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
        String deviceId = ctx.channel().attr(HandshakeAuthHandler.DEVICE_ID).get();
        if (userId != null && deviceId != null) {
            registry.remove(userId, deviceId); // 清本机表
            routeService.unregister(userId, deviceId); // 清 Redis 路由
        }
    }
}
