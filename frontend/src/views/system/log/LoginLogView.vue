<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import { listLoginLogs, type LoginLogItem, type LoginLogQuery } from '@/api/system/log'

const { t } = useI18n()

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
  <PageContainer :title="t('loginLog.title')" :description="t('loginLog.description')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('loginLog.username')">
        <el-input v-model="query.username" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">{{ t('common.search') }}</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="username" :label="t('loginLog.username')" min-width="120" />
      <el-table-column :label="t('loginLog.result')" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'">
            {{ row.status === 'SUCCESS' ? t('loginLog.success') : t('loginLog.fail') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="message" :label="t('loginLog.message')" min-width="140" />
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column prop="userAgent" :label="t('loginLog.userAgent')" min-width="220" show-overflow-tooltip />
      <el-table-column prop="loginAt" :label="t('loginLog.loginTime')" width="180" />
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
