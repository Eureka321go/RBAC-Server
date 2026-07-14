package com.rbac.common.config;

import jakarta.validation.Validator;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.i18n.AcceptHeaderLocaleResolver;

import java.util.List;
import java.util.Locale;

/**
 * 国际化配置。
 *
 * <p>语言由请求头 {@code Accept-Language} 决定，仅支持简体中文与英文，缺省简体中文。
 * 同时把 {@link MessageSource} 接入 Bean Validation，使校验注解可用 {@code {key}} 取文案。
 */
@Configuration
public class LocaleConfig {

    /** 根据 Accept-Language 选择语言，默认 zh-CN，仅在 zh-CN / en-US 之间取最佳匹配。 */
    @Bean
    public LocaleResolver localeResolver() {
        // 直接读取请求的 Accept-Language 头，不使用 Cookie 或 Session 保存语言选择。
        AcceptHeaderLocaleResolver resolver = new AcceptHeaderLocaleResolver();

        // 请求未携带语言，或请求语言不能匹配支持列表时，使用简体中文。
        resolver.setDefaultLocale(Locale.SIMPLIFIED_CHINESE);

        // 限定系统支持的语言范围，解析器会从请求头中选择最匹配的一项。
        resolver.setSupportedLocales(List.of(Locale.SIMPLIFIED_CHINESE, Locale.US));
        return resolver;
    }

    /** 让 @NotBlank/@Pattern 等校验注解的 message 支持 {key} 从 messages 资源取值并随语言切换。 */
    @Bean
    public Validator getValidator(MessageSource messageSource) {
        // 使用 Spring Boot 根据 spring.messages 配置创建的 MessageSource。
        LocalValidatorFactoryBean bean = new LocalValidatorFactoryBean();

        // 让校验注解中的 {message.key} 按当前 Locale 从 i18n/messages*.properties 解析。
        bean.setValidationMessageSource(messageSource);
        return bean;
    }
}
