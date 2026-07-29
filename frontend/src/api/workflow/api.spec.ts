import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/api/request', () => ({ default: request }))

import {
  createDefinition,
  deleteDefinition,
  getDefinition,
  listDefinitionOptions,
  listDefinitions,
  updateDefinition,
  updateDefinitionStatus,
} from './definition'
import { searchAssigneeUsers } from './assignee'
import {
  approveTask,
  listDoneTasks,
  listTodoTasks,
  rejectTask,
  transferTask,
} from './task'
import {
  getInstanceDetail,
  listMyCc,
  listMyInstances,
  markCcRead,
  startInstance,
  withdrawInstance,
} from './instance'

describe('workflow API contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the definition endpoints and payloads', () => {
    listDefinitions({ page: 1, pageSize: 10, name: 'leave' })
    updateDefinitionStatus(3, 'DISABLED')

    expect(request.get).toHaveBeenCalledWith('/workflow/definition/page', {
      params: { page: 1, pageSize: 10, name: 'leave' },
    })
    expect(request.patch).toHaveBeenCalledWith('/workflow/definition/3/status', {
      status: 'DISABLED',
    })
  })

  it('covers the complete definition lifecycle', () => {
    const data = {
      processKey: 'leave',
      name: 'Leave',
      status: 'ENABLED' as const,
      nodes: [],
    }
    getDefinition(3)
    listDefinitionOptions()
    createDefinition(data)
    updateDefinition({ ...data, id: 3 })
    deleteDefinition(3)

    expect(request.get).toHaveBeenCalledWith('/workflow/definition/3')
    expect(request.get).toHaveBeenCalledWith('/workflow/definition/options')
    expect(request.post).toHaveBeenCalledWith('/workflow/definition', data)
    expect(request.put).toHaveBeenCalledWith('/workflow/definition', { ...data, id: 3 })
    expect(request.delete).toHaveBeenCalledWith('/workflow/definition/3')
  })

  it('uses task query and approval endpoints', () => {
    listTodoTasks({ page: 1, pageSize: 10 })
    approveTask(8, 'ok')

    expect(request.get).toHaveBeenCalledWith('/workflow/task/todo', {
      params: { page: 1, pageSize: 10 },
    })
    expect(request.post).toHaveBeenCalledWith('/workflow/task/8/approve', { comment: 'ok' })
  })

  it('covers completed, reject, and transfer task endpoints', () => {
    listDoneTasks({ page: 2, pageSize: 20, title: 'trip' })
    rejectTask(8, 'missing receipt')
    transferTask(8, 9, 'please review')

    expect(request.get).toHaveBeenCalledWith('/workflow/task/done', {
      params: { page: 2, pageSize: 20, title: 'trip' },
    })
    expect(request.post).toHaveBeenCalledWith('/workflow/task/8/reject', {
      comment: 'missing receipt',
    })
    expect(request.post).toHaveBeenCalledWith('/workflow/task/8/transfer', {
      targetUserId: 9,
      comment: 'please review',
    })
  })

  it('uses instance and assignee endpoints', () => {
    getInstanceDetail(6)
    startInstance({ processKey: 'leave', title: 'Annual leave', formData: { days: 2 } })
    searchAssigneeUsers('li', 20)

    expect(request.get).toHaveBeenCalledWith('/workflow/instance/6/detail')
    expect(request.post).toHaveBeenCalledWith('/workflow/instance/start', {
      processKey: 'leave',
      title: 'Annual leave',
      formData: { days: 2 },
    })
    expect(request.get).toHaveBeenCalledWith('/workflow/assignee/users', {
      params: { keyword: 'li', limit: 20 },
    })
  })

  it('covers instance lists, withdrawal, and cc endpoints', () => {
    const params = { page: 1, pageSize: 10, title: 'leave' }
    listMyInstances(params)
    withdrawInstance(6, 'changed')
    listMyCc(params)
    markCcRead(12)

    expect(request.get).toHaveBeenCalledWith('/workflow/instance/mine', { params })
    expect(request.post).toHaveBeenCalledWith('/workflow/instance/6/withdraw', {
      comment: 'changed',
    })
    expect(request.get).toHaveBeenCalledWith('/workflow/cc/mine', { params })
    expect(request.post).toHaveBeenCalledWith('/workflow/cc/12/read')
  })
})
