package com.rbac.im.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class MediaPropertiesTest {

    @Autowired MediaProperties props;

    @Test
    void binds_bucket_ttl_and_limits() {
        assertThat(props.getBucket()).isEqualTo("im-media");
        assertThat(props.getPutTtlSeconds()).isEqualTo(300);
        assertThat(props.limitFor("IMAGE")).isNotNull();
        assertThat(props.limitFor("IMAGE").getMaxSize()).isEqualTo(10485760L);
        assertThat(props.limitFor("IMAGE").getMimes()).contains("image/png");
        assertThat(props.limitFor("FILE").getMimes()).contains("*");
        assertThat(props.limitFor("UNKNOWN")).isNull();
    }
}
