package com.rbac.workflow.support;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 轻量条件表达式求值器（无三方依赖）。
 *
 * <p>仅支持单个二元比较：{@code field OP value}，OP ∈ {@code > >= < <= == != =}。
 * value 为数字则做数值比较，否则做字符串（去引号）比较。空表达式视为「必经」（返回 true）。
 * 这是设计文档「条件分支」的简化实现；后续可替换为 Aviator / SpEL 而不影响引擎接口。
 */
@Component
public class ConditionEvaluator {

    private static final Pattern EXPR = Pattern.compile(
            "^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*(>=|<=|==|!=|=|>|<)\\s*(.+?)\\s*$");

    /**
     * @param expr     条件表达式，空/空白表示必经
     * @param formData 表单数据（可为 null）
     * @return 是否满足条件（进入该节点）
     */
    public boolean matches(String expr, Map<String, Object> formData) {
        if (!StringUtils.hasText(expr)) {
            return true;
        }
        Matcher m = EXPR.matcher(expr);
        if (!m.matches()) {
            // 无法解析的表达式按「必经」处理，避免静默跳过节点造成漏审
            return true;
        }
        String field = m.group(1);
        String op = m.group(2);
        String rhs = stripQuotes(m.group(3));

        Object actual = formData == null ? null : formData.get(field);

        BigDecimal left = toNumber(actual);
        BigDecimal right = toNumber(rhs);
        if (left != null && right != null) {
            int c = left.compareTo(right);
            return switch (op) {
                case ">" -> c > 0;
                case ">=" -> c >= 0;
                case "<" -> c < 0;
                case "<=" -> c <= 0;
                case "!=" -> c != 0;
                default -> c == 0; // == / =
            };
        }

        // 非数值：仅支持相等/不等
        String actualStr = actual == null ? "" : String.valueOf(actual);
        return switch (op) {
            case "!=" -> !actualStr.equals(rhs);
            case "==", "=" -> actualStr.equals(rhs);
            default -> false; // 对非数值做大小比较无意义
        };
    }

    private String stripQuotes(String s) {
        if (s.length() >= 2 && ((s.startsWith("'") && s.endsWith("'"))
                || (s.startsWith("\"") && s.endsWith("\"")))) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private BigDecimal toNumber(Object v) {
        if (v == null) {
            return null;
        }
        try {
            return new BigDecimal(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
