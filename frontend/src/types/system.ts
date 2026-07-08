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

export interface SystemQuery extends Partial<PageParams> {
  keyword?: string
  status?: 'ENABLED' | 'DISABLED'
}
