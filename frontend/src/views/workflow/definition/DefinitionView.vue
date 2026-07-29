<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import WorkflowStatusTag from '@/components/workflow/WorkflowStatusTag.vue'
import {
  createDefinition,
  deleteDefinition,
  getDefinition,
  listDefinitions,
  updateDefinition,
  updateDefinitionStatus,
} from '@/api/workflow/definition'
import { searchAssigneeUsers } from '@/api/workflow/assignee'
import { roleOptions, type RoleItem } from '@/api/system/role'
import { postOptions, type PostItem } from '@/api/system/post'
import type { AssigneeUserOption, WorkflowDefinition, WorkflowDefinitionQuery } from '@/types/workflow'
import { formatWorkflowDate } from '@/utils/workflow'
import {
  createEmptyDefinitionForm,
  createEmptyNode,
  definitionToEditorForm,
  serializeDefinitionForm,
  type DefinitionEditorForm,
} from './definition-form'

const { t } = useI18n()
const loading = ref(false)
const rows = ref<WorkflowDefinition[]>([])
const total = ref(0)
const query = reactive<WorkflowDefinitionQuery>({
  page: 1,
  pageSize: 10,
  processKey: '',
  name: '',
  category: '',
  status: undefined,
})

async function loadData() {
  loading.value = true
  try {
    const result = await listDefinitions(query)
    rows.value = result.records
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  loadData()
}

function reset() {
  Object.assign(query, { processKey: '', name: '', category: '', status: undefined })
  search()
}

const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive<DefinitionEditorForm>(createEmptyDefinitionForm())
const isEditing = computed(() => form.id != null)
const rules: FormRules = {
  processKey: [
    { required: true, message: t('workflow.definition.processKeyRequired'), trigger: 'blur' },
    { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: t('workflow.definition.processKeyPattern'), trigger: 'blur' },
  ],
  name: [{ required: true, message: t('workflow.definition.nameRequired'), trigger: 'blur' }],
}

const users = ref<AssigneeUserOption[]>([])
const roles = ref<RoleItem[]>([])
const posts = ref<PostItem[]>([])
const optionLoading = ref(false)

async function loadOptions() {
  optionLoading.value = true
  try {
    const [userData, roleData, postData] = await Promise.all([
      searchAssigneeUsers('', 50),
      roleOptions(),
      postOptions(),
    ])
    users.value = userData
    roles.value = roleData
    posts.value = postData
  } finally {
    optionLoading.value = false
  }
}

async function remoteUsers(keyword: string) {
  users.value = await searchAssigneeUsers(keyword, 50)
}

function resetForm(next: DefinitionEditorForm) {
  Object.assign(form, next)
  form.nodes = next.nodes.map((node) => ({ ...node, assigneeIds: [...node.assigneeIds] }))
}

async function openCreate() {
  resetForm(createEmptyDefinitionForm())
  dialogVisible.value = true
  await loadOptions()
}

async function openEdit(row: WorkflowDefinition) {
  const detail = await getDefinition(row.id)
  resetForm(definitionToEditorForm(detail))
  dialogVisible.value = true
  await loadOptions()
}

function addNode() {
  form.nodes = [...form.nodes, createEmptyNode()]
}

function removeNode(index: number) {
  if (form.nodes.length === 1) {
    ElMessage.warning(t('workflow.definition.nodesRequired'))
    return
  }
  form.nodes = form.nodes.filter((_, nodeIndex) => nodeIndex !== index)
}

function moveNode(index: number, offset: -1 | 1) {
  const target = index + offset
  if (target < 0 || target >= form.nodes.length) return
  const next = [...form.nodes]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  form.nodes = next
}

function assigneeOptions(type: string) {
  if (type === 'USER') return users.value.map((item) => ({ label: `${item.nickname} (${item.username})`, value: item.id }))
  if (type === 'ROLE') return roles.value.map((item) => ({ label: item.roleName, value: item.id }))
  return posts.value.map((item) => ({ label: item.postName, value: item.id }))
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (form.nodes.some((node) => !node.nodeName.trim())) {
    ElMessage.error(t('workflow.node.nameRequired'))
    return
  }

  let payload
  try {
    payload = serializeDefinitionForm(form)
  } catch (error) {
    ElMessage.error(t((error as Error).message))
    return
  }

  submitting.value = true
  try {
    if (isEditing.value) {
      await updateDefinition(payload)
      ElMessage.success(t('common.updated'))
    } else {
      await createDefinition(payload)
      ElMessage.success(t('common.created'))
    }
    dialogVisible.value = false
    await loadData()
  } finally {
    submitting.value = false
  }
}

async function toggleStatus(row: WorkflowDefinition) {
  const status = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updateDefinitionStatus(row.id, status)
  ElMessage.success(t('common.statusUpdated'))
  await loadData()
}

async function remove(row: WorkflowDefinition) {
  await ElMessageBox.confirm(
    t('workflow.definition.deleteConfirm', { name: row.name }),
    t('common.tip'),
    { type: 'warning' },
  )
  await deleteDefinition(row.id)
  ElMessage.success(t('common.deleted'))
  await loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('workflow.definition.title')" :description="t('workflow.definition.description')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('workflow.common.processKey')">
        <el-input v-model="query.processKey" clearable @keyup.enter="search" />
      </el-form-item>
      <el-form-item :label="t('workflow.definition.name')">
        <el-input v-model="query.name" clearable @keyup.enter="search" />
      </el-form-item>
      <el-form-item :label="t('workflow.definition.category')">
        <el-input v-model="query.category" clearable @keyup.enter="search" />
      </el-form-item>
      <el-form-item :label="t('common.status')">
        <el-select v-model="query.status" clearable class="w-28">
          <el-option :label="t('status.ENABLED')" value="ENABLED" />
          <el-option :label="t('status.DISABLED')" value="DISABLED" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="search">{{ t('common.search') }}</el-button>
        <el-button icon="Refresh" @click="reset">{{ t('common.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <el-button v-permission="'workflow:definition:add'" type="primary" icon="Plus" class="mb-3" @click="openCreate">
      {{ t('workflow.definition.add') }}
    </el-button>

    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="processKey" :label="t('workflow.common.processKey')" min-width="130" />
      <el-table-column prop="name" :label="t('workflow.definition.name')" min-width="160" />
      <el-table-column prop="category" :label="t('workflow.definition.category')" min-width="110" />
      <el-table-column prop="formKey" :label="t('workflow.definition.formKey')" min-width="110" />
      <el-table-column prop="version" :label="t('workflow.definition.version')" width="80" />
      <el-table-column :label="t('common.status')" width="100">
        <template #default="{ row }"><WorkflowStatusTag group="definition" :value="row.status" /></template>
      </el-table-column>
      <el-table-column :label="t('workflow.common.createdAt')" min-width="170">
        <template #default="{ row }">{{ formatWorkflowDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('common.operation')" width="250" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'workflow:definition:edit'" link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button v-permission="'workflow:definition:edit'" link @click="toggleStatus(row)">
            {{ row.status === 'ENABLED' ? t('common.disable') : t('common.enable') }}
          </el-button>
          <el-button v-permission="'workflow:definition:remove'" link type="danger" @click="remove(row)">{{ t('common.delete') }}</el-button>
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
        @size-change="search"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? t('workflow.definition.edit') : t('workflow.definition.create')"
      width="min(1000px, 94vw)"
      top="5vh"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <div class="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <el-form-item :label="t('workflow.common.processKey')" prop="processKey">
            <el-input v-model="form.processKey" :disabled="isEditing" />
          </el-form-item>
          <el-form-item :label="t('workflow.definition.name')" prop="name"><el-input v-model="form.name" /></el-form-item>
          <el-form-item :label="t('workflow.definition.category')"><el-input v-model="form.category" /></el-form-item>
          <el-form-item :label="t('workflow.definition.formKey')"><el-input v-model="form.formKey" /></el-form-item>
          <el-form-item :label="t('common.status')">
            <el-radio-group v-model="form.status">
              <el-radio value="ENABLED">{{ t('status.ENABLED') }}</el-radio>
              <el-radio value="DISABLED">{{ t('status.DISABLED') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('common.remark')"><el-input v-model="form.remark" /></el-form-item>
        </div>

        <el-divider content-position="left">{{ t('workflow.definition.nodes') }}</el-divider>
        <div v-loading="optionLoading" class="space-y-3">
          <el-card v-for="(node, index) in form.nodes" :key="index" shadow="never">
            <template #header>
              <div class="flex items-center justify-between">
                <strong>{{ t('workflow.node.heading', { order: index + 1 }) }}</strong>
                <div>
                  <el-button link icon="Top" :disabled="index === 0" @click="moveNode(index, -1)" />
                  <el-button link icon="Bottom" :disabled="index === form.nodes.length - 1" @click="moveNode(index, 1)" />
                  <el-button link type="danger" icon="Delete" @click="removeNode(index)" />
                </div>
              </div>
            </template>
            <div class="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              <el-form-item :label="t('workflow.node.name')" required><el-input v-model="node.nodeName" /></el-form-item>
              <el-form-item :label="t('workflow.node.assigneeType')">
                <el-select v-model="node.assigneeType" class="w-full" @change="node.assigneeIds = []">
                  <el-option v-for="type in ['USER','ROLE','POST','DEPT_LEADER','INITIATOR_SELF','INITIATOR_LEADER']" :key="type" :label="t(`workflow.assigneeType.${type}`)" :value="type" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="['USER','ROLE','POST'].includes(node.assigneeType)" :label="t('workflow.node.assignees')" required>
                <el-select
                  v-model="node.assigneeIds"
                  multiple
                  filterable
                  :remote="node.assigneeType === 'USER'"
                  :remote-method="remoteUsers"
                  class="w-full"
                >
                  <el-option v-for="option in assigneeOptions(node.assigneeType)" :key="option.value" :label="option.label" :value="option.value" />
                </el-select>
              </el-form-item>
              <el-form-item :label="t('workflow.node.approveMode')">
                <el-select v-model="node.approveMode" class="w-full">
                  <el-option v-for="mode in ['ANY','ALL','SEQUENTIAL']" :key="mode" :label="t(`workflow.approveMode.${mode}`)" :value="mode" />
                </el-select>
              </el-form-item>
              <el-form-item :label="t('workflow.node.rejectStrategy')">
                <el-select v-model="node.rejectStrategy" class="w-full">
                  <el-option v-for="strategy in ['TO_INITIATOR','TO_PREV']" :key="strategy" :label="t(`workflow.rejectStrategy.${strategy}`)" :value="strategy" />
                </el-select>
              </el-form-item>
              <el-form-item :label="t('workflow.node.condition')"><el-input v-model="node.conditionExpr" placeholder="amount > 5000" /></el-form-item>
            </div>
          </el-card>
          <el-button plain icon="Plus" @click="addNode">{{ t('workflow.node.add') }}</el-button>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </PageContainer>
</template>
