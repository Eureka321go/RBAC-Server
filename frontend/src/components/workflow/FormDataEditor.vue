<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FormFieldRow, FormFieldType } from '@/types/workflow'

const props = defineProps<{
  modelValue: FormFieldRow[]
}>()

const emit = defineEmits<{
  'update:modelValue': [rows: FormFieldRow[]]
}>()

const { t } = useI18n()

function addRow() {
  emit('update:modelValue', [...props.modelValue, { key: '', type: 'text', value: '' }])
}

function removeRow(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, rowIndex) => rowIndex !== index))
}

function updateRow(index: number, changes: Partial<FormFieldRow>) {
  emit(
    'update:modelValue',
    props.modelValue.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)),
  )
}

function updateType(index: number, type: FormFieldType) {
  updateRow(index, { type, value: type === 'boolean' ? false : '' })
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(row, index) in modelValue"
      :key="index"
      class="grid grid-cols-[minmax(120px,1fr)_120px_minmax(160px,1.5fr)_36px] items-center gap-2"
    >
      <el-input
        :model-value="row.key"
        :placeholder="t('workflow.form.fieldName')"
        @update:model-value="updateRow(index, { key: String($event) })"
      />
      <el-select :model-value="row.type" @update:model-value="updateType(index, $event as FormFieldType)">
        <el-option :label="t('workflow.form.typeText')" value="text" />
        <el-option :label="t('workflow.form.typeNumber')" value="number" />
        <el-option :label="t('workflow.form.typeBoolean')" value="boolean" />
      </el-select>
      <div :data-value-type="row.type">
        <el-switch
          v-if="row.type === 'boolean'"
          :model-value="row.value === true"
          @update:model-value="updateRow(index, { value: Boolean($event) })"
        />
        <el-input
          v-else
          :model-value="String(row.value)"
          :type="row.type === 'number' ? 'number' : 'text'"
          :placeholder="t('workflow.form.fieldValue')"
          @update:model-value="updateRow(index, { value: String($event) })"
        />
      </div>
      <el-button
        circle
        type="danger"
        plain
        icon="Delete"
        :data-testid="`remove-field-${index}`"
        :aria-label="t('workflow.form.removeField')"
        @click="removeRow(index)"
      />
    </div>

    <el-empty v-if="modelValue.length === 0" :description="t('workflow.form.empty')" :image-size="52" />
    <el-button data-testid="add-field" plain icon="Plus" @click="addRow">
      {{ t('workflow.form.addField') }}
    </el-button>
  </div>
</template>
