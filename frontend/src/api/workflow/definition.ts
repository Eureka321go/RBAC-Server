import request from '@/api/request'
import type { EnableStatus, PageResult } from '@/types/system'
import type {
  WorkflowDefinition,
  WorkflowDefinitionForm,
  WorkflowDefinitionOption,
  WorkflowDefinitionQuery,
} from '@/types/workflow'

export function listDefinitions(params: WorkflowDefinitionQuery) {
  return request.get<PageResult<WorkflowDefinition>>('/workflow/definition/page', { params })
}

export function getDefinition(id: number) {
  return request.get<WorkflowDefinition>(`/workflow/definition/${id}`)
}

export function listDefinitionOptions() {
  return request.get<WorkflowDefinitionOption[]>('/workflow/definition/options')
}

export function createDefinition(data: WorkflowDefinitionForm) {
  return request.post<number>('/workflow/definition', data)
}

export function updateDefinition(data: WorkflowDefinitionForm) {
  return request.put<number>('/workflow/definition', data)
}

export function updateDefinitionStatus(id: number, status: EnableStatus) {
  return request.patch<void>(`/workflow/definition/${id}/status`, { status })
}

export function deleteDefinition(id: number) {
  return request.delete<void>(`/workflow/definition/${id}`)
}
