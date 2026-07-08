import { defineStore } from 'pinia'
import type { RouteRecordRaw } from 'vue-router'
import type { MenuItem } from '@/types/menu'

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    menus: [] as MenuItem[],
    routes: [] as RouteRecordRaw[],
    permissionCodes: [] as string[],
    routesLoaded: false,
  }),
  actions: {
    setMenus(menus: MenuItem[]) {
      this.menus = menus
    },
    setRoutes(routes: RouteRecordRaw[]) {
      this.routes = routes
      this.routesLoaded = true
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
      this.routes = []
      this.routesLoaded = false
    },
  },
})
