import { describe, it, expect } from 'vitest'
import moment from 'moment'
import {
  isPastPayrollWeekClosedForLeaveStart,
  payrollCloseMomentForWeekContaining
} from '../../lib/model/payrollCloseWindow.js'

describe('payrollCloseWindow', () => {
  it('payrollCloseMomentForWeekContaining is Monday at payroll hour UTC for that ISO week', () => {
    const wed = moment.utc('2026-05-13T12:00:00.000Z')
    const close = payrollCloseMomentForWeekContaining(wed, 10)
    expect(close.utc().format('YYYY-MM-DD HH')).toBe('2026-05-11 10')
  })

  it('after Monday 10:00 UTC close, prior Sat week end blocks leave starting earlier in Sun–Sat weeks', () => {
    const now = moment.utc('2026-05-13T12:00:00.000Z')
    expect(
      isPastPayrollWeekClosedForLeaveStart({
        leaveStart: moment.utc('2026-05-05'),
        payrollCloseHourUtc: 10,
        now
      })
    ).toBe(true)
    expect(
      isPastPayrollWeekClosedForLeaveStart({
        leaveStart: moment.utc('2026-05-12'),
        payrollCloseHourUtc: 10,
        now
      })
    ).toBe(false)
  })

  it('before Monday close, prior week leave is not blocked', () => {
    const now = moment.utc('2026-05-10T08:00:00.000Z')
    expect(
      isPastPayrollWeekClosedForLeaveStart({
        leaveStart: moment.utc('2026-05-05'),
        payrollCloseHourUtc: 10,
        now
      })
    ).toBe(false)
  })
})
