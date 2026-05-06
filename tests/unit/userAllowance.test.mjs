import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const moment = require('moment')
const UserAllowance = require('../../lib/model/user_allowance.js')

/**
 * Build a stub user that mimics the surface UserAllowance relies on:
 *   - start_date / end_date
 *   - department.{ allowance, personal, is_accrued_allowance }
 *   - calculate_number_of_days_taken_from_allowance({ count_personal, count_regular, ... })
 *
 * `taken` is keyed by 'personal' | 'regular' | 'all' so each test can
 * dial the consumed days independently per pool.
 */
function makeUser({
  startDate = '2026-01-01',
  endDate = null,
  department = { is_accrued_allowance: false },
  taken = {}
} = {}) {
  const t = Object.assign({ personal: 0, regular: 0, all: 0 }, taken)

  return {
    start_date: startDate ? new Date(startDate) : null,
    end_date: endDate ? new Date(endDate) : null,
    department,
    calculate_number_of_days_taken_from_allowance(args) {
      args = args || {}
      if (args.count_personal) return t.personal
      if (args.count_regular) return t.regular
      if (args.leave_type) {
        return args.leave_type.use_personal ? t.personal : t.regular
      }
      return t.all
    }
  }
}

function buildAllowance({
  user,
  manualAdjustment = 0,
  personalAdjustment = 0,
  carryOver = 0,
  nominalAllowance,
  nominalPersonal,
  numberOfDaysTaken,
  numberOfDaysTakenPersonal,
  numberOfDaysTakenRegular,
  now
}) {
  const personalTaken =
    numberOfDaysTakenPersonal === undefined
      ? user.calculate_number_of_days_taken_from_allowance({ count_personal: true })
      : numberOfDaysTakenPersonal
  const regularTaken =
    numberOfDaysTakenRegular === undefined
      ? user.calculate_number_of_days_taken_from_allowance({ count_regular: true })
      : numberOfDaysTakenRegular

  return new UserAllowance({
    user,
    manual_adjustment: manualAdjustment,
    personal_adjustment: personalAdjustment,
    carry_over: carryOver,
    number_of_days_taken_from_allowance: numberOfDaysTaken,
    number_of_days_taken_personal: personalTaken,
    number_of_days_taken_regular: regularTaken,
    nominal_allowance: nominalAllowance,
    nominal_personal: nominalPersonal,
    now: now || moment.utc('2026-06-15')
  })
}

describe('UserAllowance pool math', () => {
  it('total_personal_available includes personal_adjustment', () => {
    const user = makeUser({ taken: { personal: 1, regular: 0, all: 1 } })
    const allowance = buildAllowance({
      user,
      personalAdjustment: 2,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 1
    })

    expect(allowance.total_personal_available).toBe(5 + 2 - 1)
  })

  it('total_personal_available floors at 0', () => {
    const user = makeUser({ taken: { personal: 99, regular: 0, all: 99 } })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 99
    })

    expect(allowance.total_personal_available).toBe(0)
  })

  it('number_of_regular_allowance carves out personal from total', () => {
    const user = makeUser()
    const allowance = buildAllowance({
      user,
      manualAdjustment: 0,
      personalAdjustment: 0,
      carryOver: 0,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 0
    })

    expect(allowance.total_number_of_days_in_allowance).toBe(20)
    expect(allowance.number_of_regular_allowance).toBe(15)
  })

  it('remaining_regular_allowance subtracts only regular_taken', () => {
    const user = makeUser({ taken: { personal: 3, regular: 4, all: 7 } })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 7
    })

    // Regular pool = 20 - 5 = 15, regular_taken = 4 -> 11 remaining
    expect(allowance.remaining_regular_allowance).toBe(11)
  })

  it('remaining_regular_allowance floors at 0', () => {
    const user = makeUser({ taken: { personal: 0, regular: 99, all: 99 } })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 99
    })

    expect(allowance.remaining_regular_allowance).toBe(0)
  })

  it('manual adjustment and carry over feed the regular pool', () => {
    const user = makeUser()
    const allowance = buildAllowance({
      user,
      manualAdjustment: 3,
      carryOver: 5,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 0
    })

    // total = 20 + 3 + 5 = 28; personal carve-out = 5 -> regular pool = 23
    expect(allowance.total_number_of_days_in_allowance).toBe(28)
    expect(allowance.number_of_regular_allowance).toBe(23)
  })

  it('returns 0 when start_date is in the future relative to `now`', () => {
    const user = makeUser({ startDate: '2027-01-01' })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 0,
      now: moment.utc('2026-06-15')
    })

    expect(allowance.number_of_regular_allowance).toBe(0)
    expect(allowance.number_of_days_available_in_allowance).toBe(0)
  })

  it('vacation_remaining = total_remaining - personal_remaining', () => {
    const user = makeUser({ taken: { personal: 1, regular: 2, all: 3 } })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 3
    })

    // total avail = 20 - 3 = 17; personal avail = 5 - 1 = 4; vacation = 13
    expect(allowance.vacation_remaining).toBe(13)
  })
})

describe('UserAllowance accrued semantics', () => {
  it('non-accrued department returns 0 employement_range_adjustment', () => {
    const user = makeUser({
      department: { is_accrued_allowance: false }
    })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 5,
      numberOfDaysTaken: 0
    })

    expect(allowance.is_accrued_allowance).toBe(false)
    expect(allowance.employement_range_adjustment).toBe(0)
  })

  it('accrued department reduces total when employee starts mid-year', () => {
    const user = makeUser({
      startDate: '2026-07-01',
      department: { is_accrued_allowance: true }
    })
    const allowance = buildAllowance({
      user,
      nominalAllowance: 20,
      nominalPersonal: 0,
      numberOfDaysTaken: 0,
      now: moment.utc('2026-12-31')
    })

    // employement_range_adjustment is negative when start_date is mid-year:
    // ~half a year worked => prorated allowance ~10 => adjustment ~-10
    expect(allowance.is_accrued_allowance).toBe(true)
    expect(allowance.employement_range_adjustment).toBeLessThan(0)
    expect(allowance.total_number_of_days_in_allowance).toBeLessThan(20)
  })
})
