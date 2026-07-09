import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import permission from './directives/permission'
import router from './router'
import { i18n } from './locales'
import { useSettingsStore } from './stores/settings'

const app = createApp(App)

// 全局注册 Element Plus 图标，模板中可直接以字符串名引用（如 icon="Search"）
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

const pinia = createPinia()
app.use(pinia)
app.use(i18n)
app.use(ElementPlus)
app.use(router)
app.directive('permission', permission)

// 挂载前恢复外观偏好（明暗模式、主题色），与首屏防闪烁脚本保持一致
useSettingsStore(pinia).hydrate()

app.mount('#app')
