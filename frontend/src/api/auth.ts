import request from './request'
import type { CurrentUser, LoginParams, LoginResult } from '@/types/auth'
import type { MenuItem } from '@/types/menu'

export function login(data: LoginParams) {
  return request.post<LoginResult>('/auth/login', data)
}

export function logout() {
  return request.post('/auth/logout')
}

export function refreshToken(refreshToken: string) {
  return request.post<LoginResult>('/auth/refresh-token', { refreshToken })
}

export function getCurrentUser() {
  return request.get<CurrentUser>('/auth/me')
}

export function getAuthMenus() {
  return request.get<MenuItem[]>('/auth/menus')
}

export function getAuthPermissions() {
  return request.get<string[]>('/auth/permissions')
}
