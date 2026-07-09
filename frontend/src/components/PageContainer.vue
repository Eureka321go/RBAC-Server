<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="flex w-full flex-col gap-4">
    <header class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-[22px] font-semibold tracking-tight text-[var(--app-text)]">{{ title }}</h1>
        <p v-if="description" class="text-sm text-[var(--app-text-secondary)]">{{ description }}</p>
      </div>
      <div v-if="$slots.extra" class="shrink-0">
        <slot name="extra" />
      </div>
    </header>

    <div class="app-panel rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-sm">
      <slot />
    </div>
  </section>
</template>

<style scoped>
/* 面板内元素之间的呼吸感：搜索区与表格的分隔 */
.app-panel :deep(.el-form--inline) {
  padding-bottom: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.app-panel :deep(.el-form--inline .el-form-item) {
  margin-bottom: 12px;
}
</style>
