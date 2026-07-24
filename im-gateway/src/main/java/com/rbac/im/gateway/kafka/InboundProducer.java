package com.rbac.im.gateway.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.gateway.protocol.Envelope;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class InboundProducer {

    private static final String TOPIC = "im-inbound";

    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundProducer(KafkaTemplate<String, String> kafka) {
        this.kafka = kafka;
    }

    /** key = cid 保证同会话进同一分区、分区内有序。 */
    public void send(Envelope env) {
        try {
            kafka.send(TOPIC, env.getCid(), mapper.writeValueAsString(env));
        } catch (Exception e) {
            throw new IllegalStateException("serialize envelope failed", e);
    }        }

}
