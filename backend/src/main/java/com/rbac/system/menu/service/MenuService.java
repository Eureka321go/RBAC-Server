package com.rbac.system.menu.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.menu.dto.MenuSaveRequest;
import com.rbac.system.menu.entity.SysMenu;
import com.rbac.system.menu.mapper.SysMenuMapper;
import com.rbac.system.menu.vo.MenuVO;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 菜单管理服务：菜单树 CRUD。菜单属系统级配置，仅做功能权限控制。
 */
@Service
public class MenuService {

    private final SysMenuMapper menuMapper;

    public MenuService(SysMenuMapper menuMapper) {
        this.menuMapper = menuMapper;
    }

    /** 完整菜单树（含按钮），用于菜单管理页。 */
    public List<MenuVO> tree() {
        List<SysMenu> all = menuMapper.selectList(Wrappers.<SysMenu>lambdaQuery()
                .orderByAsc(SysMenu::getSortOrder));
        return MenuVO.buildTree(all);
    }

    public SysMenu getById(Long id) {
        SysMenu menu = menuMapper.selectById(id);
        if (menu == null) {
            throw new BusinessException("菜单不存在");
        }
        return menu;
    }

    public Long create(MenuSaveRequest req) {
        SysMenu menu = new SysMenu();
        apply(menu, req);
        menuMapper.insert(menu);
        return menu.getId();
    }

    public void update(Long id, MenuSaveRequest req) {
        SysMenu menu = getById(id);
        if (req.getParentId() != null && req.getParentId().equals(id)) {
            throw new BusinessException("父菜单不能是自身");
        }
        apply(menu, req);
        menu.setId(id);
        menuMapper.updateById(menu);
    }

    public void delete(Long id) {
        getById(id);
        long children = menuMapper.selectCount(Wrappers.<SysMenu>lambdaQuery().eq(SysMenu::getParentId, id));
        if (children > 0) {
            throw new BusinessException("存在子菜单，无法删除");
        }
        menuMapper.deleteById(id);
    }

    public void updateStatus(Long id, String status) {
        getById(id);
        SysMenu update = new SysMenu();
        update.setId(id);
        update.setStatus(status);
        menuMapper.updateById(update);
    }

    private void apply(SysMenu menu, MenuSaveRequest req) {
        menu.setParentId(req.getParentId() == null ? 0L : req.getParentId());
        menu.setMenuType(req.getMenuType());
        menu.setMenuName(req.getMenuName());
        menu.setPath(req.getPath());
        menu.setComponent(req.getComponent());
        menu.setPermissionCode(req.getPermissionCode());
        menu.setIcon(req.getIcon());
        menu.setSortOrder(req.getSortOrder() == null ? 0 : req.getSortOrder());
        menu.setVisible(Boolean.FALSE.equals(req.getVisible()) ? 0 : 1);
        menu.setKeepAlive(Boolean.TRUE.equals(req.getKeepAlive()) ? 1 : 0);
        menu.setExternalLink(req.getExternalLink());
        menu.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
    }
}
