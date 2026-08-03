package com.rbac.im.push.candidate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@SuppressWarnings("unchecked")
class KafkaPushCandidatePublisherTest {

    private final KafkaTemplate<String, String> kafka = mock(KafkaTemplate.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final PushCandidate candidate = new PushCandidate(
            1, "msg-7", "g_100", 7L, 10L, "IMAGE", "[图片]", List.of(20L), 7000L);

    @Test
    void publishesSafePayloadUsingConversationAsKafkaKey() throws Exception {
        when(kafka.send(eq(ImKafkaTopics.PUSH), eq("g_100"), anyString()))
                .thenReturn(CompletableFuture.completedFuture(null));
        KafkaPushCandidatePublisher publisher = new KafkaPushCandidatePublisher(kafka, mapper);

        publisher.publish(candidate);

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(kafka).send(eq(ImKafkaTopics.PUSH), eq("g_100"), payload.capture());
        JsonNode json = mapper.readTree(payload.getValue());
        assertThat(json.path("msgId").asText()).isEqualTo("msg-7");
        assertThat(json.path("preview").asText()).isEqualTo("[图片]");
        assertThat(json.has("body")).isFalse();
        assertThat(payload.getValue()).doesNotContain("objectKey", "private/key");
    }

    @Test
    void serializationFailureIsIsolatedFromMessageFlow() throws Exception {
        ObjectMapper failingMapper = mock(ObjectMapper.class);
        when(failingMapper.writeValueAsString(candidate))
                .thenThrow(new JsonProcessingException("serialization failed") { });
        KafkaPushCandidatePublisher publisher = new KafkaPushCandidatePublisher(kafka, failingMapper);

        assertDoesNotThrow(() -> publisher.publish(candidate));

        verifyNoInteractions(kafka);
    }

    @Test
    void synchronousKafkaFailureIsIsolatedFromMessageFlow() {
        when(kafka.send(eq(ImKafkaTopics.PUSH), eq("g_100"), anyString()))
                .thenThrow(new RuntimeException("send failed"));
        KafkaPushCandidatePublisher publisher = new KafkaPushCandidatePublisher(kafka, mapper);

        assertDoesNotThrow(() -> publisher.publish(candidate));
    }

    @Test
    void asynchronousKafkaFailureIsIsolatedFromMessageFlow() {
        when(kafka.send(eq(ImKafkaTopics.PUSH), eq("g_100"), anyString()))
                .thenReturn(CompletableFuture.failedFuture(new RuntimeException("broker failed")));
        KafkaPushCandidatePublisher publisher = new KafkaPushCandidatePublisher(kafka, mapper);

        assertDoesNotThrow(() -> publisher.publish(candidate));
    }
}
