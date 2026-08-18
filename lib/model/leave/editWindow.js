'use strict'

const moment = require('moment')

/*
 * Pending-leave edits may only SHRINK the original request (fewer or the same
 * calendar days, fully inside the original span). Growing dates or deducted
 * days requires cancel + new request — this protects FCFS queue position from
 * being reused to claim more favorable time off.
 *
 * Original Aug 3–5:
 *   - Aug 3–4 allowed (drop end)
 *   - Aug 4–5 allowed (drop start)
 *   - Aug 4–4 allowed
 *   - Aug 3–6 rejected (extended end)
 *   - Aug 2–5 rejected (extended start)
 *   - Aug 6–8 rejected (different days)
 */

function toUtcDay(value) {
  return moment.utc(value).startOf('day')
}

function isEditedRangeShrinkOnly(args) {
  const originalStart = args && args.originalStart
  const originalEnd = args && args.originalEnd
  const nextStart = args && args.nextStart
  const nextEnd = args && args.nextEnd

  if (!originalStart || !originalEnd || !nextStart || !nextEnd) {
    return false
  }

  const originalFrom = toUtcDay(originalStart)
  const originalTo = toUtcDay(originalEnd)
  const nextFrom = toUtcDay(nextStart)
  const nextTo = toUtcDay(nextEnd)

  return (
    !nextFrom.isBefore(originalFrom, 'day') && !nextTo.isAfter(originalTo, 'day')
  )
}

function pendingLeaveEditShrinkMessage() {
  return (
    'Edits can only shorten a pending request. ' +
    'To add days or book different dates, cancel this request and create a new one.'
  )
}

module.exports = {
  isEditedRangeShrinkOnly,
  pendingLeaveEditShrinkMessage
}
