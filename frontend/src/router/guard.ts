import type { Router } from 'vue-router'
import { getAccessToken } from '@/utils/token'
import { useAuthStore } from '@/stores/auth'
import { useUserStore } from '@/stores/user'
import { usePermissionStore } from '@/stores/permission'
import { ROOT_ROUTE_NAME } from './static-routes'

const whiteList = new Set(['/login'])

export function setupRouterGuard(router: Router) {
  router.beforeEach(async (to) => {
    const token = getAccessToken()

    // 已登录访问登录页 → 回首页
    if (whiteList.has(to.path)) {
      return token ? '/' : true
    }

    // 未登录 → 去登录页并带上回跳地址
    if (!token) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }

    const permissionStore = usePermissionStore()

    // 首次进入：加载用户信息、菜单、权限并注册动态路由
    if (!permissionStore.routesLoaded) {
      try {
        await useUserStore().fetchCurrentUser()
        const routes = await permissionStore.generateRoutes()
        routes.forEach((route) => router.addRoute(ROOT_ROUTE_NAME, route))
        // 按 path 重新解析：刷新深层路由时 to 匹配的是 404 catch-all，
        // 直接 { ...to } 会带上 name='not-found' 导致再次落到 404，
        // 用 fullPath 让 router 针对新注册的动态路由重新匹配。
        return { path: to.fullPath, replace: true }
      } catch {
        useAuthStore().clearAuth()
        return { path: '/login', query: { redirect: to.fullPath } }
      }
    }

    // 按钮/页面权限二次校验
    const permissionCode = to.meta?.permissionCode as string | undefined
    if (permissionCode && !permissionStore.hasPermission(permissionCode)) {
      return '/403'
    }

    return true
  })
}
