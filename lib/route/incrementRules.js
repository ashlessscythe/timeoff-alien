'use strict'

/*
 * Pure helpers for resolving leave-request increments.
 *
 *  - `getRequestedIncrement` maps the form-submitted shape (legacy
 *    `from_date_part`, optional `time_start`/`time_end`, modern
 *    `increment_type`/`increment_value`) to one of the canonical names:
 *    'full_day' | 'half_day' | 'hourly' | 'quarter_hr'.
 *
 *  - `isIncrementAllowed` answers whether the requested increment is
 *    permitted given (a) the employee's department `allowed_increments`
 *    and (b) the leave type's `allow_non_default_increments` flag.
 *    Non-default increments (hourly / quarter_hr) require BOTH the
 *    department and the leave type to opt in.
 *
 *  - `parseAllowedIncrements` parses the JSON column on `departments`,
 *    falling back to the application default when the column is empty
 *    or malformed.
 */

const DEFAULT_ALLOWED_INCREMENTS = ['full_day', 'half_day']
const NON_DEFAULT_INCREMENTS = new Set(['hourly', 'quarter_hr'])

function parseAllowedIncrements(department) {
  if (department && department.allowed_increments) {
    try {
      const parsed = JSON.parse(department.allowed_increments)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    } catch (error) {
      console.error(
        'Failed to parse allowed_increments for department ' +
          (department.id || 'unknown') +
          ':',
        error
      )
    }
  }

  return DEFAULT_ALLOWED_INCREMENTS.slice()
}

function getRequestedIncrement(args) {
  const incrementType = args && args.incrementType
  const incrementValue = args && args.incrementValue
  const fromDatePart = args && args.fromDatePart
  const timeStart = args && args.timeStart
  const timeEnd = args && args.timeEnd

  if (incrementType) {
    if (incrementType === 'day') return 'full_day'
    if (incrementType === 'halfday') return 'half_day'
    if (incrementType === 'hr') return 'hourly'
    if (incrementType === 'min') return 'quarter_hr'
    return null
  }

  if (fromDatePart === '2' || fromDatePart === '3') {
    return 'half_day'
  }

  if (timeStart || timeEnd) {
    if (incrementValue === '15' || incrementValue === '30') {
      return 'quarter_hr'
    }

    return 'hourly'
  }

  return 'full_day'
}

function isIncrementAllowed(args) {
  const requestedIncrement = args && args.requestedIncrement
  const departmentAllowedIncrements =
    (args && args.departmentAllowedIncrements) || []
  const leaveTypeAllowsNonDefault = !!(args && args.leaveTypeAllowsNonDefault)

  if (!requestedIncrement) return false
  if (!departmentAllowedIncrements.includes(requestedIncrement)) return false
  if (NON_DEFAULT_INCREMENTS.has(requestedIncrement)) {
    return leaveTypeAllowsNonDefault
  }
  return true
}

module.exports = {
  DEFAULT_ALLOWED_INCREMENTS,
  NON_DEFAULT_INCREMENTS,
  parseAllowedIncrements,
  getRequestedIncrement,
  isIncrementAllowed
}
