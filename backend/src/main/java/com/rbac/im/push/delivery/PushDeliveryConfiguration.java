package com.rbac.im.push.delivery;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration(proxyBeanMethods = false)
public class PushDeliveryConfiguration {

    @Bean
    @ConditionalOnMissingBean(Clock.class)
    Clock pushDeliveryClock() {
        return Clock.systemDefaultZone();
    }
}
