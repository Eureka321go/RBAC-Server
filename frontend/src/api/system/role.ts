import request from '../request'
import type { PageResult, SystemQuery } from '@/types/system'

export interface RoleListItem {
  id: number | string
  roleName: string
  roleCode: string
  dataScope?: string
  status: 'ENABLED' | 'DISABLED'
  sortOrder: number
  createdAt: string
}

export function listRoles(params: SystemQuery) {
  return request.get<PageResult<RoleListItem>>('/system/roles', { params })
}
