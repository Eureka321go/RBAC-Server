import request from '../request'

export interface DictTypeItem {
  id: number | string
  dictName: string
  dictType: string
}

export function listDictTypes() {
  return request.get<DictTypeItem[]>('/system/dict-types')
}
