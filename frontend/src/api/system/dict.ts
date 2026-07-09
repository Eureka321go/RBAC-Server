import request from '../request'
import type { EnableStatus, PageQuery, PageResult } from '@/types/system'

export interface DictTypeItem {
  id: number
  dictName: string
  dictCode: string
  status: EnableStatus
  remark?: string
  createdAt?: string
}

export interface DictTypeQuery extends PageQuery {
  dictName?: string
  dictCode?: string
}

export interface DictTypeForm {
  dictName: string
  dictCode: string
  status?: EnableStatus
  remark?: string
}

export interface DictDataItem {
  id: number
  dictTypeId: number
  label: string
  value: string
  sortOrder: number
  defaultFlag: boolean
  status: EnableStatus
  remark?: string
}

export interface DictDataForm {
  dictTypeId: number
  label: string
  value: string
  sortOrder?: number
  defaultFlag?: boolean
  status?: EnableStatus
  remark?: string
}

// 字典类型
export function listDictTypes(params: DictTypeQuery) {
  return request.get<PageResult<DictTypeItem>>('/system/dict-types', { params })
}

export function createDictType(data: DictTypeForm) {
  return request.post<number>('/system/dict-types', data)
}

export function updateDictType(id: number, data: DictTypeForm) {
  return request.put<void>(`/system/dict-types/${id}`, data)
}

export function deleteDictType(id: number) {
  return request.delete<void>(`/system/dict-types/${id}`)
}

// 字典数据
export function listDictData(dictTypeId: number) {
  return request.get<DictDataItem[]>('/system/dict-data', { params: { dictTypeId } })
}

export function listDictDataByCode(dictCode: string) {
  return request.get<DictDataItem[]>(`/system/dict-data/code/${dictCode}`)
}

export function createDictData(data: DictDataForm) {
  return request.post<number>('/system/dict-data', data)
}

export function updateDictData(id: number, data: DictDataForm) {
  return request.put<void>(`/system/dict-data/${id}`, data)
}

export function deleteDictData(id: number) {
  return request.delete<void>(`/system/dict-data/${id}`)
}
