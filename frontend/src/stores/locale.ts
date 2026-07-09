import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getInitialLocale, i18n, LOCALE_STORAGE_KEY, type LocaleKey } from '@/locales'

/** 语言状态：统一切换入口，同步 vue-i18n、<html lang> 与本地存储。 */
export const useLocaleStore = defineStore('locale', () => {
  const current = ref<LocaleKey>(getInitialLocale())

  function setLocale(locale: LocaleKey) {
    current.value = locale
    i18n.global.locale.value = locale
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    document.documentElement.setAttribute('lang', locale)
  }

  // 首屏同步一次 <html lang>
  document.documentElement.setAttribute('lang', current.value)

  return { current, setLocale }
})
