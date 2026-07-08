import { defineStore } from 'pinia'

export interface TabItem {
  path: string
  title: string
}

export const useTabsStore = defineStore('tabs', {
  state: () => ({
    tabs: [] as TabItem[],
  }),
  actions: {
    addTab(tab: TabItem) {
      if (!this.tabs.some((item) => item.path === tab.path)) {
        this.tabs.push(tab)
      }
    },
    closeTab(path: string) {
      this.tabs = this.tabs.filter((tab) => tab.path !== path)
    },
    clearTabs() {
      this.tabs = []
    },
  },
})
