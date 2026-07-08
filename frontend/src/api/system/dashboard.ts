import request from '../request'

export interface DashboardStats {
  userCount: number
  roleCount: number
  menuCount: number
  deptCount: number
}

export function getDashboardStats() {
  return request.get<DashboardStats>('/system/dashboard/stats')
}
