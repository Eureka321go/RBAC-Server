import { defineStore } from 'pinia'
import { ref } from 'vue'
import { applyPrimary } from '@/utils/theme'

export type ThemeMode = 'light' | 'dark' | 'auto'

export const SETTINGS_STORAGE_KEY = 'app-settings'
const DEFAULT_PRIMARY = '#2563eb'

const prefersDark = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

/** 外观设置：明暗模式、主题色，统一持久化与生效入口。 */
export const useSettingsStore = defineStore('settings', () => {
  const mode = ref<ThemeMode>('auto')
  const primary = ref<string>(DEFAULT_PRIMARY)
  const isDark = ref(false)

  function resolveDark(m: ThemeMode): boolean {
    return m === 'auto' ? prefersDark() : m === 'dark'
  }

  /** 生效：切换 <html.dark>、派生主题色、持久化。 */
  function applyTheme(): void {
    isDark.value = resolveDark(mode.value)
    document.documentElement.classList.toggle('dark', isDark.value)
    applyPrimary(primary.value, isDark.value)
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ mode: mode.value, primary: primary.value }),
    )
  }

  function setMode(m: ThemeMode): void {
    mode.value = m
    applyTheme()
  }

  function setPrimary(color: string): void {
    primary.value = color
    applyTheme()
  }

  /** 从本地存储恢复偏好。 */
  function hydrate(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{ mode: ThemeMode; primary: string }>
        if (saved.mode) mode.value = saved.mode
        if (saved.primary) primary.value = saved.primary
      }
    } catch {
      /* 忽略损坏的本地数据，用默认值 */
    }
    applyTheme()
  }

  // auto 模式下跟随系统切换
  if (window.matchMedia) {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (mode.value === 'auto') applyTheme()
      })
  }

  return { mode, primary, isDark, applyTheme, setMode, setPrimary, hydrate }
})
