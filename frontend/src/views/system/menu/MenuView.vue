<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()

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
  menuType: [{ required: true, message: t('menu.ruleType'), trigger: 'change' }],
  menuName: [{ required: true, message: t('menu.ruleName'), trigger: 'blur' }],
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
  dialogTitle.value = t('menu.create')
  editingId.value = null
  Object.assign(form, defaultForm(), {
    parentId: parent ? Number(parent.id) : null,
  })
  dialogVisible.value = true
}

function openEdit(row: MenuItem) {
  dialogTitle.value = t('menu.edit')
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
    ElMessage.success(t('common.updated'))
  } else {
    await createMenu({ ...form })
    ElMessage.success(t('common.created'))
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: MenuItem) {
  await ElMessageBox.confirm(t('menu.confirmDelete', { name: row.menuName }), t('common.tip'), { type: 'warning' })
  await deleteMenu(Number(row.id))
  ElMessage.success(t('common.deleted'))
  loadData()
}

async function handleToggleStatus(row: MenuItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateMenuStatus(Number(row.id), next)
  ElMessage.success(t('common.statusUpdated'))
  loadData()
}

const menuTypeTag: Record<MenuType, string> = {
  DIR: 'warning',
  MENU: 'primary',
  BUTTON: 'info',
}
const menuTypeLabel = computed<Record<MenuType, string>>(() => ({
  DIR: t('menu.typeDir'),
  MENU: t('menu.typeMenu'),
  BUTTON: t('menu.typeButton'),
}))

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('menu.title')" :description="t('menu.description')">
    <div class="mb-4">
      <el-button v-permission="'system:menu:add'" type="primary" icon="Plus" @click="openCreate()">{{ t('menu.addTop') }}</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="treeData"
      row-key="id"
      :tree-props="{ children: 'children' }"
      default-expand-all
      border
    >
      <el-table-column prop="menuName" :label="t('menu.menuName')" min-width="200" />
      <el-table-column :label="t('menu.type')" width="90">
        <template #default="{ row }">
          <el-tag :type="menuTypeTag[row.menuType as MenuType]">{{ menuTypeLabel[row.menuType as MenuType] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="path" :label="t('menu.path')" min-width="160" />
      <el-table-column prop="permissionCode" :label="t('menu.permission')" min-width="180" />
      <el-table-column prop="sortOrder" :label="t('common.sortOrder')" width="80" />
      <el-table-column :label="t('common.status')" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? t('status.ENABLED') : t('status.DISABLED') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('common.operation')" width="360" fixed="right" class-name="op-col">
        <template #default="{ row }">
          <el-button v-permission="'system:menu:add'" link type="primary" icon="Plus" @click="openCreate(row)">{{ t('menu.addChild') }}</el-button>
          <el-button v-permission="'system:menu:edit'" link type="primary" icon="Edit" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button v-permission="'system:menu:edit'" link icon="SwitchButton" @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? t('status.DISABLED') : t('status.ENABLED') }}
          </el-button>
          <el-button v-permission="'system:menu:delete'" link type="danger" icon="Delete" @click="handleDelete(row)">{{ t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item :label="t('menu.type')" prop="menuType">
          <el-radio-group v-model="form.menuType">
            <el-radio value="DIR">{{ t('menu.typeDir') }}</el-radio>
            <el-radio value="MENU">{{ t('menu.typeMenu') }}</el-radio>
            <el-radio value="BUTTON">{{ t('menu.typeButton') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('menu.parent')">
          <el-tree-select
            v-model="form.parentId"
            :data="treeData"
            :props="{ label: 'menuName', value: 'id', children: 'children' }"
            check-strictly
            clearable
            :placeholder="t('menu.parentPlaceholder')"
            class="w-full"
          />
        </el-form-item>
        <el-form-item :label="t('menu.menuName')" prop="menuName">
          <el-input v-model="form.menuName" />
        </el-form-item>
        <template v-if="form.menuType !== 'BUTTON'">
          <el-form-item :label="t('menu.path')">
            <el-input v-model="form.path" :placeholder="t('menu.pathPlaceholder')" />
          </el-form-item>
          <el-form-item v-if="form.menuType === 'MENU'" :label="t('menu.component')">
            <el-input v-model="form.component" :placeholder="t('menu.componentPlaceholder')" />
          </el-form-item>
          <el-form-item :label="t('menu.icon')">
            <el-input v-model="form.icon" />
          </el-form-item>
        </template>
        <el-form-item v-if="form.menuType !== 'DIR'" :label="t('menu.permission')">
          <el-input v-model="form.permissionCode" :placeholder="t('menu.permissionPlaceholder')" />
        </el-form-item>
        <el-form-item v-if="form.menuType === 'MENU'" :label="t('menu.keepAlive')">
          <el-switch v-model="form.keepAlive" />
        </el-form-item>
        <el-form-item v-if="form.menuType !== 'BUTTON'" :label="t('menu.visible')">
          <el-switch v-model="form.visible" />
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
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleSubmit">{{ t('common.ok') }}</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
