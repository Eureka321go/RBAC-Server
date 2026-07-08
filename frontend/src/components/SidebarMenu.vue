<script setup lang="ts">
import type { MenuItem } from '@/types/menu'

defineProps<{
  items: MenuItem[]
  basePath?: string
}>()

/** 拼接父子路径，子路径以 / 开头则视为绝对路径。 */
function resolvePath(base: string | undefined, path: string): string {
  if (path.startsWith('/')) return path
  const b = (base ?? '').replace(/\/+$/, '')
  return `${b}/${path}`.replace(/\/{2,}/g, '/')
}

function isVisible(item: MenuItem): boolean {
  return item.visible && item.status === 'ENABLED' && item.menuType !== 'BUTTON'
}

function hasChildren(item: MenuItem): boolean {
  return Boolean(item.children && item.children.some(isVisible))
}

/** 图标回退：无 icon 时用 Menu，避免菜单项缩进不齐。 */
function iconOf(item: MenuItem): string {
  return item.icon || 'Menu'
}
</script>

<template>
  <template v-for="item in items" :key="item.id">
    <template v-if="isVisible(item)">
      <el-sub-menu v-if="hasChildren(item)" :index="resolvePath(basePath, item.path)">
        <template #title>
          <el-icon><component :is="iconOf(item)" /></el-icon>
          <span>{{ item.menuName }}</span>
        </template>
        <SidebarMenu :items="item.children ?? []" :base-path="resolvePath(basePath, item.path)" />
      </el-sub-menu>
      <el-menu-item v-else :index="resolvePath(basePath, item.path)">
        <el-icon><component :is="iconOf(item)" /></el-icon>
        <template #title>{{ item.menuName }}</template>
      </el-menu-item>
    </template>
  </template>
</template>
