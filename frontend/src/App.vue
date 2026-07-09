<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import { useLocaleStore } from '@/stores/locale'

const localeStore = useLocaleStore()
const elLocale = computed(() => (localeStore.current === 'zh-CN' ? zhCn : en))
</script>

<template>
  <el-config-provider :locale="elLocale">
    <RouterView />
  </el-config-provider>
</template>
