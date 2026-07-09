<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const formRef = ref<FormInstance>()
const form = reactive({
  username: 'admin',
  password: 'admin123',
})

const rules = computed<FormRules>(() => ({
  username: [{ required: true, message: t('login.usernameRequired'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.passwordRequired'), trigger: 'blur' }],
}))

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  try {
    await authStore.login({ username: form.username, password: form.password })
    ElMessage.success(t('login.success'))
    const redirect = (route.query.redirect as string) || '/'
    await router.replace(redirect)
  } catch {
    // 错误提示已由响应拦截器统一处理
  }
}
</script>

<template>
  <section class="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 shadow-2xl backdrop-blur">
    <div class="mb-6 flex items-center gap-3">
      <div
        class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-bold text-white shadow"
      >
        R
      </div>
      <div>
        <h1 class="text-lg font-semibold text-[var(--app-text)]">{{ t('login.title') }}</h1>
        <p class="text-xs text-[var(--app-text-secondary)]">{{ t('login.subtitle') }}</p>
      </div>
    </div>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="handleSubmit">
      <el-form-item :label="t('login.username')" prop="username">
        <el-input v-model="form.username" autocomplete="username" :placeholder="t('login.usernamePlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('login.password')" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          show-password
          :placeholder="t('login.passwordPlaceholder')"
        />
      </el-form-item>
      <el-button
        class="mt-1 w-full"
        type="primary"
        size="large"
        :loading="authStore.loginLoading"
        @click="handleSubmit"
      >
        {{ t('login.submit') }}
      </el-button>
    </el-form>
    <p class="mt-4 text-center text-xs text-[var(--app-text-secondary)]">{{ t('login.hint') }}</p>
  </section>
</template>
