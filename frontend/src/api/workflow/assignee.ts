import request from '@/api/request'
import type { AssigneeUserOption } from '@/types/workflow'

export function searchAssigneeUsers(keyword = '', limit = 20) {
  return request.get<AssigneeUserOption[]>('/workflow/assignee/users', {
    params: { keyword, limit },
  })
}
