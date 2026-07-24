package com.rbac.im.config;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * readCapped 纯逻辑测试：DoS 防护（体积截断）。方法放宽为包级可见仅为单测直调，不改判定逻辑。
 */
class LinkFetchConfigTest {

    @Test
    void truncates_when_input_exceeds_max_bytes() throws Exception {
        long maxBytes = 10;
        // 长度 20 > maxBytes 10
        byte[] data = "abcdefghijklmnopqrst".getBytes(StandardCharsets.UTF_8);
        assertThat(data.length).isGreaterThan((int) maxBytes);

        String result = LinkFetchConfig.readCapped(new ByteArrayInputStream(data), maxBytes);

        assertThat(result.length()).isEqualTo((int) maxBytes);
        assertThat(result).isEqualTo("abcdefghij");
    }

    @Test
    void returns_full_content_when_input_smaller_than_max_bytes() throws Exception {
        long maxBytes = 10;
        // 长度 5 < maxBytes 10
        byte[] data = "abcde".getBytes(StandardCharsets.UTF_8);
        assertThat(data.length).isLessThan((int) maxBytes);

        String result = LinkFetchConfig.readCapped(new ByteArrayInputStream(data), maxBytes);

        assertThat(result).isEqualTo("abcde");
    }
}
