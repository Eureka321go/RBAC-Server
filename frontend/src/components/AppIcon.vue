<script setup lang="ts">
defineProps<{
  name?: string
}>()
</script>

<template>
  <span class="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
    {{ name?.slice(0, 1).toUpperCase() || 'M' }}
  </span>
</template>
