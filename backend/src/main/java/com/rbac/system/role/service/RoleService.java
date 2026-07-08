package com.rbac.system.role.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.role.dto.RoleQuery;
import com.rbac.system.role.dto.RoleSaveRequest;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.entity.SysRoleMenu;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.role.mapper.SysRoleMenuMapper;
import com.rbac.system.role.vo.RoleVO;
import com.rbac.system.user.mapper.SysUserRoleMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 角色管理服务：角色 CRUD、功能权限（菜单）授权。
 * 内置角色不可删除；删除前校验是否仍有用户绑定。
 */
@Service
public class RoleService {

    private final SysRoleMapper roleMapper;
    private final SysRoleMenuMapper roleMenuMapper;
    private final SysUserRoleMapper userRoleMapper;

    public RoleService(SysRoleMapper roleMapper, SysRoleMenuMapper roleMenuMapper, SysUserRoleMapper userRoleMapper) {
        this.roleMapper = roleMapper;
        this.roleMenuMapper = roleMenuMapper;
        this.userRoleMapper = userRoleMapper;
    }

    public PageResult<RoleVO> page(RoleQuery query) {
        IPage<SysRole> page = roleMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysRole>lambdaQuery()
                        .like(StringUtils.hasText(query.getRoleName()), SysRole::getRoleName, query.getRoleName())
                        .like(StringUtils.hasText(query.getRoleCode()), SysRole::getRoleCode, query.getRoleCode())
                        .eq(StringUtils.hasText(query.getStatus()), SysRole::getStatus, query.getStatus())
                        .orderByAsc(SysRole::getSortOrder));
        return PageResult.from(page, RoleVO::from);
    }

    public List<RoleVO> listAllEnabled() {
        return roleMapper.selectList(Wrappers.<SysRole>lambdaQuery()
                        .eq(SysRole::getStatus, "ENABLED").orderByAsc(SysRole::getSortOrder))
                .stream().map(RoleVO::from).toList();
    }

    public SysRole getById(Long id) {
        SysRole role = roleMapper.selectById(id);
        if (role == null) {
            throw new BusinessException("角色不存在");
        }
        return role;
    }

    public Long create(RoleSaveRequest req) {
        ensureCodeUnique(req.getRoleCode(), null);
        SysRole role = new SysRole();
        role.setRoleName(req.getRoleName());
        role.setRoleCode(req.getRoleCode());
        role.setDataScope(req.getDataScope() == null ? "SELF" : req.getDataScope());
        role.setBuiltin(0);
        role.setSortOrder(req.getSortOrder() == null ? 0 : req.getSortOrder());
        role.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        role.setRemark(req.getRemark());
        roleMapper.insert(role);
        return role.getId();
    }

    public void update(Long id, RoleSaveRequest req) {
        SysRole existing = getById(id);
        boolean builtin = existing.getBuiltin() != null && existing.getBuiltin() == 1;
        if (builtin && !existing.getRoleCode().equals(req.getRoleCode())) {
            throw new BusinessException("内置角色编码不允许修改");
        }
        ensureCodeUnique(req.getRoleCode(), id);
        SysRole role = new SysRole();
        role.setId(id);
        role.setRoleName(req.getRoleName());
        role.setRoleCode(req.getRoleCode());
        role.setDataScope(req.getDataScope());
        role.setSortOrder(req.getSortOrder());
        role.setStatus(req.getStatus());
        role.setRemark(req.getRemark());
        roleMapper.updateById(role);
    }

    public void delete(Long id) {
        SysRole role = getById(id);
        if (role.getBuiltin() != null && role.getBuiltin() == 1) {
            throw new BusinessException("内置角色不允许删除");
        }
        if (userRoleMapper.countByRoleId(id) > 0) {
            throw new BusinessException("该角色仍有用户绑定，无法删除");
        }
        roleMapper.deleteById(id);
        roleMenuMapper.delete(Wrappers.<SysRoleMenu>lambdaQuery().eq(SysRoleMenu::getRoleId, id));
    }

    public void updateStatus(Long id, String status) {
        getById(id);
        SysRole update = new SysRole();
        update.setId(id);
        update.setStatus(status);
        roleMapper.updateById(update);
    }

    public List<Long> getMenuIds(Long roleId) {
        getById(roleId);
        return roleMenuMapper.selectMenuIdsByRoleId(roleId);
    }

    /**
     * 整体替换角色功能权限。修改后受影响用户的权限缓存将在其下次登录/刷新时重建。
     */
    @Transactional
    public void grantMenus(Long roleId, List<Long> menuIds) {
        getById(roleId);
        roleMenuMapper.delete(Wrappers.<SysRoleMenu>lambdaQuery().eq(SysRoleMenu::getRoleId, roleId));
        if (menuIds != null) {
            for (Long menuId : menuIds) {
                roleMenuMapper.insert(new SysRoleMenu(roleId, menuId));
            }
        }
    }

    private void ensureCodeUnique(String roleCode, Long excludeId) {
        long count = roleMapper.selectCount(Wrappers.<SysRole>lambdaQuery()
                .eq(SysRole::getRoleCode, roleCode)
                .ne(excludeId != null, SysRole::getId, excludeId));
        if (count > 0) {
            throw new BusinessException("角色编码已存在");
        }
    }
}
