import request from '@/api/request'
import type { PageResult } from '@/types/system'
import type { WorkflowTask, WorkflowTaskQuery } from '@/types/workflow'

export function listTodoTasks(params: WorkflowTaskQuery) {
  return request.get<PageResult<WorkflowTask>>('/workflow/task/todo', { params })
}

export function listDoneTasks(params: WorkflowTaskQuery) {
  return request.get<PageResult<WorkflowTask>>('/workflow/task/done', { params })
}

export function approveTask(id: number, comment?: string) {
  return request.post<void>(`/workflow/task/${id}/approve`, { comment })
}

export function rejectTask(id: number, comment?: string) {
  return request.post<void>(`/workflow/task/${id}/reject`, { comment })
}

export function transferTask(id: number, targetUserId: number, comment?: string) {
  return request.post<void>(`/workflow/task/${id}/transfer`, { targetUserId, comment })
}
