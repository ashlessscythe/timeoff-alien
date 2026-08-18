'use strict'

const moment = require('moment')

/*
 * Pending-leave edits must stay a correction of the original period, not a
 * substitute for cancel + new request. The entire new range must fall inside
 * the original range expanded by this many calendar days on each side.
 *
 * Example with 14 days, original Aug 3–5:
 *   - Aug 4–6 allowed
 *   - Jul 20–Aug 19 allowed (window edges)
 *   - Dec 22–26 rejected
 *   - Aug 3–Dec 26 rejected (end is far outside the window)
 */
const MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS = 14

function toUtcDay(value) {
  return moment.utc(value).startOf('day')
}

function editWindowForOriginalRange(originalStart, originalEnd, maxShiftDays) {
  const shift =
    maxShiftDays === undefined ? MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS : maxShiftDays
  const start = toUtcDay(originalStart)
  const end = toUtcDay(originalEnd)
  return {
    windowStart: start.clone().subtract(shift, 'days'),
    windowEnd: end.clone().add(shift, 'days')
  }
}

function isDateRangeWithinEditWindow(args) {
  const originalStart = args && args.originalStart
  const originalEnd = args && args.originalEnd
  const nextStart = args && args.nextStart
  const nextEnd = args && args.nextEnd
  const maxShiftDays =
    args && args.maxShiftDays !== undefined
      ? args.maxShiftDays
      : MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS

  if (!originalStart || !originalEnd || !nextStart || !nextEnd) {
    return false
  }

  const { windowStart, windowEnd } = editWindowForOriginalRange(
    originalStart,
    originalEnd,
    maxShiftDays
  )
  const nextFrom = toUtcDay(nextStart)
  const nextTo = toUtcDay(nextEnd)

  return !nextFrom.isBefore(windowStart, 'day') && !nextTo.isAfter(windowEnd, 'day')
}

function pendingLeaveEditWindowMessage(maxShiftDays) {
  const shift =
    maxShiftDays === undefined ? MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS : maxShiftDays
  return (
    `Edited dates must stay within ${shift} days of the original request. ` +
    'To book a different period, cancel this request and create a new one.'
  )
}

module.exports = {
  MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS,
  editWindowForOriginalRange,
  isDateRangeWithinEditWindow,
  pendingLeaveEditWindowMessage
}
