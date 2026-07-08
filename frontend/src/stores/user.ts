import { defineStore } from 'pinia'
import { getCurrentUser } from '@/api/auth'
import type { CurrentUser } from '@/types/auth'

export const useUserStore = defineStore('user', {
  state: () => ({
    currentUser: null as CurrentUser | null,
  }),
  getters: {
    loaded: (state) => state.currentUser !== null,
  },
  actions: {
    async fetchCurrentUser() {
      this.currentUser = await getCurrentUser()
      return this.currentUser
    },
    setCurrentUser(user: CurrentUser) {
      this.currentUser = user
    },
    clearUser() {
      this.currentUser = null
    },
  },
})
