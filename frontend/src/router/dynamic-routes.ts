import type { RouteRecordRaw } from 'vue-router'
import type { MenuItem } from '@/types/menu'
import { menuToRoute } from '@/utils/route'

export function buildDynamicRoutes(menus: MenuItem[]): RouteRecordRaw[] {
  return menus.map(menuToRoute).filter((route): route is RouteRecordRaw => Boolean(route))
}
