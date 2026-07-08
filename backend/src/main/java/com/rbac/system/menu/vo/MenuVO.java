package com.rbac.system.menu.vo;

import com.rbac.system.menu.entity.SysMenu;
import lombok.Data;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 菜单视图对象（camelCase，枚举字符串），用于菜单树与动态路由。
 */
@Data
public class MenuVO {

    private Long id;
    private Long parentId;
    private String menuType;
    private String menuName;
    private String path;
    private String component;
    private String permissionCode;
    private String icon;
    private Boolean visible;
    private Boolean keepAlive;
    private String externalLink;
    private Integer sortOrder;
    private String status;
    private List<MenuVO> children = new ArrayList<>();

    public static MenuVO from(SysMenu m) {
        MenuVO vo = new MenuVO();
        vo.setId(m.getId());
        vo.setParentId(m.getParentId());
        vo.setMenuType(m.getMenuType());
        vo.setMenuName(m.getMenuName());
        vo.setPath(m.getPath());
        vo.setComponent(m.getComponent());
        vo.setPermissionCode(m.getPermissionCode());
        vo.setIcon(m.getIcon());
        vo.setVisible(m.getVisible() != null && m.getVisible() == 1);
        vo.setKeepAlive(m.getKeepAlive() != null && m.getKeepAlive() == 1);
        vo.setExternalLink(m.getExternalLink());
        vo.setSortOrder(m.getSortOrder());
        vo.setStatus(m.getStatus());
        return vo;
    }

    /**
     * 将扁平菜单列表构建为树。parentId 为 0 或不在列表中的作为根节点。
     */
    public static List<MenuVO> buildTree(List<SysMenu> menus) {
        List<MenuVO> all = menus.stream().map(MenuVO::from).collect(Collectors.toList());
        Map<Long, MenuVO> byId = all.stream().collect(Collectors.toMap(MenuVO::getId, v -> v));
        List<MenuVO> roots = new ArrayList<>();
        for (MenuVO node : all) {
            Long pid = node.getParentId();
            MenuVO parent = pid == null ? null : byId.get(pid);
            if (parent != null) {
                parent.getChildren().add(node);
            } else {
                roots.add(node);
            }
        }
        sort(roots);
        return roots;
    }

    private static void sort(List<MenuVO> nodes) {
        nodes.sort(Comparator.comparing(v -> v.getSortOrder() == null ? 0 : v.getSortOrder()));
        for (MenuVO n : nodes) {
            if (!n.getChildren().isEmpty()) {
                sort(n.getChildren());
            }
        }
    }
}
