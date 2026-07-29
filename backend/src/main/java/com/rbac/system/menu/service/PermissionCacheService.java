package com.rbac.system.menu.service;

import com.rbac.system.menu.mapper.SysMenuMapper;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 用户权限标识缓存（Cache Aside）。
 *
 * <p>权限集合读多写少，是天然缓存点：登录装配 {@code LoginUser} 时命中缓存，
 * 避免每次都联表查菜单。角色授权/用户角色变化时精准失效对应用户。
 *
 * <p>注意：此缓存只影响“新请求解析到的权限集”，与“旧 Token 是否失效”正交——
 * Token 失效仍由 {@code TokenSessionService} 黑名单负责，二者互不替代。
 */
@Service
public class PermissionCacheService {

    private final SysMenuMapper menuMapper;

    public PermissionCacheService(SysMenuMapper menuMapper) {
        this.menuMapper = menuMapper;
    }

    /** 普通用户权限集合；缓存空集合以防穿透。 */
    @Cacheable(cacheNames = "userPerms", key = "#userId")
    public List<String> loadUserPermissions(Long userId) {
        return menuMapper.selectPermissionCodesByUserId(userId);
    }

    /** 超管全量权限。 */
    @Cacheable(cacheNames = "allPerms", key = "'ALL'")
    public List<String> loadAllPermissions() {
        return menuMapper.selectAllPermissionCodes();
    }

    /** 失效单个用户的权限缓存（用户改角色时调用）。 */
    @CacheEvict(cacheNames = "userPerms", key = "#userId")
    public void evictUser(Long userId) {
    }

    /** 失效全部权限缓存（角色改权限、影响面大时调用）。 */
    @CacheEvict(cacheNames = {"userPerms", "allPerms"}, allEntries = true)
    public void evictAll() {
    }
}
