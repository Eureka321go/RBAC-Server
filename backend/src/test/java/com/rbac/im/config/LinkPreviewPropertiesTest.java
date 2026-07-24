package com.rbac.im.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class LinkPreviewPropertiesTest {

    @Autowired LinkPreviewProperties props;

    @Test
    void binds_defaults_and_yml_values() {
        assertThat(props.isEnabled()).isTrue();
        assertThat(props.getConnectTimeoutMs()).isEqualTo(2000);
        assertThat(props.getMaxBodyBytes()).isEqualTo(524288L);
        assertThat(props.getMaxRedirects()).isEqualTo(3);
        assertThat(props.getAllowedPorts()).containsExactly(80, 443);
        assertThat(props.getUserAgent()).isEqualTo("RBAC-IM-LinkBot/1.0");
        assertThat(props.getCacheTtlOk()).isEqualTo(Duration.ofHours(6));
        assertThat(props.getCacheTtlFail()).isEqualTo(Duration.ofMinutes(10));
        assertThat(props.getPoolQueue()).isEqualTo(100);
    }
}
