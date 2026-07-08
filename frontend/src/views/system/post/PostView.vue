<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
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
  postName: [{ required: true, message: '请输入岗位名称', trigger: 'blur' }],
  postCode: [{ required: true, message: '请输入岗位编码', trigger: 'blur' }],
}

function openCreate() {
  dialogTitle.value = '新增岗位'
  editingId.value = null
  Object.assign(form, defaultForm())
  dialogVisible.value = true
}

function openEdit(row: PostItem) {
  dialogTitle.value = '编辑岗位'
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
    ElMessage.success('已更新')
  } else {
    await createPost({ ...form })
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: PostItem) {
  await ElMessageBox.confirm(`确认删除岗位「${row.postName}」？`, '提示', { type: 'warning' })
  await deletePost(row.id)
  ElMessage.success('已删除')
  loadData()
}

async function handleToggleStatus(row: PostItem) {
  const next = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  await updatePostStatus(row.id, next)
  ElMessage.success('状态已更新')
  loadData()
}

onMounted(loadData)
</script>

<template>
  <PageContainer title="岗位管理" description="维护岗位编码、名称和启用状态。">
    <el-form :inline="true" :model="query" class="mb-2">
      <el-form-item label="岗位名称">
        <el-input v-model="query.postName" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item label="岗位编码">
        <el-input v-model="query.postCode" clearable placeholder="请输入" @keyup.enter="handleSearch" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="mb-3">
      <el-button v-permission="'system:post:add'" type="primary" @click="openCreate">新增岗位</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" border>
      <el-table-column prop="postName" label="岗位名称" min-width="160" />
      <el-table-column prop="postCode" label="岗位编码" min-width="160" />
      <el-table-column prop="sortOrder" label="排序" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'">
            {{ row.status === 'ENABLED' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="160" />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'system:post:edit'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'system:post:edit'" link @click="handleToggleStatus(row)">
            {{ row.status === 'ENABLED' ? '禁用' : '启用' }}
          </el-button>
          <el-button v-permission="'system:post:delete'" link type="danger" @click="handleDelete(row)">删除</el-button>
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
        <el-form-item label="岗位名称" prop="postName">
          <el-input v-model="form.postName" />
        </el-form-item>
        <el-form-item label="岗位编码" prop="postCode">
          <el-input v-model="form.postCode" placeholder="如 pm" />
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
  </PageContainer>
</template>
