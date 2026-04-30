'use strict'

const moment = require('moment')
const prisma = require('./client')

/**
 * Utility functions to replicate Sequelize model methods for Prisma
 */

/**
 * Calculate full name for a user
 */
function fullName(user) {
  return `${user.name} ${user.lastname}`
}

/**
 * Check if user is active (not ended or end date is in future)
 */
function isActive(user) {
  return !user.end_date || moment(user.end_date).isAfter(moment())
}

/**
 * Calculate number of days taken from allowance for a user
 */
function calculateNumberOfDaysTakenFromAllowance(
  user,
  leaves,
  year = moment().year(),
  opts = {}
) {
  const yearStart = moment.utc().year(year).startOf('year')
  const yearEnd = moment.utc().year(year).endOf('year')

  const dayPartAll = 1
  const company = opts.company || user.company || opts.companies
  const department = opts.department || user.department || user.departments
  const schedule = opts.schedule || opts.cached_schedule

  const includePublicHolidays =
    department && Object.prototype.hasOwnProperty.call(department, 'include_public_holidays')
      ? !!department.include_public_holidays
      : true

  const bankHolidayMap = {}
  const bankHolidays = (company && company.bank_holidays) || opts.bank_holidays || []
  if (includePublicHolidays && Array.isArray(bankHolidays)) {
    bankHolidays.forEach(bh => {
      if (!bh || !bh.date) return
      bankHolidayMap[moment.utc(bh.date).format('YYYY-MM-DD')] = 1
    })
  }

  function isWorkingDay(dateMoment) {
    const sched = schedule || {}
    const key = dateMoment.format('dddd').toLowerCase()
    // Convention in this app: 1 = working, 2 = non-working
    const val = sched[key]
    if (val === undefined || val === null) {
      // default Mon-Fri working, weekend off
      const d = dateMoment.day()
      return d !== 0 && d !== 6
    }
    return Number(val) === 1
  }

  function getWorkingHoursPerDay(u) {
    try {
      const sources = [u && u.shift_hours, u && u.departments && u.departments.shift_hours]
      for (const src of sources) {
        if (!src) continue
        const shiftHours = typeof src === 'string' ? JSON.parse(src) : src
        const shifts = shiftHours && typeof shiftHours === 'object' ? Object.keys(shiftHours) : []
        if (shifts.length === 0) continue
        const first = shiftHours[shifts[0]]
        if (!first || !first.start || !first.end) continue
        const start = moment.utc(first.start, 'HH:mm')
        const end = moment.utc(first.end, 'HH:mm')
        if (!end.isAfter(start)) end.add(1, 'day')
        const hours = end.diff(start, 'hours', true)
        if (Number.isFinite(hours) && hours > 0) return hours
      }
    } catch (_) {
      // ignore parse errors
    }
    return 8
  }

  function overlapsYear(leave) {
    const start = moment.utc(leave.date_start)
    const end = moment.utc(leave.date_end)
    return start.isSameOrBefore(yearEnd) && end.isSameOrAfter(yearStart)
  }

  function deductedForLeaveDay(leave, dayStr, isFirst, isLast) {
    const day = moment.utc(dayStr, 'YYYY-MM-DD')
    if (day.isBefore(yearStart) || day.isAfter(yearEnd)) return 0

    if (includePublicHolidays && bankHolidayMap[dayStr]) return 0
    if (!isWorkingDay(day)) return 0

    // Hourly time-based leave (single-day only in this simplified context)
    if (
      (leave.time_start || leave.time_end) &&
      moment.utc(leave.date_start).isSame(moment.utc(leave.date_end), 'day') &&
      isFirst &&
      isLast
    ) {
      const workingHours = getWorkingHoursPerDay(user)
      if (leave.time_start && leave.time_end) {
        const start = moment.utc(dayStr + 'T' + leave.time_start)
        const end = moment.utc(dayStr + 'T' + leave.time_end)
        if (!end.isAfter(start)) end.add(1, 'day')
        const hours = end.diff(start, 'hours', true)
        const fraction = hours / workingHours
        return Number.isFinite(fraction) && fraction > 0 ? fraction : 0
      }
      return 1
    }

    // Day-part handling
    const s = Number(leave.day_part_start)
    const e = Number(leave.day_part_end)
    if (isFirst && isLast) {
      // Some records for single-day half-day store the half-day marker on either
      // start OR end part; treat either as half-day.
      return s !== dayPartAll || e !== dayPartAll ? 0.5 : 1
    }
    if (isFirst) return s !== dayPartAll ? 0.5 : 1
    if (isLast) return e !== dayPartAll ? 0.5 : 1
    return 1
  }

  function estimatedDeductedDays(leave) {
    const start = moment.utc(leave.date_start).startOf('day')
    const end = moment.utc(leave.date_end).startOf('day')
    const daysSpan = end.diff(start, 'days')
    let total = 0

    for (let i = 0; i <= daysSpan; i++) {
      const dayStr = start.clone().add(i, 'days').format('YYYY-MM-DD')
      total += deductedForLeaveDay(leave, dayStr, i === 0, i === daysSpan)
    }

    return Math.max(0, total)
  }

  // Filter leaves for specified year and approved/pending status
  const statuses = Array.isArray(opts.statuses) ? opts.statuses : [1, 2, 3]
  const relevantLeaves = (leaves || []).filter(leave => {
    const isRelevant = statuses.includes(leave.status)
    return isRelevant && overlapsYear(leave)
  })

  // Calculate total days taken from allowance (regular + personal)
  return relevantLeaves.reduce((total, leave) => {
    if (leave.leave_types && leave.leave_types.use_allowance) {
      return total + estimatedDeductedDays(leave)
    }
    return total
  }, 0)
}

/**
 * Validate leave balance with enhanced personal vs vacation constraints
 */
async function validateLeaveBalance(
  user,
  leaveType,
  leaveDays,
  year = moment().year()
) {
  try {
    const allowance = await getUserAllowance(user, year)
    const totalAllowance =
      allowance.nominal_allowance +
      allowance.manual_adjustment +
      allowance.personal_adjustment +
      allowance.carried_over_allowance

    // Get personal limit from department
    const department = await prisma.departments.findUnique({
      where: { id: user.department_id }
    })
    const totalPersonalLimit =
      department.personal + allowance.personal_adjustment

    // Get current usage
    const yearStart = moment
      .utc()
      .year(year)
      .startOf('year')
      .toDate()
    const yearEnd = moment
      .utc()
      .year(year)
      .endOf('year')
      .toDate()

    const leaves = await prisma.leaves.findMany({
      where: {
        user_id: user.id,
        status: { in: [1, 2, 3] }, // new/pending, approved, pended_revoke
        OR: [
          {
            date_start: {
              gte: yearStart,
              lte: yearEnd
            }
          },
          {
            date_end: {
              gte: yearStart,
              lte: yearEnd
            }
          }
        ]
      },
      include: {
        leave_types: true
      }
    })

    // Calculate personal and vacation days taken
    const personalDaysTaken = leaves
      .filter(leave => leave.leave_types.use_personal)
      .reduce((total, leave) => {
        // This is a simplified calculation - in practice you'd need the full day calculation logic
        const days =
          moment(leave.date_end).diff(moment(leave.date_start), 'days') + 1
        return total + days
      }, 0)

    const vacationDaysTaken = leaves
      .filter(
        leave =>
          !leave.leave_types.use_personal && leave.leave_types.use_allowance
      )
      .reduce((total, leave) => {
        const days =
          moment(leave.date_end).diff(moment(leave.date_start), 'days') + 1
        return total + days
      }, 0)

    // Validate based on leave type
    if (leaveType.use_personal) {
      const wouldBePersonalUsed = personalDaysTaken + leaveDays
      if (wouldBePersonalUsed > totalPersonalLimit) {
        throw new Error(
          `Not enough personal leave days. You requested ${leaveDays} day${
            leaveDays !== 1 ? 's' : ''
          } but only have ${totalPersonalLimit -
            personalDaysTaken} personal day${
            totalPersonalLimit - personalDaysTaken !== 1 ? 's' : ''
          } remaining.`
        )
      }
    } else if (leaveType.use_allowance) {
      // If personal days already exceed total allowance, no vacation days available
      if (personalDaysTaken > totalAllowance) {
        throw new Error(
          `No vacation leave days available. You have used ${personalDaysTaken} personal day${
            personalDaysTaken !== 1 ? 's' : ''
          } which exceeds your total allowance of ${totalAllowance} day${
            totalAllowance !== 1 ? 's' : ''
          }.`
        )
      }

      // Additional constraint: Personal leave is a subset of total allowance
      const totalRemaining =
        totalAllowance - (personalDaysTaken + vacationDaysTaken)
      const personalRemaining = totalPersonalLimit - personalDaysTaken

      // Personal remaining cannot exceed total remaining
      const effectivePersonalRemaining = Math.min(
        personalRemaining,
        totalRemaining
      )
      const vacationRemaining = totalRemaining - effectivePersonalRemaining

      if (vacationRemaining < leaveDays) {
        throw new Error(
          `Not enough vacation leave days available. ` +
            `You requested ${leaveDays} day${
              leaveDays !== 1 ? 's' : ''
            } but only have ${vacationRemaining} vacation day${
              vacationRemaining !== 1 ? 's' : ''
            } available. ` +
            `You have ${effectivePersonalRemaining} personal day${
              effectivePersonalRemaining !== 1 ? 's' : ''
            } remaining out of ${totalRemaining} total days.`
        )
      }
    }

    return true
  } catch (error) {
    console.error('Error validating leave balance:', error)
    throw error
  }
}

/**
 * Get user allowance information
 */
async function getUserAllowance(user, year = moment().year()) {
  return getUserAllowanceWithContext(user, year, {})
}

/**
 * Get user allowance information (optionally with preloaded context).
 * This is used by the `/users` page so it matches the calendar/details logic
 * around bank holidays and working schedules.
 */
async function getUserAllowanceWithContext(user, year = moment().year(), ctx = {}) {
  try {
    async function getAdjustmentAndCarryOverWithFallback() {
      const y = Number(year)
      if (!Number.isFinite(y)) return { adjustment: 0, carried_over_allowance: 0 }

      // Match `sessionUser.promise_adjustment_and_carry_over_for_year` behavior:
      // if there is no record for the requested year, walk backwards until the
      // user's start year and take the first adjustment found.
      const startYear = user && user.start_date ? moment.utc(user.start_date).year() : y

      for (let yr = y; yr >= startYear; yr--) {
        const rec = await prisma.user_allowance_adjustment.findFirst({
          where: { user_id: user.id, year: yr }
        })
        if (rec) {
          return {
            adjustment: rec.adjustment || 0,
            carried_over_allowance: rec.carried_over_allowance || 0
          }
        }
      }

      return { adjustment: 0, carried_over_allowance: 0 }
    }

    // Get user allowance adjustment for the year
    const adjustment = ctx.adjustment
      ? ctx.adjustment
      : await prisma.user_allowance_adjustment.findFirst({
          where: { user_id: user.id, year }
        })

    const { adjustment: fallbackAdjustment, carried_over_allowance: fallbackCarry } =
      ctx.adjustment_and_carry_over || (await getAdjustmentAndCarryOverWithFallback())

    // Get department allowance
    const department =
      ctx.department ||
      user.department ||
      user.departments ||
      (await prisma.departments.findUnique({
        where: { id: user.department_id }
      }))

    // Manual adjustment falls back to most recent prior-year adjustment when missing.
    const manualAdjustment =
      adjustment && adjustment.adjustment !== null && adjustment.adjustment !== undefined
        ? adjustment.adjustment || 0
        : fallbackAdjustment || 0
    const personalAdjustment = adjustment?.personal_adjustment || 0
    const carriedOverAllowance =
      adjustment &&
      adjustment.carried_over_allowance !== null &&
      adjustment.carried_over_allowance !== undefined
        ? adjustment.carried_over_allowance || 0
        : fallbackCarry || 0
    const nominalAllowance = department?.allowance || 0
    const nominalPersonal = department?.personal || 0

    // Get leaves for the year to calculate taken days
    const leaves =
      ctx.leaves ||
      (await prisma.leaves.findMany({
        where: {
          user_id: user.id,
          status: { in: ctx.statuses || [1, 2, 3] }, // new/pending, approved, (optionally) pended_revoke
          AND: [
            { date_start: { lte: moment.utc().year(year).endOf('year').toDate() } },
            { date_end: { gte: moment.utc().year(year).startOf('year').toDate() } }
          ]
        },
        include: {
          leave_types: true
        }
      }))

    const numberOfDaysTakenFromAllowance = calculateNumberOfDaysTakenFromAllowance(
      user,
      leaves,
      year,
      {
        company: ctx.company || user.company,
        department,
        schedule: ctx.schedule,
        statuses: ctx.statuses
      }
    )

    // IMPORTANT: personal_adjustment affects PERSONAL allowance only; it should NOT
    // inflate the total allowance pool. This matches `lib/model/user_allowance.js`.
    const number_of_days_available_in_allowance =
      nominalAllowance + manualAdjustment + carriedOverAllowance - numberOfDaysTakenFromAllowance

    // Calculate personal availability using the same day-deduction logic.
    // NOTE: personal allowance is tracked separately, but days deducted still respect
    // schedule and bank holidays when department includes them.
    const total_personal_limit = nominalPersonal + personalAdjustment
    const personal_days_taken = (leaves || [])
      .filter(leave => leave.leave_types && leave.leave_types.use_personal)
      .reduce((memo, leave) => {
        // reuse the same deduction function; it already filters to year window
        // and respects schedule/bank holidays.
        return (
          memo +
          calculateNumberOfDaysTakenFromAllowance(
            user,
            [leave],
            year,
            {
              company: ctx.company || user.company,
              department,
              schedule: ctx.schedule,
              statuses: ctx.statuses
            }
          )
        )
      }, 0)

    const total_personal_available = Math.max(0, total_personal_limit - personal_days_taken)
    const vacation_remaining =
      number_of_days_available_in_allowance - total_personal_available

    return {
      number_of_days_available_in_allowance,
      number_of_days_taken_from_allowance: numberOfDaysTakenFromAllowance,
      nominal_allowance: nominalAllowance,
      nominal_personal: nominalPersonal,
      manual_adjustment: manualAdjustment,
      personal_adjustment: personalAdjustment,
      carried_over_allowance: carriedOverAllowance,
      total_personal_available,
      vacation_remaining
    }
  } catch (error) {
    console.error('Error calculating user allowance:', error)
    return {
      number_of_days_available_in_allowance: 0,
      number_of_days_taken_from_allowance: 0,
      nominal_allowance: 0,
      manual_adjustment: 0,
      personal_adjustment: 0,
      carried_over_allowance: 0,
      total_personal_available: 0,
      vacation_remaining: 0
    }
  }
}

/**
 * Get user schedule (simplified - returns default schedule)
 */
async function getUserSchedule(user) {
  try {
    // Get user-specific schedule or company default
    const schedule = await prisma.schedules.findFirst({
      where: {
        OR: [
          { user_id: user.id },
          { company_id: user.company_id, user_id: null }
        ]
      },
      orderBy: [
        { user_id: 'asc' }, // Prefer user-specific schedule
        { id: 'asc' }
      ]
    })

    return (
      schedule || {
        monday: 1,
        tuesday: 1,
        wednesday: 1,
        thursday: 1,
        friday: 1,
        saturday: 2,
        sunday: 2
      }
    )
  } catch (error) {
    console.error('Error getting user schedule:', error)
    return {
      monday: 1,
      tuesday: 1,
      wednesday: 1,
      thursday: 1,
      friday: 1,
      saturday: 2,
      sunday: 2
    }
  }
}

module.exports = {
  fullName,
  isActive,
  calculateNumberOfDaysTakenFromAllowance,
  getUserAllowance,
  getUserAllowanceWithContext,
  getUserSchedule,
  validateLeaveBalance
}
