import request from '../request'
import type { MenuItem } from '@/types/menu'

export function listMenus() {
  return request.get<MenuItem[]>('/system/menus')
}
