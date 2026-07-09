export interface LoginParams {
  username: string
  password: string
  captchaCode?: string
  captchaKey?: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  tokenType: string
  /** access token 有效期（秒） */
  expiresIn: number
}

export interface RoleBrief {
  roleId: number
  roleCode: string
  roleName: string
}

export interface CurrentUser {
  id: number
  username: string
  nickname: string
  avatar?: string
  deptId?: number
  deptName?: string
  roles: RoleBrief[]
}
