import { h, type Component } from 'vue'
import { RouterView } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import type { MenuItem } from '@/types/menu'

const viewModules = import.meta.glob<Component>('../views/**/*.vue')
const NestedRouteView = { render: () => h(RouterView) }

export function resolveView(component?: string) {
  if (!component) return undefined

  return viewModules[`../views/${component}.vue`]
}

export function menuToRoute(menu: MenuItem): RouteRecordRaw | null {
  if (menu.status !== 'ENABLED' || !menu.visible || menu.menuType === 'BUTTON') {
    return null
  }

  const component = resolveView(menu.component) ?? NestedRouteView

  return {
    path: menu.path,
    name: String(menu.id),
    component,
    meta: {
      title: menu.menuName,
      icon: menu.icon,
      keepAlive: menu.keepAlive,
      permissionCode: menu.permissionCode,
    },
    children: menu.children?.map(menuToRoute).filter((route): route is RouteRecordRaw => Boolean(route)),
  }
}
