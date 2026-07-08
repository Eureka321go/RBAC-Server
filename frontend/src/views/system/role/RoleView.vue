<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type TreeInstance } from 'element-plus'
import PageContainer from '@/components/PageContainer.vue'
import {
  createRole,
  deleteRole,
  getRoleMenuIds,
  grantRoleMenus,
  listRoles,
  updateRole,
  updateRoleStatus,
  type DataScope,
  type RoleForm,
  type RoleItem,
  type RoleQuery,
} from '@/api/system/role'
import { getMenuTree } from '@/api/system/menu'
import type { MenuItem } from '@/types/menu'

const loading = ref(false)
const tableData = ref<RoleItem[]>([])
const total = ref(0)

const query = reactive<RoleQuery>({
  page: 1,
  pageSize: 10,
  roleName: '',
  roleCode: '',
})

const dataScopeOptions: { label: string; value: DataScope }[] = [
  { label: '全部数据', value: 'ALL' },
  { label: '自定义部门', value: 'CUSTOM_DEPT' },
  { label: '本部门及子部门', value: 'OWN_DEPT_CHILD' },
  { label: '本部门', value: 'OWN_DEPT' },
  { label: '仅本人', value: 'SELF' },
]
const dataScopeLabel = (v: DataScope) => dataScopeOptions.find((o) => o.value === v)?.label ?? v

async function loadData() {
  loading.value = true
  try {
    const res = await listRoles(query)
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
  query.roleName = ''
  query.roleCode = ''
  handleSearch()
}

// ------- 新增/编辑 -------
const dialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const defaultForm = (): RoleForm => ({
  roleName: '',
  roleCode: '',
  dataScope: 'SELF',
  sortOrder: 0,
  status: 'ENABLED',
  remark: '',
})
const form = reactive<RoleForm>(defaultForm())
const rules: FormRules = {
  roleName: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  roleCode: [{ required: true, message: '请输入角色标识', trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = '新增角色'
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: RoleItem) {
  dialogTitle.value = '编辑角色'
  editingId.value = row.id
  Object.assign(form, {
    roleName: row.roleName,
    roleCode: row.roleCode,
    dataScope: row.dataScope,
    sortOrder: row.sortOrder ?? 0,
    status: row.status,
    remark: row.remark ?? '',
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingId.value) {
    await updateRole(editingId.value, { ...form })
    ElMessage.success('已更新')
  } else {
    await createRole({ ...form })
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: RoleItem) {
  await ElMessageBox.confirm(`确认删除角色「${row.roleName}」？`, '提示', { type: 'warning' })
  await deleteRole(row.id)
  ElMessage.success('已删除')
  loadData()
}

async function handleToggleStatus(row: RoleItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateRoleStatus(row.id, next)
  ElMessage.success('状态已更新')
  loadData()
}

// ------- 分配菜单权限 -------
const grantVisible = ref(false)
const grantRoleId = ref<number | null>(null)
const grantRoleName = ref('')
const menuTree = ref<MenuItem[]>([])
const treeRef = ref<TreeInstance>()

async function openGrant(row: RoleItem) {
  grantRoleId.value = row.id
  grantRoleName.value = row.roleName
  grantVisible.value = true
  if (menuTree.value.length === 0) {
    menuTree.value = await getMenuTree()
  }
  const checked = await getRoleMenuIds(row.id)
  await Promise.resolve()
  treeRef.value?.setCheckedKeys(checked, false)
}

async function handleGrantSubmit() {
  if (grantRoleId.value == null || !treeRef.value) return
  const checked = treeRef.value.getCheckedKeys(false) as number[]
  const halfChecked = treeRef.value.getHalfCheckedKeys() as number[]
  await grantRoleMenus(grantRoleId.value, [...halfChecked, ...checked])
  ElMessage.success('权限已保存')
  grantVisible.value = false
}

onMounted(loadData)
</script>

<template>
  <PageContainer title="角色管理" description="维护角色、数据范围与菜单权限。">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item label="角色名称">
        <el-input v-model="query.roleName" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item label="角色标识">
        <el-input v-model="query.roleCode" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="handleSearch">查询</el-button>
        <el-button icon="Refresh" @click="handleReset">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:role:add'" type="primary" icon="Plus" @click="openCreate">新增角色</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="roleName" label="角色名称" min-width="140" />
      <el-table-column prop="roleCode" label="角色标识" min-width="160" />
      <el-table-column label="数据范围" width="150">
        <template #default="{ row }">{{ dataScopeLabel(row.dataScope) }}</template>
      </el-table-column>
      <el-table-column prop="sortOrder" label="排序" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="360" fixed="right" class-name="op-col">
        <template #default="{ row }">
          <el-button v-permission="'system:role:edit'" link type="primary" icon="Edit" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'system:role:menu'" link type="primary" icon="Key" @click="openGrant(row)">分配权限</el-button>
          <el-button v-permission="'system:role:edit'" link icon="SwitchButton" @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? '禁用' : '启用' }}
          </el-button>
          <el-button
            v-permission="'system:role:delete'"
            link
            type="danger"
            icon="Delete"
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

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="角色名称" prop="roleName">
          <el-input v-model="form.roleName" />
        </el-form-item>
        <el-form-item label="角色标识" prop="roleCode">
          <el-input v-model="form.roleCode" placeholder="如 system_admin" />
        </el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="form.dataScope" class="w-full">
            <el-option v-for="o in dataScopeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
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
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 分配权限 -->
    <el-dialog v-model="grantVisible" :title="`分配权限 - ${grantRoleName}`" width="420px">
      <el-tree
        ref="treeRef"
        :data="menuTree"
        show-checkbox
        node-key="id"
        :props="{ label: 'menuName', children: 'children' }"
        default-expand-all
      />
      <template #footer>
        <el-button @click="grantVisible = false">取消</el-button>
        <el-button type="primary" @click="handleGrantSubmit">保存</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
