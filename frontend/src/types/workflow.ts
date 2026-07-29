import type { EnableStatus, PageQuery } from './system'

export type AssigneeType =
  | 'USER'
  | 'ROLE'
  | 'POST'
  | 'DEPT_LEADER'
  | 'INITIATOR_SELF'
  | 'INITIATOR_LEADER'

export type ApproveMode = 'ANY' | 'ALL' | 'SEQUENTIAL'
export type RejectStrategy = 'TO_INITIATOR' | 'TO_PREV'
export type InstanceStatus = 'DRAFT' | 'RUNNING' | 'APPROVED' | 'REJECTED' | 'CANCELED'
export type TaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TRANSFERRED' | 'CANCELED'
export type WorkflowAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'TRANSFER' | 'ADD_SIGN' | 'WITHDRAW'
export type FormFieldType = 'text' | 'number' | 'boolean'

export interface FormFieldRow {
  key: string
  type: FormFieldType
  value: string | boolean
}

export interface WorkflowNode {
  id?: number
  nodeOrder: number
  nodeName: string
  assigneeType: AssigneeType
  assigneeValue?: string
  approveMode: ApproveMode
  rejectStrategy: RejectStrategy
  conditionExpr?: string
}

export interface WorkflowDefinition {
  id: number
  processKey: string
  name: string
  category?: string
  formKey?: string
  version: number
  status: EnableStatus
  remark?: string
  createdAt?: string
  nodes?: WorkflowNode[]
}

export interface WorkflowDefinitionOption {
  processKey: string
  name: string
  category?: string
  formKey?: string
  version: number
}

export interface WorkflowDefinitionQuery extends PageQuery {
  processKey?: string
  name?: string
  category?: string
}

export interface WorkflowDefinitionForm {
  id?: number
  processKey: string
  name: string
  category?: string
  formKey?: string
  status: EnableStatus
  remark?: string
  nodes: WorkflowNode[]
}

export interface WorkflowInstanceQuery extends PageQuery {
  processKey?: string
  title?: string
  instanceStatus?: InstanceStatus | ''
}

export interface WorkflowInstance {
  id: number
  processKey: string
  title: string
  businessKey?: string
  instanceStatus: InstanceStatus
  currentNodeOrder?: number
  initiatorId: number
  initiatorName?: string
  submitTime?: string
  endTime?: string
}

export interface WorkflowRecord {
  id: number
  nodeOrder?: number
  operatorId: number
  operatorName?: string
  action: WorkflowAction
  comment?: string
  operateTime: string
}

export interface WorkflowTaskBrief {
  id: number
  nodeOrder: number
  nodeName: string
  assigneeId: number
  assigneeName?: string
  taskStatus: TaskStatus
  approveTime?: string
}

export interface WorkflowInstanceDetail extends WorkflowInstance {
  formData?: unknown
  records: WorkflowRecord[]
  tasks: WorkflowTaskBrief[]
}

export interface WorkflowTaskQuery extends PageQuery {
  title?: string
}

export interface WorkflowTask {
  id: number
  instanceId: number
  nodeName: string
  taskStatus: TaskStatus
  approveTime?: string
  createdAt?: string
  title: string
  processKey: string
  initiatorId: number
  initiatorName?: string
}

export interface WorkflowCc {
  id: number
  instanceId: number
  title: string
  processKey: string
  initiatorId: number
  initiatorName?: string
  instanceStatus: InstanceStatus
  readFlag: number
  createdAt?: string
}

export interface InstanceStartForm {
  processKey: string
  businessKey?: string
  title: string
  formData?: Record<string, unknown>
}

export interface AssigneeUserOption {
  id: number
  username: string
  nickname: string
  deptName?: string
}
