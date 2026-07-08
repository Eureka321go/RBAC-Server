export interface LoginParams {
  username: string
  password: string
  captchaCode?: string
  captchaKey?: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface CurrentUser {
  id: number | string
  username: string
  nickname: string
  avatar?: string
  deptId?: number | string
  deptName?: string
  roles: string[]
}
