import request from '../request'
import type { MenuItem, MenuType } from '@/types/menu'
import type { EnableStatus } from '@/types/system'

export interface MenuForm {
  parentId?: number | null
  menuType: MenuType
  menuName: string
  path?: string
  component?: string
  permissionCode?: string
  icon?: string
  sortOrder?: number
  visible?: boolean
  keepAlive?: boolean
  externalLink?: string
  status?: EnableStatus
}

export function getMenuTree() {
  return request.get<MenuItem[]>('/system/menus/tree')
}

export function createMenu(data: MenuForm) {
  return request.post<number>('/system/menus', data)
}

export function updateMenu(id: number, data: MenuForm) {
  return request.put<void>(`/system/menus/${id}`, data)
}

export function deleteMenu(id: number) {
  return request.delete<void>(`/system/menus/${id}`)
}

export function updateMenuStatus(id: number, status: EnableStatus) {
  return request.patch<void>(`/system/menus/${id}/status`, { status })
}
