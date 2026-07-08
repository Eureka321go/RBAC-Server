<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import PageContainer from '@/components/PageContainer.vue'
import {
  createDept,
  deleteDept,
  getDeptTree,
  updateDept,
  updateDeptStatus,
  type DeptForm,
  type DeptItem,
} from '@/api/system/dept'

const loading = ref(false)
const treeData = ref<DeptItem[]>([])

const dialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<DeptForm>({
  parentId: null,
  deptName: '',
  phone: '',
  email: '',
  sortOrder: 0,
  status: 'ENABLED',
})
const rules: FormRules = {
  deptName: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    treeData.value = await getDeptTree()
  } finally {
    loading.value = false
  }
}

function openCreate(parent?: DeptItem) {
  dialogTitle.value = '新增部门'
  editingId.value = null
  Object.assign(form, {
    parentId: parent ? parent.id : null,
    deptName: '',
    phone: '',
    email: '',
    sortOrder: 0,
    status: 'ENABLED',
  })
  dialogVisible.value = true
}

function openEdit(row: DeptItem) {
  dialogTitle.value = '编辑部门'
  editingId.value = row.id
  Object.assign(form, {
    parentId: row.parentId ?? null,
    deptName: row.deptName,
    phone: row.phone ?? '',
    email: row.email ?? '',
    sortOrder: row.sortOrder ?? 0,
    status: row.status,
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingId.value) {
    await updateDept(editingId.value, { ...form })
    ElMessage.success('已更新')
  } else {
    await createDept({ ...form })
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: DeptItem) {
  await ElMessageBox.confirm(`确认删除部门「${row.deptName}」？`, '提示', { type: 'warning' })
  await deleteDept(row.id)
  ElMessage.success('已删除')
  loadData()
}

async function handleToggleStatus(row: DeptItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateDeptStatus(row.id, next)
  ElMessage.success('状态已更新')
  loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer title="部门管理" description="维护部门树、状态与层级结构。">
    <div class="mb-4">
      <el-button v-permission="'system:dept:add'" type="primary" icon="Plus" @click="openCreate()">新增顶级部门</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="treeData"
      row-key="id"
      :tree-props="{ children: 'children' }"
      default-expand-all
      border
    >
      <el-table-column prop="deptName" label="部门名称" min-width="200" />
      <el-table-column prop="phone" label="联系电话" width="140" />
      <el-table-column prop="sortOrder" label="排序" width="80" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="360" fixed="right" class-name="op-col">
        <template #default="{ row }">
          <el-button v-permission="'system:dept:add'" link type="primary" icon="Plus" @click="openCreate(row)">新增子级</el-button>
          <el-button v-permission="'system:dept:edit'" link type="primary" icon="Edit" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'system:dept:edit'" link icon="SwitchButton" @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? '禁用' : '启用' }}
          </el-button>
          <el-button v-permission="'system:dept:delete'" link type="danger" icon="Delete" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="上级部门">
          <el-tree-select
            v-model="form.parentId"
            :data="treeData"
            :props="{ label: 'deptName', value: 'id', children: 'children' }"
            check-strictly
            clearable
            placeholder="不选则为顶级部门"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="部门名称" prop="deptName">
          <el-input v-model="form.deptName" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
