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
}
