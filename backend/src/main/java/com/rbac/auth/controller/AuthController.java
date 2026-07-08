package com.rbac.auth.controller;

import com.rbac.auth.dto.LoginRequest;
import com.rbac.auth.dto.RefreshTokenRequest;
import com.rbac.auth.service.AuthService;
import com.rbac.auth.vo.CurrentUserVO;
import com.rbac.auth.vo.LoginVO;
import com.rbac.common.Result;
import com.rbac.system.menu.vo.MenuVO;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 认证接口：登录、登出、刷新、当前用户、菜单、权限。
 */
@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public Result<LoginVO> login(@Valid @RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        String userAgent = servletRequest.getHeader("User-Agent");
        return Result.success(authService.login(request, clientIp(servletRequest), userAgent));
    }

    @PostMapping("/logout")
    public Result<Void> logout(HttpServletRequest request) {
        authService.logout(resolveToken(request));
        return Result.success();
    }

    @PostMapping("/refresh-token")
    public Result<LoginVO> refresh(@Valid @RequestBody RefreshTokenRequest request) {
        return Result.success(authService.refresh(request.getRefreshToken()));
    }

    @GetMapping("/me")
    public Result<CurrentUserVO> me() {
        return Result.success(authService.currentUser());
    }

    @GetMapping("/menus")
    public Result<List<MenuVO>> menus() {
        return Result.success(authService.currentUserMenus());
    }

    @GetMapping("/permissions")
    public Result<List<String>> permissions() {
        return Result.success(authService.currentUserPermissions());
    }

    private String resolveToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }

    private String clientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip != null && !ip.isBlank()) {
            return ip.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
