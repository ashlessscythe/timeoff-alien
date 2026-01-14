/*
 * This is a class that represent a day from employee leave.
 *
 * The need of this class is historical as initially the DB design
 * included leave_day table, but it apeared to be redundant.
 *
 * Though lots of logic was written based on leave_date existance,
 * hence thos class was created.
 *
 * */

'use strict'

const _ = require('underscore')
const moment = require('moment')

function LeaveDay(args) {
  // Make sure all required data is provided
  _.each(['date', 'day_part', 'sequelize', 'leave_type_id'], property => {
    if (!_.has(args, property)) {
      throw new Error('No mandatory ' + property + ' was provided')
    }
  })

  this.date = args.date
  this.day_part = args.day_part
  this.sequelize = args.sequelize
  this.morning_leave_type_id = this.afternoon_leave_type_id = args.leave_type_id
  // New time-based fields
  this.time_start = args.time_start || null
  this.time_end = args.time_end || null
}

LeaveDay.prototype.is_all_day_leave = function() {
  return (
    String(this.day_part) ===
    String(this.sequelize.models.Leave.leave_day_part_all())
  )
}

LeaveDay.prototype.is_morning_leave = function() {
  return (
    String(this.day_part) ===
    String(this.sequelize.models.Leave.leave_day_part_morning())
  )
}

LeaveDay.prototype.is_afternoon_leave = function() {
  return (
    String(this.day_part) ===
    String(this.sequelize.models.Leave.leave_day_part_afternoon())
  )
}

LeaveDay.prototype.get_morning_leave_type_id = function() {
  return String(this.morning_leave_type_id)
}

LeaveDay.prototype.get_afternoon_leave_type_id = function() {
  return String(this.afternoon_leave_type_id)
}

// Set current object to be as one for All day leave, but the state is not
// saved into database. It is used when showing calendar to user and
// there are two half days that fit into one whole day
LeaveDay.prototype.pretend_to_be_full_day = function() {
  return (this.day_part = this.sequelize.models.Leave.leave_day_part_all())
}

LeaveDay.prototype.get_pretty_date = function() {
  return moment.utc(this.date).format('YYYY-MM-DD')
}

// Check if this is a time-based leave (has time_start and/or time_end)
LeaveDay.prototype.is_time_based_leave = function() {
  return !!(this.time_start || this.time_end)
}

// Get duration in hours for time-based leave
// Returns null if not time-based or if times are invalid
LeaveDay.prototype.get_duration_hours = function() {
  if (!this.is_time_based_leave() || !this.time_start || !this.time_end) {
    return null
  }

  try {
    const start = moment(this.time_start, 'HH:mm:ss')
    const end = moment(this.time_end, 'HH:mm:ss')

    // Handle case where end time is next day (e.g., swing shift)
    if (end.isBefore(start)) {
      end.add(1, 'day')
    }

    return end.diff(start, 'hours', true) // true = return fractional hours
  } catch (e) {
    return null
  }
}

// Get duration in minutes for time-based leave
LeaveDay.prototype.get_duration_minutes = function() {
  const hours = this.get_duration_hours()
  return hours !== null ? hours * 60 : null
}

module.exports = LeaveDay
