import type { Router } from 'vue-router'
import { getAccessToken } from '@/utils/token'

const whiteList = new Set(['/login'])

export function setupRouterGuard(router: Router) {
  router.beforeEach((to) => {
    const token = getAccessToken()

    if (whiteList.has(to.path)) {
      return token ? '/' : true
    }

    if (!token) {
      return {
        path: '/login',
        query: { redirect: to.fullPath },
      }
    }

    return true
  })
}
