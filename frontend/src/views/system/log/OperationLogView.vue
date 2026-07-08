<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import PageContainer from '@/components/PageContainer.vue'
import { listOperationLogs, type OperationLogItem, type OperationLogQuery } from '@/api/system/log'

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
  <PageContainer title="操作日志" description="查看管理操作的审计记录。">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item label="操作模块">
        <el-input v-model="query.title" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item label="操作人">
        <el-input v-model="query.operator" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="title" label="模块" min-width="120" />
      <el-table-column prop="businessType" label="类型" width="100" />
      <el-table-column prop="operator" label="操作人" width="120" />
      <el-table-column prop="requestMethod" label="方法" width="90" />
      <el-table-column prop="requestUri" label="请求地址" min-width="180" show-overflow-tooltip />
      <el-table-column label="结果" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'">
            {{ row.status === 'SUCCESS' ? '成功' : '失败' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="costMs" label="耗时(ms)" width="100" />
      <el-table-column prop="operateAt" label="操作时间" width="180" />
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
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

    <el-dialog v-model="detailVisible" title="操作日志详情" width="640px">
      <el-descriptions v-if="detail" :column="1" border>
        <el-descriptions-item label="操作模块">{{ detail.title }}</el-descriptions-item>
        <el-descriptions-item label="业务类型">{{ detail.businessType }}</el-descriptions-item>
        <el-descriptions-item label="操作人">{{ detail.operator }}</el-descriptions-item>
        <el-descriptions-item label="请求方法">{{ detail.method }}</el-descriptions-item>
        <el-descriptions-item label="请求地址">{{ detail.requestMethod }} {{ detail.requestUri }}</el-descriptions-item>
        <el-descriptions-item label="请求参数">
          <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">{{ detail.params }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="结果">{{ detail.status }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.errorMsg" label="错误信息">{{ detail.errorMsg }}</el-descriptions-item>
        <el-descriptions-item label="IP">{{ detail.ip }}</el-descriptions-item>
        <el-descriptions-item label="耗时">{{ detail.costMs }} ms</el-descriptions-item>
        <el-descriptions-item label="操作时间">{{ detail.operateAt }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
