import request from '../request'
import type { EnableStatus } from '@/types/system'

export interface DeptItem {
  id: number
  parentId?: number
  deptName: string
  leaderUserId?: number
  phone?: string
  email?: string
  sortOrder: number
  status: EnableStatus
  createdAt?: string
  children?: DeptItem[]
}

export interface DeptForm {
  parentId?: number | null
  deptName: string
  leaderUserId?: number
  phone?: string
  email?: string
  sortOrder?: number
  status?: EnableStatus
}

export function getDeptTree() {
  return request.get<DeptItem[]>('/system/depts/tree')
}

export function createDept(data: DeptForm) {
  return request.post<number>('/system/depts', data)
}

export function updateDept(id: number, data: DeptForm) {
  return request.put<void>(`/system/depts/${id}`, data)
}

export function deleteDept(id: number) {
  return request.delete<void>(`/system/depts/${id}`)
}

export function updateDeptStatus(id: number, status: EnableStatus) {
  return request.patch<void>(`/system/depts/${id}/status`, { status })
}
