import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'

export const SUPPORT_LOCALES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
] as const

export type LocaleKey = (typeof SUPPORT_LOCALES)[number]['value']

export const LOCALE_STORAGE_KEY = 'app-locale'

/** 首屏语言：本地存储 > 浏览器语言 > 默认简体中文。 */
export function getInitialLocale(): LocaleKey {
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as LocaleKey | null
  if (saved && SUPPORT_LOCALES.some((l) => l.value === saved)) return saved
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'
}

export const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})
