<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import { listOperationLogs, type OperationLogItem, type OperationLogQuery } from '@/api/system/log'

const { t } = useI18n()

const loading = ref(false)
const tableData = ref<OperationLogItem[]>([])
const total = ref(0)
const query = reactive<OperationLogQuery>({ page: 1, pageSize: 10, title: '', operator: '' })

const detailVisible = ref(false)
const detail = ref<OperationLogItem | null>(null)

async function loadData() {
  loading.value = true
  try {
    const res = await listOperationLogs(query)
    tableData.value = res.records
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  query.page = 1
  loadData()
}

function handleReset() {
  query.title = ''
  query.operator = ''
  handleSearch()
}

function openDetail(row: OperationLogItem) {
  detail.value = row
  detailVisible.value = true
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('operationLog.title')" :description="t('operationLog.description')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('operationLog.module')">
        <el-input v-model="query.title" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item :label="t('operationLog.operator')">
        <el-input v-model="query.operator" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">{{ t('common.search') }}</el-button>
        <el-button @click="handleReset">{{ t('common.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="title" :label="t('operationLog.moduleShort')" min-width="120" />
      <el-table-column prop="businessType" :label="t('operationLog.type')" width="100" />
      <el-table-column prop="operator" :label="t('operationLog.operator')" width="120" />
      <el-table-column prop="requestMethod" :label="t('operationLog.method')" width="90" />
      <el-table-column prop="requestUri" :label="t('operationLog.requestUri')" min-width="180" show-overflow-tooltip />
      <el-table-column :label="t('operationLog.result')" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'">
            {{ row.status === 'SUCCESS' ? t('loginLog.success') : t('loginLog.fail') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="costMs" :label="t('operationLog.cost')" width="100" />
      <el-table-column prop="operateAt" :label="t('operationLog.operateTime')" width="180" />
      <el-table-column :label="t('common.operation')" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">{{ t('common.detail') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="mt-4 flex justify-end">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @current-change="loadData"
        @size-change="handleSearch"
      />
    </div>

    <el-dialog v-model="detailVisible" :title="t('operationLog.detailTitle')" width="640px">
      <el-descriptions v-if="detail" :column="1" border>
        <el-descriptions-item :label="t('operationLog.module')">{{ detail.title }}</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.businessType')">{{ detail.businessType }}</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.operator')">{{ detail.operator }}</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.requestMethod')">{{ detail.method }}</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.requestUri')">{{ detail.requestMethod }} {{ detail.requestUri }}</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.requestParams')">
          <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">{{ detail.params }}</pre>
        </el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.result')">{{ detail.status }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.errorMsg" :label="t('operationLog.errorMsg')">{{ detail.errorMsg }}</el-descriptions-item>
        <el-descriptions-item label="IP">{{ detail.ip }}</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.costLabel')">{{ detail.costMs }} ms</el-descriptions-item>
        <el-descriptions-item :label="t('operationLog.operateTime')">{{ detail.operateAt }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="detailVisible = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
