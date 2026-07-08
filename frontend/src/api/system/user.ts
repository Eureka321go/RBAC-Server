import request from '../request'
import type { PageResult, SystemQuery } from '@/types/system'

export interface UserListItem {
  id: number | string
  username: string
  nickname: string
  deptName?: string
  status: 'ENABLED' | 'DISABLED'
  createdAt: string
}

export function listUsers(params: SystemQuery) {
  return request.get<PageResult<UserListItem>>('/system/users', { params })
}
