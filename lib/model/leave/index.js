'use strict'

const Promise = require('bluebird')
const Joi = require('joi')
const moment = require('moment')
const Exception = require('../../error')
const { commentLeave } = require('../comment')
const Models = require('../db')

const schemaCreateNewLeave = Joi.object()
  .required()
  .keys({
    for_employee: Joi.object().required(),
    of_type: Joi.object().required(),
    with_parameters: Joi.object().required(),
    created_by: Joi.object().required()
  })

/*
 * Create new leave for provided parameters.
 * Returns promise that is resolved with newly created leave row
 * */
async function createNewLeave(args) {
  args = Joi.attempt(args, schemaCreateNewLeave, 'Failed to validate arguments')

  const employee = args.for_employee
  const leave_type = args.of_type
  const valide_attributes = args.with_parameters
  const creating_user = args.created_by

  const start_date = moment.utc(valide_attributes.from_date)
  const end_date = moment.utc(valide_attributes.to_date)

  // log what dates are being used
  console.log(
    'file: leave/model/leave/index.js start_date',
    start_date.format('YYYY-MM-DD'),
    end_date.format('YYYY-MM-DD')
  )

  // Check that start date is not bigger then end one
  if (start_date.toDate() > end_date.toDate()) {
    Exception.throwUserError({
      user_error: 'Start date is later than end date',
      system_error: `Failed to add new Leave for user ${
        employee.id
      } ``because start date ${start_date} happnned to be after end date ${end_date}`
    })
  }

  // Check if trying to request dates from past weeks after payroll close
  // Skip this validation for admin users
  if (!creating_user.is_admin()) {
    const now = moment().utc()
    // alternate now (TESTING!!!!! COMMENT OUT!!!!)
    // const now = moment
    //   .utc()
    //   .startOf('week') // Sun
    //   .add(1, 'days') // Monday
    //   .add(16, 'hours') // utc time
    //   .add(15, 'minutes')

    // Get company's configured payroll close time
    const company = await employee.getCompany()
    const payrollCloseTime = moment()
      .utc()
      .startOf('week') // Sunday
      .add(1, 'days') // Monday
      .add(company.payroll_close_time, 'hours') // Use configured close time

    // log
    console.log(`now is ${now.tz(company.timezone).toString()}`)
    console.log(
      `payroll close time is ${payrollCloseTime
        .tz(company.timezone)
        .toString()}`
    )

    // If we're past payroll close time for this week
    if (now.isAfter(payrollCloseTime)) {
      // Check if any requested dates are from previous weeks
      const lastWeekEnd = moment()
        .utc()
        .startOf('week')
        .subtract(1, 'millisecond')

      if (start_date.isBefore(lastWeekEnd)) {
        const localTime = parseInt(
          payrollCloseTime.tz(company.timezone).format('H'),
          10
        )
        Exception.throwUserError({
          user_error: `Leave requests for previous weeks are not allowed after payroll closes. Payroll closes at ${localTime}:00 local time on Monday (${
            company.payroll_close_time
          }:00 UTC).`,
          system_error: `Failed to add new Leave for user ${
            employee.id
          } because requested dates (${start_date.format(
            'YYYY-MM-DD'
          )}) are in past weeks and payroll is closed`
        })
      }
    }
  }

  const comment = valide_attributes.reason
  const company_id = employee.company_id

  // Make sure that booking to be created is not going to overlap with
  // any existing bookings
  await employee.validate_overlapping(valide_attributes)

  const main_supervisor = await employee.promise_manager()

  const new_leave_status = Models.Leave.does_skip_approval(employee, leave_type)
    ? Models.Leave.status_approved()
    : Models.Leave.status_new()

  // Create leave object (not saved to database yet)
  const leave_to_create = Models.Leave.build({
    user_id: employee.id,
    leave_type_id: leave_type.id,
    status: new_leave_status,
    approver_id: main_supervisor.id,
    employee_comment: valide_attributes.reason,
    date_start: start_date.format('YYYY-MM-DD'),
    date_end: end_date.format('YYYY-MM-DD'),
    day_part_start: valide_attributes.from_date_part,
    day_part_end: valide_attributes.to_date_part
  })

  // Validate and save - only validate allowance for leave types that use it
  if (leave_type.use_allowance) {
    await employee.validate_leave_fits_into_remaining_allowance({
      year: start_date,
      leave_type,
      leave: leave_to_create
    })
  }

  const leave = await leave_to_create.save()

  await commentLeaveIfNeeded({ leave, comment, company_id })

  return leave
}

const commentLeaveIfNeeded = ({ leave, comment, company_id }) =>
  comment ? commentLeave({ leave, comment, company_id }) : Promise.resolve()

const getLeaveForUserView = async ({ actingUser, leaveId, dbModel }) => {
  const [leave] = await dbModel.Leave.findAll({
    where: {
      id: leaveId
    },
    include: [
      {
        model: dbModel.User,
        as: 'user',
        where: {
          company_id: actingUser.company_id
        },
        include: [
          {
            model: dbModel.Company,
            as: 'company',
            include: [
              {
                model: dbModel.BankHoliday,
                as: 'bank_holidays'
              }
            ]
          },
          {
            model: dbModel.Department,
            as: 'department'
          }
        ]
      },
      {
        model: dbModel.LeaveType,
        as: 'leave_type'
      }
    ]
  })

  if (!leave) {
    throw new Error(
      `User [${
        actingUser.id
      }] tried to access leave [${leaveId}] which does not belong to the same company.`
    )
  }

  // Load and cache the schedule for the user
  await leave.user.promise_schedule_I_obey()

  return leave
}

const doesUserHasExtendedViewOfLeave = async ({ user, leave }) => {
  if (user.company_id !== (await leave.getUser()).company_id) {
    throw new Error(
      `User [${user.id}] and leave [${leave.id}] do not share company.`
    )
  }

  let extendedView = false

  if (user.is_admin()) {
    extendedView = true
  }

  if (!extendedView) {
    const reports = await user.promise_supervised_users()

    if (reports.filter(u => `${u.id}` === `${leave.user_id}`).length > 0) {
      extendedView = true
    }
  }

  return extendedView
}

module.exports = {
  createNewLeave,
  doesUserHasExtendedViewOfLeave,
  getLeaveForUserView
}
