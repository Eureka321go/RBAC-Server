import { defineStore } from 'pinia'
import { login as loginApi, logout as logoutApi } from '@/api/auth'
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from '@/utils/token'
import { useUserStore } from '@/stores/user'
import { usePermissionStore } from '@/stores/permission'
import type { LoginParams } from '@/types/auth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: getAccessToken(),
    refreshToken: getRefreshToken(),
    tokenExpiresAt: 0,
    loginLoading: false,
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.accessToken),
  },
  actions: {
    setTokens(accessToken: string, refreshToken: string, expiresAt = 0) {
      this.accessToken = accessToken
      this.refreshToken = refreshToken
      this.tokenExpiresAt = expiresAt
      setAccessToken(accessToken)
      setRefreshToken(refreshToken)
    },

    async login(params: LoginParams) {
      this.loginLoading = true
      try {
        const result = await loginApi(params)
        const expiresAt = Date.now() + result.expiresIn * 1000
        this.setTokens(result.accessToken, result.refreshToken, expiresAt)
      } finally {
        this.loginLoading = false
      }
    },

    async logout() {
      try {
        await logoutApi()
      } catch {
        // 忽略登出接口错误，本地状态照常清理
      }
      this.clearAuth()
    },

    clearAuth() {
      this.accessToken = null
      this.refreshToken = null
      this.tokenExpiresAt = 0
      clearTokens()
      useUserStore().clearUser()
      usePermissionStore().resetRoutes()
    },
  },
})
