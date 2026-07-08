<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="space-y-4">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-slate-900">{{ title }}</h1>
      <p v-if="description" class="text-sm text-slate-500">{{ description }}</p>
    </header>

    <div class="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <slot />
    </div>
  </section>
</template>
