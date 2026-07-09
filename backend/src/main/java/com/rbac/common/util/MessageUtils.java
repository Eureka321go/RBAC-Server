package com.rbac.common.util;

import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Component;

import java.util.Locale;

/**
 * 国际化文案工具：按当前请求语言（{@link LocaleContextHolder}）解析 messageKey。
 *
 * <p>静态方法便于在异常处理等非 Spring 管理场景调用，Bean 初始化时注入 {@link MessageSource}。
 */
@Component
public class MessageUtils {

    private static MessageSource messageSource;

    public MessageUtils(MessageSource messageSource) {
        MessageUtils.messageSource = messageSource;
    }

    /**
     * 解析文案；若 key 不存在则原样返回 key（避免抛异常打断响应）。
     *
     * @param key  文案键
     * @param args 占位参数
     */
    public static String get(String key, Object... args) {
        if (messageSource == null) {
            return key;
        }
        return messageSource.getMessage(key, args, key, LocaleContextHolder.getLocale());
    }

    /**
     * 指定语言解析文案，用于安全过滤器等 {@link LocaleContextHolder} 尚未就绪的场景。
     * 语言归一到受支持集合（en* → en-US，其余 → zh-CN）。
     */
    public static String get(Locale locale, String key, Object... args) {
        if (messageSource == null) {
            return key;
        }
        return messageSource.getMessage(key, args, key, normalize(locale));
    }

    private static Locale normalize(Locale locale) {
        if (locale != null && "en".equalsIgnoreCase(locale.getLanguage())) {
            return Locale.US;
        }
        return Locale.SIMPLIFIED_CHINESE;
    }
}
