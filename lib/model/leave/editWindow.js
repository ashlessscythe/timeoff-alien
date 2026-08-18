'use strict'

const moment = require('moment')

/*
 * A pending-leave edit must still be the same request: the new date range
 * must share at least one calendar day with the original range.
 *
 * Original Aug 3–5:
 *   - Aug 4–6 allowed (shares Aug 4–5)
 *   - Aug 5–20 allowed (shares Aug 5)
 *   - Aug 6–8 rejected (no shared day — that is a different request)
 *   - Dec 22–26 rejected
 */

function toUtcDay(value) {
  return moment.utc(value).startOf('day')
}

function editedRangeSharesOriginalDate(args) {
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

  return !originalTo.isBefore(nextFrom, 'day') && !nextTo.isBefore(originalFrom, 'day')
}

function pendingLeaveEditWindowMessage() {
  return (
    'Edited dates must include at least one date from the original request. ' +
    'Different days should be a new request: cancel this one and create another.'
  )
}

module.exports = {
  editedRangeSharesOriginalDate,
  // Back-compat alias used by updatePendingLeave / calendar UI naming.
  isDateRangeWithinEditWindow: editedRangeSharesOriginalDate,
  pendingLeaveEditWindowMessage
}
