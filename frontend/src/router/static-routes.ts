import type { RouteRecordRaw } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import BasicLayout from '@/layouts/BasicLayout.vue'
import LoginView from '@/views/auth/LoginView.vue'
import DashboardView from '@/views/dashboard/DashboardView.vue'
import ForbiddenView from '@/views/error/ForbiddenView.vue'
import NotFoundView from '@/views/error/NotFoundView.vue'
import ConfigView from '@/views/system/config/ConfigView.vue'
import DeptView from '@/views/system/dept/DeptView.vue'
import DictView from '@/views/system/dict/DictView.vue'
import LogView from '@/views/system/log/LogView.vue'
import MenuView from '@/views/system/menu/MenuView.vue'
import PostView from '@/views/system/post/PostView.vue'
import RoleView from '@/views/system/role/RoleView.vue'
import UserView from '@/views/system/user/UserView.vue'

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
      {
        path: 'system/user',
        name: 'system-user',
        component: UserView,
        meta: { title: '用户管理', permissionCode: 'system:user:list' },
      },
      {
        path: 'system/role',
        name: 'system-role',
        component: RoleView,
        meta: { title: '角色管理', permissionCode: 'system:role:list' },
      },
      {
        path: 'system/menu',
        name: 'system-menu',
        component: MenuView,
        meta: { title: '菜单管理', permissionCode: 'system:menu:list' },
      },
      {
        path: 'system/dept',
        name: 'system-dept',
        component: DeptView,
        meta: { title: '部门管理', permissionCode: 'system:dept:list' },
      },
      {
        path: 'system/post',
        name: 'system-post',
        component: PostView,
        meta: { title: '岗位管理' },
      },
      {
        path: 'system/config',
        name: 'system-config',
        component: ConfigView,
        meta: { title: '参数配置' },
      },
      {
        path: 'system/dict',
        name: 'system-dict',
        component: DictView,
        meta: { title: '字典管理' },
      },
      {
        path: 'system/log',
        name: 'system-log',
        component: LogView,
        meta: { title: '日志审计' },
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
