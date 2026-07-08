import request from '../request'
import type { PageResult, SystemQuery } from '@/types/system'

export interface PostListItem {
  id: number | string
  postName: string
  postCode: string
  status: 'ENABLED' | 'DISABLED'
}

export function listPosts(params: SystemQuery) {
  return request.get<PageResult<PostListItem>>('/system/posts', { params })
}
