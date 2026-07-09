<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()

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
  configName: [{ required: true, message: t('config.ruleName'), trigger: 'blur' }],
  configKey: [{ required: true, message: t('config.ruleKey'), trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = t('config.create')
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: ConfigItem) {
  dialogTitle.value = t('config.edit')
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
    ElMessage.success(t('common.updated'))
  } else {
    await createConfig({ ...form })
    ElMessage.success(t('common.created'))
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: ConfigItem) {
  await ElMessageBox.confirm(t('config.confirmDelete', { name: row.configName }), t('common.tip'), { type: 'warning' })
  await deleteConfig(row.id)
  ElMessage.success(t('common.deleted'))
  loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('config.title')" :description="t('config.description')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('config.configName')">
        <el-input v-model="query.configName" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item :label="t('config.configKey')">
        <el-input v-model="query.configKey" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">{{ t('common.search') }}</el-button>
        <el-button @click="handleReset">{{ t('common.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:config:add'" type="primary" @click="openCreate">{{ t('config.addConfig') }}</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="configName" :label="t('config.configName')" min-width="160" />
      <el-table-column prop="configKey" :label="t('config.configKey')" min-width="200" />
      <el-table-column prop="configValue" :label="t('config.configValue')" min-width="160" />
      <el-table-column prop="configType" :label="t('config.type')" width="100" />
      <el-table-column :label="t('config.builtin')" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.builtin" type="warning" size="small">{{ t('config.builtin') }}</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="remark" :label="t('common.remark')" min-width="140" />
      <el-table-column :label="t('common.operation')" width="160" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'system:config:edit'" link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button
            v-permission="'system:config:delete'"
            link
            type="danger"
            :disabled="row.builtin"
            @click="handleDelete(row)"
          >
            {{ t('common.delete') }}
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
        <el-form-item :label="t('config.configName')" prop="configName">
          <el-input v-model="form.configName" />
        </el-form-item>
        <el-form-item :label="t('config.configKey')" prop="configKey">
          <el-input v-model="form.configKey" :placeholder="t('config.keyPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('config.configValue')">
          <el-input v-model="form.configValue" :placeholder="form.sensitive ? t('config.sensitiveValuePlaceholder') : ''" />
        </el-form-item>
        <el-form-item :label="t('config.type')">
          <el-select v-model="form.configType" class="w-full">
            <el-option :label="t('config.typeString')" value="STRING" />
            <el-option :label="t('config.typeBoolean')" value="BOOLEAN" />
            <el-option :label="t('config.typeNumber')" value="NUMBER" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('config.sensitive')">
          <el-switch v-model="form.sensitive" />
        </el-form-item>
        <el-form-item :label="t('common.remark')">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleSubmit">{{ t('common.ok') }}</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
