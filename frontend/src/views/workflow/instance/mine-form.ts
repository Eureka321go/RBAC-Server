import type { FormFieldRow, InstanceStartForm } from '@/types/workflow'
import { formRowsToData } from '@/utils/workflow'

export interface StartEditorForm {
  processKey: string
  title: string
  businessKey: string
  fields: FormFieldRow[]
}

export function createStartEditorForm(): StartEditorForm {
  return { processKey: '', title: '', businessKey: '', fields: [] }
}

export function buildStartPayload(form: StartEditorForm): InstanceStartForm {
  return {
    processKey: form.processKey.trim(),
    title: form.title.trim(),
    businessKey: form.businessKey.trim() || undefined,
    formData: formRowsToData(form.fields),
  }
}
