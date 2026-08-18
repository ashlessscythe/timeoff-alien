import { describe, expect, it } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  editedRangeSharesOriginalDate,
  pendingLeaveEditWindowMessage
} = require('../../lib/model/leave/editWindow.js')

describe('editedRangeSharesOriginalDate', () => {
  it('allows shrink, grow, or shift that keeps at least one original day', () => {
    expect(
      editedRangeSharesOriginalDate({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-04',
        nextEnd: '2026-08-06'
      })
    ).toBe(true)

    expect(
      editedRangeSharesOriginalDate({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-03',
        nextEnd: '2026-08-04'
      })
    ).toBe(true)

    expect(
      editedRangeSharesOriginalDate({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-05',
        nextEnd: '2026-08-20'
      })
    ).toBe(true)
  })

  it('rejects adjacent or distant ranges with no shared original day', () => {
    expect(
      editedRangeSharesOriginalDate({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-08-06',
        nextEnd: '2026-08-08'
      })
    ).toBe(false)

    expect(
      editedRangeSharesOriginalDate({
        originalStart: '2026-08-03',
        originalEnd: '2026-08-05',
        nextStart: '2026-12-22',
        nextEnd: '2026-12-26'
      })
    ).toBe(false)

    expect(
      editedRangeSharesOriginalDate({
        originalStart: '2026-12-22',
        originalEnd: '2026-12-26',
        nextStart: '2026-08-03',
        nextEnd: '2026-08-05'
      })
    ).toBe(false)
  })

  it('tells the user to create a new request for different days', () => {
    expect(pendingLeaveEditWindowMessage()).toContain(
      'at least one date from the original request'
    )
    expect(pendingLeaveEditWindowMessage()).toContain(
      'Different days should be a new request'
    )
  })
})
