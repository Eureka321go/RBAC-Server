<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import PageContainer from '@/components/PageContainer.vue'
import {
  createMenu,
  deleteMenu,
  getMenuTree,
  updateMenu,
  updateMenuStatus,
  type MenuForm,
} from '@/api/system/menu'
import type { MenuItem, MenuType } from '@/types/menu'

const loading = ref(false)
const treeData = ref<MenuItem[]>([])

const dialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const defaultForm = (): MenuForm => ({
  parentId: null,
  menuType: 'MENU',
  menuName: '',
  path: '',
  component: '',
  permissionCode: '',
  icon: '',
  sortOrder: 0,
  visible: true,
  keepAlive: false,
  externalLink: '',
  status: 'ENABLED',
})
const form = reactive<MenuForm>(defaultForm())

const rules: FormRules = {
  menuType: [{ required: true, message: '请选择菜单类型', trigger: 'change' }],
  menuName: [{ required: true, message: '请输入菜单名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    treeData.value = await getMenuTree()
  } finally {
    loading.value = false
  }
}

function openCreate(parent?: MenuItem) {
  dialogTitle.value = '新增菜单'
  editingId.value = null
  Object.assign(form, defaultForm(), {
    parentId: parent ? Number(parent.id) : null,
  })
  dialogVisible.value = true
}

function openEdit(row: MenuItem) {
  dialogTitle.value = '编辑菜单'
  editingId.value = Number(row.id)
  Object.assign(form, {
    parentId: row.parentId != null ? Number(row.parentId) : null,
    menuType: row.menuType,
    menuName: row.menuName,
    path: row.path ?? '',
    component: row.component ?? '',
    permissionCode: row.permissionCode ?? '',
    icon: row.icon ?? '',
    sortOrder: row.sortOrder ?? 0,
    visible: row.visible ?? true,
    keepAlive: row.keepAlive ?? false,
    externalLink: '',
    status: row.status,
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  if (editingId.value) {
    await updateMenu(editingId.value, { ...form })
    ElMessage.success('已更新')
  } else {
    await createMenu({ ...form })
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: MenuItem) {
  await ElMessageBox.confirm(`确认删除菜单「${row.menuName}」？`, '提示', { type: 'warning' })
  await deleteMenu(Number(row.id))
  ElMessage.success('已删除')
  loadData()
}

async function handleToggleStatus(row: MenuItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateMenuStatus(Number(row.id), next)
  ElMessage.success('状态已更新')
  loadData()
}

const menuTypeTag: Record<MenuType, string> = {
  DIR: 'warning',
  MENU: 'primary',
  BUTTON: 'info',
}
const menuTypeLabel: Record<MenuType, string> = {
  DIR: '目录',
  MENU: '菜单',
  BUTTON: '按钮',
}

onMounted(loadData)
</script>

<template>
  <PageContainer title="菜单管理" description="维护目录、菜单、按钮和权限标识。">
    <div class="mb-4">
      <el-button v-permission="'system:menu:add'" type="primary" icon="Plus" @click="openCreate()">新增顶级菜单</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="treeData"
      row-key="id"
      :tree-props="{ children: 'children' }"
      default-expand-all
      border
    >
      <el-table-column prop="menuName" label="菜单名称" min-width="200" />
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag :type="menuTypeTag[row.menuType as MenuType]">{{ menuTypeLabel[row.menuType as MenuType] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="path" label="路由路径" min-width="160" />
      <el-table-column prop="permissionCode" label="权限标识" min-width="180" />
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
          <el-button v-permission="'system:menu:add'" link type="primary" icon="Plus" @click="openCreate(row)">新增子级</el-button>
          <el-button v-permission="'system:menu:edit'" link type="primary" icon="Edit" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'system:menu:edit'" link icon="SwitchButton" @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? '禁用' : '启用' }}
          </el-button>
          <el-button v-permission="'system:menu:delete'" link type="danger" icon="Delete" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="菜单类型" prop="menuType">
          <el-radio-group v-model="form.menuType">
            <el-radio value="DIR">目录</el-radio>
            <el-radio value="MENU">菜单</el-radio>
            <el-radio value="BUTTON">按钮</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="上级菜单">
          <el-tree-select
            v-model="form.parentId"
            :data="treeData"
            :props="{ label: 'menuName', value: 'id', children: 'children' }"
            check-strictly
            clearable
            placeholder="不选则为顶级菜单"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="菜单名称" prop="menuName">
          <el-input v-model="form.menuName" />
        </el-form-item>
        <template v-if="form.menuType !== 'BUTTON'">
          <el-form-item label="路由路径">
            <el-input v-model="form.path" placeholder="如 /system/user" />
          </el-form-item>
          <el-form-item v-if="form.menuType === 'MENU'" label="组件路径">
            <el-input v-model="form.component" placeholder="如 system/user/UserView" />
          </el-form-item>
          <el-form-item label="图标">
            <el-input v-model="form.icon" />
          </el-form-item>
        </template>
        <el-form-item v-if="form.menuType !== 'DIR'" label="权限标识">
          <el-input v-model="form.permissionCode" placeholder="如 system:user:list" />
        </el-form-item>
        <el-form-item v-if="form.menuType === 'MENU'" label="页面缓存">
          <el-switch v-model="form.keepAlive" />
        </el-form-item>
        <el-form-item v-if="form.menuType !== 'BUTTON'" label="是否显示">
          <el-switch v-model="form.visible" />
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
