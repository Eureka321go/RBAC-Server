<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type TreeInstance } from 'element-plus'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import {
  createRole,
  deleteRole,
  getRoleDeptIds,
  getRoleMenuIds,
  grantRoleDepts,
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
import { getDeptTree, type DeptItem } from '@/api/system/dept'
import type { MenuItem } from '@/types/menu'

const { t } = useI18n()

const loading = ref(false)
const tableData = ref<RoleItem[]>([])
const total = ref(0)

const query = reactive<RoleQuery>({
  page: 1,
  pageSize: 10,
  roleName: '',
  roleCode: '',
})

const dataScopeOptions = computed<{ label: string; value: DataScope }[]>(() => [
  { label: t('role.scopeAll'), value: 'ALL' },
  { label: t('role.scopeCustomDept'), value: 'CUSTOM_DEPT' },
  { label: t('role.scopeOwnDeptChild'), value: 'OWN_DEPT_CHILD' },
  { label: t('role.scopeOwnDept'), value: 'OWN_DEPT' },
  { label: t('role.scopeSelf'), value: 'SELF' },
])
const dataScopeLabel = (v: DataScope) => dataScopeOptions.value.find((o) => o.value === v)?.label ?? v

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
  roleName: [{ required: true, message: t('role.ruleRoleName'), trigger: 'blur' }],
  roleCode: [{ required: true, message: t('role.ruleRoleCode'), trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = t('role.create')
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: RoleItem) {
  dialogTitle.value = t('role.edit')
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
    ElMessage.success(t('common.updated'))
  } else {
    await createRole({ ...form })
    ElMessage.success(t('common.created'))
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: RoleItem) {
  await ElMessageBox.confirm(t('role.confirmDelete', { name: row.roleName }), t('common.tip'), { type: 'warning' })
  await deleteRole(row.id)
  ElMessage.success(t('common.deleted'))
  loadData()
}

async function handleToggleStatus(row: RoleItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateRoleStatus(row.id, next)
  ElMessage.success(t('common.statusUpdated'))
  loadData()
}

// ------- 分配菜单权限 -------
const grantVisible = ref(false)
const grantRoleId = ref<number | null>(null)
const grantRoleName = ref('')
const menuTree = ref<MenuItem[]>([])
const treeRef = ref<TreeInstance>()

/**
 * 只勾选叶子节点，父节点的半选/全选状态交给 el-tree 自动推算。
 * 后端保存的 id 里包含父目录节点，若直接 setCheckedKeys 会级联勾选整棵子树，
 * 导致已取消的子节点被重新勾上。
 */
function setLeafChecked(tree: TreeInstance, ids: number[]) {
  const leafIds = ids.filter((id) => tree.getNode(id)?.isLeaf)
  tree.setCheckedKeys(leafIds, false)
}

async function openGrant(row: RoleItem) {
  grantRoleId.value = row.id
  grantRoleName.value = row.roleName
  grantVisible.value = true
  if (menuTree.value.length === 0) {
    menuTree.value = await getMenuTree()
  }
  const checked = await getRoleMenuIds(row.id)
  await nextTick()
  if (treeRef.value) setLeafChecked(treeRef.value, checked)
}

async function handleGrantSubmit() {
  if (grantRoleId.value == null || !treeRef.value) return
  const checked = treeRef.value.getCheckedKeys(false) as number[]
  const halfChecked = treeRef.value.getHalfCheckedKeys() as number[]
  await grantRoleMenus(grantRoleId.value, [...halfChecked, ...checked])
  ElMessage.success(t('role.menuSaved'))
  grantVisible.value = false
}

// ------- 分配数据权限（部门） -------
const deptDialogVisible = ref(false)
const deptRoleId = ref<number | null>(null)
const deptRoleName = ref('')
const deptRoleScope = ref<DataScope>('SELF')
const deptTree = ref<DeptItem[]>([])
const deptTreeRef = ref<TreeInstance>()

async function openGrantDept(row: RoleItem) {
  deptRoleId.value = row.id
  deptRoleName.value = row.roleName
  deptRoleScope.value = row.dataScope
  deptDialogVisible.value = true
  if (deptTree.value.length === 0) {
    deptTree.value = await getDeptTree()
  }
  const checked = await getRoleDeptIds(row.id)
  await nextTick()
  if (deptTreeRef.value) setLeafChecked(deptTreeRef.value, checked)
}

async function handleGrantDeptSubmit() {
  if (deptRoleId.value == null || !deptTreeRef.value) return
  const checked = deptTreeRef.value.getCheckedKeys(false) as number[]
  const halfChecked = deptTreeRef.value.getHalfCheckedKeys() as number[]
  await grantRoleDepts(deptRoleId.value, [...halfChecked, ...checked])
  ElMessage.success(t('role.dataSaved'))
  deptDialogVisible.value = false
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('role.title')" :description="t('role.description')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('role.roleName')">
        <el-input v-model="query.roleName" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item :label="t('role.roleCode')">
        <el-input v-model="query.roleCode" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="handleSearch">{{ t('common.search') }}</el-button>
        <el-button icon="Refresh" @click="handleReset">{{ t('common.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:role:add'" type="primary" icon="Plus" @click="openCreate">{{ t('role.addRole') }}</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="roleName" :label="t('role.roleName')" min-width="140" />
      <el-table-column prop="roleCode" :label="t('role.roleCode')" min-width="160" />
      <el-table-column :label="t('role.dataScope')" width="150">
        <template #default="{ row }">{{ dataScopeLabel(row.dataScope) }}</template>
      </el-table-column>
      <el-table-column prop="sortOrder" :label="t('common.sortOrder')" width="80" />
      <el-table-column :label="t('common.status')" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? t('status.ENABLED') : t('status.DISABLED') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('common.operation')" width="440" fixed="right" class-name="op-col">
        <template #default="{ row }">
          <el-button v-permission="'system:role:edit'" link type="primary" icon="Edit" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button v-permission="'system:role:grant-menu'" link type="primary" icon="Key" @click="openGrant(row)">{{ t('role.grantMenu') }}</el-button>
          <el-button v-permission="'system:role:grant-data'" link type="primary" icon="Share" @click="openGrantDept(row)">{{ t('role.grantData') }}</el-button>
          <el-button v-permission="'system:role:edit'" link icon="SwitchButton" @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? t('status.DISABLED') : t('status.ENABLED') }}
          </el-button>
          <el-button
            v-permission="'system:role:delete'"
            link
            type="danger"
            icon="Delete"
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

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item :label="t('role.roleName')" prop="roleName">
          <el-input v-model="form.roleName" />
        </el-form-item>
        <el-form-item :label="t('role.roleCode')" prop="roleCode">
          <el-input v-model="form.roleCode" :placeholder="t('role.roleCodePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('role.dataScope')">
          <el-select v-model="form.dataScope" class="w-full">
            <el-option v-for="o in dataScopeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('common.sortOrder')">
          <el-input-number v-model="form.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item :label="t('common.status')">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">{{ t('status.ENABLED') }}</el-radio>
            <el-radio value="DISABLED">{{ t('status.DISABLED') }}</el-radio>
          </el-radio-group>
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

    <!-- 分配菜单 -->
    <el-dialog v-model="grantVisible" :title="t('role.grantMenuTitle', { name: grantRoleName })" width="420px">
      <el-tree
        ref="treeRef"
        class="max-h-[60vh] overflow-y-auto"
        :data="menuTree"
        show-checkbox
        node-key="id"
        :props="{ label: 'menuName', children: 'children' }"
        default-expand-all
      />
      <template #footer>
        <el-button @click="grantVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleGrantSubmit">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 分配数据权限（部门） -->
    <el-dialog v-model="deptDialogVisible" :title="t('role.grantDataTitle', { name: deptRoleName })" width="420px">
      <el-alert
        v-if="deptRoleScope !== 'CUSTOM_DEPT'"
        type="info"
        :closable="false"
        show-icon
        class="mb-3"
        :title="t('role.dataScopeHint')"
      />
      <el-tree
        ref="deptTreeRef"
        class="max-h-[60vh] overflow-y-auto"
        :data="deptTree"
        show-checkbox
        node-key="id"
        :props="{ label: 'deptName', children: 'children' }"
        default-expand-all
      />
      <template #footer>
        <el-button @click="deptDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleGrantDeptSubmit">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
