import { describe, expect, it } from 'vitest'
import { formatWorkflowDate, formRowsToData, workflowLabelKey, workflowTagType } from './workflow'

describe('formRowsToData', () => {
  it('converts supported value types', () => {
    expect(
      formRowsToData([
        { key: 'reason', type: 'text', value: 'Trip' },
        { key: 'days', type: 'number', value: '4' },
        { key: 'urgent', type: 'boolean', value: true },
      ]),
    ).toEqual({ reason: 'Trip', days: 4, urgent: true })
  })

  it('rejects empty field names', () => {
    expect(() => formRowsToData([{ key: '', type: 'text', value: 'x' }])).toThrow(
      'workflow.form.keyRequired',
    )
  })

  it('rejects invalid numeric values', () => {
    expect(() => formRowsToData([{ key: 'days', type: 'number', value: 'x' }])).toThrow(
      'workflow.form.numberInvalid',
    )
  })

  it('rejects duplicate field names after trimming', () => {
    expect(() =>
      formRowsToData([
        { key: 'reason', type: 'text', value: 'a' },
        { key: ' reason ', type: 'text', value: 'b' },
      ]),
    ).toThrow('workflow.form.keyDuplicate')
  })
})

describe('workflowTagType', () => {
  it('maps known values and falls back safely for unknown values', () => {
    expect(workflowTagType('instance', 'APPROVED')).toBe('success')
    expect(workflowTagType('task', 'REJECTED')).toBe('danger')
    expect(workflowTagType('instance', 'FUTURE')).toBe('info')
  })

  it('builds translation keys and formats optional dates', () => {
    expect(workflowLabelKey('task', 'PENDING')).toBe('workflow.task.PENDING')
    expect(formatWorkflowDate()).toBe('-')
    expect(formatWorkflowDate('2026-07-10T10:00:00')).not.toBe('-')
  })
})
