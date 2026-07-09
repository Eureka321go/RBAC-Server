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
        AcceptHeaderLocaleResolver resolver = new AcceptHeaderLocaleResolver();
        resolver.setDefaultLocale(Locale.SIMPLIFIED_CHINESE);
        resolver.setSupportedLocales(List.of(Locale.SIMPLIFIED_CHINESE, Locale.US));
        return resolver;
    }

    /** 让 @NotBlank/@Pattern 等校验注解的 message 支持 {key} 从 messages 资源取值并随语言切换。 */
    @Bean
    public Validator getValidator(MessageSource messageSource) {
        LocalValidatorFactoryBean bean = new LocalValidatorFactoryBean();
        bean.setValidationMessageSource(messageSource);
        return bean;
    }
}
