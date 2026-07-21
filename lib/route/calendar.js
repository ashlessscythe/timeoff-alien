'use strict'

const express = require('express')
const router = express.Router()
const Promise = require('bluebird')
const moment = require('moment')
const _ = require('underscore')
const validator = require('validator')
const get_and_validate_leave_params = require('./validator/leave_request')
const TeamView = require('../model/team_view')
const Exception = require('../error')
const EmailTransport = require('../email')
const SlackTransport = require('../slack')
const prisma = require('../prisma/client')
const dbModel = require('../model/db')

const {
  createNewLeave,
  getLeaveForUserView,
  doesUserHasExtendedViewOfLeave
} = require('../model/leave')
const { leaveIntoObject } = require('../model/Report')
const leaveConstants = require('../model/leave_constants')
const { getCommentsForLeave } = require('../model/comment')
const { sorter } = require('../util')
const {
  DEFAULT_ALLOWED_INCREMENTS,
  parseAllowedIncrements,
  getRequestedIncrement,
  isIncrementAllowed
} = require('./incrementRules')
const {
  parseExplicitLeaveTypeIds,
  getEffectiveAllowedLeaveTypeIds
} = require('./leaveTypeRules')
const { wrapUser, loadSessionUserById } = require('../model/sessionUser')

async function resolveBookLeaveEmployee(req, valid_attributes) {
  const hasUserIndex =
    valid_attributes.user !== undefined &&
    valid_attributes.user !== null &&
    String(valid_attributes.user) !== ''

  if (!hasUserIndex) {
    return req.user
  }

  if (!req.user.is_admin() && !req.user.is_manager()) {
    return req.user
  }

  const asInt = parseInt(String(valid_attributes.user), 10)
  if (Number.isNaN(asInt)) {
    return req.user
  }

  // Prefer resolving by user id (modal posts data-user-id as the option value).
  // Load only that employee instead of hydrating the full managed-users list.
  if (Number(asInt) === Number(req.user.id)) {
    return req.user
  }

  if (req.user.is_admin()) {
    const row = await prisma.users.findFirst({
      where: { id: asInt, company_id: req.user.company_id },
      include: { companies: true, departments: true }
    })
    if (row) {
      return wrapUser(row, prisma)
    }
  } else {
    const target = await loadSessionUserById(prisma, asInt)
    if (target && Number(target.company_id) === Number(req.user.company_id)) {
      const supervisedDepartments = await req.user.promise_supervised_departments()
      const supervisedDeptIds = new Set(
        supervisedDepartments.map(department => Number(department.id))
      )
      if (supervisedDeptIds.has(Number(target.department_id))) {
        return target
      }
    }
  }

  // Legacy fallback: treat the value as an index into supervised_users.
  await req.user.ensure_supervised_users()
  const users = req.user.supervised_users || []
  if (asInt >= 0 && asInt < users.length) {
    return users[asInt] || req.user
  }

  return req.user
}

async function getBookingRulesForEmployee(req, employee, companyLeaveTypeIds) {
  const locals = req.res && req.res.locals
  const incrementsFromLocals =
    locals &&
    locals.allowed_increments_by_user &&
    locals.allowed_increments_by_user[employee.id]
  const leaveTypesFromLocals =
    locals &&
    locals.allowed_leave_type_ids_by_user &&
    locals.allowed_leave_type_ids_by_user[employee.id]

  if (incrementsFromLocals && leaveTypesFromLocals) {
    return {
      allowedIncrements: incrementsFromLocals,
      effectiveLeaveTypeIds: leaveTypesFromLocals
    }
  }

  if (!employee || !employee.department_id) {
    return {
      allowedIncrements: DEFAULT_ALLOWED_INCREMENTS.slice(),
      effectiveLeaveTypeIds: companyLeaveTypeIds.slice()
    }
  }

  // Prefer already-hydrated department (common on self-booking) when it has
  // the fields needed for increment + leave-type rules.
  let department = employee.department
  if (
    !department ||
    Number(department.id) !== Number(employee.department_id) ||
    department.allowed_increments === undefined ||
    department.department_leave_types === undefined
  ) {
    department = await prisma.departments.findUnique({
      where: { id: employee.department_id },
      select: {
        allowed_increments: true,
        department_leave_types: {
          select: { leave_type_id: true }
        }
      }
    })
  }

  const explicitLeaveTypeIds = parseExplicitLeaveTypeIds(department)

  return {
    allowedIncrements: parseAllowedIncrements(department),
    effectiveLeaveTypeIds: getEffectiveAllowedLeaveTypeIds({
      explicitIds: explicitLeaveTypeIds,
      allCompanyLeaveTypeIds: companyLeaveTypeIds
    })
  }
}

function isLeaveTypeAllowedForEmployeeBooking(rules, leaveTypeId) {
  return (rules.effectiveLeaveTypeIds || []).some(
    id => Number(id) === Number(leaveTypeId)
  )
}

router.all(/.*/, (req, res, next) => {
  if (!req.user) {
    return res.redirect_with_session(303, '/')
  }
  next()
})

router.post('/bookleave/', async (req, res) => {
  try {
    const valid_attributes = get_and_validate_leave_params({
      req,
      params: req.body
    })

    await req.user.ensure_company_with_leave_types()
    const company = req.user.company

    const employee = await resolveBookLeaveEmployee(req, valid_attributes)
    const [leave_type] = company.leave_types.filter(
      lt => `${lt.id}` === `${valid_attributes.leave_type}`
    )

    if (!employee) {
      req.session.flash_error('Incorrect employee')
      throw new Error('Got validation errors')
    }

    if (!leave_type) {
      req.session.flash_error('Incorrect leave type')
      throw new Error('Got validation errors')
    }

    const companyLeaveTypeIds = company.leave_types.map(lt => lt.id)
    const bookingRules = await getBookingRulesForEmployee(
      req,
      employee,
      companyLeaveTypeIds
    )

    if (!isLeaveTypeAllowedForEmployeeBooking(bookingRules, leave_type.id)) {
      Exception.throwUserError({
        user_error:
          'This leave type is not available for this employee\'s department',
        system_error:
          'User ' +
          req.user.id +
          ' attempted to book leave type ' +
          leave_type.id +
          ' for employee ' +
          employee.id +
          ' in department ' +
          (employee.department_id || 'unknown')
      })
    }

    // Server-side enforcement: manager_only leave types may only be booked
    // by managers/admins (UI hides these, but POSTs must be protected too).
    if (leave_type.manager_only && !(req.user.is_admin() || req.user.is_manager())) {
      Exception.throwUserError({
        user_error: 'This leave type is restricted to managers',
        system_error:
          'User ' +
          req.user.id +
          ' attempted to book manager_only leave type ' +
          leave_type.id
      })
    }

    const requestedIncrement = getRequestedIncrement({
      incrementType: req.body.increment_type,
      incrementValue: req.body.increment_value,
      fromDatePart: valid_attributes.from_date_part,
      timeStart: valid_attributes.time_start,
      timeEnd: valid_attributes.time_end
    })

    if (!requestedIncrement) {
      Exception.throwUserError({
        user_error: 'Invalid leave increment type',
        system_error:
          'Failed to add leave for user ' +
          employee.id +
          ' because increment type was invalid: ' +
          req.body.increment_type
      })
    }

    const allowedIncrements = bookingRules.allowedIncrements
    const leaveTypeAllowsNonDefault = !!leave_type.allow_non_default_increments

    if (
      !isIncrementAllowed({
        requestedIncrement,
        departmentAllowedIncrements: allowedIncrements,
        leaveTypeAllowsNonDefault
      })
    ) {
      const isNonDefault =
        requestedIncrement === 'hourly' || requestedIncrement === 'quarter_hr'
      const userError =
        isNonDefault && allowedIncrements.includes(requestedIncrement)
          ? 'Selected leave increment is not allowed for this leave type'
          : "Selected leave increment is not allowed for this employee's department"

      Exception.throwUserError({
        user_error: userError,
        system_error:
          'Failed to add leave for user ' +
          employee.id +
          ' because increment ' +
          requestedIncrement +
          ' is not allowed for department ' +
          (employee.department_id || 'unknown') +
          ' / leave_type ' +
          leave_type.id +
          ' (allow_non_default_increments=' +
          leaveTypeAllowsNonDefault +
          ')'
      })
    }

    if (company.is_mode_readonly_holidays()) {
      req.session.flash_error(
        'Company account is locked and new Timeoff ' +
          'requests could not be added. Please contact administration.'
      )
      throw new Error('Company is in "Read-only holidays" mode')
    }

    const leave = await createNewLeave({
      for_employee: employee,
      of_type: leave_type,
      with_parameters: valid_attributes,
      created_by: req.user
    })

    // save() already loads associates; only reload when missing.
    const reloadedLeave =
      leave && leave.user && leave.leave_type
        ? leave
        : await leave.reloadWithAssociates()

    const Slack = new SlackTransport()

    Slack.promise_leave_request_slacks({
      leave: reloadedLeave
    })
      .catch(error => {
        console.error(
          'Failed to send leave slack message to: ' + error,
          error.stack
        )
      })

    const Email = new EmailTransport()

    // Do not block the submit redirect on email/audit work — same pattern as Slack.
    Email.promise_leave_request_emails({
      leave: reloadedLeave
    }).catch(error => {
      console.error(
        'Failed to send leave send_mail to: ' + error,
        error,
        error.stack
      )
    })

    req.session.flash_message('New leave request was added')
    return res.redirect_with_session(
      req.body.redirect_back_to ? req.body.redirect_back_to : '../'
    )
  } catch (error) {
    console.error(
      'An error occured when user ' +
        req.user.id +
        ' try to create a leave request: ',
      error,
      error.stack
    )

    if (error.user_message) {
      req.session.flash_error(error.user_message)
    } else if (error.user_error_message) {
      req.session.flash_error(error.user_error_message)
    } else {
      req.session.flash_error('Failed to create a leave request')
    }

    return res.redirect_with_session(
      req.body.redirect_back_to ? req.body.redirect_back_to : '../'
    )
  }
})

router.get('/', (req, res) => {
  const current_year =
    req.query.year && validator.isNumeric(req.query.year)
      ? moment.utc(req.query.year, 'YYYY')
      : req.user.company.get_today()

  const show_full_year =
    (req.query.show_full_year &&
      validator.toBoolean(req.query.show_full_year)) ||
    false

  Promise.resolve(req.user.ensure_company_with_leave_types())
    .then(() =>
      Promise.join(
        req.user.promise_calendar({
          year: current_year.clone(),
          show_full_year
        }),
        req.user.get_company_with_all_leave_types(),
        Promise.resolve(req.user),
        req.user.promise_supervisors(),
        async (calendar, company, user, supervisors) => {
      if (
        !Array.isArray(user.my_leaves) ||
        user._my_leaves_year !== current_year.year()
      ) {
        await user.reload_with_leave_details({ year: current_year })
      }

      // Compute allowance AFTER leaves are loaded so pending requests are reflected.
      const user_allowance_raw = await user.promise_allowance({
        year: current_year,
        include_pending: true
      })
      const user_allowance =
        user_allowance_raw && typeof user_allowance_raw.toJSON === 'function'
          ? user_allowance_raw.toJSON()
          : user_allowance_raw

      const leave_statistics = await user.get_leave_statistics_by_types()
      const leaves_taken_statistics = leave_statistics.filter(
        stat => stat.days_taken > 0
      )

      // Count pending requests for the current year
      const pending_requests_count = user.my_leaves
        ? user.my_leaves.filter(
          leave =>
            leave.is_new_leave() &&
            moment.utc(leave.date_start).year() === current_year.year()
        ).length
        : 0

      console.log(
        'Calendar route - pending_requests_count:',
        pending_requests_count
      )
      console.log(
        'Calendar route - user.my_leaves length:',
        user.my_leaves ? user.my_leaves.length : 'undefined'
      )

      // Debug: Log the company first_day_of_week value
      console.log(
        'Calendar route: company.first_day_of_week =',
        company.first_day_of_week
      )

      res.render('calendar', {
        calendar: _.map(calendar, c => c.as_for_template()),
        company: company.toJSON(),
        title: 'Calendar | TimeOff',
        current_user: user,
        supervisors,
        previous_year: moment
          .utc(current_year)
          .add(-1, 'year')
          .format('YYYY'),
        current_year: current_year.format('YYYY'),
        next_year: moment
          .utc(current_year)
          .add(1, 'year')
          .format('YYYY'),
        show_full_year,
        leave_type_statistics: leaves_taken_statistics,
        pending_requests_count,

        // User allowance object is simple object with attributes only
        user_allowance
      })
        }
      )
    )
})

router.get('/teamview/', async (req, res) => {
  const user = req.user

  if (user.company.is_team_view_hidden && (!user.admin && !user.manager)) {
    return res.redirect_with_session('/')
  }

  await user.ensure_company_with_leave_types()

  const base_date =
    req.query.date && validator.toDate(req.query.date)
      ? moment.utc(req.query.date)
      : req.user.company.get_today()

  const grouped_mode = getGroupedModeParameter(req)
  const department_ids = getDepartmentIdsForTeamView(req)
  const team_view = new TeamView({ user, base_date })

  try {
    const [team_view_details, company] = await Promise.all([
      team_view.promise_team_view_details({
        department_ids,
        company: user.company
      }),
      user.get_company_with_all_leave_types()
    ])

    // Enrich "team view details" with statistics as how many deducted days each employee spent current month
    const team_view_details_with_stat = await team_view.inject_statistics({
      team_view_details,
      leave_types: company.leave_types
    })

    const {
      users_and_leaves,
      related_departments,
      selected_departments
    } = await team_view.restrainStatisticsForUser({
      user,
      team_view_details: team_view_details_with_stat
    })

    const renderingContext = {
      company,
      users_and_leaves,
      related_departments,
      selected_departments,
      base_date,
      prev_date: moment.utc(base_date).add(-1, 'month'),
      next_date: moment.utc(base_date).add(1, 'month')
    }

    if (grouped_mode) {
      renderingContext.grouped_mode = true
      renderingContext.users_and_leaves_by_departments = groupUsersOnTeamViewByDepartments(
        users_and_leaves
      )
    }

    res.render('team_view', renderingContext)
  } catch (error) {
    console.error(
      `An error occurred when user ${user.id
      } tried to access TeamView page: ${error}, at ${error.stack}`
    )
    req.session.flash_error(
      'Failed to access TeamView page. Please contact administrator.'
    )

    if (error.user_message) {
      req.session.flash_error(error.user_message)
    }

    return res.redirect_with_session('/')
  }
})

const getGroupedModeParameter = req => {
  /**
   * grouped_mode parameter is saved in the current session so user's
   * transition between different pages does not reset the value
   */
  let groupedMode = !!req.query.grouped_mode

  if (req.query.save_grouped_mode) {
    req.session.teamViewGroupedMode = groupedMode
  }

  // for cases when no grouped_mode parameter was supplied: used onf from session
  if (req.query.grouped_mode === undefined) {
    groupedMode = req.session.teamViewGroupedMode
  }

  return groupedMode
}

const getDepartmentIdsForTeamView = req => {
  /**
   * departments parameter is saved in the current session so user's
   * transition between different pages does not reset the value
   */
  let departmentIds = []

  if (req.query.departments) {
    departmentIds = req.query.departments
      .split(',')
      .filter(id => validator.isNumeric(id))
  }

  if (req.query.save_current_department) {
    req.session.teamViewDepartmentIds = departmentIds
  }

  // for cases when no departments parameter was supplied: used from session
  if (req.query.departments === undefined) {
    departmentIds = req.session.teamViewDepartmentIds || []
  }

  return departmentIds
}

const groupUsersOnTeamViewByDepartments = usersAndLeaves => {
  const departmentsDict = usersAndLeaves.reduce(
    (acc, item) => ({
      ...acc,
      [item.user.department.id]: {
        departmentName: item.user.department.name,
        users_and_leaves: []
      }
    }),
    {}
  )

  usersAndLeaves.forEach(item => {
    departmentsDict[item.user.department.id].users_and_leaves.push(item)
  })

  return Object.values(departmentsDict).sort((a, b) =>
    sorter(a.departmentName, b.departmentName)
  )
}

router.get('/feeds/', (req, res) => {
  req.user.getFeeds().then(feeds =>
    Promise.join(
      promise_feed_of_type({ user: req.user, feeds, type: 'calendar' }),
      promise_feed_of_type({ user: req.user, feeds, type: 'teamview' }),
      (calendar_feed, team_view_feed) => {
        res.render('feeds_list', {
          title: 'My feeds | TimeOff',
          calendar_feed,
          team_view_feed,
          current_host: req.get('host')
        })
      }
    )
  )
})

router.post('/feeds/regenerate/', (req, res) => {
  const model = req.app.get('db_model')

  req.user
    .getFeeds()
    .then(feeds => {
      const the_feed = _.findWhere(feeds, { feed_token: req.body.token })

      if (the_feed) {
        return model.UserFeed.promise_new_feed({
          user: req.user,
          type: the_feed.type
        })
      }

      return Promise.resolve()
    })
    .then(() => {
      req.session.flash_message('Feed was regenerated')
      return res.redirect_with_session('/calendar/feeds/')
    })
})

// Fetch or create new feed feed provided types
function promise_feed_of_type(args) {
  const type = args.type
  const user = args.user
  const feeds = args.feeds
  const feed = _.findWhere(feeds, { type })
  let feed_promise

  if (!feed) {
    feed_promise = dbModel.UserFeed.promise_new_feed({
      user,
      type
    })
  } else {
    feed_promise = Promise.resolve(feed)
  }

  return feed_promise
}

router.get('/leave-summary/:leaveId/', async (req, res) => {
  const actingUser = req.user
  const leaveId = validator.trim(req.params.leaveId)
  try {
    const leave = await getLeaveForUserView({ actingUser, leaveId })
    console.log('getting details for leave', leaveId)
    const extendedView = await doesUserHasExtendedViewOfLeave({
      user: actingUser,
      leave
    })
    console.log('extendedView: ', extendedView)
    if (extendedView) {
      const user = leave.user
      await user.promise_schedule_I_obey()
      const [extendedLeave] = await user.promise_my_leaves({
        // changed this
        ignore_year: true,
        filter: { id: leave.id }
      })
      const leaveDetails = leaveIntoObject(extendedLeave)
      console.log(
        'leaveIntoObject leaveDetails: id, start, end, deducted',
        leaveId,
        leaveDetails.startDate,
        leaveDetails.endDate,
        leaveDetails.deductedDays
      )
      const comments = await getCommentsForLeave({ leave })
      leaveDetails.commentsString = comments
        .map(({ comment }) => comment)
        .join('<br>')

      // Add canApprove flag based on user permissions and leave status
      leaveDetails.canApprove =
        (actingUser.admin || actingUser.is_manager()) &&
        (leave.status === leaveConstants.status_new() ||
          leave.status === leaveConstants.status_pended_revoke())

      return res.render('leave/popup_leave_details', {
        leave: leaveDetails,
        layout: false
      })
    } else {
      // return res.send('Short');
      const leaveDetails = leaveIntoObject(leave)
      return res.render('leave/popup_leave_details', {
        leave: leaveDetails,
        layout: false,
        limitedView: true
      })
    }
  } catch (error) {
    console.log(
      `Failed to obtain Leave [${leaveId}] summary: ${error} at ${error.stack}`
    )
    return res.send('Failed to get leave details...')
  }
})

module.exports = router
