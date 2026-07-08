<script setup lang="ts">
import { computed } from 'vue'
import { usePermissionStore } from '@/stores/permission'

const props = defineProps<{
  permission: string | string[]
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
}>()

const permissionStore = usePermissionStore()
const visible = computed(() => {
  return Array.isArray(props.permission)
    ? permissionStore.hasAnyPermission(props.permission)
    : permissionStore.hasPermission(props.permission)
})
</script>

<template>
  <el-button v-if="visible" :type="type">
    <slot />
  </el-button>
</template>
