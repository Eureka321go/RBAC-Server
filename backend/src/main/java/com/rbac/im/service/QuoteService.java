package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** 校验 TEXT 消息的引用目标，并用服务端权威数据覆盖客户端引用快照。 */
@Service
public class QuoteService {

    private static final Set<String> SUPPORTED_TYPES = Set.of("TEXT", "IMAGE", "FILE", "AUDIO");
    private static final Pattern CONTROL_CHARS = Pattern.compile("\\p{C}+");
    private static final Pattern WHITESPACE = Pattern.compile("[\\p{Z}\\s]+");
    private static final int MAX_SENDER_NAME_CODE_POINTS = 80;
    private static final int MAX_SUMMARY_CODE_POINTS = 120;

    private final ImMessageRepository repo;
    private final ConversationService conversationService;

    public QuoteService(ImMessageRepository repo, ConversationService conversationService) {
        this.repo = repo;
        this.conversationService = conversationService;
    }

    public Map<String, Object> enrich(String cid, String type, Map<String, Object> body) {
        if (!"TEXT".equals(type) || body == null || !body.containsKey("quote")) {
            return body;
        }

        Object rawQuote = body.get("quote");
        if (!(rawQuote instanceof Map<?, ?> quote)) {
            throw new QuoteValidationException("QUOTE_TARGET_INVALID");
        }
        long targetSeq = positiveLong(quote.get("targetSeq"));
        ImMessage target = repo.findByCidAndSeq(cid, targetSeq)
                .orElseThrow(() -> new QuoteValidationException("QUOTE_TARGET_NOT_FOUND"));
        if (target.isRecalled()) {
            throw new QuoteValidationException("QUOTE_TARGET_RECALLED");
        }
        if (!SUPPORTED_TYPES.contains(target.getType()) || target.getSenderId() == null) {
            throw new QuoteValidationException("QUOTE_TARGET_UNSUPPORTED");
        }

        long senderId = target.getSenderId();
        String fallbackName = "用户 #" + senderId;
        Map<Long, String> names = conversationService.displayNames(List.of(senderId));
        String senderName = normalizeText(
                names.get(senderId),
                MAX_SENDER_NAME_CODE_POINTS,
                fallbackName
        );

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("targetSeq", targetSeq);
        snapshot.put("senderId", senderId);
        snapshot.put("senderName", senderName);
        snapshot.put("type", target.getType());
        snapshot.put("summary", summaryOf(target));

        Map<String, Object> enriched = new LinkedHashMap<>(body);
        enriched.put("quote", snapshot);
        return enriched;
    }

    private static long positiveLong(Object value) {
        if (!(value instanceof Number number)) {
            throw new QuoteValidationException("QUOTE_TARGET_INVALID");
        }
        try {
            long parsed = new BigDecimal(number.toString()).longValueExact();
            if (parsed <= 0) {
                throw new QuoteValidationException("QUOTE_TARGET_INVALID");
            }
            return parsed;
        } catch (ArithmeticException | NumberFormatException ex) {
            throw new QuoteValidationException("QUOTE_TARGET_INVALID");
        }
    }

    private static String summaryOf(ImMessage target) {
        return switch (target.getType()) {
            case "TEXT" -> normalizeText(bodyText(target, "text"), MAX_SUMMARY_CODE_POINTS, "[文本]");
            case "IMAGE" -> "[图片]";
            case "AUDIO" -> "[语音]";
            case "FILE" -> normalizeText(fileBasename(bodyText(target, "filename")),
                    MAX_SUMMARY_CODE_POINTS, "[文件]");
            default -> throw new QuoteValidationException("QUOTE_TARGET_UNSUPPORTED");
        };
    }

    private static String bodyText(ImMessage target, String key) {
        if (target.getBody() == null) {
            return null;
        }
        Object value = target.getBody().get(key);
        return value instanceof String text ? text : null;
    }

    private static String fileBasename(String filename) {
        if (filename == null) {
            return null;
        }
        String normalized = filename.replace('\\', '/');
        int slash = normalized.lastIndexOf('/');
        return slash < 0 ? normalized : normalized.substring(slash + 1);
    }

    private static String normalizeText(String value, int maxCodePoints, String fallback) {
        if (value == null) {
            return fallback;
        }
        String normalized = CONTROL_CHARS.matcher(value).replaceAll(" ");
        normalized = WHITESPACE.matcher(normalized).replaceAll(" ").trim();
        if (normalized.isEmpty()) {
            return fallback;
        }
        int codePoints = normalized.codePointCount(0, normalized.length());
        if (codePoints <= maxCodePoints) {
            return normalized;
        }
        int end = normalized.offsetByCodePoints(0, maxCodePoints);
        return normalized.substring(0, end);
    }
}
