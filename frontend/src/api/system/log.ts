import request from '../request'
import type { PageResult, SystemQuery } from '@/types/system'

export interface LogListItem {
  id: number | string
  username: string
  action: string
  ip: string
  status: string
  createdAt: string
}

export function listOperationLogs(params: SystemQuery) {
  return request.get<PageResult<LogListItem>>('/system/logs/operation', { params })
}
