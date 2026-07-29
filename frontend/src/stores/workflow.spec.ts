// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listTodoTasks = vi.hoisted(() => vi.fn())
vi.mock('@/api/workflow/task', () => ({ listTodoTasks }))

import { useWorkflowStore } from './workflow'

describe('workflow pending task polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.restoreAllMocks()
    listTodoTasks.mockReset().mockResolvedValue({ records: [], total: 4, page: 1, pageSize: 1 })
    setActivePinia(createPinia())
  })

  it('refreshes immediately and every 30 seconds while visible', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const store = useWorkflowStore()

    store.startPolling()
    await vi.waitFor(() => expect(listTodoTasks).toHaveBeenCalledTimes(1))
    expect(store.todoCount).toBe(4)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(listTodoTasks).toHaveBeenCalledTimes(2)
    store.stopPolling()
  })

  it('pauses while hidden and refreshes when visibility returns', async () => {
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const store = useWorkflowStore()
    store.startPolling()
    await vi.waitFor(() => expect(listTodoTasks).toHaveBeenCalledTimes(1))

    hidden = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(listTodoTasks).toHaveBeenCalledTimes(1)

    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(listTodoTasks).toHaveBeenCalledTimes(2))
    store.stopPolling()
  })

  it('keeps the previous successful count after a failed refresh', async () => {
    const store = useWorkflowStore()
    await store.refreshTodoCount()
    listTodoTasks.mockRejectedValueOnce(new Error('network'))
    await expect(store.refreshTodoCount()).rejects.toThrow('network')
    expect(store.todoCount).toBe(4)
  })
})
