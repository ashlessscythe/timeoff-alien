import { describe, expect, it } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS,
  isDateRangeWithinEditWindow
} = require('../../lib/model/leave/editWindow.js')

describe('isDateRangeWithinEditWindow', () => {
  it('allows shrinking, growing, or shifting inside the original window', () => {
    expect(
      isDateRangeWithinEditWindow({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-04',
        nextEnd: '2026-08-06'
      })
    ).toBe(true)

    expect(
      isDateRangeWithinEditWindow({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-03',
        nextEnd: '2026-08-04'
      })
    ).toBe(true)
  })

  it('allows dates on the 14-day window edges', () => {
    expect(
      isDateRangeWithinEditWindow({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-07-20',
        nextEnd: '2026-08-19'
      })
    ).toBe(true)
  })

  it('rejects a jump to a completely different period', () => {
    expect(
      isDateRangeWithinEditWindow({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-12-22',
        nextEnd: '2026-12-26'
      })
    ).toBe(false)

    expect(
      isDateRangeWithinEditWindow({
        originalStart: '2026-12-22',
        originalEnd: '2026-12-26',
        nextStart: '2026-08-03',
        nextEnd: '2026-08-05'
      })
    ).toBe(false)
  })

  it('rejects stretching the original range far beyond the window', () => {
    expect(
      isDateRangeWithinEditWindow({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-03',
        nextEnd: '2026-12-26'
      })
    ).toBe(false)
  })

  it('uses a 14 day default window', () => {
    expect(MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS).toBe(14)
  })
})
