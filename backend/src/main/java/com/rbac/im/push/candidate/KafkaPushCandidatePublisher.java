package com.rbac.im.push.candidate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class KafkaPushCandidatePublisher implements PushCandidatePublisher {

    private static final Logger log = LoggerFactory.getLogger(KafkaPushCandidatePublisher.class);

    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper;

    public KafkaPushCandidatePublisher(KafkaTemplate<String, String> kafka, ObjectMapper mapper) {
        this.kafka = kafka;
        this.mapper = mapper;
    }

    @Override
    public void publish(PushCandidate candidate) {
        try {
            String json = mapper.writeValueAsString(candidate);
            kafka.send(ImKafkaTopics.PUSH, candidate.cid(), json)
                    .whenComplete((ok, cause) -> {
                        if (cause != null) {
                            log.warn("推送候选发布失败 msgId={}", candidate.msgId());
                        }
                    });
        } catch (JsonProcessingException ex) {
            log.error("推送候选序列化失败 msgId={}", candidate.msgId());
        } catch (RuntimeException ex) {
            log.warn("推送候选发布失败 msgId={}", candidate.msgId());
        }
    }
}
