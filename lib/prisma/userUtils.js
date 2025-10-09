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
  year = moment().year()
) {
  const yearStart = moment
    .utc()
    .year(year)
    .startOf('year')
    .format('YYYY-MM-DD')
  const yearEnd = moment
    .utc()
    .year(year)
    .endOf('year')
    .format('YYYY-MM-DD 23:59:59')

  // Filter leaves for specified year and approved/pending status
  const relevantLeaves = leaves.filter(leave => {
    const isInYear =
      (leave.date_start >= yearStart && leave.date_start <= yearEnd) ||
      (leave.date_end >= yearStart && leave.date_end <= yearEnd)
    // Include approved (2), new/pending (1), and pended_revoke (3) statuses
    // This ensures pending requests are included in allowance calculation
    const isRelevant = [1, 2, 3].includes(leave.status) // new, approved, pended_revoke
    return isInYear && isRelevant
  })

  // Calculate total days taken
  return relevantLeaves.reduce((total, leave) => {
    if (leave.leave_types && leave.leave_types.use_allowance) {
      const startDate = moment(leave.date_start)
      const endDate = moment(leave.date_end)
      const days = endDate.diff(startDate, 'days') + 1
      return total + days
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
  try {
    // Get user allowance adjustment for the year
    const adjustment = await prisma.user_allowance_adjustment.findFirst({
      where: {
        user_id: user.id,
        year
      }
    })

    // Get department allowance
    const department = await prisma.departments.findUnique({
      where: { id: user.department_id }
    })

    const manualAdjustment = adjustment?.adjustment || 0
    const personalAdjustment = adjustment?.personal_adjustment || 0
    const carriedOverAllowance = adjustment?.carried_over_allowance || 0
    const nominalAllowance = department?.allowance || 0

    // Get leaves for the year to calculate taken days
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

    const numberOfDaysTakenFromAllowance = calculateNumberOfDaysTakenFromAllowance(
      user,
      leaves,
      year
    )

    const number_of_days_available_in_allowance =
      nominalAllowance +
      manualAdjustment +
      personalAdjustment +
      carriedOverAllowance -
      numberOfDaysTakenFromAllowance

    // Calculate personal and vacation remaining
    const total_personal_limit = department.personal + personalAdjustment
    const personal_days_taken = leaves
      .filter(leave => leave.leave_types.use_personal)
      .reduce((total, leave) => {
        const days =
          moment(leave.date_end).diff(moment(leave.date_start), 'days') + 1
        return total + days
      }, 0)

    const total_personal_available = Math.max(
      0,
      total_personal_limit - personal_days_taken
    )
    const vacation_remaining =
      number_of_days_available_in_allowance - total_personal_available

    return {
      number_of_days_available_in_allowance,
      number_of_days_taken_from_allowance: numberOfDaysTakenFromAllowance,
      nominal_allowance: nominalAllowance,
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
  getUserSchedule,
  validateLeaveBalance
}
