'use strict'

const validator = require('validator')
const moment = require('moment')
const LeaveRequestParameters = require('../../model/leave_request_parameters')

module.exports = function(args) {
  const req = args.req
  const params = args.params

  const user = typeof params.user !== 'undefined' && validator.trim(params.user)
  console.log('validating user: ' + user)
  const leave_type =
    typeof params.leave_type !== 'undefined' &&
    validator.trim(params.leave_type)
  let from_date =
    typeof params.from_date !== 'undefined' && validator.trim(params.from_date)
  const from_date_part =
    typeof params.from_date_part !== 'undefined' &&
    validator.trim(params.from_date_part)
  let to_date =
    typeof params.to_date !== 'undefined' && validator.trim(params.to_date)
  const to_date_part =
    typeof params.to_date_part !== 'undefined' &&
    validator.trim(params.to_date_part)
  const time_start =
    typeof params.time_start !== 'undefined' && validator.trim(params.time_start)
  const time_end =
    typeof params.time_end !== 'undefined' && validator.trim(params.time_end)
  const reason =
    typeof params.reason !== 'undefined' && validator.trim(params.reason)

  if (
    typeof user !== 'undefined' &&
    user &&
    typeof user !== 'number' &&
    (!user || !validator.isNumeric(user))
  ) {
    req.session.flash_error('Incorrect employee')
  }

  if (
    typeof leave_type !== 'number' &&
    (!leave_type || !validator.isNumeric(leave_type))
  ) {
    req.session.flash_error('Incorrect leave type')
  }

  const date_validator = function(date_str, label) {
    try {
      // Basic check
      if (!date_str) throw new Error('date needs to be defined')

      // log check
      console.log('date_str: ' + date_str)
      date_str = req.user.company.normalise_date(date_str)

      // Ensure that normalisation went OK
      if (date_str.length !== 10) {
        throw new Error('Invalid date format')
      }
    } catch (e) {
      console.log('Got an error ' + e)
      req.session.flash_error(label + ' should be a date')
    }
  }

  date_validator(from_date, 'From date')

  // Validate day_part (legacy) - only required if time fields are not provided
  if (!time_start && !time_end) {
    if (
      typeof from_date_part === 'undefined' ||
      !validator.matches(from_date_part, /^[123]$/) ||
      typeof to_date_part === 'undefined' ||
      !validator.matches(to_date_part, /^[123]$/)
    ) {
      req.session.flash_error('Incorrect day part')
    }
  }

  // Validate time fields if provided (should be in HH:mm:ss format)
  if (time_start && !validator.matches(time_start, /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/)) {
    req.session.flash_error('Invalid start time format (expected HH:mm:ss)')
  }
  if (time_end && !validator.matches(time_end, /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/)) {
    req.session.flash_error('Invalid end time format (expected HH:mm:ss)')
  }

  date_validator(to_date, 'To date')

  // Check if it makes sence to continue validation (as following code relies on
  // to and from dates to be valid ones)
  if (req.session.flash_has_errors()) {
    const error = new Error('Got validation errors')
    error.flash = req.session.flash
    throw error
  }

  // Convert dates inot format used internally
  from_date = req.user.company.normalise_date(from_date)
  to_date = req.user.company.normalise_date(to_date)

  if (from_date.substr(0, 4) !== to_date.substr(0, 4)) {
    req.session.flash_error(
      'Current implementation does not allow inter year leaves. Please split your request into two parts'
    )
  }

  if (req.session.flash_has_errors()) {
    const error = new Error('Got validation errors')
    error.flash = req.session.flash
    throw error
  }

  const valid_attributes = {
    leave_type,
    from_date,
    from_date_part,
    to_date,
    to_date_part,
    reason
  }

  // Add time fields if provided
  if (time_start) {
    valid_attributes.time_start = time_start
  }
  if (time_end) {
    valid_attributes.time_end = time_end
  }

  if (user) {
    valid_attributes.user = user
  }

  return new LeaveRequestParameters(valid_attributes)
}
