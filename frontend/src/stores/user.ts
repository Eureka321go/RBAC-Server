import { defineStore } from 'pinia'
import type { CurrentUser } from '@/types/auth'

export const useUserStore = defineStore('user', {
  state: () => ({
    currentUser: null as CurrentUser | null,
  }),
  actions: {
    setCurrentUser(user: CurrentUser) {
      this.currentUser = user
    },
    clearUser() {
      this.currentUser = null
    },
  },
})
