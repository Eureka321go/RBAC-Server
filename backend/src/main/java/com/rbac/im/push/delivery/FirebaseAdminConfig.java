package com.rbac.im.push.delivery;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.kafka.annotation.EnableKafkaRetryTopic;

import java.io.IOException;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "rbac.im.push", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(PushProperties.class)
@EnableKafkaRetryTopic
public class FirebaseAdminConfig {

    static final String FIREBASE_APP_NAME = "rbac-im-push";

    @Bean(destroyMethod = "delete")
    @Lazy
    FirebaseApp firebaseApp() {
        try {
            FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.getApplicationDefault())
                    .build();
            return FirebaseApp.initializeApp(options, FIREBASE_APP_NAME);
        } catch (IOException | RuntimeException exception) {
            throw new IllegalStateException("Firebase Admin initialization failed");
        }
    }

    @Bean
    @Lazy
    FirebaseMessaging firebaseMessaging(FirebaseApp app) {
        return FirebaseMessaging.getInstance(app);
    }
}
