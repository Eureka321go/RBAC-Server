import { describe, expect, it } from 'vitest'
import { buildStartPayload } from './mine-form'

describe('buildStartPayload', () => {
  it('builds typed form data and trims primary fields', () => {
    expect(
      buildStartPayload({
        processKey: ' leave ',
        title: ' Annual leave ',
        businessKey: ' L-1 ',
        fields: [
          { key: 'days', type: 'number', value: '3' },
          { key: 'urgent', type: 'boolean', value: false },
        ],
      }),
    ).toEqual({
      processKey: 'leave',
      title: 'Annual leave',
      businessKey: 'L-1',
      formData: { days: 3, urgent: false },
    })
  })
})
