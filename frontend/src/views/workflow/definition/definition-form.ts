import type {
  ApproveMode,
  AssigneeType,
  RejectStrategy,
  WorkflowDefinition,
  WorkflowDefinitionForm,
} from '@/types/workflow'

export interface DefinitionNodeForm {
  nodeName: string
  assigneeType: AssigneeType
  assigneeIds: number[]
  approveMode: ApproveMode
  rejectStrategy: RejectStrategy
  conditionExpr: string
}

export interface DefinitionEditorForm {
  id?: number
  processKey: string
  name: string
  category: string
  formKey: string
  status: 'ENABLED' | 'DISABLED'
  remark: string
  nodes: DefinitionNodeForm[]
}

const explicitAssigneeTypes: AssigneeType[] = ['USER', 'ROLE', 'POST']

export function createEmptyNode(): DefinitionNodeForm {
  return {
    nodeName: '',
    assigneeType: 'DEPT_LEADER',
    assigneeIds: [],
    approveMode: 'ANY',
    rejectStrategy: 'TO_INITIATOR',
    conditionExpr: '',
  }
}

export function createEmptyDefinitionForm(): DefinitionEditorForm {
  return {
    processKey: '',
    name: '',
    category: '',
    formKey: '',
    status: 'ENABLED',
    remark: '',
    nodes: [createEmptyNode()],
  }
}

export function definitionToEditorForm(definition: WorkflowDefinition): DefinitionEditorForm {
  return {
    id: definition.id,
    processKey: definition.processKey,
    name: definition.name,
    category: definition.category ?? '',
    formKey: definition.formKey ?? '',
    status: definition.status,
    remark: definition.remark ?? '',
    nodes: (definition.nodes ?? []).map((node) => ({
      nodeName: node.nodeName,
      assigneeType: node.assigneeType,
      assigneeIds: node.assigneeValue
        ? node.assigneeValue.split(',').map(Number).filter(Number.isFinite)
        : [],
      approveMode: node.approveMode,
      rejectStrategy: node.rejectStrategy,
      conditionExpr: node.conditionExpr ?? '',
    })),
  }
}

export function serializeDefinitionForm(form: DefinitionEditorForm): WorkflowDefinitionForm {
  if (form.nodes.length === 0) throw new Error('workflow.definition.nodesRequired')

  return {
    id: form.id,
    processKey: form.processKey.trim(),
    name: form.name.trim(),
    category: form.category.trim() || undefined,
    formKey: form.formKey.trim() || undefined,
    status: form.status,
    remark: form.remark.trim() || undefined,
    nodes: form.nodes.map((node, index) => {
      if (explicitAssigneeTypes.includes(node.assigneeType) && node.assigneeIds.length === 0) {
        throw new Error('workflow.node.assigneeRequired')
      }
      return {
        nodeOrder: index + 1,
        nodeName: node.nodeName.trim(),
        assigneeType: node.assigneeType,
        assigneeValue: explicitAssigneeTypes.includes(node.assigneeType)
          ? node.assigneeIds.join(',')
          : undefined,
        approveMode: node.approveMode,
        rejectStrategy: node.rejectStrategy,
        conditionExpr: node.conditionExpr.trim() || undefined,
      }
    }),
  }
}
