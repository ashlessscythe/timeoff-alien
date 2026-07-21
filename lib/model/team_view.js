'use strict'

const Promise = require('bluebird')
const Joi = require('joi')
const moment = require('moment')
const Exception = require('../error')
const _ = require('underscore')
const { sorter } = require('../util')
const CalendarMonth = require('./calendar_month')
const leaveConstants = require('./leave_constants')
const {
  wrapUser,
  wrapLeave,
  loadSchedulesForUsers
} = require('./sessionUser')

function TeamView(args) {
  this.user = args.user
  this.base_date = args.base_date || this.user.company.get_today()

  // Optional parameters that override base date specify months range
  // Team view is going to represent.
  //
  // The precision is up to month, that is any smaller part of dates
  // (such as days, hours etc) are ignored.
  //
  // If those two parameters are missed - base_date is used to determine with month
  // Team view would represent.
  //
  this.start_date = args.start_date
  this.end_date = args.end_date

  if (args.start_date && args.end_date && args.base_date) {
    Exception.throw_user_error({
      user_error: 'Failed to calculate team view',
      system_error:
        'TeamView could not be instanciated with start_date, end_data and base_date all defined.'
    })
  }
}

function normaliseDepartmentIds(args) {
  if (args.department_ids && args.department_ids.length > 0) {
    return args.department_ids.map(String)
  }
  // Reports / integration API historically passed a singular department_id.
  if (args.department_id != null && args.department_id !== '') {
    return [String(args.department_id)]
  }
  return []
}

function validateTeamViewDateRange(start_date, end_date) {
  if (
    moment.utc(end_date).format('YYYY') !==
    moment.utc(start_date).format('YYYY')
  ) {
    Exception.throw_user_error({
      user_error: 'Start and End dates should within single year',
      system_error:
        'TeamView was called with start_date and end_date from different years.'
    })
  }

  if (moment.utc(start_date).dayOfYear() > moment.utc(end_date).dayOfYear()) {
    Exception.throw_user_error({
      user_error: 'Start date needs to be before end date',
      system_error: 'TeamView was called with end_date prior to start_date'
    })
  }
}

function activeUsersWhere(extra) {
  return Object.assign({}, extra || {}, {
    OR: [
      { end_date: null },
      {
        end_date: {
          gte: moment.utc().startOf('day').toDate()
        }
      }
    ]
  })
}

/**
 * Build calendar rows for a set of departments in a few bulk queries
 * (users + overlapping leaves + schedules), matching the /users/ list pattern.
 */
async function buildUsersAndLeavesForDepartments(args) {
  const {
    departments,
    company,
    start_date,
    end_date,
    prismaClient
  } = args

  const departmentIds = departments.map(department => department.id)
  if (departmentIds.length === 0) {
    return []
  }

  const rangeStart = moment.utc(start_date).clone().startOf('month')
  const rangeEnd = moment.utc(end_date).clone().endOf('month')
  const rangeStartDate = rangeStart.toDate()
  const rangeEndDate = rangeEnd.toDate()
  const rangeStartKey = rangeStart.format('YYYY-MM-DD')
  const rangeEndKey = rangeEnd.format('YYYY-MM-DD')
  const number_of_months = rangeEnd.month() - rangeStart.month()

  const users = (
    await prismaClient.users.findMany({
      where: activeUsersWhere({ department_id: { in: departmentIds } }),
      orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
      // Department only — company is already available from the session/route.
      include: { departments: true }
    })
  ).map(row => wrapUser(row, prismaClient))

  const userIds = users.map(user => user.id)
  const userById = users.reduce((acc, user) => {
    acc[user.id] = user
    return acc
  }, {})

  const leaveStatuses = [
    leaveConstants.status_new(),
    leaveConstants.status_approved(),
    leaveConstants.status_pended_revoke()
  ]

  const [leaveRows, schedulesByUserId] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : prismaClient.leaves.findMany({
          where: {
            user_id: { in: userIds },
            status: { in: leaveStatuses },
            AND: [
              { date_start: { lte: rangeEndDate } },
              { date_end: { gte: rangeStartDate } }
            ]
          },
          include: { leave_types: true }
        }),
    loadSchedulesForUsers(prismaClient, userIds, company.id)
  ])

  const leavesByUserId = leaveRows.reduce((acc, row) => {
    const uid = row.user_id
    if (!acc[uid]) acc[uid] = []
    // Attach the already-loaded user so wrapping a leave doesn't refetch it.
    acc[uid].push(
      Object.assign({}, row, { users_leaves_user_idTousers: userById[uid] })
    )
    return acc
  }, {})

  const bankHolidays = (company.bank_holidays || []).map(day => ({
    date: day.date,
    name: day.name
  }))
  const today = company.get_today()
  const leave_types = company.leave_types
  const first_day_of_week = company.first_day_of_week

  return users.map(user => {
    const leaves = (leavesByUserId[user.id] || []).map(row =>
      wrapLeave(row, prismaClient)
    )

    const leave_days = _.flatten(
      _.map(leaves, leave =>
        _.map(leave.get_days(), leave_day => {
          leave_day.leave = leave
          return leave_day
        })
      )
    ).filter(leave_day => {
      const key = moment.utc(leave_day.date).format('YYYY-MM-DD')
      return key >= rangeStartKey && key <= rangeEndKey
    })

    const includePublicHolidays =
      user.department && user.department.include_public_holidays

    const days = []
    for (let i = 0; i <= number_of_months; i++) {
      const calendar_month = new CalendarMonth(
        rangeStart.clone().add(i, 'months'),
        {
          bank_holidays: includePublicHolidays ? bankHolidays : [],
          leave_days,
          schedule: schedulesByUserId[user.id],
          today,
          leave_types,
          first_day_of_week
        }
      )
      days.push(calendar_month.as_for_team_view())
    }

    return {
      user,
      leave_days,
      schedule: schedulesByUserId[user.id],
      days: _.flatten(days)
    }
  })
}

TeamView.prototype.promise_team_view_details = function(args) {
  // Handle case when no parameters were provided
  if (!args) {
    args = {}
  }

  const self = this
  const user = this.user
  const department_ids = normaliseDepartmentIds(args)
  const teamViewCompany = args.company || user.company
  let related_departments = []
  let selected_departments = []
  const base_date = this.base_date

  let promise_departments

  function normalise_departments_func(my_department, supervised_departments) {
    if (my_department) {
      // Get all related departments by combining supervised ones with
      // one current user belongs to
      supervised_departments.push(my_department)
    }
    supervised_departments = _.uniq(supervised_departments, item => item.id)

    // Copy all available departments for current user into closured variable
    // to pass it into template
    related_departments = supervised_departments.sort((a, b) =>
      sorter(a.name, b.name)
    )

    // Find selected departments
    if (department_ids && department_ids.length > 0) {
      selected_departments = supervised_departments.filter(dept =>
        department_ids.includes(dept.id.toString())
      )
    }

    return Promise.resolve(
      selected_departments.length > 0
        ? selected_departments
        : supervised_departments
    )
  }

  if (user.is_admin() || user.is_manager() || user.company.share_all_absences) {
    // For admin users or if current company allows all users to see everybody's
    // time offs promise all departments for current company
    promise_departments = user.company
      .getDepartments()
      .then(departments => normalise_departments_func(null, departments))
  } else {
    // Promise departments either supervised by current user or one that she belongs to
    promise_departments = Promise.join(
      user.getDepartment(),
      user.promise_supervised_departments(),
      normalise_departments_func
    )
  }

  // Calculate users and leaves for all selected departments in bulk
  return promise_departments.then(async departments => {
    const start_date = self.start_date || base_date
    const end_date = self.end_date || start_date

    if (self.start_date && self.end_date) {
      validateTeamViewDateRange(start_date, end_date)
    }

    const prismaClient = user._prisma
    const users_and_leaves = (
      await buildUsersAndLeavesForDepartments({
        departments,
        company: teamViewCompany,
        start_date,
        end_date,
        prismaClient
      })
    ).sort((a, b) =>
      sorter(a.user.lastname + a.user.name, b.user.lastname + b.user.name)
    )

    return {
      users_and_leaves,
      related_departments,
      selected_departments
    }
  })
}

// Experimenting with parameter validation done with Joi.js
const inject_statistics_args_schema = Joi.object().keys({
  leave_types: Joi.array().items(
    Joi.object().keys({
      id: Joi.number().required(),
      use_allowance: Joi.boolean().required()
    })
  ),
  team_view_details: Joi.object()
    .required()
    .keys({
      users_and_leaves: Joi.array()
        .required()
        .items(Joi.object().keys())
    })
})

/*
 * Takes "team view details" and enrich them with statistics about absences
 * each employee has for given month
 *
 * */

TeamView.prototype.inject_statistics = function(args) {
  // Validate parameters
  try {
    const param_validation = inject_statistics_args_schema.validate(args, {
      allowUnknown: true
    })
    if (param_validation.error) {
      console.log(
        'An error occured when trying to validate args in inject_statistics.'
      )
      console.dir(param_validation.error)
      throw new Error(
        'Failed to validate parameters in TeamView.inject_statistics'
      )
    }
  } catch (error) {
    console.log('Validation error:', error)
    // Continue without validation if there's an issue with the validation itself
  }

  const team_view_details = args.team_view_details
  const leave_types = args.leave_types || []

  // Convert leave types array into look-up map
  const leave_types_map = {}
  leave_types.forEach(lt => (leave_types_map[lt.id] = lt))

  team_view_details.users_and_leaves.forEach(node => {
    let deducted_days = 0

    // Set statistics by leave type to zeros
    const leave_type_stat = {}
    leave_types.forEach(lt => (leave_type_stat[lt.id] = 0))

    node.days
      // Consider only those days that have any leave objects
      .filter(day => !!day.leave_obj)
      // Ignore those days which were not approved yet
      .filter(day => !!day.leave_obj.is_approved_leave())
      // Ignore weekends
      .filter(day => !day.is_weekend)
      // Ignore bank holidays
      .filter(day => !day.is_bank_holiday)
      .forEach(day => {
        if (day.is_leave_morning) {
          leave_type_stat[day.morning_leave_type_id] =
            leave_type_stat[day.morning_leave_type_id] + 0.5

          if (
            leave_types_map[day.morning_leave_type_id] &&
            leave_types_map[day.morning_leave_type_id].use_allowance
          ) {
            deducted_days = deducted_days + 0.5
          }
        }

        if (day.is_leave_afternoon) {
          if (
            leave_types_map[day.afternoon_leave_type_id] &&
            leave_types_map[day.afternoon_leave_type_id].use_allowance
          ) {
            deducted_days = deducted_days + 0.5
          }

          leave_type_stat[day.afternoon_leave_type_id] =
            leave_type_stat[day.afternoon_leave_type_id] + 0.5
        }
      })

    const statistics = {
      deducted_days,
      // Shows statistics by leave type
      leave_type_break_down: {
        // format for machine using
        lite_version: leave_type_stat,
        // format for rendering to end users
        pretty_version: leave_types
          // Sort by name
          .sort((a, b) => sorter(a.name, b.name))
          .map(lt => ({
            name: lt.name,
            stat: leave_type_stat[lt.id],
            id: lt.id
          }))
      }
    }

    node.statistics = statistics
  })

  return Promise.resolve(team_view_details)
}

/*
 *  Take "team view details" and user for whom them were generated
 *  and ensure the details contain statisticts for only those employees
 *  current user has access to.
 *
 * */

TeamView.prototype.restrainStatisticsForUser = function(args) {
  // TODO Consider parameters validation in the same fashion as in inject_statistics method

  const team_view_details = args.team_view_details
  const observer_user = args.user

  const supervised_user_map = {}
  observer_user.supervised_users.forEach(u => (supervised_user_map[u.id] = u))

  team_view_details.users_and_leaves.forEach(item => {
    if (item.statistics && !supervised_user_map[item.user.id]) {
      delete item.statistics
    }
  })

  return Promise.resolve(team_view_details)
}

module.exports = TeamView
