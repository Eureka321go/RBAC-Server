import { ref } from 'vue'
import { defineStore } from 'pinia'
import { listTodoTasks } from '@/api/workflow/task'

const POLL_INTERVAL_MS = 30_000

export const useWorkflowStore = defineStore('workflow', () => {
  const todoCount = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined

  async function refreshTodoCount() {
    const result = await listTodoTasks({ page: 1, pageSize: 1 })
    todoCount.value = result.total
  }

  function refreshWhenVisible() {
    if (!document.hidden) void refreshTodoCount().catch(() => undefined)
  }

  function handleVisibilityChange() {
    if (!document.hidden) void refreshTodoCount().catch(() => undefined)
  }

  function startPolling() {
    if (timer) return
    refreshWhenVisible()
    timer = setInterval(refreshWhenVisible, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  function stopPolling() {
    if (timer) clearInterval(timer)
    timer = undefined
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }

  return { todoCount, refreshTodoCount, startPolling, stopPolling }
})
