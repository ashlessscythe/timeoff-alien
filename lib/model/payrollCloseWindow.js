'use strict'

const moment = require('moment')

/** Vitest / local only: fixed "now" for payroll week rules (see integration revoke tests). */
function utcNowForPayrollRules() {
  return process.env.TIMEOFF_TEST_PAYROLL_NOW
    ? moment.utc(process.env.TIMEOFF_TEST_PAYROLL_NOW)
    : moment.utc()
}

/**
 * Monday payroll close instant for the ISO week that contains `now` (moment default:
 * week starts Sunday UTC, Monday is startOf('week') + 1 day), at `payrollCloseHourUtc`
 * hours — same construction as lib/model/leave/index.js booking rules.
 *
 * @param {import('moment').Moment} nowUtc
 * @param {number} payrollCloseHourUtc
 * @returns {import('moment').Moment}
 */
function payrollCloseMomentForWeekContaining(nowUtc, payrollCloseHourUtc) {
  const hour = Number(payrollCloseHourUtc)
  const safeHour = Number.isNaN(hour) ? 10 : hour
  return nowUtc
    .clone()
    .startOf('week')
    .add(1, 'days')
    .add(safeHour, 'hours')
}

/**
 * After this week's Monday payroll close (UTC), leave whose start is strictly before
 * the end of the prior Saturday (Sun–Sat weeks) is treated as a past closed pay period
 * for non-admins — matches booking validation in lib/model/leave/index.js.
 *
 * @param {{ leaveStart: Date|string|import('moment').Moment, payrollCloseHourUtc: number, now?: import('moment').Moment }} args
 * @returns {boolean}
 */
function isPastPayrollWeekClosedForLeaveStart(args) {
  const now = args.now != null ? moment.utc(args.now) : utcNowForPayrollRules()
  const payrollCloseTime = payrollCloseMomentForWeekContaining(
    now,
    args.payrollCloseHourUtc
  )

  if (!now.isAfter(payrollCloseTime)) {
    return false
  }

  const lastWeekEnd = now.clone().startOf('week').subtract(1, 'millisecond')
  const startDate = moment.isMoment(args.leaveStart)
    ? args.leaveStart.clone().utc()
    : moment.utc(args.leaveStart)
  return startDate.isBefore(lastWeekEnd)
}

module.exports = {
  utcNowForPayrollRules,
  payrollCloseMomentForWeekContaining,
  isPastPayrollWeekClosedForLeaveStart
}
