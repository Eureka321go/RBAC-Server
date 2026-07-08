package com.rbac.system.user.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.common.util.SecurityUtils;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.user.dto.UserCreateRequest;
import com.rbac.system.user.dto.UserQuery;
import com.rbac.system.user.dto.UserUpdateRequest;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.entity.SysUserRole;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.system.user.mapper.SysUserRoleMapper;
import com.rbac.system.user.vo.UserVO;
import org.springframework.beans.factory.annotation.Value;
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
    private final SysRoleMapper roleMapper;
    private final SysDeptMapper deptMapper;
    private final PasswordEncoder passwordEncoder;
    private final String defaultPassword;

    public UserService(SysUserMapper userMapper, SysUserRoleMapper userRoleMapper, SysRoleMapper roleMapper,
                       SysDeptMapper deptMapper, PasswordEncoder passwordEncoder,
                       @Value("${rbac.security.default-password:123456}") String defaultPassword) {
        this.userMapper = userMapper;
        this.userRoleMapper = userRoleMapper;
        this.roleMapper = roleMapper;
        this.deptMapper = deptMapper;
        this.passwordEncoder = passwordEncoder;
        this.defaultPassword = defaultPassword;
    }

    public PageResult<UserVO> page(UserQuery query) {
        IPage<SysUser> page = userMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysUser>lambdaQuery()
                        .like(StringUtils.hasText(query.getUsername()), SysUser::getUsername, query.getUsername())
                        .like(StringUtils.hasText(query.getNickname()), SysUser::getNickname, query.getNickname())
                        .like(StringUtils.hasText(query.getPhone()), SysUser::getPhone, query.getPhone())
                        .eq(query.getDeptId() != null, SysUser::getDeptId, query.getDeptId())
                        .eq(StringUtils.hasText(query.getStatus()), SysUser::getStatus, query.getStatus())
                        .orderByDesc(SysUser::getId));

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
            throw new BusinessException("账号已存在");
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
        return user.getId();
    }

    @Transactional
    public void update(Long id, UserUpdateRequest req) {
        SysUser existing = requireUser(id);
        if (isSuperAdmin(id) && !SecurityUtils.isSuperAdmin()) {
            throw new BusinessException("无权修改超级管理员");
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
    }

    public void delete(Long id) {
        requireUser(id);
        if (id.equals(SecurityUtils.getUserId())) {
            throw new BusinessException("不能删除当前登录用户");
        }
        if (isSuperAdmin(id)) {
            throw new BusinessException("超级管理员不允许删除");
        }
        userMapper.deleteById(id);
        userRoleMapper.delete(Wrappers.<SysUserRole>lambdaQuery().eq(SysUserRole::getUserId, id));
    }

    public void updateStatus(Long id, String status) {
        requireUser(id);
        if ("DISABLED".equals(status) && isSuperAdmin(id)) {
            throw new BusinessException("超级管理员不允许禁用");
        }
        if (id.equals(SecurityUtils.getUserId()) && "DISABLED".equals(status)) {
            throw new BusinessException("不能禁用当前登录用户");
        }
        SysUser update = new SysUser();
        update.setId(id);
        update.setStatus(status);
        userMapper.updateById(update);
    }

    public void resetPassword(Long id, String newPassword) {
        requireUser(id);
        if (isSuperAdmin(id) && !SecurityUtils.isSuperAdmin()) {
            throw new BusinessException("无权重置超级管理员密码");
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
            throw new BusinessException("超级管理员角色不允许调整");
        }
        replaceRoles(id, roleIds);
    }

    // ── 内部方法 ──

    private SysUser requireUser(Long id) {
        SysUser user = userMapper.selectById(id);
        if (user == null) {
            throw new BusinessException("用户不存在");
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

    private void fillDeptAndRoles(List<UserVO> vos) {
        if (vos.isEmpty()) {
            return;
        }
        Map<Long, String> deptNames = deptMapper.selectList(null).stream()
                .collect(Collectors.toMap(SysDept::getId, SysDept::getDeptName, (a, b) -> a));
        for (UserVO vo : vos) {
            if (vo.getDeptId() != null) {
                vo.setDeptName(deptNames.get(vo.getDeptId()));
            }
            List<SysRole> roles = roleMapper.selectRolesByUserId(vo.getId());
            vo.setRoleIds(roles.stream().map(SysRole::getId).collect(Collectors.toList()));
            vo.setRoleNames(roles.stream().map(SysRole::getRoleName).collect(Collectors.toList()));
        }
    }
}
