package com.rbac.im.service;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 从文本提取第一个 http(s) URL。纯函数，无 IO。 */
public final class UrlExtractor {

    // URL 主体允许的字符（RFC 3986 常见子集）；不含空白与中文标点，天然在边界处截断。
    private static final Pattern URL = Pattern.compile(
            "https?://[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
            Pattern.CASE_INSENSITIVE);

    private UrlExtractor() {}

    public static Optional<String> firstHttpUrl(String text) {
        if (text == null || text.isEmpty()) {
            return Optional.empty();
        }
        Matcher m = URL.matcher(text);
        if (!m.find()) {
            return Optional.empty();
        }
        String url = m.group();
        // 去掉常见尾随英文标点（正则已挡中文/空白，但 . , ; ) 可能是句尾而非 URL 一部分）。
        // 对 ')' 做配平式判断：仅当 URL 串内右括号数多于左括号数（即这个尾随 ')' 没有对应的 '(')
        // 才剥离，否则视为 URL 自身的配对括号（如维基百科 Foo_(bar)），保留不动。
        while (!url.isEmpty()) {
            char last = url.charAt(url.length() - 1);
            if (last == ')') {
                long open = url.chars().filter(c -> c == '(').count();
                long close = url.chars().filter(c -> c == ')').count();
                if (close <= open) {
                    break;
                }
                url = url.substring(0, url.length() - 1);
            } else if (".,;!?'\"".indexOf(last) >= 0) {
                url = url.substring(0, url.length() - 1);
            } else {
                break;
            }
        }
        return url.isEmpty() ? Optional.empty() : Optional.of(url);
    }
}
