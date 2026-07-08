<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
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
  dictName: [{ required: true, message: '请输入字典名称', trigger: 'blur' }],
  dictCode: [{ required: true, message: '请输入字典编码', trigger: 'blur' }],
}

function openCreateType() {
  typeDialogTitle.value = '新增字典类型'
  editingTypeId.value = null
  Object.assign(typeForm, defaultTypeForm())
  typeDialogVisible.value = true
}

function openEditType(row: DictTypeItem) {
  typeDialogTitle.value = '编辑字典类型'
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
    ElMessage.success('已更新')
  } else {
    await createDictType({ ...typeForm })
    ElMessage.success('已创建')
  }
  typeDialogVisible.value = false
  loadTypes()
}

async function handleDeleteType(row: DictTypeItem) {
  await ElMessageBox.confirm(`确认删除字典「${row.dictName}」及其数据项？`, '提示', { type: 'warning' })
  await deleteDictType(row.id)
  ElMessage.success('已删除')
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
  label: [{ required: true, message: '请输入标签', trigger: 'blur' }],
  value: [{ required: true, message: '请输入键值', trigger: 'blur' }],
}

function openCreateData() {
  if (!activeType.value) {
    ElMessage.warning('请先选择左侧字典类型')
    return
  }
  dataDialogTitle.value = '新增字典数据'
  editingDataId.value = null
  Object.assign(dataForm, defaultDataForm(), { dictTypeId: activeType.value.id })
  dataDialogVisible.value = true
}

function openEditData(row: DictDataItem) {
  dataDialogTitle.value = '编辑字典数据'
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
    ElMessage.success('已更新')
  } else {
    await createDictData({ ...dataForm })
    ElMessage.success('已创建')
  }
  dataDialogVisible.value = false
  loadData()
}

async function handleDeleteData(row: DictDataItem) {
  await ElMessageBox.confirm(`确认删除数据项「${row.label}」？`, '提示', { type: 'warning' })
  await deleteDictData(row.id)
  ElMessage.success('已删除')
  loadData()
}

onMounted(loadTypes)
</script>

<template>
  <PageContainer title="字典管理" description="左侧字典类型，右侧字典数据项。">
    <div class="flex gap-4">
      <!-- 左：字典类型 -->
      <div class="w-2/5">
        <div class="mb-2 flex items-center gap-2">
          <el-input
            v-model="typeQuery.dictName"
            clearable
            placeholder="字典名称"
            style="width: 160px"
            @keyup.enter="loadTypes"
          />
          <el-button type="primary" @click="loadTypes">查询</el-button>
          <el-button v-permission="'system:dict:add'" @click="openCreateType">新增</el-button>
        </div>
        <el-table
          v-loading="typeLoading"
          :data="typeData"
          border
          highlight-current-row
          @current-change="(row: DictTypeItem) => row && selectType(row)"
        >
          <el-table-column prop="dictName" label="字典名称" min-width="120" />
          <el-table-column prop="dictCode" label="编码" min-width="140" />
          <el-table-column label="操作" width="130">
            <template #default="{ row }">
              <el-button v-permission="'system:dict:edit'" link type="primary" @click.stop="openEditType(row)">编辑</el-button>
              <el-button v-permission="'system:dict:delete'" link type="danger" @click.stop="handleDeleteType(row)">删除</el-button>
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
            {{ activeType ? `当前字典：${activeType.dictName}` : '请选择左侧字典类型' }}
          </span>
          <el-button v-permission="'system:dict:add'" type="primary" :disabled="!activeType" @click="openCreateData">
            新增数据
          </el-button>
        </div>
        <el-table v-loading="dataLoading" :data="dataList" border>
          <el-table-column prop="label" label="标签" min-width="120" />
          <el-table-column prop="value" label="键值" min-width="120" />
          <el-table-column prop="sortOrder" label="排序" width="80" />
          <el-table-column label="默认" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.defaultFlag" type="success" size="small">默认</el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
                {{ row.status === 'ENABLED' ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button v-permission="'system:dict:edit'" link type="primary" @click="openEditData(row)">编辑</el-button>
              <el-button v-permission="'system:dict:delete'" link type="danger" @click="handleDeleteData(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 字典类型弹窗 -->
    <el-dialog v-model="typeDialogVisible" :title="typeDialogTitle" width="480px">
      <el-form ref="typeFormRef" :model="typeForm" :rules="typeRules" label-width="90px">
        <el-form-item label="字典名称" prop="dictName">
          <el-input v-model="typeForm.dictName" />
        </el-form-item>
        <el-form-item label="字典编码" prop="dictCode">
          <el-input v-model="typeForm.dictCode" placeholder="如 sys_user_gender" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="typeForm.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="typeForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="typeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitType">确定</el-button>
      </template>
    </el-dialog>

    <!-- 字典数据弹窗 -->
    <el-dialog v-model="dataDialogVisible" :title="dataDialogTitle" width="480px">
      <el-form ref="dataFormRef" :model="dataForm" :rules="dataRules" label-width="90px">
        <el-form-item label="标签" prop="label">
          <el-input v-model="dataForm.label" />
        </el-form-item>
        <el-form-item label="键值" prop="value">
          <el-input v-model="dataForm.value" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="dataForm.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item label="默认项">
          <el-switch v-model="dataForm.defaultFlag" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="dataForm.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="dataForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dataDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitData">确定</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
