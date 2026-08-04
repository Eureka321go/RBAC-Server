package com.rbac.im.push.delivery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.ImPushRegistration;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FcmPayloadFactoryTest {

    private final FcmPayloadFactory factory = new FcmPayloadFactory();

    @Test
    void groupPayloadContainsAccountBindingAndMentionChannelData() throws Exception {
        Map<String, String> data = factory.create(
                candidate("g_100", 86L, "今晚八点发布"),
                target(42L, true),
                new PushPresentation("研发群", "张三"));

        assertThat(data).containsEntry("version", "1")
                .containsEntry("event", "NEW_MESSAGE")
                .containsEntry("recipientUserId", "42")
                .containsEntry("msgId", "m_1")
                .containsEntry("cid", "g_100")
                .containsEntry("seq", "86")
                .containsEntry("conversationType", "GROUP")
                .containsEntry("groupId", "100")
                .containsEntry("title", "研发群")
                .containsEntry("senderName", "张三")
                .containsEntry("preview", "今晚八点发布")
                .containsEntry("mentioned", "true")
                .containsEntry("ts", "123")
                .hasSize(13);
        assertThat(new ObjectMapper().writeValueAsBytes(data).length).isLessThan(4096);
    }

    @Test
    void singlePayloadHasEmptyGroupIdAndNeverIncludesDeliveryTarget() {
        Map<String, String> data = factory.create(
                candidate("u_42", 2L, "hello"), target(42L, false),
                new PushPresentation("张三", "张三"));

        assertThat(data).containsEntry("conversationType", "SINGLE")
                .containsEntry("groupId", "")
                .containsEntry("mentioned", "false")
                .doesNotContainKeys("target", "targetValue", "mediaUrl", "token", "credential", "body");
        assertThat(data.values()).allMatch(value -> value instanceof String);
    }

    @Test
    void payloadWithMaximumSafePreviewRemainsBelowFcmDataLimit() throws Exception {
        String largestSafePreview = "😀".repeat(120);
        Map<String, String> data = factory.create(
                candidate("g_9223372036854775807", Long.MAX_VALUE, largestSafePreview),
                target(Long.MAX_VALUE, true),
                new PushPresentation("群".repeat(64), "用户".repeat(64)));

        assertThat(new ObjectMapper().writeValueAsBytes(data).length).isLessThan(4096);
    }

    private PushCandidate candidate(String cid, long seq, String preview) {
        return new PushCandidate(1, "m_1", cid, seq, 10L, "TEXT", preview, List.of(), 123L);
    }

    private PushTarget target(long recipientUserId, boolean mentioned) {
        ImPushRegistration registration = new ImPushRegistration();
        registration.setUserId(recipientUserId);
        return new PushTarget(registration, recipientUserId, mentioned);
    }
}
