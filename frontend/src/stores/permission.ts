import { defineStore } from 'pinia'
import type { RouteRecordRaw } from 'vue-router'
import { getAuthMenus, getAuthPermissions } from '@/api/auth'
import { buildDynamicRoutes } from '@/router/dynamic-routes'
import type { MenuItem } from '@/types/menu'

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    menus: [] as MenuItem[],
    routes: [] as RouteRecordRaw[],
    permissionCodes: [] as string[],
    routesLoaded: false,
  }),
  actions: {
    /** 拉取菜单+权限，构建动态路由并返回，供导航守卫注册。 */
    async generateRoutes(): Promise<RouteRecordRaw[]> {
      const [menus, permissions] = await Promise.all([getAuthMenus(), getAuthPermissions()])
      this.menus = menus
      this.permissionCodes = permissions
      this.routes = buildDynamicRoutes(menus)
      this.routesLoaded = true
      return this.routes
    },
    setMenus(menus: MenuItem[]) {
      this.menus = menus
    },
    setPermissionCodes(codes: string[]) {
      this.permissionCodes = codes
    },
    hasPermission(code: string) {
      return this.permissionCodes.includes(code)
    },
    hasAnyPermission(codes: string[]) {
      return codes.some((code) => this.hasPermission(code))
    },
    hasAllPermissions(codes: string[]) {
      return codes.every((code) => this.hasPermission(code))
    },
    resetRoutes() {
      this.menus = []
      this.routes = []
      this.permissionCodes = []
      this.routesLoaded = false
    },
  },
})
