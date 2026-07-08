<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <el-result icon="warning" title="403" :sub-title="t('error.forbiddenSub')">
    <template #extra>
      <el-button type="primary" @click="$router.push('/')">{{ t('error.backHome') }}</el-button>
    </template>
  </el-result>
</template>
