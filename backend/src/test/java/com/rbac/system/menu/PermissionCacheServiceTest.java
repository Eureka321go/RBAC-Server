package com.rbac.system.menu;

import com.rbac.system.menu.mapper.SysMenuMapper;
import com.rbac.system.menu.service.PermissionCacheService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.cache.CacheType;
import org.springframework.boot.test.autoconfigure.core.AutoConfigureCache;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Import;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest(classes = {PermissionCacheService.class, PermissionCacheServiceTest.CacheTestConfig.class})
// cacheProvider 显式指定 SIMPLE：@AutoConfigureCache 默认装的是 NoOpCacheManager（真正禁用缓存），
// 必须显式选 SIMPLE 才会用内存 ConcurrentMapCacheManager，真实验证 @Cacheable 生效。
@AutoConfigureCache(cacheProvider = CacheType.SIMPLE)
class PermissionCacheServiceTest {

    @EnableCaching
    static class CacheTestConfig { }

    @Autowired
    PermissionCacheService service;

    @MockBean
    SysMenuMapper menuMapper;

    @Test
    void userPermissionsAreCachedAfterFirstLoad() {
        when(menuMapper.selectPermissionCodesByUserId(9L)).thenReturn(List.of("user:list"));

        List<String> first = service.loadUserPermissions(9L);
        List<String> second = service.loadUserPermissions(9L);

        assertThat(first).containsExactly("user:list");
        assertThat(second).containsExactly("user:list");
        verify(menuMapper, times(1)).selectPermissionCodesByUserId(9L);  // 第二次走缓存
    }
}
