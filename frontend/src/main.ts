import 'element-plus/dist/index.css'
import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import permission from './directives/permission'
import router from './router'

const app = createApp(App)

// 全局注册 Element Plus 图标，模板中可直接以字符串名引用（如 icon="Search"）
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(createPinia())
app.use(ElementPlus)
app.use(router)
app.directive('permission', permission)

app.mount('#app')
