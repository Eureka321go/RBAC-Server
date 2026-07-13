<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import WorkflowStatusTag from '@/components/workflow/WorkflowStatusTag.vue'
import DetailDrawer from './DetailDrawer.vue'
import { listMyCc, markCcRead } from '@/api/workflow/instance'
import type { WorkflowCc, WorkflowInstanceQuery } from '@/types/workflow'
import { formatWorkflowDate } from '@/utils/workflow'

const { t } = useI18n()
const loading = ref(false)
const rows = ref<WorkflowCc[]>([])
const total = ref(0)
const query = reactive<WorkflowInstanceQuery>({ page: 1, pageSize: 10 })
const detailDrawer = ref<InstanceType<typeof DetailDrawer>>()

async function loadData() {
  loading.value = true
  try {
    const result = await listMyCc(query)
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

function rowClassName({ row }: { row: WorkflowCc }) {
  return row.readFlag === 0 ? 'font-semibold' : ''
}

async function openDetail(row: WorkflowCc) {
  await detailDrawer.value?.open(row.instanceId)
  if (row.readFlag === 0) {
    await markCcRead(row.id)
    rows.value = rows.value.map((item) => (item.id === row.id ? { ...item, readFlag: 1 } : item))
  }
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('workflow.cc.title')" :description="t('workflow.cc.description')">
    <el-table v-loading="loading" :data="rows" border :row-class-name="rowClassName">
      <el-table-column :label="t('workflow.cc.readState')" width="80"><template #default="{ row }"><el-badge :is-dot="row.readFlag === 0">{{ row.readFlag === 0 ? t('workflow.cc.unread') : t('workflow.cc.read') }}</el-badge></template></el-table-column>
      <el-table-column prop="title" :label="t('workflow.common.title')" min-width="210" />
      <el-table-column prop="processKey" :label="t('workflow.common.processKey')" min-width="120" />
      <el-table-column prop="initiatorName" :label="t('workflow.common.initiator')" min-width="120" />
      <el-table-column :label="t('common.status')" width="110"><template #default="{ row }"><WorkflowStatusTag group="instance" :value="row.instanceStatus" /></template></el-table-column>
      <el-table-column :label="t('workflow.common.createdAt')" min-width="170"><template #default="{ row }">{{ formatWorkflowDate(row.createdAt) }}</template></el-table-column>
      <el-table-column :label="t('common.operation')" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">{{ t('common.detail') }}</el-button></template></el-table-column>
    </el-table>

    <div class="mt-4 flex justify-end">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadData" @size-change="resetPageAndLoad" />
    </div>
    <DetailDrawer ref="detailDrawer" />
  </PageContainer>
</template>
