/*
 *  This class represent Employee's allowance.
 *
 *  As allowance became quite complicated entity, which is calculated
 *  based on few sources, there was decision to move allowance calculation
 *  logic out into its own class.
 *
 * */

'use strict'

const moment = require('moment')
const Promise = require('bluebird')
const Joi = require('joi')

/*
 *  Section where we declare interfaces used in methods for this class.
 * */

const schema_user = Joi.object().required()
// For moment objects in Joi v17, we'll use simple Joi.any() with default function
const schema_year = Joi.any().default(() => moment.utc())
const schema_now = Joi.any().default(() => moment.utc())

const schema_promise_allowance = Joi.object({
  year: schema_year,
  user: schema_user,
  now: schema_now,
  forceNow: Joi.boolean().default(false),
  // When provided, exclude this leave from taken-days calculation (to avoid double-counting during approval)
  exclude_leave_id: Joi.alternatives().try(Joi.number(), Joi.string())
}).required()

const scheme_constructor = Joi.object({
  user: schema_user,
  number_of_days_taken_from_allowance: Joi.number().required(),
  manual_adjustment: Joi.number().required(),
  personal_adjustment: Joi.number().required(),
  carry_over: Joi.number().required(),
  nominal_allowance: Joi.number().required(),
  nominal_personal: Joi.number().required(),
  now: schema_now
}).required()

/*
 *  Class definition.
 *
 * */

class UserAllowance {
  constructor(args) {
    // Validate provided parameters
    args = Joi.attempt(
      args,
      scheme_constructor,
      'Failed parameters validation for UserAllowance constructor'
    )

    const self = this

    // console.log('args', args);

    // Private properties (not to be accessed directly)
    self._user = args.user
    self._number_of_days_taken_from_allowance =
      args.number_of_days_taken_from_allowance
    self._manual_adjustment = args.manual_adjustment
    self._personal_adjustment = args.personal_adjustment
    self._carry_over = args.carry_over
    self._nominal_allowance = args.nominal_allowance
    self._nominal_personal = args.nominal_personal
    self._now = args.now
  }

  get total_personal_available() {
    const personal_taken = this._user.calculate_number_of_days_taken_from_allowance(
      {
        year: this._now.year(),
        count_personal: true
      }
    )

    // Ensure personal allowance never goes below zero
    return Math.max(
      0,
      this._nominal_personal + this._personal_adjustment - personal_taken
    )
  }

  get total_personal_taken() {
    const self = this
    const personal_taken = self._user.calculate_number_of_days_taken_from_allowance(
      {
        year: self._now.year(),
        count_personal: true
      }
    )

    return personal_taken
  }

  get vacation_remaining() {
    const self = this
    return self.number_of_days_available_in_allowance - self.total_personal_available
  }

  get total_number_of_days_in_allowance() {
    const self = this

    return (
      self.nominal_allowance +
      self.carry_over +
      self.manual_adjustment +
      self.employement_range_adjustment
    )
  }

  get number_of_days_taken_from_allowance() {
    return this._number_of_days_taken_from_allowance
  }

  get manual_adjustment() {
    return this._manual_adjustment
  }

  get personal_adjustment() {
    return this._personal_adjustment
  }

  get carry_over() {
    return this._carry_over
  }

  get nominal_allowance() {
    return this._nominal_allowance
  }

  get nominal_personal() {
    return this._nominal_personal
  }

  get remaining_regular_allowance() {
    const regular_taken = this._user.calculate_number_of_days_taken_from_allowance(
      {
        year: this._now.year(),
        count_regular: true
      }
    )

    // Ensure regular allowance never goes below zero
    return Math.max(0, this.number_of_regular_allowance - regular_taken)
  }

  get number_of_regular_allowance() {
    const self = this
    if (
      self.user.start_date &&
      moment.utc(self.user.start_date).year() > self._now.year()
    ) {
      return 0
    }

    // regular non-personal days (total - (personal + personal_adjustment))
    const regular_allowance =
      self.total_number_of_days_in_allowance -
      (self.nominal_personal + self._personal_adjustment)

    return regular_allowance
  }

  get number_of_days_available_in_allowance() {
    const self = this

    // Check case when user started after "now", then even so she has
    // nominal allowance derived from general settings, she could not
    // use it as it is valid for time she was not here
    if (
      self.user.start_date &&
      moment.utc(self.user.start_date).year() > self._now.year()
    ) {
      return 0
    }

    // Calculate the available allowance
    // Allow negative values to show when users have overbooked
    const calculatedAllowance =
      self.total_number_of_days_in_allowance -
      self.number_of_days_taken_from_allowance +
      (self.is_accrued_allowance ? self.accrued_adjustment : 0)

    return calculatedAllowance
  }

  get is_accrued_allowance() {
    return !!this.user.department.is_accrued_allowance
  }

  get user() {
    return this._user
  }

  get employement_range_adjustment() {
    const self = this
    const now = self._now.clone()

    if (
      now.year() !== moment.utc(self.user.start_date).year() &&
      (!self.user.end_date ||
        moment.utc(self.user.end_date).year() > now.year())
    ) {
      return 0
    }

    // Determine start_date based on whether the start year is the current year
    const start_date =
      moment.utc(self.user.start_date).year() === now.year()
        ? moment.utc(self.user.start_date)
        : now.clone().startOf('year')

    // Determine end_date based on the user's end date and current year
    const end_date =
      self.user.end_date && moment.utc(self.user.end_date).year() <= now.year()
        ? moment.utc(self.user.end_date)
        : now.clone().endOf('year')

    // Calculate the difference in days and then the prorated allowance
    const daysDifference = end_date.diff(start_date, 'days')
    const proratedAllowance = Math.round(
      (self.nominal_allowance * daysDifference) / 365
    )

    // Calculate the remaining allowance after subtracting the prorated amount
    const remainingAllowance = -1 * (self.nominal_allowance - proratedAllowance)

    return remainingAllowance // Return the calculated remaining allowance
  }

  /*
   *  Accrued adjustment affects all total allowance components BUT carried
   *  over part. Because "carry over" part was already deserved.
   *
   * */
  get accrued_adjustment() {
    const self = this
    const now = self._now.clone()

    // Consider only following parts of allowance when calculating accrual
    // adjustment:
    //  * nominal allowance
    //  * manual adjustment
    //  * adjustment based in start/end day of employment
    // Other components do not make sense, e.g.:
    //  * carried over part - it could be immediately used as employee
    //    already worked on them last year
    const allowance =
      self.nominal_allowance +
      self.manual_adjustment +
      self.employement_range_adjustment

    const period_starts_at =
      moment.utc(self.user.start_date).year() === now.year()
        ? moment.utc(self.user.start_date)
        : now.clone().startOf('year')

    const period_ends_at =
      self.user.end_date && moment.utc(self.user.end_date).year() <= now.year()
        ? moment.utc(self.user.end_date)
        : now.clone().endOf('year')

    const days_in_period = period_ends_at.diff(period_starts_at, 'days')

    const delta =
      (allowance * period_ends_at.diff(now, 'days')) / days_in_period

    return -1 * (Math.round(delta * 2) / 2).toFixed(1)
  }

  /*
   *  The idea of this static method is to be constructor for UserAllowance class.
   *  It takes parameters and perform all necessary (and costly) actions to fetch
   *  all info required for allowance calculation for given user and year.
   * */
  static promise_allowance(args) {
    args = Joi.attempt(
      args,
      schema_promise_allowance,
      'Failed to validate parameters for promise_allowance'
    )

    const user = args.user
    let year = args.year
    let number_of_days_taken_from_allowance
    let manual_adjustment
    let personal_adjustment
    let carried_over_allowance

    const { forceNow, now } = args
    const exclude_leave_id = args.exclude_leave_id

    let flow = Promise.resolve()

    if (user.my_leaves === undefined) {
      flow = flow.then(() => user.reload_with_leave_details({ year }))
    }

    // Fetch adjustment and Carry over allowance
    flow = flow.then(() =>
      user.promise_adjustment_and_carry_over_for_year(year)
    )

    flow = flow
      .then(adjustment_and_coa => {
        manual_adjustment = adjustment_and_coa.adjustment
        carried_over_allowance = adjustment_and_coa.carried_over_allowance

        // If no adjustment is found for the current year
        if (!manual_adjustment) {
          // Convert user.start_date to a moment object
          const startYear = moment(user.start_date).year()
          let checkYear

          // Start looking back through previous years
          for (
            let previousYear = year.year() - 1;
            previousYear >= startYear;
            previousYear--
          ) {
            checkYear = moment.utc(previousYear.toString(), 'YYYY')
            adjustment_and_coa = user.promise_adjustment_and_carry_over_for_year(
              checkYear
            )
            manual_adjustment = adjustment_and_coa.adjustment

            // If an adjustment is found, stop looking back
            if (manual_adjustment) {
              break
            }
          }
        }

        // If no adjustment is found by the time we reach the start year, assume 0
        if (!manual_adjustment) {
          manual_adjustment = 0
        }

        return user.promise_personal_adjustment_for_year(year.format('YYYY'))
      })
      .then(personal_adj => {
        personal_adjustment = personal_adj || 0
        return Promise.resolve()
      })

    flow = flow.then(() =>
      Promise.resolve(
        (number_of_days_taken_from_allowance = user.calculate_number_of_days_taken_from_allowance(
          {
            year: year.format('YYYY'),
            // propagate exclusion to calculation when needed
            exclude_leave_id
          }
        ))
      )
    )

    // Got all necessary data for UserAllowance object so build it!
    flow = flow.then(() => {
      const args = {
        user,
        manual_adjustment,
        personal_adjustment,
        number_of_days_taken_from_allowance,
        carry_over: carried_over_allowance,
        nominal_allowance: user.department.allowance,
        nominal_personal: user.department.personal
      }

      if (forceNow && now) {
        args.now = now
      } else if (year && year.year() !== moment.utc().year()) {
        args.now = year.startOf('year')
      }

      return new UserAllowance(args)
    })

    return flow
  }
}

module.exports = UserAllowance
