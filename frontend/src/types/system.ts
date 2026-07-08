export type EnableStatus = 'ENABLED' | 'DISABLED'

export interface PageParams {
  page: number
  pageSize: number
}

export interface PageResult<T> {
  records: T[]
  total: number
  page: number
  pageSize: number
}

export interface PageQuery extends Partial<PageParams> {
  status?: EnableStatus
}

/** 通用后台分页查询别名（关键字 + 分页） */
export interface SystemQuery extends PageQuery {
  keyword?: string
}
