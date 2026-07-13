import { describe, expect, it } from 'vitest'
import { createEmptyDefinitionForm, serializeDefinitionForm } from './definition-form'

describe('serializeDefinitionForm', () => {
  it('renumbers nodes and serializes selected assignees', () => {
    const form = createEmptyDefinitionForm()
    form.processKey = 'leave'
    form.name = 'Leave approval'
    form.nodes = [
      {
        nodeName: 'Manager',
        assigneeType: 'USER',
        assigneeIds: [9, 3],
        approveMode: 'ALL',
        rejectStrategy: 'TO_INITIATOR',
        conditionExpr: '',
      },
      {
        nodeName: 'Leader',
        assigneeType: 'INITIATOR_LEADER',
        assigneeIds: [99],
        approveMode: 'ANY',
        rejectStrategy: 'TO_PREV',
        conditionExpr: 'days > 3',
      },
    ]

    const payload = serializeDefinitionForm(form)

    expect(payload.nodes).toEqual([
      expect.objectContaining({ nodeOrder: 1, assigneeValue: '9,3' }),
      expect.objectContaining({ nodeOrder: 2, assigneeValue: undefined }),
    ])
  })

  it('requires at least one node', () => {
    const form = createEmptyDefinitionForm()
    form.nodes = []
    expect(() => serializeDefinitionForm(form)).toThrow('workflow.definition.nodesRequired')
  })

  it('requires selected assignees for explicit assignee types', () => {
    const form = createEmptyDefinitionForm()
    form.nodes[0] = { ...form.nodes[0]!, assigneeType: 'ROLE', assigneeIds: [] }
    expect(() => serializeDefinitionForm(form)).toThrow('workflow.node.assigneeRequired')
  })
})
