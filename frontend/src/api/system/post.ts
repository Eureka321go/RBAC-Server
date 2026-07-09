import request from '../request'
import type { EnableStatus, PageQuery, PageResult } from '@/types/system'

export interface PostItem {
  id: number
  postName: string
  postCode: string
  sortOrder: number
  status: EnableStatus
  remark?: string
  createdAt?: string
}

export interface PostQuery extends PageQuery {
  postName?: string
  postCode?: string
}

export interface PostForm {
  postName: string
  postCode: string
  sortOrder?: number
  status?: EnableStatus
  remark?: string
}

export function listPosts(params: PostQuery) {
  return request.get<PageResult<PostItem>>('/system/posts', { params })
}

export function postOptions() {
  return request.get<PostItem[]>('/system/posts/options')
}

export function createPost(data: PostForm) {
  return request.post<number>('/system/posts', data)
}

export function updatePost(id: number, data: PostForm) {
  return request.put<void>(`/system/posts/${id}`, data)
}

export function deletePost(id: number) {
  return request.delete<void>(`/system/posts/${id}`)
}

export function updatePostStatus(id: number, status: EnableStatus) {
  return request.patch<void>(`/system/posts/${id}/status`, { status })
}
