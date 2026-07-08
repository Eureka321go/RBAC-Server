<script setup lang="ts">
import { reactive } from 'vue'

const form = reactive({
  username: '',
  password: '',
})
</script>

<template>
  <section class="w-full max-w-sm rounded border border-slate-200 bg-white p-6 shadow-sm">
    <h1 class="mb-6 text-xl font-semibold text-slate-900">RBAC 系统登录</h1>
    <el-form :model="form" label-position="top">
      <el-form-item label="账号">
        <el-input v-model="form.username" autocomplete="username" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="form.password" type="password" autocomplete="current-password" show-password />
      </el-form-item>
      <el-button class="w-full" type="primary">登录</el-button>
    </el-form>
  </section>
</template>
