import request from '../request'
import type { EnableStatus } from '@/types/menu'

export interface DeptItem {
  id: number | string
  parentId?: number | string | null
  deptName: string
  status: EnableStatus
  children?: DeptItem[]
}

export function listDepts() {
  return request.get<DeptItem[]>('/system/depts')
}
