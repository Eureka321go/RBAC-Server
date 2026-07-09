<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import {
  createDictData,
  createDictType,
  deleteDictData,
  deleteDictType,
  listDictData,
  listDictTypes,
  updateDictData,
  updateDictType,
  type DictDataForm,
  type DictDataItem,
  type DictTypeForm,
  type DictTypeItem,
  type DictTypeQuery,
} from '@/api/system/dict'

const { t } = useI18n()

// ------- 字典类型（左） -------
const typeLoading = ref(false)
const typeData = ref<DictTypeItem[]>([])
const typeTotal = ref(0)
const typeQuery = reactive<DictTypeQuery>({ page: 1, pageSize: 10, dictName: '' })
const activeType = ref<DictTypeItem | null>(null)

async function loadTypes() {
  typeLoading.value = true
  try {
    const res = await listDictTypes(typeQuery)
    typeData.value = res.records
    typeTotal.value = res.total
    if (!activeType.value && res.records[0]) {
      selectType(res.records[0])
    }
  } finally {
    typeLoading.value = false
  }
}

function selectType(row: DictTypeItem) {
  activeType.value = row
  loadData()
}

const typeDialogVisible = ref(false)
const typeDialogTitle = ref('')
const editingTypeId = ref<number | null>(null)
const typeFormRef = ref<FormInstance>()
const defaultTypeForm = (): DictTypeForm => ({ dictName: '', dictCode: '', status: 'ENABLED', remark: '' })
const typeForm = reactive<DictTypeForm>(defaultTypeForm())
const typeRules: FormRules = {
  dictName: [{ required: true, message: t('dict.ruleName'), trigger: 'blur' }],
  dictCode: [{ required: true, message: t('dict.ruleCode'), trigger: 'blur' }],
}

function openCreateType() {
  typeDialogTitle.value = t('dict.createType')
  editingTypeId.value = null
  Object.assign(typeForm, defaultTypeForm())
  typeDialogVisible.value = true
}

function openEditType(row: DictTypeItem) {
  typeDialogTitle.value = t('dict.editType')
  editingTypeId.value = row.id
  Object.assign(typeForm, {
    dictName: row.dictName,
    dictCode: row.dictCode,
    status: row.status,
    remark: row.remark ?? '',
  })
  typeDialogVisible.value = true
}

async function submitType() {
  if (!typeFormRef.value) return
  const valid = await typeFormRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingTypeId.value) {
    await updateDictType(editingTypeId.value, { ...typeForm })
    ElMessage.success(t('common.updated'))
  } else {
    await createDictType({ ...typeForm })
    ElMessage.success(t('common.created'))
  }
  typeDialogVisible.value = false
  loadTypes()
}

async function handleDeleteType(row: DictTypeItem) {
  await ElMessageBox.confirm(t('dict.confirmDeleteType', { name: row.dictName }), t('common.tip'), { type: 'warning' })
  await deleteDictType(row.id)
  ElMessage.success(t('common.deleted'))
  if (activeType.value?.id === row.id) {
    activeType.value = null
    dataList.value = []
  }
  loadTypes()
}

// ------- 字典数据（右） -------
const dataLoading = ref(false)
const dataList = ref<DictDataItem[]>([])

async function loadData() {
  if (!activeType.value) return
  dataLoading.value = true
  try {
    dataList.value = await listDictData(activeType.value.id)
  } finally {
    dataLoading.value = false
  }
}

const dataDialogVisible = ref(false)
const dataDialogTitle = ref('')
const editingDataId = ref<number | null>(null)
const dataFormRef = ref<FormInstance>()
const defaultDataForm = (): DictDataForm => ({
  dictTypeId: 0,
  label: '',
  value: '',
  sortOrder: 0,
  defaultFlag: false,
  status: 'ENABLED',
  remark: '',
})
const dataForm = reactive<DictDataForm>(defaultDataForm())
const dataRules: FormRules = {
  label: [{ required: true, message: t('dict.ruleLabel'), trigger: 'blur' }],
  value: [{ required: true, message: t('dict.ruleValue'), trigger: 'blur' }],
}

function openCreateData() {
  if (!activeType.value) {
    ElMessage.warning(t('dict.selectTypeWarn'))
    return
  }
  dataDialogTitle.value = t('dict.createData')
  editingDataId.value = null
  Object.assign(dataForm, defaultDataForm(), { dictTypeId: activeType.value.id })
  dataDialogVisible.value = true
}

function openEditData(row: DictDataItem) {
  dataDialogTitle.value = t('dict.editData')
  editingDataId.value = row.id
  Object.assign(dataForm, {
    dictTypeId: row.dictTypeId,
    label: row.label,
    value: row.value,
    sortOrder: row.sortOrder ?? 0,
    defaultFlag: row.defaultFlag,
    status: row.status,
    remark: row.remark ?? '',
  })
  dataDialogVisible.value = true
}

async function submitData() {
  if (!dataFormRef.value) return
  const valid = await dataFormRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingDataId.value) {
    await updateDictData(editingDataId.value, { ...dataForm })
    ElMessage.success(t('common.updated'))
  } else {
    await createDictData({ ...dataForm })
    ElMessage.success(t('common.created'))
  }
  dataDialogVisible.value = false
  loadData()
}

async function handleDeleteData(row: DictDataItem) {
  await ElMessageBox.confirm(t('dict.confirmDeleteData', { name: row.label }), t('common.tip'), { type: 'warning' })
  await deleteDictData(row.id)
  ElMessage.success(t('common.deleted'))
  loadData()
}

onMounted(loadTypes)
</script>

<template>
  <PageContainer :title="t('dict.title')" :description="t('dict.description')">
    <div class="flex gap-4">
      <!-- 左：字典类型 -->
      <div class="w-2/5">
        <div class="mb-2 flex items-center gap-2">
          <el-input
            v-model="typeQuery.dictName"
            clearable
            :placeholder="t('dict.dictName')"
            style="width: 160px"
            @keyup.enter="loadTypes"
          />
          <el-button type="primary" @click="loadTypes">{{ t('common.search') }}</el-button>
          <el-button v-permission="'system:dict:add'" @click="openCreateType">{{ t('dict.addType') }}</el-button>
        </div>
        <el-table
          v-loading="typeLoading"
          :data="typeData"
          border
          highlight-current-row
          @current-change="(row: DictTypeItem) => row && selectType(row)"
        >
          <el-table-column prop="dictName" :label="t('dict.dictName')" min-width="120" />
          <el-table-column prop="dictCode" :label="t('dict.code')" min-width="140" />
          <el-table-column :label="t('common.operation')" width="130">
            <template #default="{ row }">
              <el-button v-permission="'system:dict:edit'" link type="primary" @click.stop="openEditType(row)">{{ t('common.edit') }}</el-button>
              <el-button v-permission="'system:dict:delete'" link type="danger" @click.stop="handleDeleteType(row)">{{ t('common.delete') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="mt-2 flex justify-end">
          <el-pagination
            v-model:current-page="typeQuery.page"
            :total="typeTotal"
            :page-size="typeQuery.pageSize"
            layout="prev, pager, next"
            small
            @current-change="loadTypes"
          />
        </div>
      </div>

      <!-- 右：字典数据 -->
      <div class="flex-1">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm text-slate-500">
            {{ activeType ? t('dict.currentDict', { name: activeType.dictName }) : t('dict.selectTypeFirst') }}
          </span>
          <el-button v-permission="'system:dict:add'" type="primary" :disabled="!activeType" @click="openCreateData">
            {{ t('dict.addData') }}
          </el-button>
        </div>
        <el-table v-loading="dataLoading" :data="dataList" border>
          <el-table-column prop="label" :label="t('dict.label')" min-width="120" />
          <el-table-column prop="value" :label="t('dict.value')" min-width="120" />
          <el-table-column prop="sortOrder" :label="t('common.sortOrder')" width="80" />
          <el-table-column :label="t('dict.default')" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.defaultFlag" type="success" size="small">{{ t('dict.default') }}</el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('common.status')" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
                {{ row.status === 'ENABLED' ? t('status.ENABLED') : t('status.DISABLED') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('common.operation')" width="140">
            <template #default="{ row }">
              <el-button v-permission="'system:dict:edit'" link type="primary" @click="openEditData(row)">{{ t('common.edit') }}</el-button>
              <el-button v-permission="'system:dict:delete'" link type="danger" @click="handleDeleteData(row)">{{ t('common.delete') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 字典类型弹窗 -->
    <el-dialog v-model="typeDialogVisible" :title="typeDialogTitle" width="480px">
      <el-form ref="typeFormRef" :model="typeForm" :rules="typeRules" label-width="90px">
        <el-form-item :label="t('dict.dictName')" prop="dictName">
          <el-input v-model="typeForm.dictName" />
        </el-form-item>
        <el-form-item :label="t('dict.dictCode')" prop="dictCode">
          <el-input v-model="typeForm.dictCode" :placeholder="t('dict.codePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('common.status')">
          <el-radio-group v-model="typeForm.status">
            <el-radio value="ENABLED">{{ t('status.ENABLED') }}</el-radio>
            <el-radio value="DISABLED">{{ t('status.DISABLED') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('common.remark')">
          <el-input v-model="typeForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="typeDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitType">{{ t('common.ok') }}</el-button>
      </template>
    </el-dialog>

    <!-- 字典数据弹窗 -->
    <el-dialog v-model="dataDialogVisible" :title="dataDialogTitle" width="480px">
      <el-form ref="dataFormRef" :model="dataForm" :rules="dataRules" label-width="90px">
        <el-form-item :label="t('dict.label')" prop="label">
          <el-input v-model="dataForm.label" />
        </el-form-item>
        <el-form-item :label="t('dict.value')" prop="value">
          <el-input v-model="dataForm.value" />
        </el-form-item>
        <el-form-item :label="t('common.sortOrder')">
          <el-input-number v-model="dataForm.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item :label="t('dict.defaultItem')">
          <el-switch v-model="dataForm.defaultFlag" />
        </el-form-item>
        <el-form-item :label="t('common.status')">
          <el-radio-group v-model="dataForm.status">
            <el-radio value="ENABLED">{{ t('status.ENABLED') }}</el-radio>
            <el-radio value="DISABLED">{{ t('status.DISABLED') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('common.remark')">
          <el-input v-model="dataForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dataDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitData">{{ t('common.ok') }}</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
