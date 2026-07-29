import request from '@/api/request'
import type { PageResult } from '@/types/system'
import type {
  InstanceStartForm,
  WorkflowCc,
  WorkflowInstance,
  WorkflowInstanceDetail,
  WorkflowInstanceQuery,
} from '@/types/workflow'

export function startInstance(data: InstanceStartForm) {
  return request.post<number>('/workflow/instance/start', data)
}

export function listMyInstances(params: WorkflowInstanceQuery) {
  return request.get<PageResult<WorkflowInstance>>('/workflow/instance/mine', { params })
}

export function getInstanceDetail(id: number) {
  return request.get<WorkflowInstanceDetail>(`/workflow/instance/${id}/detail`)
}

export function withdrawInstance(id: number, comment?: string) {
  return request.post<void>(`/workflow/instance/${id}/withdraw`, { comment })
}

export function listMyCc(params: WorkflowInstanceQuery) {
  return request.get<PageResult<WorkflowCc>>('/workflow/cc/mine', { params })
}

export function markCcRead(id: number) {
  return request.post<void>(`/workflow/cc/${id}/read`)
}
