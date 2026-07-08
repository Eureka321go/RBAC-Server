<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import SidebarMenu from '@/components/SidebarMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useUserStore } from '@/stores/user'
import { usePermissionStore } from '@/stores/permission'
import { useSettingsStore, type ThemeMode } from '@/stores/settings'
import { useLocaleStore } from '@/stores/locale'
import { SUPPORT_LOCALES, type LocaleKey } from '@/locales'

const { t } = useI18n()
const route = useRoute()
const authStore = useAuthStore()
const userStore = useUserStore()
const permissionStore = usePermissionStore()
const settings = useSettingsStore()
const localeStore = useLocaleStore()

const activePath = computed(() => route.path)
const menus = computed(() => permissionStore.menus)
const nickname = computed(() => userStore.currentUser?.nickname ?? t('layout.notLoggedIn'))
const avatarText = computed(() => nickname.value.slice(0, 1) || 'U')
const breadcrumbs = computed(() =>
  route.matched.filter((r) => r.meta?.title).map((r) => r.meta.title as string),
)

const themeModes: { value: ThemeMode; icon: string }[] = [
  { value: 'light', icon: 'Sunny' },
  { value: 'dark', icon: 'Moon' },
  { value: 'auto', icon: 'Monitor' },
]

function handleLocale(locale: LocaleKey) {
  localeStore.setLocale(locale)
}

function handleThemeMode(mode: ThemeMode) {
  settings.setMode(mode)
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm(t('layout.logoutConfirm'), t('common.tip'), {
      confirmButtonText: t('layout.logoutButton'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
  } catch {
    return
  }
  await authStore.logout()
  // 整页跳转以彻底清理已注册的动态路由
  window.location.href = '/login'
}
</script>

<template>
  <div class="flex min-h-screen bg-[var(--app-bg)]">
    <!-- 侧边栏 -->
    <aside
      class="fixed inset-y-0 left-0 z-20 flex flex-col border-r border-[var(--app-border)] bg-[var(--app-surface)]"
      :style="{ width: 'var(--app-sidebar-width)' }"
    >
      <div class="flex h-[60px] items-center gap-2.5 px-5">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm"
        >
          R
        </div>
        <div class="leading-tight">
          <div class="text-[15px] font-semibold text-[var(--app-text)]">{{ t('common.appName') }}</div>
          <div class="text-[11px] text-[var(--app-text-secondary)]">{{ t('common.appSubtitle') }}</div>
        </div>
      </div>

      <el-scrollbar class="flex-1 border-t border-[var(--app-border)]">
        <el-menu :default-active="activePath" router unique-opened class="app-menu">
          <el-menu-item index="/dashboard">
            <el-icon><HomeFilled /></el-icon>
            <template #title>{{ t('common.dashboard') }}</template>
          </el-menu-item>
          <SidebarMenu :items="menus" />
        </el-menu>
      </el-scrollbar>
    </aside>

    <!-- 主区域 -->
    <div class="flex min-h-screen flex-1 flex-col" :style="{ marginLeft: 'var(--app-sidebar-width)' }">
      <header
        class="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 backdrop-blur"
      >
        <el-breadcrumb separator="/" class="app-breadcrumb">
          <el-breadcrumb-item v-for="(title, idx) in breadcrumbs" :key="idx">
            {{ title }}
          </el-breadcrumb-item>
        </el-breadcrumb>

        <div class="flex items-center gap-1">
          <!-- 主题切换 -->
          <el-dropdown trigger="click" @command="handleThemeMode">
            <span class="header-action" :title="t('theme.title')">
              <el-icon :size="18">
                <Moon v-if="settings.isDark" />
                <Sunny v-else />
              </el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="m in themeModes"
                  :key="m.value"
                  :command="m.value"
                  :class="{ 'is-active-choice': settings.mode === m.value }"
                >
                  <el-icon><component :is="m.icon" /></el-icon>
                  <span class="ml-1.5">{{ t(`theme.${m.value}`) }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <!-- 语言切换 -->
          <el-dropdown trigger="click" @command="handleLocale">
            <span class="header-action" :title="t('locale.title')">
              <el-icon :size="18"><Operation /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="l in SUPPORT_LOCALES"
                  :key="l.value"
                  :command="l.value"
                  :class="{ 'is-active-choice': localeStore.current === l.value }"
                >
                  {{ l.label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <!-- 用户 -->
          <el-dropdown>
            <span
              class="ml-1 flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition hover:bg-[var(--app-surface-2)]"
            >
              <span
                class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white"
              >
                {{ avatarText }}
              </span>
              <span class="text-sm font-medium text-[var(--app-text)]">{{ nickname }}</span>
              <span class="text-xs text-[var(--app-text-secondary)]">▾</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleLogout">{{ t('layout.logout') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="flex-1 px-6 py-5">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* 顶栏图标按钮 */
.header-action {
  display: flex;
  height: 34px;
  width: 34px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--el-text-color-regular);
  transition: background 0.15s ease;
}
.header-action:hover {
  background: var(--app-surface-2);
  color: var(--el-color-primary);
}
.is-active-choice {
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 侧边菜单：胶囊态、激活高亮 */
.app-menu {
  border-right: none;
  padding: 10px;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: var(--el-text-color-regular);
  --el-menu-hover-bg-color: var(--app-surface-2);
  --el-menu-active-color: var(--el-color-primary);
}
.app-menu :deep(.el-menu-item),
.app-menu :deep(.el-sub-menu__title) {
  height: 44px;
  line-height: 44px;
  margin: 4px 0;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}
.app-menu :deep(.el-icon) {
  font-size: 17px;
}
.app-menu :deep(.el-sub-menu .el-menu) {
  padding-left: 4px;
}
.app-menu :deep(.el-menu-item:hover),
.app-menu :deep(.el-sub-menu__title:hover) {
  background: var(--app-surface-2);
}
.app-menu :deep(.el-menu-item.is-active) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.app-menu :deep(.el-sub-menu .el-menu-item) {
  min-width: auto;
}
.app-menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: var(--el-color-primary);
}

.app-breadcrumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--app-text);
  font-weight: 600;
}
</style>
