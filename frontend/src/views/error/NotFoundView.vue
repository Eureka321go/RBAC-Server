<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <el-result icon="info" title="404" :sub-title="t('error.notFoundSub')">
    <template #extra>
      <el-button type="primary" @click="$router.push('/')">{{ t('error.backHome') }}</el-button>
    </template>
  </el-result>
</template>
