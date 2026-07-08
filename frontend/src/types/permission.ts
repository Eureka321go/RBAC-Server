export type PermissionCode = string

export interface PermissionState {
  permissionCodes: PermissionCode[]
  routesLoaded: boolean
}
