package com.rbac.im.gateway.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.gateway.protocol.OutboundPacket;
import com.rbac.im.gateway.registry.ChannelRegistry;
import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OutboundConsumer {

    private final ChannelRegistry registry;
    private final String gatewayId;
    private final ObjectMapper mapper = new ObjectMapper();

    public OutboundConsumer(ChannelRegistry registry,
                            @Value("${im.gateway.id}") String gatewayId) {
        this.registry = registry;
        this.gatewayId = gatewayId;
    }

    @KafkaListener(topics = "im-outbound", groupId = "im-gateway-${im.gateway.id}")
    public void onOutbound(String json) throws Exception {
        OutboundPacket packet = mapper.readValue(json, OutboundPacket.class);
        if (!gatewayId.equals(packet.getGatewayId())) {
            return;   // 不是发给本网关的
        }
        Channel ch = registry.find(packet.getTargetUserId(), packet.getDeviceId());
        if (ch != null && ch.isActive()) {
            ch.writeAndFlush(new TextWebSocketFrame(
                    mapper.writeValueAsString(packet.getEnvelope())));
        }
    }
}
