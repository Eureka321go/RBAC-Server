<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { workflowLabelKey, workflowTagType, type WorkflowStatusGroup } from '@/utils/workflow'

const props = defineProps<{
  group: WorkflowStatusGroup
  value: string
}>()

const { t, te } = useI18n()
const label = computed(() => {
  const key = workflowLabelKey(props.group, props.value)
  return te(key) ? t(key) : props.value
})
</script>

<template>
  <el-tag :type="workflowTagType(group, value)" effect="light">{{ label }}</el-tag>
</template>
