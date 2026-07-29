package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
class MediaUrlEnricherTest {

    @Autowired MediaUrlEnricher enricher;
    @MockBean MediaStorage storage;

    @Test
    void image_getsUrl_fromPresignedGet() {
        when(storage.presignGet(eq("im/c_1_2/199001/abc.png"), any(Duration.class)))
                .thenReturn("http://signed/get");
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", "im/c_1_2/199001/abc.png");
        body.put("width", 100);

        Map<String, Object> out = enricher.enrich("IMAGE", body);

        assertThat(out.get("url")).isEqualTo("http://signed/get");
        assertThat(out.get("width")).isEqualTo(100);
        assertThat(body).doesNotContainKey("url");   // 原 body 不被污染
    }

    @Test
    void text_isNoOp() {
        Map<String, Object> body = Map.of("text", "hi");
        assertThat(enricher.enrich("TEXT", body)).isSameAs(body);
    }

    @Test
    void media_withoutObjectKey_isNoOp() {
        Map<String, Object> body = Map.of("foo", "bar");
        assertThat(enricher.enrich("FILE", body)).isSameAs(body);
    }

    @Test
    void nullBody_isNoOp() {
        assertThat(enricher.enrich("IMAGE", null)).isNull();
    }

    /** I3：Set.of(...).contains(null) 会抛 NPE；pull 对每条存量消息都调本方法，不能炸。 */
    @Test
    void nullType_isNoOp_notNpe() {
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", "im/c_1_2/199001/abc.png");
        assertThat(enricher.enrich(null, body)).isSameAs(body);
        assertThat(enricher.enrich(null, null)).isNull();
    }

    @Test
    void audio_getsUrl_fromPresignedGet() {
        when(storage.presignGet(eq("im/c_1_2/199001/audio.mp3"), any(Duration.class)))
                .thenReturn("http://signed/audio");
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", "im/c_1_2/199001/audio.mp3");
        body.put("duration", 60);

        Map<String, Object> out = enricher.enrich("AUDIO", body);

        assertThat(out.get("url")).isEqualTo("http://signed/audio");
        assertThat(out.get("duration")).isEqualTo(60);
        assertThat(body).doesNotContainKey("url");   // 原 body 不被污染
    }

    @Test
    void file_getsUrl_fromPresignedGet() {
        when(storage.presignGet(eq("im/c_1_2/199001/doc.pdf"), any(Duration.class)))
                .thenReturn("http://signed/file");
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", "im/c_1_2/199001/doc.pdf");
        body.put("fileName", "document.pdf");

        Map<String, Object> out = enricher.enrich("FILE", body);

        assertThat(out.get("url")).isEqualTo("http://signed/file");
        assertThat(out.get("fileName")).isEqualTo("document.pdf");
        assertThat(body).doesNotContainKey("url");   // 原 body 不被污染
    }

    @Test
    void objectKey_notString_isNoOp() {
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", 123);
        assertThat(enricher.enrich("IMAGE", body)).isSameAs(body);
    }
}
