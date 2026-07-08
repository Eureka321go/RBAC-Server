package com.rbac.auth.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.auth.dto.LoginRequest;
import com.rbac.auth.vo.CurrentUserVO;
import com.rbac.auth.vo.LoginVO;
import com.rbac.common.exception.BusinessException;
import com.rbac.common.util.SecurityUtils;
import com.rbac.security.JwtTokenProvider;
import com.rbac.security.LoginUserAssembler;
import com.rbac.security.TokenSessionService;
import com.rbac.security.model.LoginUser;
import com.rbac.system.log.service.LogService;
import com.rbac.system.menu.mapper.SysMenuMapper;
import com.rbac.system.menu.vo.MenuVO;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import io.jsonwebtoken.Claims;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 认证服务：登录、登出、刷新、当前用户上下文、菜单、权限。
 */
@Service
public class AuthService {

    private final SysUserMapper userMapper;
    private final SysRoleMapper roleMapper;
    private final SysMenuMapper menuMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;
    private final TokenSessionService sessionService;
    private final LoginUserAssembler loginUserAssembler;
    private final LogService logService;

    public AuthService(SysUserMapper userMapper, SysRoleMapper roleMapper, SysMenuMapper menuMapper,
                       PasswordEncoder passwordEncoder, JwtTokenProvider tokenProvider,
                       TokenSessionService sessionService, LoginUserAssembler loginUserAssembler,
                       LogService logService) {
        this.userMapper = userMapper;
        this.roleMapper = roleMapper;
        this.menuMapper = menuMapper;
        this.passwordEncoder = passwordEncoder;
        this.tokenProvider = tokenProvider;
        this.sessionService = sessionService;
        this.loginUserAssembler = loginUserAssembler;
        this.logService = logService;
    }

    public LoginVO login(LoginRequest request, String loginIp, String userAgent) {
        try {
            SysUser user = userMapper.selectOne(Wrappers.<SysUser>lambdaQuery()
                    .eq(SysUser::getUsername, request.getUsername()));
            if (user == null || !passwordEncoder.matches(request.getPassword(), user.getPassword())) {
                throw new BusinessException("账号或密码错误");
            }
            if (!"ENABLED".equals(user.getStatus())) {
                throw new BusinessException("账号已被禁用");
            }

            LoginUser loginUser = loginUserAssembler.assemble(user);
            LoginVO loginVO = issueTokens(loginUser);

            // 记录登录信息
            SysUser update = new SysUser();
            update.setId(user.getId());
            update.setLastLoginAt(LocalDateTime.now());
            update.setLastLoginIp(loginIp);
            userMapper.updateById(update);

            logService.recordLogin(request.getUsername(), true, "登录成功", loginIp, userAgent);
            return loginVO;
        } catch (BusinessException e) {
            logService.recordLogin(request.getUsername(), false, e.getMessage(), loginIp, userAgent);
            throw e;
        }
    }

    /** 生成并保存 access/refresh 会话。 */
    private LoginVO issueTokens(LoginUser loginUser) {
        String accessJti = JwtTokenProvider.newJti();
        String refreshJti = JwtTokenProvider.newJti();
        String accessToken = tokenProvider.createAccessToken(accessJti, loginUser.getUserId(), loginUser.getUsername());
        String refreshToken = tokenProvider.createRefreshToken(refreshJti, loginUser.getUserId(), loginUser.getUsername());
        sessionService.saveAccessSession(accessJti, loginUser, tokenProvider.getAccessTtlSeconds());
        sessionService.saveRefreshSession(refreshJti, loginUser.getUserId(), tokenProvider.getRefreshTtlSeconds());
        return new LoginVO(accessToken, refreshToken, tokenProvider.getAccessTtlSeconds());
    }

    public void logout(String accessToken) {
        if (accessToken == null) {
            return;
        }
        try {
            Claims claims = tokenProvider.parse(accessToken);
            sessionService.removeAccessSession(claims.getId());
        } catch (Exception ignored) {
            // token 已失效，无需处理
        }
    }

    public LoginVO refresh(String refreshToken) {
        Claims claims;
        try {
            claims = tokenProvider.parse(refreshToken);
        } catch (Exception e) {
            throw new BusinessException(401, "refreshToken 无效或已过期");
        }
        if (!JwtTokenProvider.TYPE_REFRESH.equals(claims.get("typ", String.class))) {
            throw new BusinessException(401, "refreshToken 类型错误");
        }
        Long userId = sessionService.getRefreshUserId(claims.getId());
        if (userId == null) {
            throw new BusinessException(401, "登录已失效，请重新登录");
        }
        SysUser user = userMapper.selectById(userId);
        if (user == null || !"ENABLED".equals(user.getStatus())) {
            throw new BusinessException(401, "账号不可用，请重新登录");
        }
        // 轮换 refresh 会话，签发新的 access + refresh
        sessionService.removeRefreshSession(claims.getId());
        LoginUser loginUser = loginUserAssembler.assemble(user);
        return issueTokens(loginUser);
    }

    public CurrentUserVO currentUser() {
        LoginUser loginUser = SecurityUtils.getLoginUser();
        CurrentUserVO vo = new CurrentUserVO();
        vo.setId(loginUser.getUserId());
        vo.setUsername(loginUser.getUsername());
        vo.setNickname(loginUser.getNickname());
        vo.setAvatar(loginUser.getAvatar());
        vo.setDeptId(loginUser.getDeptId());
        vo.setDeptName(loginUser.getDeptName());
        List<CurrentUserVO.RoleBriefVO> roles = roleMapper.selectRolesByUserId(loginUser.getUserId()).stream()
                .map(r -> new CurrentUserVO.RoleBriefVO(r.getId(), r.getRoleCode(), r.getRoleName()))
                .collect(Collectors.toList());
        vo.setRoles(roles);
        return vo;
    }

    public List<MenuVO> currentUserMenus() {
        LoginUser loginUser = SecurityUtils.getLoginUser();
        List<com.rbac.system.menu.entity.SysMenu> menus =
                loginUser.getRoleCodes() != null && loginUser.getRoleCodes().contains("super_admin")
                        ? menuMapper.selectAllVisibleMenus()
                        : menuMapper.selectVisibleMenusByUserId(loginUser.getUserId());
        return MenuVO.buildTree(menus);
    }

    public List<String> currentUserPermissions() {
        LoginUser loginUser = SecurityUtils.getLoginUser();
        return loginUser.getPermissions() == null ? List.of() : loginUser.getPermissions().stream().sorted().collect(Collectors.toList());
    }
}
