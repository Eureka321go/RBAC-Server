import request from '../request'
import type { PageQuery, PageResult } from '@/types/system'

export interface ConfigItem {
  id: number
  configName: string
  configKey: string
  configValue: string
  configType: string
  builtin: boolean
  sensitive: boolean
  remark?: string
  createdAt?: string
}

export interface ConfigQuery extends PageQuery {
  configName?: string
  configKey?: string
}

export interface ConfigForm {
  configName: string
  configKey: string
  configValue?: string
  configType?: string
  sensitive?: boolean
  remark?: string
}

export function listConfigs(params: ConfigQuery) {
  return request.get<PageResult<ConfigItem>>('/system/configs', { params })
}

export function createConfig(data: ConfigForm) {
  return request.post<number>('/system/configs', data)
}

export function updateConfig(id: number, data: ConfigForm) {
  return request.put<void>(`/system/configs/${id}`, data)
}

export function deleteConfig(id: number) {
  return request.delete<void>(`/system/configs/${id}`)
}
