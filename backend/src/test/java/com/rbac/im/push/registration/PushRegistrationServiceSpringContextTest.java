package com.rbac.im.push.registration;

import org.junit.jupiter.api.Test;
import org.apache.ibatis.annotations.Mapper;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.lang.reflect.Proxy;

import static org.assertj.core.api.Assertions.assertThat;

class PushRegistrationServiceSpringContextTest {

    @Test
    void mapperIsExplicitlyRegisteredAndItsPackageIsScanned() {
        assertThat(ImPushRegistrationMapper.class.isAnnotationPresent(Mapper.class)).isTrue();
        MapperScan mapperScan = com.rbac.RbacServerApplication.class.getAnnotation(MapperScan.class);
        assertThat(mapperScan.value()).contains("com.rbac.im.push.registration");
    }

    @Test
    void contextCreatesServiceUsingMapperConstructor() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.register(PushRegistrationService.class);
            context.registerBean(ImPushRegistrationMapper.class, () -> mapper());
            context.refresh();

            assertThat(context.getBean(PushRegistrationService.class)).isNotNull();
        }
    }

    private ImPushRegistrationMapper mapper() {
        return (ImPushRegistrationMapper) Proxy.newProxyInstance(
                getClass().getClassLoader(),
                new Class<?>[]{ImPushRegistrationMapper.class},
                (proxy, method, args) -> null);
    }
}
