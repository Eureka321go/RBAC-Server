<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getInstanceDetail } from '@/api/workflow/instance'
import WorkflowStatusTag from '@/components/workflow/WorkflowStatusTag.vue'
import type { WorkflowInstanceDetail } from '@/types/workflow'
import { formatWorkflowDate } from '@/utils/workflow'

const { t, te } = useI18n()
const visible = ref(false)
const loading = ref(false)
const detail = ref<WorkflowInstanceDetail>()

const formEntries = computed(() => {
  const formData = detail.value?.formData
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return []
  return Object.entries(formData as Record<string, unknown>)
})

function displayValue(value: unknown) {
  if (value == null) return '-'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function actionLabel(action: string) {
  const key = `workflow.action.${action}`
  return te(key) ? t(key) : action
}

async function open(instanceId: number) {
  loading.value = true
  try {
    detail.value = await getInstanceDetail(instanceId)
    visible.value = true
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <el-drawer v-model="visible" :title="t('workflow.detail.title')" size="min(760px, 92vw)">
    <div v-loading="loading">
      <el-descriptions v-if="detail" :column="2" border class="mb-5">
        <el-descriptions-item :label="t('workflow.common.title')">{{ detail.title }}</el-descriptions-item>
        <el-descriptions-item :label="t('workflow.common.status')">
          <WorkflowStatusTag group="instance" :value="detail.instanceStatus" />
        </el-descriptions-item>
        <el-descriptions-item :label="t('workflow.common.processKey')">{{ detail.processKey }}</el-descriptions-item>
        <el-descriptions-item :label="t('workflow.common.initiator')">
          {{ detail.initiatorName || detail.initiatorId }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('workflow.common.businessKey')">{{ detail.businessKey || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="t('workflow.common.submitTime')">
          {{ formatWorkflowDate(detail.submitTime) }}
        </el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">{{ t('workflow.detail.formSnapshot') }}</el-divider>
      <el-table v-if="formEntries.length" :data="formEntries" border size="small" class="mb-5">
        <el-table-column prop="0" :label="t('workflow.form.fieldName')" min-width="140" />
        <el-table-column :label="t('workflow.form.fieldValue')" min-width="260">
          <template #default="{ row }"><pre class="whitespace-pre-wrap font-sans">{{ displayValue(row[1]) }}</pre></template>
        </el-table-column>
      </el-table>
      <el-empty v-else :description="t('workflow.detail.noFormData')" :image-size="64" />

      <el-divider content-position="left">{{ t('workflow.detail.tasks') }}</el-divider>
      <el-table :data="detail?.tasks ?? []" border size="small" class="mb-5">
        <el-table-column prop="nodeOrder" :label="t('workflow.node.order')" width="80" />
        <el-table-column prop="nodeName" :label="t('workflow.node.name')" min-width="150" />
        <el-table-column :label="t('workflow.common.assignee')" min-width="120">
          <template #default="{ row }">{{ row.assigneeName || row.assigneeId }}</template>
        </el-table-column>
        <el-table-column :label="t('workflow.common.status')" width="110">
          <template #default="{ row }"><WorkflowStatusTag group="task" :value="row.taskStatus" /></template>
        </el-table-column>
        <el-table-column :label="t('workflow.common.handleTime')" min-width="170">
          <template #default="{ row }">{{ formatWorkflowDate(row.approveTime) }}</template>
        </el-table-column>
      </el-table>

      <el-divider content-position="left">{{ t('workflow.detail.timeline') }}</el-divider>
      <el-timeline v-if="detail?.records.length">
        <el-timeline-item
          v-for="record in detail.records"
          :key="record.id"
          :timestamp="formatWorkflowDate(record.operateTime)"
          placement="top"
        >
          <div class="font-medium">{{ record.operatorName || record.operatorId }} · {{ actionLabel(record.action) }}</div>
          <div v-if="record.comment" class="mt-1 text-sm text-[var(--app-text-secondary)]">{{ record.comment }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else :description="t('workflow.detail.noRecords')" :image-size="64" />
    </div>
  </el-drawer>
</template>
