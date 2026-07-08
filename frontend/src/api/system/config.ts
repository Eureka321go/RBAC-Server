import request from '../request'
import type { PageResult, SystemQuery } from '@/types/system'

export interface ConfigListItem {
  id: number | string
  configName: string
  configKey: string
  configValue: string
  sensitive: boolean
}

export function listConfigs(params: SystemQuery) {
  return request.get<PageResult<ConfigListItem>>('/system/configs', { params })
}
