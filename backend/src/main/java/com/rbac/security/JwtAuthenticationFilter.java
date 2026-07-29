package com.rbac.security;

import com.rbac.security.model.LoginUser;
import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * JWT 认证过滤器：解析 Bearer Token → 校验 Redis 会话 → 写入 SecurityContext。
 * 会话被删除（登出/强退/改密）后，即便 token 未过期也无法通过。
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String HEADER = "Authorization";
    private static final String PREFIX = "Bearer ";

    private final JwtTokenProvider tokenProvider;
    private final TokenSessionService tokenSessionService;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider, TokenSessionService tokenSessionService) {
        this.tokenProvider = tokenProvider;
        this.tokenSessionService = tokenSessionService;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain) throws ServletException, IOException {
        // ① 从请求头 Authorization: Bearer xxx 里取出令牌（没有则返回 null）
        String token = resolveToken(request);
        // 有令牌 且 本次请求还没被认证过，才进入认证流程，（如果第6步有出现说明有认证过了）
        if (StringUtils.hasText(token) && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                // ② 验签 + 验过期，解析出令牌内容（伪造/篡改/过期都会在这里抛异常）
                Claims claims = tokenProvider.parse(token);
                // ③ 必须是 access 类型令牌；refresh 令牌不能拿来访问普通接口
                if (JwtTokenProvider.TYPE_ACCESS.equals(claims.get("typ", String.class))) {
                    // ④ ★关键：用令牌里的 jti 去 Redis 查会话。会话被删（登出/改密/强踢）则返回 null
                    LoginUser loginUser = tokenSessionService.getAccessSession(claims.getId());
                    if (loginUser != null) {
                        // ⑤ 会话还在 → 组装 Spring Security 的认证对象，authorities 就是用户的权限码集合
                        UsernamePasswordAuthenticationToken authentication =
                                new UsernamePasswordAuthenticationToken(loginUser, null, loginUser.getAuthorities());
                        authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                        // ⑥ ★写入 SecurityContext：此后 Controller/Service 里可通过 SecurityUtils 拿到当前登录用户
                        SecurityContextHolder.getContext().setAuthentication(authentication);
                    }
                }
            } catch (Exception ignored) {
                // token 无效/过期：不设置认证，后续由 EntryPoint 返回 401
            }
        }
        // ⑦ 无论认没认成，都放行到下一环；拒绝与否交给后面的授权规则（未认证 → 401）
        filterChain.doFilter(request, response);
    }

    private String resolveToken(HttpServletRequest request) {
        String header = request.getHeader(HEADER);
        if (StringUtils.hasText(header) && header.startsWith(PREFIX)) {
            return header.substring(PREFIX.length());
        }
        return null;
    }
}
