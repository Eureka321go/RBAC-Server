<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const formRef = ref<FormInstance>()
const form = reactive({
  username: 'admin',
  password: 'admin123',
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  try {
    await authStore.login({ username: form.username, password: form.password })
    ElMessage.success('登录成功')
    const redirect = (route.query.redirect as string) || '/'
    await router.replace(redirect)
  } catch {
    // 错误提示已由响应拦截器统一处理
  }
}
</script>

<template>
  <section class="w-full rounded-2xl border border-white/10 bg-white/95 p-8 shadow-2xl backdrop-blur">
    <div class="mb-6 flex items-center gap-3">
      <div
        class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-bold text-white shadow"
      >
        R
      </div>
      <div>
        <h1 class="text-lg font-semibold text-slate-900">RBAC 系统登录</h1>
        <p class="text-xs text-slate-500">权限管理系统 · 后台管理</p>
      </div>
    </div>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="handleSubmit">
      <el-form-item label="账号" prop="username">
        <el-input v-model="form.username" autocomplete="username" placeholder="请输入账号" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          show-password
          placeholder="请输入密码"
        />
      </el-form-item>
      <el-button
        class="mt-1 w-full"
        type="primary"
        size="large"
        :loading="authStore.loginLoading"
        @click="handleSubmit"
      >
        登 录
      </el-button>
    </el-form>
    <p class="mt-4 text-center text-xs text-slate-400">默认账号 admin / admin123</p>
  </section>
</template>
