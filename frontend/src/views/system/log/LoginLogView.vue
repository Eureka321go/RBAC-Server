<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import PageContainer from '@/components/PageContainer.vue'
import { listLoginLogs, type LoginLogItem, type LoginLogQuery } from '@/api/system/log'

const loading = ref(false)
const tableData = ref<LoginLogItem[]>([])
const total = ref(0)
const query = reactive<LoginLogQuery>({ page: 1, pageSize: 10, username: '' })

async function loadData() {
  loading.value = true
  try {
    const res = await listLoginLogs(query)
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

onMounted(loadData)
</script>

<template>
  <PageContainer title="登录日志" description="查看登录成功与失败记录。">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item label="账号">
        <el-input v-model="query.username" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="username" label="账号" min-width="120" />
      <el-table-column label="结果" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'">
            {{ row.status === 'SUCCESS' ? '成功' : '失败' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="提示信息" min-width="140" />
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column prop="userAgent" label="User-Agent" min-width="220" show-overflow-tooltip />
      <el-table-column prop="loginAt" label="登录时间" width="180" />
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
  </PageContainer>
</template>
