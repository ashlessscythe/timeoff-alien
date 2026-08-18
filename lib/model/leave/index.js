'use strict'

const Promise = require('bluebird')
const Joi = require('joi')
const moment = require('moment')
const { throwUserError } = require('../../error')
const { commentLeave } = require('../comment')
const Models = require('../db')
const prisma = require('../../prisma/client')
const leaveConstants = require('../leave_constants')
const { wrapLeave, getLeaveIncludeForPrisma } = require('../sessionUser')
const {
  utcNowForPayrollRules,
  isPastPayrollWeekClosedForLeaveStart,
  payrollCloseMomentForWeekContaining
} = require('../payrollCloseWindow')
const {
  isEditedRangeShrinkOnly,
  pendingLeaveEditShrinkMessage
} = require('./editWindow')

function coerceDayPart(value) {
  const n = parseInt(String(value == null ? '' : value).trim(), 10)
  return Number.isNaN(n) ? leaveConstants.leave_day_part_all() : n
}

const schemaCreateNewLeave = Joi.object()
  .required()
  .keys({
    for_employee: Joi.object().required(),
    of_type: Joi.object().required(),
    with_parameters: Joi.object().required(),
    created_by: Joi.object().required()
  })

const schemaUpdatePendingLeave = Joi.object()
  .required()
  .keys({
    existing_leave: Joi.object().required(),
    of_type: Joi.object().required(),
    with_parameters: Joi.object().required(),
    edited_by: Joi.object().required()
  })

function canUserEditPendingLeave({ actingUser, leave }) {
  if (!leave || !leave.is_new_leave || !leave.is_new_leave()) {
    return false
  }
  if (!actingUser || !leave.user) {
    return false
  }
  if (Number(actingUser.company_id) !== Number(leave.user.company_id)) {
    return false
  }
  if (actingUser.is_admin && actingUser.is_admin()) {
    return true
  }
  return Number(actingUser.id) === Number(leave.user_id)
}

function leaveHasSubstantiveChanges(existingLeave, nextAttributes, nextLeaveType) {
  const start = moment.utc(nextAttributes.from_date).format('YYYY-MM-DD')
  const end = moment.utc(nextAttributes.to_date).format('YYYY-MM-DD')
  const existingStart = moment.utc(existingLeave.date_start).format('YYYY-MM-DD')
  const existingEnd = moment.utc(existingLeave.date_end).format('YYYY-MM-DD')
  const dayPartStart = coerceDayPart(nextAttributes.from_date_part)
  const dayPartEnd = coerceDayPart(nextAttributes.to_date_part)
  const nextTimeStart = nextAttributes.time_start || null
  const nextTimeEnd = nextAttributes.time_end || null
  const existingTimeStart = existingLeave.time_start || null
  const existingTimeEnd = existingLeave.time_end || null

  return (
    Number(nextLeaveType.id) !== Number(existingLeave.leave_type_id) ||
    start !== existingStart ||
    end !== existingEnd ||
    dayPartStart !== coerceDayPart(existingLeave.day_part_start) ||
    dayPartEnd !== coerceDayPart(existingLeave.day_part_end) ||
    nextTimeStart !== existingTimeStart ||
    nextTimeEnd !== existingTimeEnd
  )
}

async function validateLeaveDateAndPolicyRules({
  employee,
  actingUser,
  start_date,
  end_date
}) {
  if (start_date.toDate() > end_date.toDate()) {
    throwUserError({
      user_error: 'Start date is later than end date',
      system_error: `Failed to validate leave for user ${
        employee.id
      } because start date ${start_date} happened to be after end date ${end_date}`
    })
  }

  if (!actingUser.is_admin()) {
    const now = utcNowForPayrollRules()
    const company = await employee.getCompany()

    if (
      isPastPayrollWeekClosedForLeaveStart({
        leaveStart: start_date,
        payrollCloseHourUtc: company.payroll_close_time,
        now
      })
    ) {
      const payrollCloseTime = payrollCloseMomentForWeekContaining(
        now,
        company.payroll_close_time
      )
      const localTime = parseInt(
        payrollCloseTime.tz(company.timezone).format('H'),
        10
      )
      throwUserError({
        user_error: `Leave requests for previous weeks are not allowed after payroll closes. Payroll closes at ${localTime}:00 local time on Monday (${
          company.payroll_close_time
        }:00 UTC).`,
        system_error: `Failed to validate leave for user ${
          employee.id
        } because requested dates (${start_date.format(
          'YYYY-MM-DD'
        )}) are in past weeks and payroll is closed`
      })
    }
  }

  if (!actingUser.is_admin()) {
    const company = await employee.getCompany()
    const currentYear = moment()
      .utc()
      .year()
    const requestYear = start_date.year()
    const nextYear = currentYear + 1

    if (requestYear === nextYear && company.next_year_cutoff_date) {
      const cutoffDate = moment
        .utc(company.next_year_cutoff_date)
        .startOf('day')
      const now = moment()
        .utc()
        .startOf('day')
      const limitedDepts = company.limited_departments || []

      if (now.isBefore(cutoffDate)) {
        const employeeDept = await employee.getDepartment()
        if (employeeDept && limitedDepts.includes(employeeDept.id)) {
          const cutoffDateStr = company.next_year_cutoff_date
          const formattedCutoffDate = moment(
            cutoffDateStr,
            'YYYY-MM-DD'
          ).format('MMMM D, YYYY')
          throwUserError({
            user_error: `Requests for ${nextYear} are not allowed yet. Please wait until ${formattedCutoffDate} to request time off for the following calendar year.`,
            system_error: `Failed to validate leave for user ${
              employee.id
            } because requested dates (${start_date.format(
              'YYYY-MM-DD'
            )}) are for next year and user's department is restricted before cutoff date ${cutoffDate.format(
              'YYYY-MM-DD'
            )}`
          })
        }
      }
    }
  }
}

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

  console.log(
    'file: leave/model/leave/index.js start_date',
    start_date.format('YYYY-MM-DD'),
    end_date.format('YYYY-MM-DD')
  )

  await validateLeaveDateAndPolicyRules({
    employee,
    actingUser: creating_user,
    start_date,
    end_date
  })

  const comment = valide_attributes.reason
  const company_id = employee.company_id

  const day_part_start = coerceDayPart(valide_attributes.from_date_part)
  const day_part_end = coerceDayPart(valide_attributes.to_date_part)

  // Best-effort idempotency / dedupe: if the same request is retried (mobile cache,
  // network hiccup, double-submit), return the already-created leave instead of
  // inserting a duplicate.
  //
  // We intentionally scope this to a short time window to avoid surprising matches
  // for legitimate repeated requests later.
  const dedupeWindowMinutes = 10
  const dedupeSince = moment.utc().subtract(dedupeWindowMinutes, 'minutes')

  const [, existingRow, main_supervisor] = await globalThis.Promise.all([
    employee.validate_overlapping(valide_attributes),
    prisma.leaves.findFirst({
      where: {
        user_id: employee.id,
        leave_type_id: leave_type.id,
        date_start: moment.utc(start_date.format('YYYY-MM-DD')).toDate(),
        date_end: moment.utc(end_date.format('YYYY-MM-DD')).toDate(),
        day_part_start,
        day_part_end,
        time_start: valide_attributes.time_start || null,
        time_end: valide_attributes.time_end || null,
        status: {
          in: [
            Models.Leave.status_new(),
            Models.Leave.status_approved(),
            Models.Leave.status_pended_revoke()
          ]
        },
        created_at: {
          gte: dedupeSince.toDate()
        }
      },
      select: { id: true }
    }),
    employee.promise_manager()
  ])

  if (existingRow) {
    const fullExisting = await prisma.leaves.findFirst({
      where: { id: existingRow.id },
      include: getLeaveIncludeForPrisma()
    })
    return wrapLeave(fullExisting, prisma)
  }

  if (!main_supervisor) {
    throwUserError({
      user_error:
        'Cannot create leave request: department has no manager assigned',
      system_error: `Failed to add new Leave for user ${
        employee.id
      } because department ${employee.department_id} has no manager`
    })
  }

  const new_leave_status = Models.Leave.does_skip_approval(employee, leave_type)
    ? Models.Leave.status_approved()
    : Models.Leave.status_new()

  // Create leave object (not saved to database yet)
  // Include `leave_type` so allowance validation can compute
  // `get_deducted_days_number` before the row exists in the DB.
  const leave_to_create = Models.Leave.build({
    user_id: employee.id,
    leave_type_id: leave_type.id,
    leave_type,
    status: new_leave_status,
    approver_id: main_supervisor.id,
    employee_comment: valide_attributes.reason,
    date_start: moment.utc(start_date.format('YYYY-MM-DD')).toDate(),
    date_end: moment.utc(end_date.format('YYYY-MM-DD')).toDate(),
    day_part_start,
    day_part_end,
    // New time-based fields (optional, for time-based leaves)
    time_start: valide_attributes.time_start || null,
    time_end: valide_attributes.time_end || null
  })
  // Attach associates so save() can skip a second heavy join round-trip.
  leave_to_create.user = employee
  leave_to_create.approver = main_supervisor

  // Validate and save - only validate allowance for leave types that use it.
  // For non-allowance leave types we still enforce the per-leave-type `limit`
  // (e.g. Sick Leave with limit=10). The pool validator already handles limit
  // for use_allowance types internally.
  if (leave_type.use_allowance) {
    await employee.validate_leave_fits_into_remaining_allowance({
      year: start_date,
      leave_type,
      leave: leave_to_create,
      // For new requests we treat pending requests as consuming allowance so
      // employees cannot stack multiple pending requests beyond their balance.
      include_pending: true
    })
  } else if (leave_type.limit && leave_type.limit > 0) {
    await employee.validate_leave_fits_into_limit({
      year: start_date,
      leave_type,
      leave: leave_to_create
    })
  }

  const leave = await leave_to_create.save()

  await commentLeaveIfNeeded({ leave, comment, company_id })

  return leave
}

async function updatePendingLeave(args) {
  args = Joi.attempt(args, schemaUpdatePendingLeave, 'Failed to validate arguments')

  const existingLeave = args.existing_leave
  const leave_type = args.of_type
  const validAttributes = args.with_parameters
  const editedBy = args.edited_by

  if (!canUserEditPendingLeave({ actingUser: editedBy, leave: existingLeave })) {
    throwUserError({
      user_error: 'You are not allowed to edit this leave request',
      system_error: `User ${editedBy.id} attempted to edit leave ${existingLeave.id}`
    })
  }

  if (!existingLeave.is_new_leave()) {
    throwUserError({
      user_error: 'This request is no longer pending and cannot be edited',
      system_error: `Leave ${existingLeave.id} has status ${existingLeave.status}`
    })
  }

  const employee = existingLeave.user
  const start_date = moment.utc(validAttributes.from_date)
  const end_date = moment.utc(validAttributes.to_date)

  await validateLeaveDateAndPolicyRules({
    employee,
    actingUser: editedBy,
    start_date,
    end_date
  })

  if (
    !isEditedRangeShrinkOnly({
      originalStart: existingLeave.date_start,
      originalEnd: existingLeave.date_end,
      nextStart: start_date,
      nextEnd: end_date
    })
  ) {
    throwUserError({
      user_error: pendingLeaveEditShrinkMessage(),
      system_error: `Leave ${existingLeave.id} edit grew or moved dates outside the original span (${moment
        .utc(existingLeave.date_start)
        .format('YYYY-MM-DD')}..${moment
        .utc(existingLeave.date_end)
        .format('YYYY-MM-DD')} -> ${start_date.format(
        'YYYY-MM-DD'
      )}..${end_date.format('YYYY-MM-DD')})`
    })
  }

  const day_part_start = coerceDayPart(validAttributes.from_date_part)
  const day_part_end = coerceDayPart(validAttributes.to_date_part)
  const comment = validAttributes.reason
  const company_id = employee.company_id

  await employee.validate_overlapping(validAttributes, {
    exclude_leave_id: existingLeave.id
  })

  const leave_to_validate = Models.Leave.build({
    id: existingLeave.id,
    user_id: employee.id,
    leave_type_id: leave_type.id,
    leave_type,
    status: leaveConstants.status_new(),
    approver_id: existingLeave.approver_id,
    employee_comment: validAttributes.reason,
    date_start: moment.utc(start_date.format('YYYY-MM-DD')).toDate(),
    date_end: moment.utc(end_date.format('YYYY-MM-DD')).toDate(),
    day_part_start,
    day_part_end,
    time_start: validAttributes.time_start || null,
    time_end: validAttributes.time_end || null
  })
  leave_to_validate.user = employee
  leave_to_validate.approver = existingLeave.approver

  await employee.promise_schedule_I_obey()
  const originalDeducted = existingLeave.get_deducted_days_number({
    user: employee
  })
  const nextDeducted = leave_to_validate.get_deducted_days_number({
    user: employee
  })
  if (nextDeducted - originalDeducted > 1e-9) {
    throwUserError({
      user_error: pendingLeaveEditShrinkMessage(),
      system_error: `Leave ${existingLeave.id} edit increased deducted days (${originalDeducted} -> ${nextDeducted})`
    })
  }

  if (leave_type.use_allowance) {
    await employee.validate_leave_fits_into_remaining_allowance({
      year: start_date,
      leave_type,
      leave: leave_to_validate,
      include_pending: true
    })
  } else if (leave_type.limit && leave_type.limit > 0) {
    await employee.validate_leave_fits_into_limit({
      year: start_date,
      leave_type,
      leave: leave_to_validate,
      include_pending: true
    })
  }

  const substantiveChanged = leaveHasSubstantiveChanges(
    existingLeave,
    validAttributes,
    leave_type
  )
  const commentChanged =
    String(validAttributes.reason || '') !==
    String(existingLeave.employee_comment || '')

  if (!substantiveChanged && !commentChanged) {
    return existingLeave
  }

  const updateResult = await prisma.leaves.updateMany({
    where: {
      id: existingLeave.id,
      status: leaveConstants.status_new()
    },
    data: {
      leave_type_id: leave_type.id,
      employee_comment: validAttributes.reason,
      date_start: moment.utc(start_date.format('YYYY-MM-DD')).toDate(),
      date_end: moment.utc(end_date.format('YYYY-MM-DD')).toDate(),
      day_part_start,
      day_part_end,
      time_start: validAttributes.time_start || null,
      time_end: validAttributes.time_end || null,
      edited_at: new Date(),
      updated_at: new Date()
    }
  })

  if (updateResult.count === 0) {
    throwUserError({
      user_error: 'This request is no longer pending and cannot be edited',
      system_error: `Concurrent update blocked edit of leave ${existingLeave.id}`
    })
  }

  const reloadedRow = await prisma.leaves.findFirst({
    where: { id: existingLeave.id },
    include: getLeaveIncludeForPrisma()
  })
  const leave = wrapLeave(reloadedRow, prisma)

  if (commentChanged) {
    const existingComment = await prisma.comments.findFirst({
      where: { entity_type: 'LEAVE', entity_id: leave.id }
    })
    if (existingComment) {
      await prisma.comments.update({
        where: { id: existingComment.id },
        data: { comment: comment || '' }
      })
    } else if (comment) {
      await commentLeaveIfNeeded({ leave, comment, company_id })
    }
  }

  leave._edit_had_substantive_changes = substantiveChanged
  return leave
}

function leaveToFormFields(leave) {
  const startDate = moment.utc(leave.date_start).format('YYYY-MM-DD')
  const endDate = moment.utc(leave.date_end).format('YYYY-MM-DD')
  const dayPartStart = coerceDayPart(leave.day_part_start)
  const dayPartEnd = coerceDayPart(leave.day_part_end)

  let increment_type = 'day'
  let increment_value = '1'
  let show_multi_day = startDate !== endDate

  if (leave.time_start || leave.time_end) {
    const startT = moment(leave.time_start || '09:00:00', 'HH:mm:ss')
    const endT = moment(leave.time_end || '17:00:00', 'HH:mm:ss')
    const diffMinutes = endT.diff(startT, 'minutes')
    if (diffMinutes === 15 || diffMinutes === 30) {
      increment_type = 'min'
      increment_value = String(diffMinutes)
    } else {
      increment_type = 'hr'
      const diffHours = Math.round((diffMinutes / 60) * 10) / 10
      increment_value = String(Math.max(1, Math.round(diffHours)))
    }
    show_multi_day = false
  } else if (
    dayPartStart === leaveConstants.leave_day_part_morning() ||
    dayPartStart === leaveConstants.leave_day_part_afternoon() ||
    dayPartEnd === leaveConstants.leave_day_part_morning() ||
    dayPartEnd === leaveConstants.leave_day_part_afternoon()
  ) {
    increment_type = 'halfday'
    increment_value = String(
      dayPartStart === leaveConstants.leave_day_part_morning() ? 2 : 3
    )
    show_multi_day = false
  }

  return {
    leave_type_id: leave.leave_type_id,
    from_date: startDate,
    to_date: endDate,
    from_date_part: String(dayPartStart),
    to_date_part: String(dayPartEnd),
    time_start: leave.time_start || '',
    time_end: leave.time_end || '',
    reason: leave.employee_comment || '',
    increment_type,
    increment_value,
    show_multi_day,
    deducted_days: leave.get_deducted_days_number(),
    type_name: leave.get_leave_type_name()
  }
}

const commentLeaveIfNeeded = ({ leave, comment, company_id }) =>
  comment ? commentLeave({ leave, comment, company_id }) : Promise.resolve()

const getLeaveForUserView = async ({ actingUser, leaveId }) => {
  const id = parseInt(leaveId, 10)
  const row = await prisma.leaves.findFirst({
    where: {
      id,
      users_leaves_user_idTousers: {
        company_id: actingUser.company_id
      }
    },
    include: getLeaveIncludeForPrisma()
  })

  if (!row) {
    throw new Error(
      `User [${
        actingUser.id
      }] tried to access leave [${leaveId}] which does not belong to the same company.`
    )
  }

  const leave = wrapLeave(row, prisma)
  await leave.user.promise_schedule_I_obey()

  return leave
}

const doesUserHasExtendedViewOfLeave = async ({ user, leave }) => {
  if (user.company_id !== leave.user.company_id) {
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
  updatePendingLeave,
  canUserEditPendingLeave,
  leaveToFormFields,
  leaveHasSubstantiveChanges,
  doesUserHasExtendedViewOfLeave,
  getLeaveForUserView,
  isEditedRangeShrinkOnly,
  pendingLeaveEditShrinkMessage
}
