<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const activePath = computed(() => route.path)
</script>

<template>
  <el-container class="min-h-screen">
    <el-aside width="240px" class="border-r border-slate-200 bg-white">
      <div class="flex h-14 items-center border-b border-slate-200 px-5 text-base font-semibold text-slate-900">
        RBAC Admin
      </div>
      <el-menu :default-active="activePath" router>
        <el-menu-item index="/dashboard">控制台</el-menu-item>
        <el-sub-menu index="/system">
          <template #title>系统管理</template>
          <el-menu-item index="/system/user">用户管理</el-menu-item>
          <el-menu-item index="/system/role">角色管理</el-menu-item>
          <el-menu-item index="/system/menu">菜单管理</el-menu-item>
          <el-menu-item index="/system/dept">部门管理</el-menu-item>
          <el-menu-item index="/system/post">岗位管理</el-menu-item>
          <el-menu-item index="/system/config">参数配置</el-menu-item>
          <el-menu-item index="/system/dict">字典管理</el-menu-item>
          <el-menu-item index="/system/log">日志审计</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="flex items-center justify-between border-b border-slate-200 bg-white px-6">
        <span class="text-sm text-slate-500">前端 RBAC 框架</span>
        <el-button text>退出登录</el-button>
      </el-header>
      <el-main class="bg-slate-50 p-6">
        <RouterView />
      </el-main>
    </el-container>
  </el-container>
</template>
