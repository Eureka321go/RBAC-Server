import type { RouteRecordRaw } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import BasicLayout from '@/layouts/BasicLayout.vue'
import LoginView from '@/views/auth/LoginView.vue'
import DashboardView from '@/views/dashboard/DashboardView.vue'
import ForbiddenView from '@/views/error/ForbiddenView.vue'
import NotFoundView from '@/views/error/NotFoundView.vue'

/** 根布局路由名，动态路由通过 router.addRoute(ROOT_ROUTE_NAME, ...) 挂载。 */
export const ROOT_ROUTE_NAME = 'root'

export const staticRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: AuthLayout,
    children: [
      {
        path: '',
        name: 'login',
        component: LoginView,
        meta: { title: '登录' },
      },
    ],
  },
  {
    path: '/',
    name: ROOT_ROUTE_NAME,
    component: BasicLayout,
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: DashboardView,
        meta: { title: '控制台' },
      },
      {
        path: '403',
        name: 'forbidden',
        component: ForbiddenView,
        meta: { title: '无权限' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
    meta: { title: '页面不存在' },
  },
]
