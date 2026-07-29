package com.rbac.im.gateway.registry;

import io.netty.channel.Channel;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 本机在线连接表：userId -> (deviceId -> Channel)。 */
@Component
public class ChannelRegistry {

    private final Map<Long, Map<String, Channel>> table = new ConcurrentHashMap<>();

    public void add(long userId, String deviceId, Channel ch) {
        table.computeIfAbsent(userId, k -> new ConcurrentHashMap<>()).put(deviceId, ch);
    }

    public void remove(long userId, String deviceId) {
        Map<String, Channel> devices = table.get(userId);
        if (devices != null) {
            devices.remove(deviceId);
            if (devices.isEmpty()) {
                table.remove(userId);
            }
        }
    }

    public Collection<Channel> find(long userId) {
        Map<String, Channel> devices = table.get(userId);
        return devices == null ? List.of() : devices.values();
    }

    public Channel find(long userId, String deviceId) {
        Map<String, Channel> devices = table.get(userId);
        return devices == null ? null : devices.get(deviceId);
    }
}
