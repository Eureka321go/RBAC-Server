import request from '../request'
import type { PageQuery, PageResult } from '@/types/system'

export interface LoginLogItem {
  id: number
  username: string
  status: string
  message?: string
  ip?: string
  userAgent?: string
  loginAt?: string
}

export interface LoginLogQuery extends PageQuery {
  username?: string
}

export interface OperationLogItem {
  id: number
  title: string
  businessType: string
  method?: string
  requestUri?: string
  requestMethod?: string
  operator?: string
  deptId?: number
  params?: string
  status: string
  errorMsg?: string
  costMs?: number
  ip?: string
  operateAt?: string
}

export interface OperationLogQuery extends PageQuery {
  title?: string
  operator?: string
}

export function listLoginLogs(params: LoginLogQuery) {
  return request.get<PageResult<LoginLogItem>>('/system/login-logs', { params })
}

export function listOperationLogs(params: OperationLogQuery) {
  return request.get<PageResult<OperationLogItem>>('/system/operation-logs', { params })
}
