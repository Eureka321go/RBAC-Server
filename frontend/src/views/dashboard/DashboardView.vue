<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { getDashboardStats, type DashboardStats } from '@/api/system/dashboard'

const router = useRouter()
const userStore = useUserStore()

const nickname = computed(() => userStore.currentUser?.nickname ?? '管理员')
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '凌晨好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})
const today = computed(() =>
  new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
)

const counts = reactive<DashboardStats>({ userCount: 0, roleCount: 0, menuCount: 0, deptCount: 0 })
const loaded = ref(false)

const stats = computed(() => [
  { label: '系统用户', value: counts.userCount, hint: '在管账户', tone: 'blue', to: '/system/user' },
  { label: '角色数量', value: counts.roleCount, hint: '权限分组', tone: 'violet', to: '/system/role' },
  { label: '菜单资源', value: counts.menuCount, hint: '可控功能点', tone: 'emerald', to: '/system/menu' },
  { label: '部门机构', value: counts.deptCount, hint: '组织架构', tone: 'amber', to: '/system/dept' },
])

onMounted(async () => {
  try {
    const data = (await getDashboardStats()) as unknown as DashboardStats
    Object.assign(counts, data)
  } finally {
    loaded.value = true
  }
})

const quickLinks = [
  { title: '用户管理', desc: '新增账户、分配角色与部门', to: '/system/user' },
  { title: '角色管理', desc: '配置数据范围与菜单权限', to: '/system/role' },
  { title: '菜单管理', desc: '维护目录、菜单与按钮权限', to: '/system/menu' },
  { title: '部门管理', desc: '维护组织树与层级结构', to: '/system/dept' },
]

const toneMap: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
}

function go(to: string) {
  router.push(to)
}
</script>

<template>
  <section class="flex w-full flex-col gap-5">
    <!-- 欢迎横幅 -->
    <div
      class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-7 py-6 text-white shadow-sm"
    >
      <div class="relative z-10">
        <h1 class="text-2xl font-semibold">{{ greeting }}，{{ nickname }} 👋</h1>
        <p class="mt-1.5 text-sm text-blue-100">{{ today }}，欢迎回到 RBAC 权限管理系统。</p>
      </div>
      <div class="pointer-events-none absolute -right-8 -top-10 h-44 w-44 rounded-full bg-white/10"></div>
      <div class="pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-white/5"></div>
    </div>

    <!-- 指标卡 -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <button
        v-for="s in stats"
        :key="s.label"
        type="button"
        class="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        @click="go(s.to)"
      >
        <span
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          :class="toneMap[s.tone]"
        >
          {{ s.label.slice(0, 1) }}
        </span>
        <div class="min-w-0">
          <div class="text-2xl font-semibold leading-none text-slate-900">{{ loaded ? s.value : '—' }}</div>
          <div class="mt-1.5 text-sm font-medium text-slate-600">{{ s.label }}</div>
          <div class="text-xs text-slate-400">{{ s.hint }}</div>
        </div>
      </button>
    </div>

    <!-- 快捷入口 -->
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-semibold text-slate-900">快捷入口</h2>
        <span class="text-xs text-slate-400">常用管理功能</span>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          v-for="link in quickLinks"
          :key="link.to"
          type="button"
          class="group flex flex-col rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/50"
          @click="go(link.to)"
        >
          <span class="text-sm font-semibold text-slate-800 group-hover:text-blue-600">{{ link.title }}</span>
          <span class="mt-1 text-xs leading-relaxed text-slate-500">{{ link.desc }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
