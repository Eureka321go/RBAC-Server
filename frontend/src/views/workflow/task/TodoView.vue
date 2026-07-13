<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import WorkflowStatusTag from '@/components/workflow/WorkflowStatusTag.vue'
import DetailDrawer from '@/views/workflow/instance/DetailDrawer.vue'
import { searchAssigneeUsers } from '@/api/workflow/assignee'
import { approveTask, listTodoTasks, rejectTask, transferTask } from '@/api/workflow/task'
import { useWorkflowStore } from '@/stores/workflow'
import type { AssigneeUserOption, WorkflowTask, WorkflowTaskQuery } from '@/types/workflow'
import { formatWorkflowDate } from '@/utils/workflow'

const { t } = useI18n()
const workflowStore = useWorkflowStore()
const loading = ref(false)
const rows = ref<WorkflowTask[]>([])
const total = ref(0)
const query = reactive<WorkflowTaskQuery>({ page: 1, pageSize: 10 })
const detailDrawer = ref<InstanceType<typeof DetailDrawer>>()

async function loadData() {
  loading.value = true
  try {
    const result = await listTodoTasks(query)
    rows.value = result.records
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function resetPageAndLoad() {
  query.page = 1
  loadData()
}

const actionVisible = ref(false)
const actionLoading = ref(false)
const currentTask = ref<WorkflowTask>()
const comment = ref('')
const targetUserId = ref<number>()
const users = ref<AssigneeUserOption[]>([])

async function openAction(task: WorkflowTask) {
  currentTask.value = task
  comment.value = ''
  targetUserId.value = undefined
  users.value = await searchAssigneeUsers('', 50)
  actionVisible.value = true
}

async function searchUsers(keyword: string) {
  users.value = await searchAssigneeUsers(keyword, 50)
}

async function finishAction(action: 'approve' | 'reject' | 'transfer') {
  const task = currentTask.value
  if (!task) return
  if (comment.value.length > 500) {
    ElMessage.error(t('workflow.common.commentTooLong'))
    return
  }
  if (action === 'transfer' && targetUserId.value == null) {
    ElMessage.error(t('workflow.task.targetRequired'))
    return
  }

  actionLoading.value = true
  try {
    if (action === 'approve') await approveTask(task.id, comment.value)
    if (action === 'reject') await rejectTask(task.id, comment.value)
    if (action === 'transfer') await transferTask(task.id, targetUserId.value!, comment.value)
    ElMessage.success(t(`workflow.task.${action}Success`))
    actionVisible.value = false
    await Promise.all([loadData(), workflowStore.refreshTodoCount()])
  } finally {
    actionLoading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('workflow.task.todoTitle')" :description="t('workflow.task.todoDescription')">
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="title" :label="t('workflow.common.title')" min-width="220" />
      <el-table-column prop="processKey" :label="t('workflow.common.processKey')" min-width="120" />
      <el-table-column prop="initiatorName" :label="t('workflow.common.initiator')" min-width="120" />
      <el-table-column prop="nodeName" :label="t('workflow.task.currentNode')" min-width="150" />
      <el-table-column :label="t('workflow.common.status')" width="105"><template #default="{ row }"><WorkflowStatusTag group="task" :value="row.taskStatus" /></template></el-table-column>
      <el-table-column :label="t('workflow.common.createdAt')" min-width="170"><template #default="{ row }">{{ formatWorkflowDate(row.createdAt) }}</template></el-table-column>
      <el-table-column :label="t('common.operation')" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openAction(row)">{{ t('workflow.task.handle') }}</el-button>
          <el-button link @click="detailDrawer?.open(row.instanceId)">{{ t('common.detail') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="mt-4 flex justify-end">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadData" @size-change="resetPageAndLoad" />
    </div>

    <el-drawer v-model="actionVisible" :title="t('workflow.task.handleTitle')" size="min(560px, 92vw)" destroy-on-close>
      <el-descriptions v-if="currentTask" :column="1" border class="mb-5">
        <el-descriptions-item :label="t('workflow.common.title')">{{ currentTask.title }}</el-descriptions-item>
        <el-descriptions-item :label="t('workflow.common.initiator')">{{ currentTask.initiatorName || currentTask.initiatorId }}</el-descriptions-item>
        <el-descriptions-item :label="t('workflow.task.currentNode')">{{ currentTask.nodeName }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-position="top">
        <el-form-item :label="t('workflow.common.comment')">
          <el-input v-model="comment" type="textarea" :rows="5" maxlength="500" show-word-limit :placeholder="t('workflow.common.commentPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('workflow.task.transferTarget')">
          <el-select v-model="targetUserId" filterable remote :remote-method="searchUsers" clearable class="w-full">
            <el-option v-for="user in users" :key="user.id" :label="`${user.nickname} (${user.username})${user.deptName ? ` · ${user.deptName}` : ''}`" :value="user.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-button v-if="currentTask" class="mb-5" @click="detailDrawer?.open(currentTask.instanceId)">{{ t('workflow.task.viewFullDetail') }}</el-button>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button :disabled="actionLoading" @click="actionVisible = false">{{ t('common.cancel') }}</el-button>
          <el-button type="warning" :loading="actionLoading" @click="finishAction('transfer')">{{ t('workflow.task.transfer') }}</el-button>
          <el-button type="danger" :loading="actionLoading" @click="finishAction('reject')">{{ t('workflow.task.reject') }}</el-button>
          <el-button type="success" :loading="actionLoading" @click="finishAction('approve')">{{ t('workflow.task.approve') }}</el-button>
        </div>
      </template>
    </el-drawer>

    <DetailDrawer ref="detailDrawer" />
  </PageContainer>
</template>
