'use strict'

const moment = require('moment')
const moment_tz = require('moment-timezone')
const config = require('../config')

function as_date_formatted(date_str, format, options) {
  if (!date_str) return ''

  if (!format) {
    format = get_current_format(options)
  }

  // Special case when we have to take time zone into consideration
  // when printing date (usually it is needed for those dates recorded
  // automatically as UTC time stampts)
  if (options.tom_take_timezone_into_consideration) {
    return moment_tz
      .utc(date_str)
      .tz(get_timezone(options))
      .format(format)
  }

  return moment.utc(date_str).format(format)
}

// Note: that currently it returns only truely value of given property, that is if there property
// exists and its value is falsy, that undef is returned back
function get_property_from_options(options, property_name) {
  let value

  if (
    options.hasOwnProperty('data') &&
    options.data.hasOwnProperty('root') &&
    options.data.root.hasOwnProperty(property_name) &&
    options.data.root[property_name]
  ) {
    value = options.data.root[property_name]
  }

  return value
}

function get_current_format(options) {
  let format = 'YYYY-MM-DD'

  const user =
    get_property_from_options(options, 'logged_user') ||
    get_property_from_options(options, 'user')

  if (user && user.hasOwnProperty('company')) {
    format = user.company.get_default_date_format()
  }

  return format
}

function get_timezone(options) {
  let timezone = 'Europe/London'

  const user =
    get_property_from_options(options, 'logged_user') ||
    get_property_from_options(options, 'user')

  if (user && user.hasOwnProperty('company')) {
    timezone = user.company.timezone
  }

  return timezone
}

module.exports = function() {
  return {
    // Handlebars does not allow to have conditions in IF, here is
    // workaround picked from here: http://stackoverflow.com/questions/8853396/logical-operator-in-a-handlebars-js-if-conditional
    eq: function(a, b) {
      return a === b
    },
    if_equal: function(v1, v2, options) {
      if (v1 === v2) {
        return options.fn(this)
      }
      return options.inverse(this)
    },

    or: (a, b) => a || b,
    not: a => !a,

    // Helper to check if an array includes a value
    includes: function(array, value) {
      if (!Array.isArray(array)) return false
      // Try numeric comparison first (for IDs), then fall back to string comparison
      const numValue = parseInt(value, 10)
      if (!isNaN(numValue)) {
        return array.some(item => parseInt(item, 10) === numValue)
      }
      // String comparison for non-numeric values
      return array.some(item => String(item) === String(value))
    },

    // Given string with UTC date return string with date formated in customer specific manner
    as_date: function(date_string, options) {
      return as_date_formatted(date_string, undefined, options)
    },

    // Return string with given date formated as a timestamp
    as_datetime: function(date_str, options) {
      return as_date_formatted(
        date_str,
        get_current_format(options) + ' HH:mm:ss',
        options
      )
    },

    // Do the same as "as_date" method but takes into consideration of company
    // timezone. It is needed for rendering dates that were recorded in database
    // automatically in UTC, dates that were recorded based on explicit input
    // from users should not be used with this method (but with "as_date" instead)
    as_date_from_timestamp: function(date_string, options) {
      // Add custom flag to options so further down the call stack
      // we would know that date needs to be corrected with
      // current timezone
      options.tom_take_timezone_into_consideration = true

      return as_date_formatted(date_string, undefined, options)
    },

    // Similar to "as_datetime" but with the same twist as "as_date_from_timestamp"
    as_datetime_from_timestamp: function(date_str, options) {
      // Add custom flag to options so further down the call stack
      // we would know that date needs to be corrected with
      // current timezone
      options.tom_take_timezone_into_consideration = true

      return as_date_formatted(
        date_str,
        get_current_format(options) + ' HH:mm:ss',
        options
      )
    },

    // Given string with UTC date and string with moment.js format return corresponding string
    as_date_formatted,

    // Get access to config value holding application domain
    get_application_domain: function() {
      return config.get('branding:url')
    },

    // Return URL to the web site with promotion materials for TimeOff.Management
    get_promotion_website_domain: function() {
      return config.get('branding:website')
    },

    concatenate: function() {
      const arg = Array.prototype.slice.call(arguments, 0)
      arg.pop()
      return arg.join('')
    },

    ga_tracker: config.get('google:analytics:tracker'),
    // Should we include Google Analitics snipet?
    // (based on application config)
    is_ga_analitics_on: function(options) {
      if (config.get('google:analytics:tracker')) {
        return options.fn(this)
      }

      return options.inverse(this)
    },

    is_force_to_explicitly_select_type_when_requesting_new_leave: function(
      options
    ) {
      if (
        config.get('force_to_explicitly_select_type_when_requesting_new_leave')
      ) {
        return options.fn(this)
      }

      return options.inverse(this)
    },

    // Helper to multiply two numbers
    multiply: function(a, b) {
      return a * b
    },

    // Helper to get array length
    array_length: function(arr) {
      return Array.isArray(arr) ? arr.length : 0
    },

    // Helper to sum two numbers
    sum: function(a, b) {
      return Number(a || 0) + Number(b || 0)
    },

    // Helper to check if first value is less than second value
    lt: function(a, b) {
      return Number(a) < Number(b)
    },

    // Helper to check if first value is greater than second value
    gt: function(a, b) {
      return Number(a) > Number(b)
    },

    // Helper to check if first value is greater than or equal to second value
    gte: function(a, b) {
      return Number(a) >= Number(b)
    },

    // Helper to get absolute value
    abs: function(value) {
      return Math.abs(Number(value))
    },

    // Helper to convert decimal to percentage
    percent: function(value) {
      return Math.round(Number(value) * 100)
    },

    // Helper to check if errors array has suggestions
    hasSuggestions: function(errors) {
      if (!Array.isArray(errors)) return false
      return errors.some(err => err.suggestions)
    },

    parseInt: function(value) {
      return parseInt(value, 10)
    },

    // return as string
    toString: function(value) {
      return String(value)
    },

    typeof: function(value) {
      return typeof value
    },

    // Helper to convert value to JSON string
    json: function(value) {
      return JSON.stringify(value)
    },

    // Helper to get days and hours separately for styling purposes
    // Returns an object with {days: "14", hours: "7", hasHours: true} or {days: "14", hours: "", hasHours: false}
    get_days_and_hours_parts: function(fractional_days, options) {
      if (fractional_days === null || fractional_days === undefined) {
        return { days: '0', hours: '', hasHours: false, isNegative: false }
      }

      const days = Number(fractional_days)
      if (isNaN(days) || days === 0) {
        return { days: '0', hours: '', hasHours: false, isNegative: false }
      }

      const isNegative = days < 0
      const absDays = Math.abs(days)

      // Get working hours per day from user context, default to 8
      let working_hours_per_day = 8

      try {
        const user =
          (options && get_property_from_options(options, 'logged_user')) ||
          (options && get_property_from_options(options, 'user')) ||
          (options && options.data && options.data.root && options.data.root.current_user) ||
          (options && options.data && options.data.root && options.data.root.requester) ||
          (options && options.data && options.data.root && options.data.root.user)

        if (user) {
          if (user.shift_hours) {
            const userShiftHours = typeof user.shift_hours === 'string'
              ? JSON.parse(user.shift_hours)
              : user.shift_hours

            const shifts = Object.keys(userShiftHours)
            if (shifts.length > 0) {
              const firstShift = userShiftHours[shifts[0]]
              if (firstShift && firstShift.start && firstShift.end) {
                const start = moment(firstShift.start, 'HH:mm')
                let end = moment(firstShift.end, 'HH:mm')
                if (end.isBefore(start)) {
                  end.add(1, 'day')
                }
                working_hours_per_day = end.diff(start, 'hours', true)
              }
            }
          } else if (user.department && user.department.shift_hours) {
            const deptShiftHours = typeof user.department.shift_hours === 'string'
              ? JSON.parse(user.department.shift_hours)
              : user.department.shift_hours

            const shifts = Object.keys(deptShiftHours)
            if (shifts.length > 0) {
              const firstShift = deptShiftHours[shifts[0]]
              if (firstShift && firstShift.start && firstShift.end) {
                const start = moment(firstShift.start, 'HH:mm')
                let end = moment(firstShift.end, 'HH:mm')
                if (end.isBefore(start)) {
                  end.add(1, 'day')
                }
                working_hours_per_day = end.diff(start, 'hours', true)
              }
            }
          }
        }
      } catch (e) {
        console.error('Error getting working hours per day:', e)
      }

      const whole_days = Math.floor(absDays)
      const fractional_part = absDays - whole_days

      let hours = 0
      if (fractional_part > 0) {
        const precise_hours = fractional_part * working_hours_per_day
        hours = Math.round(precise_hours)
        if (hours === 0 && precise_hours > 0) {
          hours = 1
        }
      }

      // If we have fractional days but no whole days, show hours only
      if (whole_days === 0 && absDays > 0) {
        if (hours === 0) {
          const precise_hours = fractional_part * working_hours_per_day
          hours = Math.max(1, Math.round(precise_hours))
        }
        return {
          days: '',
          hours: String(hours),
          hasHours: true,
          isNegative: isNegative
        }
      }

      return {
        days: whole_days > 0 ? String(whole_days) : '0',
        hours: hours > 0 ? String(hours) : '',
        hasHours: hours > 0,
        isNegative: isNegative
      }
    },

    // Helper to convert fractional days to "days and hours" format
    // For hour-based requests, displays as compact "Xd.Yh" or verbose "X days Y hours"
    // Options: pass 'compact' as second argument for compact format (default for calendar view)
    format_days_and_hours: function(fractional_days, format_type, options) {
      // Handle null/undefined/NaN
      if (fractional_days === null || fractional_days === undefined) {
        return format_type === 'compact' ? '0d' : '0 days'
      }

      // Handle case where format_type is actually the options object (backwards compatibility)
      if (format_type && typeof format_type === 'object' && format_type.hash === undefined && !format_type.fn) {
        options = format_type
        format_type = 'verbose'
      } else if (!format_type || (format_type !== 'compact' && format_type !== 'verbose')) {
        // If format_type is not provided or is options, default based on context
        format_type = 'compact' // Default to compact for better UX
      }

      // Convert to number and check if it's a valid number
      // Handle both string and number inputs, and also handle function results
      let days = fractional_days

      // If it's a function (method call result), try to get the value
      if (typeof fractional_days === 'function') {
        try {
          days = fractional_days.call(this)
        } catch (e) {
          console.error('Error calling fractional_days function:', e)
          return format_type === 'compact' ? '0d' : '0 days'
        }
      }

      if (typeof days === 'string') {
        days = parseFloat(days)
      } else {
        days = Number(days)
      }

      // Debug logging - log ALL values to see what's happening
      console.log('format_days_and_hours DEBUG:', {
        original: fractional_days,
        converted: days,
        type: typeof fractional_days,
        isFunction: typeof fractional_days === 'function',
        isZero: days === 0,
        absDays: Math.abs(days)
      })

      if (isNaN(days) || days === null || days === undefined) {
        console.log('format_days_and_hours: Invalid value, returning 0d')
        return format_type === 'compact' ? '0d' : '0 days'
      }

      const isNegative = days < 0
      const absDays = Math.abs(days)

      // Handle case where days is exactly 0 (not a fraction)
      // Use a small epsilon to handle floating point precision issues
      // BUT: if the original value was a method call that might return 0 incorrectly,
      // we need to be more careful. For now, only return '0d' if truly zero
      if (absDays < 0.0001) {
        console.log('format_days_and_hours: Value is effectively 0, returning 0d')
        // Only return 0d if it's truly zero, not if it's a very small fraction
        return format_type === 'compact' ? '0d' : '0 days'
      }

      console.log('format_days_and_hours: Processing value:', absDays, 'whole_days will be:', Math.floor(absDays))

      // Get working hours per day from user context, default to 8
      let working_hours_per_day = 8

      try {
        const user =
          (options && get_property_from_options(options, 'logged_user')) ||
          (options && get_property_from_options(options, 'user')) ||
          (options && options.data && options.data.root && options.data.root.current_user) ||
          (options && options.data && options.data.root && options.data.root.requester) ||
          (options && options.data && options.data.root && options.data.root.user)

        if (user) {
          // Try to get working hours from user's shift configuration
          if (user.shift_hours) {
            const userShiftHours = typeof user.shift_hours === 'string'
              ? JSON.parse(user.shift_hours)
              : user.shift_hours

            const shifts = Object.keys(userShiftHours)
            if (shifts.length > 0) {
              const firstShift = userShiftHours[shifts[0]]
              if (firstShift && firstShift.start && firstShift.end) {
                const start = moment(firstShift.start, 'HH:mm')
                let end = moment(firstShift.end, 'HH:mm')
                if (end.isBefore(start)) {
                  end.add(1, 'day')
                }
                working_hours_per_day = end.diff(start, 'hours', true)
              }
            }
          } else if (user.department && user.department.shift_hours) {
            const deptShiftHours = typeof user.department.shift_hours === 'string'
              ? JSON.parse(user.department.shift_hours)
              : user.department.shift_hours

            const shifts = Object.keys(deptShiftHours)
            if (shifts.length > 0) {
              const firstShift = deptShiftHours[shifts[0]]
              if (firstShift && firstShift.start && firstShift.end) {
                const start = moment(firstShift.start, 'HH:mm')
                let end = moment(firstShift.end, 'HH:mm')
                if (end.isBefore(start)) {
                  end.add(1, 'day')
                }
                working_hours_per_day = end.diff(start, 'hours', true)
              }
            }
          }
        }
      } catch (e) {
        // If there's an error, use default 8 hours
        console.error('Error getting working hours per day:', e)
      }

      // Calculate whole days and remaining hours
      const whole_days = Math.floor(absDays)
      const fractional_part = absDays - whole_days

      // Calculate hours - ALWAYS calculate if we have any fractional part
      let hours = 0
      if (fractional_part > 0 || (whole_days === 0 && absDays > 0)) {
        const precise_hours = fractional_part * working_hours_per_day
        // Round to nearest integer
        hours = Math.round(precise_hours)
        // If we have fractional days but rounded to 0, show at least 1 hour
        if (hours === 0 && precise_hours > 0) {
          hours = 1
        }
        // Special case: if whole_days is 0 but we have a value, ensure we show at least 1 hour
        if (whole_days === 0 && absDays > 0 && hours === 0) {
          hours = 1
        }
      }

      // Build the result string
      if (format_type === 'compact') {
        // Compact format: "14d7h" or "7h" or "14d"
        const parts = []

        // Add days if we have whole days
        if (whole_days > 0) {
          parts.push(`${whole_days}d`)
        }

        // CRITICAL: If we have fractional days (whole_days = 0 but absDays > 0), ALWAYS show hours
        // This handles cases like 0.375 days = 3 hours
        if (whole_days === 0 && absDays > 0) {
          // Recalculate hours to be sure we have the right value
          const precise_hours = fractional_part * working_hours_per_day
          const calc_hours = Math.round(precise_hours)
          const final_hours = (calc_hours === 0 && precise_hours > 0) ? 1 : Math.max(1, calc_hours)
          parts.push(`${final_hours}h`)
        } else if (hours > 0) {
          // Show hours if we have them and we also have whole days
          parts.push(`${hours}h`)
        }

        // If no days and no hours (absDays is exactly 0), show 0d
        if (parts.length === 0) {
          return isNegative ? '-0d' : '0d'
        }

        const result = parts.join('')
        return isNegative ? `-${result}` : result
      } else {
        // Verbose format: "14 days 7 hours" or "7 hours" or "14 days"
        const parts = []
        if (whole_days > 0) {
          parts.push(`${whole_days} ${whole_days === 1 ? 'day' : 'days'}`)
        }
        // If we have fractional days (whole_days = 0 but absDays > 0), always show hours
        if (whole_days === 0 && absDays > 0) {
          // Always show at least 1 hour for any fractional time
          const display_hours = hours > 0 ? hours : 1
          parts.push(`${display_hours} ${display_hours === 1 ? 'hour' : 'hours'}`)
        } else if (hours > 0) {
          // Show hours if we have them and we also have whole days
          parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
        }
        // If no days and no hours (absDays is exactly 0), show 0 days
        if (parts.length === 0) {
          return isNegative ? '-0 days' : '0 days'
        }
        const result = parts.join(' ')
        return isNegative ? `-${result}` : result
      }
    }
  }
}
