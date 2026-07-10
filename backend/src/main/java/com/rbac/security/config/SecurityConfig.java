package com.rbac.security.config;

import com.rbac.security.JwtAuthenticationFilter;
import com.rbac.security.handler.JwtAuthenticationEntryPoint;
import com.rbac.security.handler.RestAccessDeniedHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Spring Security 配置：无状态 JWT 认证 + 方法级鉴权（@PreAuthorize）。
 * 放行登录、刷新、探活；其余接口默认需认证。
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    /** 无需认证的路径（相对 context-path /api）。 */
    private static final String[] WHITELIST = {
            "/auth/login",
            "/auth/refresh-token",
            "/ping",
            "/error"
    };

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final JwtAuthenticationEntryPoint authenticationEntryPoint;
    private final RestAccessDeniedHandler accessDeniedHandler;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter,
                          JwtAuthenticationEntryPoint authenticationEntryPoint,
                          RestAccessDeniedHandler accessDeniedHandler) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.authenticationEntryPoint = authenticationEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // 关闭 CSRF：本项目是无状态 JWT 接口，不依赖浏览器 Cookie/Session，无需 CSRF 令牌
                .csrf(AbstractHttpConfigurer::disable)
                // 无状态：不创建/使用 HttpSession，身份完全靠每个请求自带的 JWT（服务器不存登录态）
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(WHITELIST).permitAll()   // 白名单路径放行（登录/刷新/探活/错误页）
                        .anyRequest().authenticated())            // 其余所有请求：必须已认证（否则 → 401）
                .exceptionHandling(e -> e
                        .authenticationEntryPoint(authenticationEntryPoint)  // 未认证（没登录/令牌无效）→ 401
                        .accessDeniedHandler(accessDeniedHandler))           // 已认证但无权限 → 403
                .httpBasic(AbstractHttpConfigurer::disable)   // 关闭 HTTP Basic 弹窗登录
                .formLogin(AbstractHttpConfigurer::disable)   // 关闭表单登录页（前后端分离，不用 Security 自带登录页）
                // ★ 把自定义 JWT 过滤器插到 Spring Security 认证过滤器之前，保证每个请求先经过 JWT 识别
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** 密码加密器：登录校验时 passwordEncoder.matches(明文, BCrypt哈希) 用的就是它。 */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
