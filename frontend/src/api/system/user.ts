import request from '../request'
import type { EnableStatus, PageQuery, PageResult } from '@/types/system'

export interface UserItem {
  id: number
  deptId?: number
  deptName?: string
  username: string
  nickname: string
  email?: string
  phone?: string
  gender?: string
  status: EnableStatus
  remark?: string
  lastLoginAt?: string
  createdAt?: string
  roleIds: number[]
  roleNames: string[]
  postIds: number[]
  postNames: string[]
}

export interface UserQuery extends PageQuery {
  username?: string
  nickname?: string
  phone?: string
  deptId?: number
}

export interface UserForm {
  username?: string
  nickname: string
  password?: string
  deptId?: number
  email?: string
  phone?: string
  gender?: string
  status?: EnableStatus
  remark?: string
  roleIds: number[]
  postIds: number[]
}

export function listUsers(params: UserQuery) {
  return request.get<PageResult<UserItem>>('/system/users', { params })
}

export function getUser(id: number) {
  return request.get<UserItem>(`/system/users/${id}`)
}

export function createUser(data: UserForm) {
  return request.post<number>('/system/users', data)
}

export function updateUser(id: number, data: UserForm) {
  return request.put<void>(`/system/users/${id}`, data)
}

export function deleteUser(id: number) {
  return request.delete<void>(`/system/users/${id}`)
}

export function updateUserStatus(id: number, status: EnableStatus) {
  return request.patch<void>(`/system/users/${id}/status`, { status })
}

export function resetUserPassword(id: number, password: string) {
  return request.patch<void>(`/system/users/${id}/password`, { password })
}

export function assignUserRoles(id: number, roleIds: number[]) {
  return request.put<void>(`/system/users/${id}/roles`, { roleIds })
}
