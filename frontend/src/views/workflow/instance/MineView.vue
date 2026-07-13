<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import FormDataEditor from '@/components/workflow/FormDataEditor.vue'
import WorkflowStatusTag from '@/components/workflow/WorkflowStatusTag.vue'
import DetailDrawer from './DetailDrawer.vue'
import { listDefinitionOptions } from '@/api/workflow/definition'
import { listMyInstances, startInstance, withdrawInstance } from '@/api/workflow/instance'
import type { WorkflowDefinitionOption, WorkflowInstance, WorkflowInstanceQuery } from '@/types/workflow'
import { formatWorkflowDate } from '@/utils/workflow'
import { buildStartPayload, createStartEditorForm, type StartEditorForm } from './mine-form'

const { t } = useI18n()
const loading = ref(false)
const rows = ref<WorkflowInstance[]>([])
const total = ref(0)
const query = reactive<WorkflowInstanceQuery>({ page: 1, pageSize: 10, processKey: '', title: '', instanceStatus: '' })
const detailDrawer = ref<InstanceType<typeof DetailDrawer>>()

async function loadData() {
  loading.value = true
  try {
    const result = await listMyInstances(query)
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
  Object.assign(query, { processKey: '', title: '', instanceStatus: '' })
  search()
}

const startVisible = ref(false)
const startLoading = ref(false)
const startFormRef = ref<FormInstance>()
const startForm = reactive<StartEditorForm>(createStartEditorForm())
const definitions = ref<WorkflowDefinitionOption[]>([])
const startRules: FormRules = {
  processKey: [{ required: true, message: t('workflow.instance.processRequired'), trigger: 'change' }],
  title: [{ required: true, message: t('workflow.instance.titleRequired'), trigger: 'blur' }],
}

async function openStart() {
  Object.assign(startForm, createStartEditorForm())
  startForm.fields = []
  definitions.value = await listDefinitionOptions()
  startVisible.value = true
}

async function submitStart() {
  const valid = await startFormRef.value?.validate().catch(() => false)
  if (!valid) return
  let payload
  try {
    payload = buildStartPayload(startForm)
  } catch (error) {
    ElMessage.error(t((error as Error).message))
    return
  }

  startLoading.value = true
  try {
    await startInstance(payload)
    ElMessage.success(t('workflow.instance.started'))
    startVisible.value = false
    await loadData()
  } finally {
    startLoading.value = false
  }
}

async function withdraw(row: WorkflowInstance) {
  const result = await ElMessageBox.prompt(
    t('workflow.instance.withdrawPrompt'),
    t('workflow.instance.withdraw'),
    {
      inputType: 'textarea',
      inputPlaceholder: t('workflow.common.commentPlaceholder'),
      inputValidator: (value) => value.length <= 500 || t('workflow.common.commentTooLong'),
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    },
  )
  await withdrawInstance(row.id, result.value)
  ElMessage.success(t('workflow.instance.withdrawn'))
  await loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('workflow.instance.mineTitle')" :description="t('workflow.instance.mineDescription')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('workflow.common.title')"><el-input v-model="query.title" clearable @keyup.enter="search" /></el-form-item>
      <el-form-item :label="t('workflow.common.processKey')"><el-input v-model="query.processKey" clearable @keyup.enter="search" /></el-form-item>
      <el-form-item :label="t('common.status')">
        <el-select v-model="query.instanceStatus" clearable class="w-32">
          <el-option v-for="status in ['DRAFT','RUNNING','APPROVED','REJECTED','CANCELED']" :key="status" :label="t(`workflow.instance.${status}`)" :value="status" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="search">{{ t('common.search') }}</el-button>
        <el-button icon="Refresh" @click="reset">{{ t('common.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <el-button v-permission="'workflow:instance:start'" type="primary" icon="Plus" class="mb-3" @click="openStart">
      {{ t('workflow.instance.start') }}
    </el-button>

    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="title" :label="t('workflow.common.title')" min-width="210" />
      <el-table-column prop="processKey" :label="t('workflow.common.processKey')" min-width="120" />
      <el-table-column prop="businessKey" :label="t('workflow.common.businessKey')" min-width="130" />
      <el-table-column :label="t('common.status')" width="110"><template #default="{ row }"><WorkflowStatusTag group="instance" :value="row.instanceStatus" /></template></el-table-column>
      <el-table-column prop="currentNodeOrder" :label="t('workflow.instance.currentNode')" width="100" />
      <el-table-column :label="t('workflow.common.submitTime')" min-width="170"><template #default="{ row }">{{ formatWorkflowDate(row.submitTime) }}</template></el-table-column>
      <el-table-column :label="t('common.operation')" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="detailDrawer?.open(row.id)">{{ t('common.detail') }}</el-button>
          <el-button v-if="row.instanceStatus === 'RUNNING'" link type="warning" @click="withdraw(row)">{{ t('workflow.instance.withdraw') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="mt-4 flex justify-end">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadData" @size-change="search" />
    </div>

    <el-dialog v-model="startVisible" :title="t('workflow.instance.start')" width="min(760px, 94vw)" destroy-on-close>
      <el-form ref="startFormRef" :model="startForm" :rules="startRules" label-width="100px">
        <el-form-item :label="t('workflow.instance.process')" prop="processKey">
          <el-select v-model="startForm.processKey" class="w-full" filterable>
            <el-option v-for="item in definitions" :key="item.processKey" :label="`${item.name} (v${item.version})`" :value="item.processKey" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('workflow.common.title')" prop="title"><el-input v-model="startForm.title" maxlength="255" /></el-form-item>
        <el-form-item :label="t('workflow.common.businessKey')"><el-input v-model="startForm.businessKey" maxlength="64" /></el-form-item>
        <el-form-item :label="t('workflow.detail.formSnapshot')"><FormDataEditor v-model="startForm.fields" class="w-full" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="startVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="startLoading" @click="submitStart">{{ t('workflow.instance.submit') }}</el-button>
      </template>
    </el-dialog>

    <DetailDrawer ref="detailDrawer" />
  </PageContainer>
</template>
