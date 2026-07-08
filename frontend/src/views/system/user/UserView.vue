<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import PageContainer from '@/components/PageContainer.vue'
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
  type UserForm,
  type UserItem,
  type UserQuery,
} from '@/api/system/user'
import { roleOptions, type RoleItem } from '@/api/system/role'
import { getDeptTree, type DeptItem } from '@/api/system/dept'

const loading = ref(false)
const tableData = ref<UserItem[]>([])
const total = ref(0)
const roles = ref<RoleItem[]>([])
const deptTree = ref<DeptItem[]>([])

const query = reactive<UserQuery>({
  page: 1,
  pageSize: 10,
  username: '',
  nickname: '',
  phone: '',
})

async function loadData() {
  loading.value = true
  try {
    const res = await listUsers(query)
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
  query.username = ''
  query.nickname = ''
  query.phone = ''
  handleSearch()
}

// ------- 新增/编辑 -------
const dialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const defaultForm = (): UserForm => ({
  username: '',
  nickname: '',
  password: '',
  deptId: undefined,
  email: '',
  phone: '',
  gender: '',
  status: 'ENABLED',
  remark: '',
  roleIds: [],
})
const form = reactive<UserForm>(defaultForm())
const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  password: [{ required: true, message: '请输入初始密码', trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = '新增用户'
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: UserItem) {
  dialogTitle.value = '编辑用户'
  editingId.value = row.id
  Object.assign(form, {
    username: row.username,
    nickname: row.nickname,
    password: '',
    deptId: row.deptId,
    email: row.email ?? '',
    phone: row.phone ?? '',
    gender: row.gender ?? '',
    status: row.status,
    remark: row.remark ?? '',
    roleIds: [...(row.roleIds ?? [])],
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingId.value) {
    const payload = { ...form }
    delete payload.password
    await updateUser(editingId.value, payload)
    ElMessage.success('已更新')
  } else {
    await createUser({ ...form })
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: UserItem) {
  await ElMessageBox.confirm(`确认删除用户「${row.username}」？`, '提示', { type: 'warning' })
  await deleteUser(row.id)
  ElMessage.success('已删除')
  loadData()
}

async function handleToggleStatus(row: UserItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateUserStatus(row.id, next)
  ElMessage.success('状态已更新')
  loadData()
}

async function handleResetPassword(row: UserItem) {
  const { value } = await ElMessageBox.prompt(`为用户「${row.username}」设置新密码`, '重置密码', {
    inputType: 'password',
    inputPattern: /^.{6,}$/,
    inputErrorMessage: '密码至少 6 位',
  })
  await resetUserPassword(row.id, value)
  ElMessage.success('密码已重置')
}

onMounted(() => {
  loadData()
  roleOptions().then((r) => (roles.value = r))
  getDeptTree().then((d) => (deptTree.value = d))
})
</script>

<template>
  <PageContainer title="用户管理" description="查询、新增、编辑、删除、重置密码和分配角色。">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item label="用户名">
        <el-input v-model="query.username" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item label="昵称">
        <el-input v-model="query.nickname" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item label="手机号">
        <el-input v-model="query.phone" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="handleSearch">查询</el-button>
        <el-button icon="Refresh" @click="handleReset">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:user:add'" type="primary" icon="Plus" @click="openCreate">新增用户</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="username" label="用户名" min-width="120" />
      <el-table-column prop="nickname" label="昵称" min-width="120" />
      <el-table-column prop="deptName" label="部门" min-width="120" />
      <el-table-column prop="phone" label="手机号" width="130" />
      <el-table-column label="角色" min-width="160">
        <template #default="{ row }">
          <el-tag v-for="name in row.roleNames" :key="name" class="mr-1" size="small">{{ name }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="360" fixed="right" class-name="op-col">
        <template #default="{ row }">
          <el-button v-permission="'system:user:edit'" link type="primary" icon="Edit" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'system:user:edit'" link icon="SwitchButton" @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? '禁用' : '启用' }}
          </el-button>
          <el-button v-permission="'system:user:resetPwd'" link type="warning" icon="Key" @click="handleResetPassword(row)">
            重置密码
          </el-button>
          <el-button v-permission="'system:user:delete'" link type="danger" icon="Delete" @click="handleDelete(row)">删除</el-button>
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="editingId !== null" />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" />
        </el-form-item>
        <el-form-item v-if="editingId === null" label="初始密码" prop="password">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="所属部门">
          <el-tree-select
            v-model="form.deptId"
            :data="deptTree"
            :props="{ label: 'deptName', value: 'id', children: 'children' }"
            check-strictly
            clearable
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.roleIds" multiple class="w-full" placeholder="请选择角色">
            <el-option v-for="r in roles" :key="r.id" :label="r.roleName" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="性别">
          <el-select v-model="form.gender" clearable class="w-full">
            <el-option label="男" value="MALE" />
            <el-option label="女" value="FEMALE" />
            <el-option label="未知" value="UNKNOWN" />
          </el-select>
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
  </PageContainer>
</template>
