'use strict'

const Promise = require('bluebird')
const Joi = require('joi')
const moment = require('moment')
const Exception = require('../../error')
const { commentLeave } = require('../comment')
const prisma = require('../db/prisma')

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
      system_error: `Failed to add new Leave for user ${employee.id
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
          user_error: `Leave requests for previous weeks are not allowed after payroll closes. Payroll closes at ${localTime}:00 local time on Monday (${company.payroll_close_time
            }:00 UTC).`,
          system_error: `Failed to add new Leave for user ${employee.id
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

  // Determine if leave should skip approval
  const new_leave_status = employee.auto_approve || leave_type.auto_approve ? 2 : 1 // 2=approved, 1=new

  // Validate allowance before creating
  const leave_to_validate = {
    user_id: employee.id,
    leave_type_id: leave_type.id,
    status: new_leave_status,
    approver_id: main_supervisor.id,
    employee_comment: valide_attributes.reason,
    date_start: start_date.toDate(),
    date_end: end_date.toDate(),
    day_part_start: valide_attributes.from_date_part,
    day_part_end: valide_attributes.to_date_part,
    get_deducted_days_number: () => {
      // Implement deducted days calculation logic here
      return 1 // Placeholder
    }
  }

  await employee.validate_leave_fits_into_remaining_allowance({
    year: start_date,
    leave_type,
    leave: leave_to_validate
  })

  // Create leave in database
  const leave = await prisma.leaves.create({
    data: {
      user_id: employee.id,
      leave_type_id: leave_type.id,
      status: new_leave_status,
      approver_id: main_supervisor.id,
      employee_comment: valide_attributes.reason,
      date_start: start_date.toDate(),
      date_end: end_date.toDate(),
      day_part_start: valide_attributes.from_date_part,
      day_part_end: valide_attributes.to_date_part
    }
  })

  await commentLeaveIfNeeded({ leave, comment, company_id })

  return leave
}

const commentLeaveIfNeeded = ({ leave, comment, company_id }) =>
  comment ? commentLeave({ leave, comment, company_id }) : Promise.resolve()

const getLeaveForUserView = async ({ actingUser, leaveId }) => {
  const leave = await prisma.leaves.findFirst({
    where: {
      id: leaveId,
      users_leaves_user_idTousers: {
        company_id: actingUser.company_id
      }
    },
    include: {
      users_leaves_user_idTousers: {
        include: {
          companies: {
            include: {
              bank_holidays: true
            }
          },
          departments: true
        }
      },
      leave_type: true
    }
  })

  if (!leave) {
    throw new Error(
      `User [${actingUser.id}] tried to access leave [${leaveId}] which does not belong to the same company.`
    )
  }

  // Get user's schedule
  const schedule = await prisma.schedules.findFirst({
    where: {
      OR: [
        { user_id: leave.user_id },
        { company_id: actingUser.company_id, user_id: null }
      ]
    }
  })

  if (leave.users_leaves_user_idTousers) {
    leave.users_leaves_user_idTousers.cached_schedule = schedule || {
      monday: 1,
      tuesday: 1,
      wednesday: 1,
      thursday: 1,
      friday: 1,
      saturday: 2,
      sunday: 2
    }
  }

  return leave
}

const doesUserHasExtendedViewOfLeave = async ({ user, leave }) => {
  const leaveUser = await prisma.users.findUnique({
    where: { id: leave.user_id },
    select: { company_id: true }
  })

  if (user.company_id !== leaveUser.company_id) {
    throw new Error(
      `User [${user.id}] and leave [${leave.id}] do not share company.`
    )
  }

  if (user.admin) {
    return true
  }

  // Check if user supervises the leave's user
  const supervisedDepartments = await prisma.departments.findMany({
    where: {
      OR: [
        { manager_id: user.id },
        {
          department_supervisors: {
            some: {
              user_id: user.id
            }
          }
        }
      ]
    },
    include: {
      users: {
        where: {
          id: leave.user_id
        }
      }
    }
  })

  return supervisedDepartments.some(dept => dept.users.length > 0)
}

module.exports = {
  createNewLeave,
  doesUserHasExtendedViewOfLeave,
  getLeaveForUserView
}
