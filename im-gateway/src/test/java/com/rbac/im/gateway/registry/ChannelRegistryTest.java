package com.rbac.im.gateway.registry;

import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.Test;

import java.util.Collection;

import static org.junit.jupiter.api.Assertions.*;

class ChannelRegistryTest {

    @Test
    void add_find_remove() {
        ChannelRegistry reg = new ChannelRegistry();
        EmbeddedChannel ch = new EmbeddedChannel();
        reg.add(1L, "d1", ch);

        Collection<io.netty.channel.Channel> found = reg.find(1L);
        assertEquals(1, found.size());

        reg.remove(1L, "d1");
        assertTrue(reg.find(1L).isEmpty());
    }
}
