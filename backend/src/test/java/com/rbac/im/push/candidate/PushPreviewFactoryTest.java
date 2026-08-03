package com.rbac.im.push.candidate;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.Map;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

class PushPreviewFactoryTest {

    private final PushPreviewFactory factory = new PushPreviewFactory();

    @ParameterizedTest
    @MethodSource("previews")
    void createsSafePreview(String type, Map<String, Object> body, String expected) {
        assertThat(factory.create(type, body)).isEqualTo(expected);
    }

    static Stream<Arguments> previews() {
        return Stream.of(
                arguments("TEXT", Map.of("text", "第一行\n  第二行"), "第一行 第二行"),
                arguments("IMAGE", Map.of("objectKey", "private/key"), "[图片]"),
                arguments("AUDIO", Map.of("duration", 3), "[语音]"),
                arguments("FILE", Map.of("filename", "合同.pdf"), "[文件]"));
    }

    @Test
    void truncatesTextAt120UnicodeCodePoints() {
        String text = "😀".repeat(120) + "尾部";

        assertThat(factory.create("TEXT", Map.of("text", text)))
                .isEqualTo("😀".repeat(120));
    }

    @Test
    void returnsNullForUnsupportedType() {
        assertThat(factory.create("SYSTEM", Map.of("event", "MEMBER_JOIN"))).isNull();
    }
}
