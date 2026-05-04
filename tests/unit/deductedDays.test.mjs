import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const moment = require('moment')
const {
  wrapLeave,
  wrapSchedule
} = require('../../lib/model/sessionUser.js')
const userUtils = require('../../lib/prisma/userUtils.js')

function makeBankHoliday(dateIso) {
  return {
    date: new Date(`${dateIso}T00:00:00.000Z`),
    get_pretty_date() {
      return moment.utc(this.date).format('YYYY-MM-DD')
    }
  }
}

function makeUser({
  includePublicHolidays = true,
  scheduleRow,
  bankHolidays = [],
  shiftHours = null
} = {}) {
  const schedule = wrapSchedule(
    scheduleRow || {
      monday: 1,
      tuesday: 1,
      wednesday: 1,
      thursday: 1,
      friday: 1,
      saturday: 2,
      sunday: 2
    },
    null
  )

  return {
    id: 1,
    company_id: 1,
    department_id: 1,
    shift_hours: shiftHours,
    department: {
      include_public_holidays: includePublicHolidays
    },
    company: {
      bank_holidays: bankHolidays
    },
    cached_schedule: schedule
  }
}

function makeLeaveRow({
  user,
  leaveType = { id: 1, use_allowance: true, use_personal: false, limit: 0 },
  dateStart,
  dateEnd,
  dayPartStart = 1,
  dayPartEnd = 1,
  timeStart = null,
  timeEnd = null
}) {
  return {
    id: 123,
    user_id: user.id,
    leave_type_id: leaveType.id,
    leave_type: leaveType,
    leave_types: leaveType,
    user,
    date_start: new Date(`${dateStart}T00:00:00.000Z`),
    date_end: new Date(`${dateEnd}T00:00:00.000Z`),
    day_part_start: dayPartStart,
    day_part_end: dayPartEnd,
    time_start: timeStart,
    time_end: timeEnd
  }
}

describe('deducted-days engines', () => {
  describe('sessionUser leave.get_deducted_days / get_deducted_days_number', () => {
    it('excludes weekends and bank holidays when include_public_holidays=true', () => {
      const user = makeUser({
        includePublicHolidays: true,
        bankHolidays: [makeBankHoliday('2026-08-11')]
      })

      const leave = wrapLeave(
        makeLeaveRow({
          user,
          dateStart: '2026-08-10', // Mon
          dateEnd: '2026-08-16' // Sun
        }),
        null
      )

      const days = leave.get_deducted_days({
        ignore_allowance: true,
        leave_type: { use_allowance: true },
        user
      })

      // Mon-Fri = 5 days, minus bank holiday Tue => 4 deducted days
      expect(days.map(d => d.get_pretty_date())).toEqual([
        '2026-08-10',
        '2026-08-12',
        '2026-08-13',
        '2026-08-14'
      ])
      expect(leave.get_deducted_days_number({ ignore_allowance: true, leave_type: { use_allowance: true }, user })).toBe(
        4
      )
    })

    it('includes bank holidays when include_public_holidays=false', () => {
      const user = makeUser({
        includePublicHolidays: false,
        bankHolidays: [makeBankHoliday('2026-08-11')]
      })

      const leave = wrapLeave(
        makeLeaveRow({
          user,
          dateStart: '2026-08-10',
          dateEnd: '2026-08-12'
        }),
        null
      )

      const n = leave.get_deducted_days_number({
        ignore_allowance: true,
        leave_type: { use_allowance: true },
        user
      })

      // Mon..Wed all working, holiday is not excluded when include_public_holidays=false
      expect(n).toBe(3)
    })

    it('computes time-based leave as a fraction of working hours', () => {
      const user = makeUser({
        shiftHours: JSON.stringify({ shift_1: { start: '09:00', end: '17:00' } })
      })

      const leave = wrapLeave(
        makeLeaveRow({
          user,
          dateStart: '2026-08-10',
          dateEnd: '2026-08-10',
          timeStart: '09:00:00',
          timeEnd: '11:00:00'
        }),
        null
      )

      const n = leave.get_deducted_days_number({
        ignore_allowance: true,
        leave_type: { use_allowance: true },
        user
      })
      expect(n).toBeCloseTo(2 / 8, 6)
    })
  })

  describe('prisma userUtils.calculateNumberOfDaysTakenFromAllowance', () => {
    it('matches schedule + bank holiday exclusion semantics for all-day leave', () => {
      const schedule = {
        monday: 1,
        tuesday: 1,
        wednesday: 1,
        thursday: 1,
        friday: 1,
        saturday: 2,
        sunday: 2
      }

      const user = {
        id: 1,
        company: { bank_holidays: [{ date: new Date('2026-08-11T00:00:00.000Z') }] },
        department: { include_public_holidays: true },
        cached_schedule: schedule
      }

      const leaveType = { use_allowance: true }
      const leaves = [
        {
          status: 2,
          date_start: new Date('2026-08-10T00:00:00.000Z'),
          date_end: new Date('2026-08-16T00:00:00.000Z'),
          day_part_start: 1,
          day_part_end: 1,
          time_start: null,
          time_end: null,
          leave_types: leaveType
        }
      ]

      const taken = userUtils.calculateNumberOfDaysTakenFromAllowance(
        user,
        leaves,
        2026,
        { schedule, company: user.company, department: user.department }
      )

      // Same scenario as above: Mon-Fri=5 minus bank holiday => 4
      expect(taken).toBe(4)
    })

    it('computes time-based leave fraction using shift_hours when present', () => {
      const schedule = {
        monday: 1,
        tuesday: 1,
        wednesday: 1,
        thursday: 1,
        friday: 1,
        saturday: 2,
        sunday: 2
      }

      const user = {
        id: 1,
        shift_hours: JSON.stringify({ shift_1: { start: '09:00', end: '17:00' } }),
        company: { bank_holidays: [] },
        department: { include_public_holidays: true },
        cached_schedule: schedule
      }

      const leaves = [
        {
          status: 2,
          date_start: new Date('2026-08-10T00:00:00.000Z'),
          date_end: new Date('2026-08-10T00:00:00.000Z'),
          day_part_start: 1,
          day_part_end: 1,
          time_start: '09:00:00',
          time_end: '11:00:00',
          leave_types: { use_allowance: true }
        }
      ]

      const taken = userUtils.calculateNumberOfDaysTakenFromAllowance(
        user,
        leaves,
        2026,
        { schedule, company: user.company, department: user.department }
      )
      expect(taken).toBeCloseTo(2 / 8, 6)
    })
  })
})

