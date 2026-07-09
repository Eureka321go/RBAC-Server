<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import PageContainer from '@/components/PageContainer.vue'
import {
  createPost,
  deletePost,
  listPosts,
  updatePost,
  updatePostStatus,
  type PostForm,
  type PostItem,
  type PostQuery,
} from '@/api/system/post'

const { t } = useI18n()

const loading = ref(false)
const tableData = ref<PostItem[]>([])
const total = ref(0)

const query = reactive<PostQuery>({ page: 1, pageSize: 10, postName: '', postCode: '' })

async function loadData() {
  loading.value = true
  try {
    const res = await listPosts(query)
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
  query.postName = ''
  query.postCode = ''
  handleSearch()
}

const dialogVisible = ref(false)
const dialogTitle = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const defaultForm = (): PostForm => ({ postName: '', postCode: '', sortOrder: 0, status: 'ENABLED', remark: '' })
const form = reactive<PostForm>(defaultForm())
const rules: FormRules = {
  postName: [{ required: true, message: t('post.ruleName'), trigger: 'blur' }],
  postCode: [{ required: true, message: t('post.ruleCode'), trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = t('post.create')
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: PostItem) {
  dialogTitle.value = t('post.edit')
  editingId.value = row.id
  Object.assign(form, {
    postName: row.postName,
    postCode: row.postCode,
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
    await updatePost(editingId.value, { ...form })
    ElMessage.success(t('common.updated'))
  } else {
    await createPost({ ...form })
    ElMessage.success(t('common.created'))
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: PostItem) {
  await ElMessageBox.confirm(t('post.confirmDelete', { name: row.postName }), t('common.tip'), { type: 'warning' })
  await deletePost(row.id)
  ElMessage.success(t('common.deleted'))
  loadData()
}

async function handleToggleStatus(row: PostItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updatePostStatus(row.id, next)
  ElMessage.success(t('common.statusUpdated'))
  loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer :title="t('post.title')" :description="t('post.description')">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item :label="t('post.postName')">
        <el-input v-model="query.postName" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item :label="t('post.postCode')">
        <el-input v-model="query.postCode" clearable :placeholder="t('common.inputPlaceholder')" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">{{ t('common.search') }}</el-button>
        <el-button @click="handleReset">{{ t('common.reset') }}</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:post:add'" type="primary" @click="openCreate">{{ t('post.addPost') }}</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="postName" :label="t('post.postName')" min-width="160" />
      <el-table-column prop="postCode" :label="t('post.postCode')" min-width="160" />
      <el-table-column prop="sortOrder" :label="t('common.sortOrder')" width="80" />
      <el-table-column :label="t('common.status')" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? t('status.ENABLED') : t('status.DISABLED') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" :label="t('common.remark')" min-width="160" />
      <el-table-column :label="t('common.operation')" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'system:post:edit'" link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button v-permission="'system:post:edit'" link @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? t('status.DISABLED') : t('status.ENABLED') }}
          </el-button>
          <el-button v-permission="'system:post:delete'" link type="danger" @click="handleDelete(row)">{{ t('common.delete') }}</el-button>
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item :label="t('post.postName')" prop="postName">
          <el-input v-model="form.postName" />
        </el-form-item>
        <el-form-item :label="t('post.postCode')" prop="postCode">
          <el-input v-model="form.postCode" :placeholder="t('post.codePlaceholder')" />
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
  </PageContainer>
</template>
