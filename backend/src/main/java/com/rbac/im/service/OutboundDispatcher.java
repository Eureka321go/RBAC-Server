package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.protocol.OutboundPacket;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class OutboundDispatcher {

    private final ConversationService conversationService;
    private final StringRedisTemplate redis;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper = new ObjectMapper();

    public OutboundDispatcher(ConversationService conversationService,
                              StringRedisTemplate redis,
                              KafkaTemplate<String, String> kafka) {
        this.conversationService = conversationService;
        this.redis = redis;
        this.kafka = kafka;
    }

    /** 查会话成员 → 查 Redis 路由 → 逐设备投到目标网关。离线（无路由）则跳过，等增量拉取。 */
    public void dispatch(String cid, Envelope pushEnv) {
        List<Long> members = conversationService.memberUserIds(cid);
        for (Long uid : members) {
            Map<Object, Object> routes = redis.opsForHash().entries("route:user:" + uid);
            for (Map.Entry<Object, Object> e : routes.entrySet()) {
                String deviceId = String.valueOf(e.getKey());
                String gatewayId = String.valueOf(e.getValue());
                OutboundPacket packet = new OutboundPacket();
                packet.setGatewayId(gatewayId);
                packet.setTargetUserId(uid);
                packet.setDeviceId(deviceId);
                packet.setEnvelope(pushEnv);
                send(gatewayId, packet);
            }
        }
    }

    /** 定向推送给单个用户的所有在线设备（用于发送失败 ERROR 回执）。 */
    public void dispatchToUser(long userId, Envelope env) {
        Map<Object, Object> routes = redis.opsForHash().entries("route:user:" + userId);
        for (Map.Entry<Object, Object> e : routes.entrySet()) {
            String deviceId = String.valueOf(e.getKey());
            String gatewayId = String.valueOf(e.getValue());
            OutboundPacket packet = new OutboundPacket();
            packet.setGatewayId(gatewayId);
            packet.setTargetUserId(userId);
            packet.setDeviceId(deviceId);
            packet.setEnvelope(env);
            send(gatewayId, packet);
        }
    }

    private void send(String gatewayId, OutboundPacket packet) {
        try {
            kafka.send(ImKafkaTopics.OUT, gatewayId, mapper.writeValueAsString(packet));
        } catch (Exception ex) {
            throw new IllegalStateException("serialize outbound failed", ex);
        }
    }
}
