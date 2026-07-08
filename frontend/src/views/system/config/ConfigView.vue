<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import PageContainer from '@/components/PageContainer.vue'
import {
  createConfig,
  deleteConfig,
  listConfigs,
  updateConfig,
  type ConfigForm,
  type ConfigItem,
  type ConfigQuery,
} from '@/api/system/config'

const loading = ref(false)
const tableData = ref<ConfigItem[]>([])
const total = ref(0)

const query = reactive<ConfigQuery>({ page: 1, pageSize: 10, configName: '', configKey: '' })

async function loadData() {
  loading.value = true
  try {
    const res = await listConfigs(query)
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
  query.configName = ''
  query.configKey = ''
  handleSearch()
}

const dialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const defaultForm = (): ConfigForm => ({
  configName: '',
  configKey: '',
  configValue: '',
  configType: 'STRING',
  sensitive: false,
  remark: '',
})
const form = reactive<ConfigForm>(defaultForm())
const rules: FormRules = {
  configName: [{ required: true, message: '请输入参数名称', trigger: 'blur' }],
  configKey: [{ required: true, message: '请输入参数键', trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = '新增参数'
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: ConfigItem) {
  dialogTitle.value = '编辑参数'
  editingId.value = row.id
  Object.assign(form, {
    configName: row.configName,
    configKey: row.configKey,
    configValue: row.sensitive ? '' : row.configValue,
    configType: row.configType,
    sensitive: row.sensitive,
    remark: row.remark ?? '',
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingId.value) {
    await updateConfig(editingId.value, { ...form })
    ElMessage.success('已更新')
  } else {
    await createConfig({ ...form })
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: ConfigItem) {
  await ElMessageBox.confirm(`确认删除参数「${row.configName}」？`, '提示', { type: 'warning' })
  await deleteConfig(row.id)
  ElMessage.success('已删除')
  loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer title="参数配置" description="维护系统参数，敏感参数值以脱敏方式展示。">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item label="参数名称">
        <el-input v-model="query.configName" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item label="参数键">
        <el-input v-model="query.configKey" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:config:add'" type="primary" @click="openCreate">新增参数</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="configName" label="参数名称" min-width="160" />
      <el-table-column prop="configKey" label="参数键" min-width="200" />
      <el-table-column prop="configValue" label="参数值" min-width="160" />
      <el-table-column prop="configType" label="类型" width="100" />
      <el-table-column label="内置" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.builtin" type="warning" size="small">内置</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="140" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'system:config:edit'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-permission="'system:config:delete'"
            link
            type="danger"
            :disabled="row.builtin"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="参数名称" prop="configName">
          <el-input v-model="form.configName" />
        </el-form-item>
        <el-form-item label="参数键" prop="configKey">
          <el-input v-model="form.configKey" placeholder="如 sys.user.initPassword" />
        </el-form-item>
        <el-form-item label="参数值">
          <el-input v-model="form.configValue" :placeholder="form.sensitive ? '敏感值，留空则不修改' : ''" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.configType" class="w-full">
            <el-option label="字符串" value="STRING" />
            <el-option label="布尔" value="BOOLEAN" />
            <el-option label="数字" value="NUMBER" />
          </el-select>
        </el-form-item>
        <el-form-item label="敏感参数">
          <el-switch v-model="form.sensitive" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
