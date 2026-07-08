export type MenuType = 'DIR' | 'MENU' | 'BUTTON'
export type EnableStatus = 'ENABLED' | 'DISABLED'

export interface MenuItem {
  id: number | string
  parentId?: number | string | null
  menuType: MenuType
  menuName: string
  path: string
  component?: string
  permissionCode?: string
  icon?: string
  visible: boolean
  keepAlive?: boolean
  sortOrder: number
  status: EnableStatus
  children?: MenuItem[]
}
