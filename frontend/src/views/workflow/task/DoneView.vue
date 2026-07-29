<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import WorkflowStatusTag from '@/components/workflow/WorkflowStatusTag.vue'
import DetailDrawer from '@/views/workflow/instance/DetailDrawer.vue'
import { listDoneTasks } from '@/api/workflow/task'
import type { WorkflowTask, WorkflowTaskQuery } from '@/types/workflow'
import { formatWorkflowDate } from '@/utils/workflow'

const { t } = useI18n()
const loading = ref(false)
const rows = ref<WorkflowTask[]>([])
const total = ref(0)
const query = reactive<WorkflowTaskQuery>({ page: 1, pageSize: 10 })
const detailDrawer = ref<InstanceType<typeof DetailDrawer>>()

async function loadData() {
  loading.value = true
  try {
    const result = await listDoneTasks(query)
    rows.value = result.records
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function resetPageAndLoad() {
  query.page = 1
  loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('workflow.task.doneTitle')" :description="t('workflow.task.doneDescription')">
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="title" :label="t('workflow.common.title')" min-width="220" />
      <el-table-column prop="processKey" :label="t('workflow.common.processKey')" min-width="120" />
      <el-table-column prop="initiatorName" :label="t('workflow.common.initiator')" min-width="120" />
      <el-table-column prop="nodeName" :label="t('workflow.task.currentNode')" min-width="150" />
      <el-table-column :label="t('common.status')" width="110"><template #default="{ row }"><WorkflowStatusTag group="task" :value="row.taskStatus" /></template></el-table-column>
      <el-table-column :label="t('workflow.common.handleTime')" min-width="170"><template #default="{ row }">{{ formatWorkflowDate(row.approveTime) }}</template></el-table-column>
      <el-table-column :label="t('common.operation')" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="detailDrawer?.open(row.instanceId)">{{ t('common.detail') }}</el-button></template></el-table-column>
    </el-table>
    <div class="mt-4 flex justify-end">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadData" @size-change="resetPageAndLoad" />
    </div>
    <DetailDrawer ref="detailDrawer" />
  </PageContainer>
</template>
