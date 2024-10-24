'use strict'

const moment = require('moment')
const _ = require('underscore')

function CalendarMonth(day, args) {
  const self = this
  this.date = moment.utc(day).startOf('month')
  this._leaves = {}
  this._bank_holidays = {}

  if (args && args.today) {
    self.today = args.today
  } else {
    throw new Error(
      'CalendarMonth requires today - moment object that represents today'
    )
  }

  if (args) {
    self._schedule = args.schedule
  }

  if (!self._schedule) {
    throw new Error('CalendarMonth requires schedule')
  }

  // fixed `today` always appearing as holiday
  // due to invalid moment and arg.bank_holidays combo
  if (args && args.bank_holidays) {
    const map = {}
    const bArray = args.bank_holidays
    // console.log('bArray: ', bArray)

    bArray.forEach(d => {
      let parsedDate

      if (typeof d === 'string' || d instanceof String) {
        parsedDate = moment.utc(d)
        d = {
          date: parsedDate,
          name: undefined
        }
      } else if (d instanceof Date) {
        parsedDate = moment.utc(d)
        d = {
          date: parsedDate,
          name: undefined
        }
      } else if (d.date && moment.utc(d.date).isValid()) {
        parsedDate = moment.utc(d.date)
        d = {
          date: parsedDate,
          name: d.name
        }
      } else {
        // Skip invalid entries
        return
      }

      const formattedDate = d.date.clone().format(self.default_date_format())
      map[formattedDate] = d
    })

    self._bank_holidays = map
  }

  if (args && args.leave_days) {
    var map = {}
    args.leave_days.forEach(day => {
      const attribute = moment.utc(day.date).format(self.default_date_format())
      if (!map[attribute]) {
        map[attribute] = day
      } else if (map[attribute]) {
        if (map[attribute].is_all_day_leave()) {
          return
        }

        if (day.is_all_day_leave()) {
          map[attribute] = day
        } else if (map[attribute].day_part !== day.day_part) {
          // Merge leave types from both days into one in "map"
          if (day.is_morning_leave()) {
            map[attribute].morning_leave_type_id = day.morning_leave_type_id
          }

          if (day.is_afternoon_leave()) {
            map[attribute].afternoon_leave_type_id = day.afternoon_leave_type_id
          }

          map[attribute].pretend_to_be_full_day()
        }
      }
    })
    self._leaves = map
  }

  self._leave_types_map = {}

  if (args && args.leave_types) {
    // Build leave types look up dictionary
    args.leave_types.forEach(lt => (self._leave_types_map[lt.id] = lt))
  }
}

CalendarMonth.prototype.is_bank_holiday = function(day) {
  const formattedDate = this.get_base_date()
    .date(day)
    .format(this.default_date_format())

  let list =
    this._bank_holidays && this._bank_holidays.hasOwnProperty(formattedDate)

  return list
}

CalendarMonth.prototype.get_bank_holiday_name = function(day) {
  const self = this

  if (!self.is_bank_holiday(day)) {
    return null
  }

  // console.log('this._bank_holidays: ', this._bank_holidays)
  return this._bank_holidays[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ].name
}

CalendarMonth.prototype.is_leave = function(day) {
  const leave_day = this._leaves[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ]

  return leave_day && leave_day.is_all_day_leave()
}

CalendarMonth.prototype.is_leave_morning = function(day) {
  const leave_day = this._leaves[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ]
  return this.is_leave(day) || (leave_day && leave_day.is_morning_leave())
}

CalendarMonth.prototype.is_leave_afternoon = function(day) {
  const leave_day = this._leaves[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ]

  return this.is_leave(day) || (leave_day && leave_day.is_afternoon_leave())
}

CalendarMonth.prototype.get_leave_obj = function(day) {
  const leave_day = this._leaves[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ]

  if (leave_day && leave_day.leave) {
    return leave_day.leave
  } else {
    return null
  }
}

CalendarMonth.prototype.is_new_leave = function(day) {
  const leave_day = this._leaves[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ]

  return leave_day && leave_day.leave && leave_day.leave.is_new_leave()
}

CalendarMonth.prototype.is_approved_leave = function(day) {
  const leave_day = this._leaves[
    this.get_base_date()
      .date(day)
      .format(this.default_date_format())
  ]

  return leave_day && leave_day.leave && leave_day.leave.is_approved_leave()
}

CalendarMonth.prototype.get_morning_leave_type_id = function(day) {
  const self = this
  const leave_day =
    self._leaves[
      self
        .get_base_date()
        .date(day)
        .format(self.default_date_format())
    ]

  if (!leave_day) {
    return null
  }

  return leave_day.get_morning_leave_type_id()
}

CalendarMonth.prototype.get_afternoon_leave_type_id = function(day) {
  const self = this
  const leave_day =
    self._leaves[
      self
        .get_base_date()
        .date(day)
        .format(self.default_date_format())
    ]

  if (!leave_day) {
    return null
  }

  return leave_day.get_afternoon_leave_type_id()
}

CalendarMonth.prototype.default_date_format = function() {
  return 'YYYY-MM-DD'
}

CalendarMonth.prototype.how_many_days = function() {
  return this.date.daysInMonth()
}

CalendarMonth.prototype.get_base_date = function() {
  return this.date.clone()
}

CalendarMonth.prototype._week_day_map = function() {
  return { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }
}

CalendarMonth.prototype.week_day = function() {
  return this._week_day_map()[this.date.day()]
}

CalendarMonth.prototype.how_many_blanks_at_the_start = function() {
  return this.week_day() - 1
}

CalendarMonth.prototype.how_many_blanks_at_the_end = function() {
  return (
    7 -
    this._week_day_map()[
      this.get_base_date()
        .endOf('month')
        .day()
    ]
  )
}

CalendarMonth.prototype.is_weekend = function(day) {
  return !this._schedule.is_it_working_day({
    day: this.get_base_date().date(day)
  })
}

CalendarMonth.prototype.is_current_day = function(day) {
  return (
    this.get_base_date()
      .date(day)
      .format(this.default_date_format()) ===
    this.today.format(this.default_date_format())
  )
}

CalendarMonth.prototype.as_for_template = function() {
  const self = this
  const weeks = []
  let week = []

  for (let i = 0; i < self.how_many_blanks_at_the_start(); i++) {
    week.push({ val: '' })
  }

  for (let i = 1; i <= self.how_many_days(); i++) {
    const day = {
      val: i,
      leave_obj: self.get_leave_obj(i)
    }

    if (self.is_weekend(i)) {
      day.is_weekend = true
    } else if (self.is_bank_holiday(i)) {
      day.is_bank_holiday = true
      day.bank_holiday_name = self.get_bank_holiday_name(i) || 'N/A'
    } else {
      const leaveLabelForDay = {}

      if (self.is_leave_morning(i)) {
        day.is_leave_morning = true

        const morning_leave_type_id = self.get_morning_leave_type_id(i)
        day.morning_leave_type_id = morning_leave_type_id

        day.leave_color_value_morning =
          morning_leave_type_id && self._leave_types_map[morning_leave_type_id]
            ? self._leave_types_map[morning_leave_type_id].get_color_value()
            : '#ffffff'

        leaveLabelForDay.morning =
          (morning_leave_type_id &&
            self._leave_types_map[morning_leave_type_id] &&
            self._leave_types_map[morning_leave_type_id].name) ||
          'morning'
      }

      if (self.is_leave_afternoon(i)) {
        day.is_leave_afternoon = true

        const afternoon_leave_type_id = self.get_afternoon_leave_type_id(i)
        day.afternoon_leave_type_id = afternoon_leave_type_id

        day.leave_color_value_afternoon =
          afternoon_leave_type_id &&
          self._leave_types_map[afternoon_leave_type_id]
            ? self._leave_types_map[afternoon_leave_type_id].get_color_value()
            : '#ffffff'

        leaveLabelForDay.afternoon =
          (afternoon_leave_type_id &&
            self._leave_types_map[afternoon_leave_type_id] &&
            self._leave_types_map[afternoon_leave_type_id].name) ||
          'afternoon'
      }

      if (self.is_new_leave(i)) {
        day.is_new_leave = true
      } else if (self.is_approved_leave(i)) {
        day.is_approved_leave = true
      }

      if (
        leaveLabelForDay.morning &&
        leaveLabelForDay.morning === leaveLabelForDay.afternoon
      ) {
        day.leaveLabel = leaveLabelForDay.morning
      } else {
        if (leaveLabelForDay.morning) {
          day.leaveLabel = `${leaveLabelForDay.morning} (morning) `
        }
        if (leaveLabelForDay.afternoon) {
          day.leaveLabel = `${day.leaveLabel ? day.leaveLabel : ''}${
            leaveLabelForDay.afternoon
          } (afternoon)`
        }
      }
    }

    if (self.is_current_day(i)) {
      day.is_current_day = true
    }

    week.push(day)
    if (week.length >= 7) {
      weeks.push(week)
      week = []
    }
  }

  for (let i = 0; i < self.how_many_blanks_at_the_end(); i++) {
    week.push({ val: '' })
  }

  weeks.push(week)

  return {
    month: self.get_base_date().format('MMMM'),
    moment: self.get_base_date(),
    weeks
  }
}

CalendarMonth.prototype.as_for_team_view = function() {
  const me = this
  const for_calendar_structure = this.as_for_template()

  // remove empty days, those staying for empty cells in calendar
  const days = _.filter(
    _.flatten(for_calendar_structure.weeks),
    day => !!day.val
  )

  _.each(days, day => {
    day.moment = me.get_base_date().date(day.val)
  })

  return days
}

module.exports = CalendarMonth
