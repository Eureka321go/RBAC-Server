package com.rbac.im.gateway.netty;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ImFrameHandlerTest {

    private final ObjectMapper mapper = new ObjectMapper();

    /** 客户端心跳 PING 必须得到 PONG 应答，否则客户端存活看门狗会误杀空闲连接。 */
    @Test
    void ping_frame_gets_pong_reply() throws Exception {
        // PING 分支不触达 producer/registry/route，可传 null
        EmbeddedChannel ch = new EmbeddedChannel(new ImFrameHandler(null, null, null));

        ch.writeInbound(new TextWebSocketFrame("{\"op\":\"PING\",\"ts\":123}"));

        TextWebSocketFrame out = ch.readOutbound();
        assertNotNull(out, "PING 应触发一个出站帧");
        JsonNode node = mapper.readTree(out.text());
        assertEquals("PONG", node.get("op").asText());
        out.release();
    }
}
