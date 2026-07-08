import request from '../request'
import type { EnableStatus, PageQuery, PageResult } from '@/types/system'

export type DataScope = 'ALL' | 'CUSTOM_DEPT' | 'OWN_DEPT' | 'OWN_DEPT_CHILD' | 'SELF'

export interface RoleItem {
  id: number
  roleName: string
  roleCode: string
  dataScope: DataScope
  builtin: boolean
  sortOrder: number
  status: EnableStatus
  remark?: string
  createdAt?: string
}

export interface RoleQuery extends PageQuery {
  roleName?: string
  roleCode?: string
}

export interface RoleForm {
  roleName: string
  roleCode: string
  dataScope?: DataScope
  sortOrder?: number
  status?: EnableStatus
  remark?: string
}

export function listRoles(params: RoleQuery) {
  return request.get<PageResult<RoleItem>>('/system/roles', { params })
}

export function roleOptions() {
  return request.get<RoleItem[]>('/system/roles/options')
}

export function createRole(data: RoleForm) {
  return request.post<number>('/system/roles', data)
}

export function updateRole(id: number, data: RoleForm) {
  return request.put<void>(`/system/roles/${id}`, data)
}

export function deleteRole(id: number) {
  return request.delete<void>(`/system/roles/${id}`)
}

export function updateRoleStatus(id: number, status: EnableStatus) {
  return request.patch<void>(`/system/roles/${id}/status`, { status })
}

export function getRoleMenuIds(id: number) {
  return request.get<number[]>(`/system/roles/${id}/menus`)
}

export function grantRoleMenus(id: number, menuIds: number[]) {
  return request.put<void>(`/system/roles/${id}/menus`, { menuIds })
}

export function getRoleDeptIds(id: number) {
  return request.get<number[]>(`/system/roles/${id}/depts`)
}

export function grantRoleDepts(id: number, deptIds: number[]) {
  return request.put<void>(`/system/roles/${id}/depts`, { deptIds })
}
