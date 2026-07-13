import type { TagProps } from 'element-plus'
import type { FormFieldRow } from '@/types/workflow'

export type WorkflowStatusGroup = 'definition' | 'instance' | 'task' | 'action'
export type WorkflowTagType = TagProps['type']

const tagTypes: Record<WorkflowStatusGroup, Record<string, WorkflowTagType>> = {
  definition: {
    ENABLED: 'success',
    DISABLED: 'info',
  },
  instance: {
    DRAFT: 'info',
    RUNNING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    CANCELED: 'info',
  },
  task: {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    TRANSFERRED: 'primary',
    CANCELED: 'info',
  },
  action: {
    SUBMIT: 'primary',
    APPROVE: 'success',
    REJECT: 'danger',
    TRANSFER: 'warning',
    ADD_SIGN: 'primary',
    WITHDRAW: 'info',
  },
}

export function formRowsToData(rows: FormFieldRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const row of rows) {
    const key = row.key.trim()
    if (!key) throw new Error('workflow.form.keyRequired')
    if (Object.hasOwn(result, key)) throw new Error('workflow.form.keyDuplicate')

    if (row.type === 'number') {
      const value = typeof row.value === 'string' ? Number(row.value.trim()) : Number.NaN
      if (!Number.isFinite(value)) throw new Error('workflow.form.numberInvalid')
      result[key] = value
    } else if (row.type === 'boolean') {
      result[key] = row.value === true
    } else {
      result[key] = String(row.value)
    }
  }

  return result
}

export function workflowTagType(group: WorkflowStatusGroup, value: string): WorkflowTagType {
  return tagTypes[group][value] ?? 'info'
}

export function workflowLabelKey(group: WorkflowStatusGroup, value: string): string {
  return `workflow.${group}.${value}`
}

export function formatWorkflowDate(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}
