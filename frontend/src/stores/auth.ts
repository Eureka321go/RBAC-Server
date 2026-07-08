import { defineStore } from 'pinia'
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from '@/utils/token'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: getAccessToken(),
    refreshToken: getRefreshToken(),
    tokenExpiresAt: 0,
    loginLoading: false,
  }),
  actions: {
    setTokens(accessToken: string, refreshToken: string, expiresAt = 0) {
      this.accessToken = accessToken
      this.refreshToken = refreshToken
      this.tokenExpiresAt = expiresAt
      setAccessToken(accessToken)
      setRefreshToken(refreshToken)
    },
    clearAuth() {
      this.accessToken = null
      this.refreshToken = null
      this.tokenExpiresAt = 0
      clearTokens()
    },
  },
})
