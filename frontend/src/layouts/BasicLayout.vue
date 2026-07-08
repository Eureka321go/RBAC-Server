<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import SidebarMenu from '@/components/SidebarMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useUserStore } from '@/stores/user'
import { usePermissionStore } from '@/stores/permission'

const route = useRoute()
const authStore = useAuthStore()
const userStore = useUserStore()
const permissionStore = usePermissionStore()

const activePath = computed(() => route.path)
const menus = computed(() => permissionStore.menus)
const nickname = computed(() => userStore.currentUser?.nickname ?? '未登录')
const avatarText = computed(() => nickname.value.slice(0, 1) || 'U')
const breadcrumbs = computed(() =>
  route.matched.filter((r) => r.meta?.title).map((r) => r.meta.title as string),
)

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确认退出登录？', '提示', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
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
  <div class="flex min-h-screen bg-slate-100">
    <!-- 侧边栏 -->
    <aside
      class="fixed inset-y-0 left-0 z-20 flex flex-col border-r border-slate-200 bg-white"
      :style="{ width: 'var(--app-sidebar-width)' }"
    >
      <div class="flex h-[60px] items-center gap-2.5 px-5">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm"
        >
          R
        </div>
        <div class="leading-tight">
          <div class="text-[15px] font-semibold text-slate-900">RBAC Admin</div>
          <div class="text-[11px] text-slate-400">权限管理系统</div>
        </div>
      </div>

      <el-scrollbar class="flex-1 border-t border-slate-100">
        <el-menu :default-active="activePath" router unique-opened class="app-menu">
          <el-menu-item index="/dashboard">
            <el-icon><HomeFilled /></el-icon>
            <template #title>控制台</template>
          </el-menu-item>
          <SidebarMenu :items="menus" />
        </el-menu>
      </el-scrollbar>
    </aside>

    <!-- 主区域 -->
    <div class="flex min-h-screen flex-1 flex-col" :style="{ marginLeft: 'var(--app-sidebar-width)' }">
      <header
        class="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur"
      >
        <el-breadcrumb separator="/" class="app-breadcrumb">
          <el-breadcrumb-item v-for="(title, idx) in breadcrumbs" :key="idx">
            {{ title }}
          </el-breadcrumb-item>
        </el-breadcrumb>

        <el-dropdown>
          <span
            class="flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition hover:bg-slate-100"
          >
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white"
            >
              {{ avatarText }}
            </span>
            <span class="text-sm font-medium text-slate-700">{{ nickname }}</span>
            <span class="text-xs text-slate-400">▾</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="handleLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="flex-1 px-6 py-5">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* 侧边菜单：胶囊态、激活高亮 */
.app-menu {
  border-right: none;
  padding: 10px;
  --el-menu-bg-color: #ffffff;
  --el-menu-text-color: #475569;
  --el-menu-hover-bg-color: #f1f5f9;
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
  background: #f1f5f9;
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
  color: #1e293b;
  font-weight: 600;
}
</style>
