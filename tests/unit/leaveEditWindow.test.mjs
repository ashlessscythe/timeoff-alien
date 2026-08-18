import { describe, expect, it } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  isEditedRangeShrinkOnly,
  pendingLeaveEditShrinkMessage
} = require('../../lib/model/leave/editWindow.js')

describe('isEditedRangeShrinkOnly', () => {
  it('allows shrinking within the original span', () => {
    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-03',
        nextEnd: '2026-08-04'
      })
    ).toBe(true)

    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-04',
        nextEnd: '2026-08-05'
      })
    ).toBe(true)

    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-04',
        nextEnd: '2026-08-04'
      })
    ).toBe(true)

    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-10',
        nextStart: '2026-08-08',
        nextEnd: '2026-08-10'
      })
    ).toBe(true)
  })

  it('rejects growing or moving outside the original span', () => {
    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-04',
        nextEnd: '2026-08-06'
      })
    ).toBe(false)

    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-02',
        nextEnd: '2026-08-05'
      })
    ).toBe(false)

    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-06',
        nextEnd: '2026-08-08'
      })
    ).toBe(false)

    expect(
      isEditedRangeShrinkOnly({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-12-22',
        nextEnd: '2026-12-26'
      })
    ).toBe(false)
  })

  it('tells the user to create a new request to grow or move dates', () => {
    expect(pendingLeaveEditShrinkMessage()).toContain('only shorten')
    expect(pendingLeaveEditShrinkMessage()).toContain('cancel this request')
  })
})
