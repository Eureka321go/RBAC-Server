// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import type { FormFieldRow } from '@/types/workflow'
import FormDataEditor from './FormDataEditor.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      workflow: {
        form: {
          fieldName: 'Field',
          fieldValue: 'Value',
          typeText: 'Text',
          typeNumber: 'Number',
          typeBoolean: 'Boolean',
          addField: 'Add field',
          removeField: 'Remove field',
          empty: 'No fields',
        },
      },
    },
  },
})

const global = {
  plugins: [i18n],
  stubs: {
    ElInput: true,
    ElOption: true,
    ElSelect: true,
    ElSwitch: true,
    ElButton: true,
    ElEmpty: true,
  },
}

describe('FormDataEditor', () => {
  it('adds and removes rows without mutating the model', async () => {
    const original = [{ key: 'reason', type: 'text' as const, value: 'Trip' }]
    const wrapper = shallowMount(FormDataEditor, {
      props: { modelValue: original },
      global,
    })

    await wrapper.get('[data-testid="add-field"]').trigger('click')
    const added = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as FormFieldRow[]
    expect(added).toHaveLength(2)
    expect(original).toHaveLength(1)

    await wrapper.setProps({ modelValue: added })
    await wrapper.get('[data-testid="remove-field-0"]').trigger('click')
    const removed = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as FormFieldRow[]
    expect(removed).toHaveLength(1)
  })

  it('renders value controls for text, number, and boolean rows', () => {
    const wrapper = shallowMount(FormDataEditor, {
      props: {
        modelValue: [
          { key: 'reason', type: 'text', value: '' },
          { key: 'days', type: 'number', value: '' },
          { key: 'urgent', type: 'boolean', value: false },
        ],
      },
      global,
    })

    expect(wrapper.findAll('[data-value-type="text"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-value-type="number"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-value-type="boolean"]')).toHaveLength(1)
  })
})
