package com.rbac.system.user.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.datascope.DataScopeQuery;
import com.rbac.common.datascope.DataScopeService;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.common.util.SecurityUtils;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.post.entity.SysPost;
import com.rbac.system.post.mapper.SysPostMapper;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.user.dto.UserCreateRequest;
import com.rbac.system.user.dto.UserQuery;
import com.rbac.system.user.dto.UserUpdateRequest;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.entity.SysUserPost;
import com.rbac.system.user.entity.SysUserRole;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.system.user.mapper.SysUserPostMapper;
import com.rbac.system.user.mapper.SysUserRoleMapper;
import com.rbac.system.user.vo.UserVO;
import com.rbac.common.config.RbacProperties;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 用户管理服务：用户 CRUD、状态、重置密码、分配角色。
 * 关键规则：不能删除/禁用超级管理员，不能删除自身。
 */
@Service
public class UserService {

    private static final String SUPER_ADMIN = "super_admin";

    private final SysUserMapper userMapper;
    private final SysUserRoleMapper userRoleMapper;
    private final SysUserPostMapper userPostMapper;
    private final SysRoleMapper roleMapper;
    private final SysDeptMapper deptMapper;
    private final SysPostMapper postMapper;
    private final PasswordEncoder passwordEncoder;
    private final DataScopeService dataScopeService;
    private final String defaultPassword;

    public UserService(SysUserMapper userMapper, SysUserRoleMapper userRoleMapper, SysUserPostMapper userPostMapper,
                       SysRoleMapper roleMapper, SysDeptMapper deptMapper, SysPostMapper postMapper,
                       PasswordEncoder passwordEncoder, DataScopeService dataScopeService,
                       RbacProperties rbacProperties) {
        this.userMapper = userMapper;
        this.userRoleMapper = userRoleMapper;
        this.userPostMapper = userPostMapper;
        this.roleMapper = roleMapper;
        this.deptMapper = deptMapper;
        this.postMapper = postMapper;
        this.passwordEncoder = passwordEncoder;
        this.dataScopeService = dataScopeService;
        this.defaultPassword = rbacProperties.getSecurity().getDefaultPassword();
    }

    public PageResult<UserVO> page(UserQuery query) {
        DataScopeQuery scope = dataScopeService.calculate();
        var wrapper = Wrappers.<SysUser>lambdaQuery()
                .like(StringUtils.hasText(query.getUsername()), SysUser::getUsername, query.getUsername())
                .like(StringUtils.hasText(query.getNickname()), SysUser::getNickname, query.getNickname())
                .like(StringUtils.hasText(query.getPhone()), SysUser::getPhone, query.getPhone())
                .eq(query.getDeptId() != null, SysUser::getDeptId, query.getDeptId())
                .eq(StringUtils.hasText(query.getStatus()), SysUser::getStatus, query.getStatus());

        // 数据权限过滤：非全部范围时，按可见部门集合 OR 本人创建 收敛
        if (!scope.isAll()) {
            if (scope.hasDeptScope() && scope.hasSelfScope()) {
                wrapper.and(w -> w.in(SysUser::getDeptId, scope.getDeptIds())
                        .or().eq(SysUser::getCreatedBy, scope.getSelfUserId()));
            } else if (scope.hasDeptScope()) {
                wrapper.in(SysUser::getDeptId, scope.getDeptIds());
            } else if (scope.hasSelfScope()) {
                wrapper.eq(SysUser::getCreatedBy, scope.getSelfUserId());
            } else {
                // 无任何可见范围：返回空结果
                wrapper.apply("1 = 0");
            }
        }

        IPage<SysUser> page = userMapper.selectPage(Page.of(query.current(), query.size()),
                wrapper.orderByDesc(SysUser::getId));

        List<UserVO> vos = page.getRecords().stream().map(UserVO::from).collect(Collectors.toList());
        fillDeptAndRoles(vos);
        return PageResult.of(vos, page.getTotal(), page.getCurrent(), page.getSize());
    }

    public UserVO getById(Long id) {
        SysUser user = requireUser(id);
        UserVO vo = UserVO.from(user);
        fillDeptAndRoles(List.of(vo));
        return vo;
    }

    @Transactional
    public Long create(UserCreateRequest req) {
        if (existsUsername(req.getUsername(), null)) {
            throw new BusinessException("user.usernameExists");
        }
        SysUser user = new SysUser();
        user.setUsername(req.getUsername());
        user.setNickname(req.getNickname());
        String raw = StringUtils.hasText(req.getPassword()) ? req.getPassword() : defaultPassword;
        user.setPassword(passwordEncoder.encode(raw));
        user.setDeptId(req.getDeptId());
        user.setEmail(req.getEmail());
        user.setPhone(req.getPhone());
        user.setGender(req.getGender());
        user.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        user.setRemark(req.getRemark());
        userMapper.insert(user);
        replaceRoles(user.getId(), req.getRoleIds());
        replacePosts(user.getId(), req.getPostIds());
        return user.getId();
    }

    @Transactional
    public void update(Long id, UserUpdateRequest req) {
        SysUser existing = requireUser(id);
        if (isSuperAdmin(id) && !SecurityUtils.isSuperAdmin()) {
            throw new BusinessException("user.superAdminImmutable");
        }
        SysUser user = new SysUser();
        user.setId(id);
        user.setNickname(req.getNickname());
        user.setDeptId(req.getDeptId());
        user.setEmail(req.getEmail());
        user.setPhone(req.getPhone());
        user.setGender(req.getGender());
        user.setStatus(req.getStatus());
        user.setRemark(req.getRemark());
        userMapper.updateById(user);
        // 超管角色不允许被改动
        if (!isSuperAdmin(id)) {
            replaceRoles(id, req.getRoleIds());
        }
        replacePosts(id, req.getPostIds());
    }

    public void delete(Long id) {
        requireUser(id);
        if (id.equals(SecurityUtils.getUserId())) {
            throw new BusinessException("user.cannotDeleteSelf");
        }
        if (isSuperAdmin(id)) {
            throw new BusinessException("user.superAdminUndeletable");
        }
        userMapper.deleteById(id);
        userRoleMapper.delete(Wrappers.<SysUserRole>lambdaQuery().eq(SysUserRole::getUserId, id));
        userPostMapper.delete(Wrappers.<SysUserPost>lambdaQuery().eq(SysUserPost::getUserId, id));
    }

    public void updateStatus(Long id, String status) {
        requireUser(id);
        if ("DISABLED".equals(status) && isSuperAdmin(id)) {
            throw new BusinessException("user.superAdminUndisable");
        }
        if (id.equals(SecurityUtils.getUserId()) && "DISABLED".equals(status)) {
            throw new BusinessException("user.cannotDisableSelf");
        }
        SysUser update = new SysUser();
        update.setId(id);
        update.setStatus(status);
        userMapper.updateById(update);
    }

    public void resetPassword(Long id, String newPassword) {
        requireUser(id);
        if (isSuperAdmin(id) && !SecurityUtils.isSuperAdmin()) {
            throw new BusinessException("user.superAdminPwdImmutable");
        }
        SysUser update = new SysUser();
        update.setId(id);
        update.setPassword(passwordEncoder.encode(newPassword));
        userMapper.updateById(update);
    }

    @Transactional
    public void assignRoles(Long id, List<Long> roleIds) {
        requireUser(id);
        if (isSuperAdmin(id)) {
            throw new BusinessException("user.superAdminRoleImmutable");
        }
        replaceRoles(id, roleIds);
    }

    // ── 内部方法 ──

    private SysUser requireUser(Long id) {
        SysUser user = userMapper.selectById(id);
        if (user == null) {
            throw new BusinessException("user.notFound");
        }
        return user;
    }

    private boolean existsUsername(String username, Long excludeId) {
        return userMapper.selectCount(Wrappers.<SysUser>lambdaQuery()
                .eq(SysUser::getUsername, username)
                .ne(excludeId != null, SysUser::getId, excludeId)) > 0;
    }

    private boolean isSuperAdmin(Long userId) {
        return roleMapper.selectRolesByUserId(userId).stream()
                .anyMatch(r -> SUPER_ADMIN.equals(r.getRoleCode()));
    }

    private void replaceRoles(Long userId, List<Long> roleIds) {
        userRoleMapper.delete(Wrappers.<SysUserRole>lambdaQuery().eq(SysUserRole::getUserId, userId));
        if (roleIds != null) {
            for (Long roleId : roleIds) {
                userRoleMapper.insert(new SysUserRole(userId, roleId));
            }
        }
    }

    private void replacePosts(Long userId, List<Long> postIds) {
        userPostMapper.delete(Wrappers.<SysUserPost>lambdaQuery().eq(SysUserPost::getUserId, userId));
        if (postIds != null) {
            for (Long postId : postIds) {
                userPostMapper.insert(new SysUserPost(userId, postId));
            }
        }
    }

    private void fillDeptAndRoles(List<UserVO> vos) {
        if (vos.isEmpty()) {
            return;
        }
        Map<Long, String> deptNames = deptMapper.selectList(null).stream()
                .collect(Collectors.toMap(SysDept::getId, SysDept::getDeptName, (a, b) -> a));
        Map<Long, String> postNames = postMapper.selectList(null).stream()
                .collect(Collectors.toMap(SysPost::getId, SysPost::getPostName, (a, b) -> a));
        for (UserVO vo : vos) {
            if (vo.getDeptId() != null) {
                vo.setDeptName(deptNames.get(vo.getDeptId()));
            }
            List<SysRole> roles = roleMapper.selectRolesByUserId(vo.getId());
            vo.setRoleIds(roles.stream().map(SysRole::getId).collect(Collectors.toList()));
            vo.setRoleNames(roles.stream().map(SysRole::getRoleName).collect(Collectors.toList()));
            List<Long> postIds = userPostMapper.selectPostIdsByUserId(vo.getId());
            vo.setPostIds(postIds);
            vo.setPostNames(postIds.stream().map(postNames::get)
                    .filter(java.util.Objects::nonNull).collect(Collectors.toList()));
        }
    }
}
