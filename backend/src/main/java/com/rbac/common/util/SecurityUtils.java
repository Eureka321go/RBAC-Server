package com.rbac.common.util;

import com.rbac.common.exception.BusinessException;
import com.rbac.security.model.LoginUser;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * 安全上下文工具：获取当前登录用户。
 */
public final class SecurityUtils {

    private SecurityUtils() {
    }

    /** 返回当前登录用户，未登录返回 null。 */
    public static LoginUser getLoginUserOrNull() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof LoginUser loginUser) {
            return loginUser;
        }
        return null;
    }

    /** 返回当前登录用户，未登录抛 401。 */
    public static LoginUser getLoginUser() {
        LoginUser loginUser = getLoginUserOrNull();
        if (loginUser == null) {
            throw new BusinessException(401, "auth.notLoggedIn");
        }
        return loginUser;
    }

    /** 当前用户 ID，未登录返回 null（用于审计字段填充）。 */
    public static Long getUserIdOrNull() {
        LoginUser loginUser = getLoginUserOrNull();
        return loginUser == null ? null : loginUser.getUserId();
    }

    public static Long getUserId() {
        return getLoginUser().getUserId();
    }

    public static boolean isSuperAdmin() {
        LoginUser loginUser = getLoginUserOrNull();
        return loginUser != null && loginUser.getRoleCodes() != null
                && loginUser.getRoleCodes().contains("super_admin");
    }
}
