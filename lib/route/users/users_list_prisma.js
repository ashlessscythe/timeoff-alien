'use strict'

const moment = require('moment')
const validator = require('validator')
const prisma = require('../../prisma/client')
const userUtils = require('../../prisma/userUtils')
const allowanceStatuses = userUtils.allowanceCountingStatuses()
const leaveConstants = require('../../model/leave_constants')

/** Escape a cell for CSV (RFC-style: wrap in quotes, double internal quotes). */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

function users_list_as_csv(args) {
  const users_info = args.users_info
  const company = args.company
  const res = args.res

  const csv_header = [
    'name',
    'last_name',
    'email',
    'department_id',
    'department_name',
    'admin',
    'manager',
    'active',
    'remaining_allowance',
    'remaining_personal',
    'remaining_vacation',
    'days_used',
    'nominal_allowance',
    'nominal_personal',
    'manual_adjustment',
    'personal_adjustment',
    'carried_over_allowance'
  ].join(',')

  const csv_rows = users_info.map(ui => {
    const user = ui.user_row
    const a = ui.allowance || {}
    const remainingAllowance =
      a.number_of_days_available_in_allowance != null
        ? a.number_of_days_available_in_allowance
        : ui.number_of_days_available_in_allowance
    const remainingPersonal =
      a.total_personal_available != null ? a.total_personal_available : ''
    const remainingVacation =
      a.vacation_remaining != null ? a.vacation_remaining : ''
    const daysUsed =
      a.number_of_days_taken_from_allowance != null
        ? a.number_of_days_taken_from_allowance
        : user.calculate_number_of_days_taken_from_allowance()

    return [
      csvCell(user.name),
      csvCell(user.lastname),
      csvCell(user.email),
      csvCell(user.department && user.department.id),
      csvCell(user.department && user.department.name),
      csvCell(user.admin ? 'true' : 'false'),
      csvCell(user.manager ? 'true' : 'false'),
      csvCell(user.is_active() ? 'true' : 'false'),
      csvCell(remainingAllowance),
      csvCell(remainingPersonal),
      csvCell(remainingVacation),
      csvCell(daysUsed),
      csvCell(a.nominal_allowance != null ? a.nominal_allowance : ''),
      csvCell(a.nominal_personal != null ? a.nominal_personal : ''),
      csvCell(a.manual_adjustment != null ? a.manual_adjustment : ''),
      csvCell(a.personal_adjustment != null ? a.personal_adjustment : ''),
      csvCell(a.carried_over_allowance != null ? a.carried_over_allowance : '')
    ].join(',')
  })

  const csv_content = [csv_header, ...csv_rows].join('\n')

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="users-${company.name}-${moment().format(
      'YYYY-MM-DD'
    )}.csv"`
  )
  res.send(csv_content)
}

module.exports = function registerUsersListPrismaRoutes(router) {
  router.get('/', async (req, res) => {
    try {
      let department_id = req.query.department
      let users_filter = {}

      if (
        typeof department_id === 'number' ||
        (department_id && validator.isNumeric(department_id))
      ) {
        users_filter = { department_id: parseInt(department_id, 10) }
      } else {
        department_id = undefined
      }

      await req.user.ensure_company_with_leave_types()
      const company = req.user.company

      let usersWhere = {
        company_id: company.id,
        ...users_filter
      }

      if (req.user.is_admin()) {
        // Admins see the full company roster (unchanged).
      } else if (req.user.is_manager()) {
        const supervisedDepartments = await req.user.promise_supervised_departments()
        const supervisedDepartmentIds = supervisedDepartments.map(
          department => department.id
        )

        if (supervisedDepartmentIds.length === 0) {
          usersWhere.department_id = -1
        } else if (users_filter.department_id) {
          if (!supervisedDepartmentIds.includes(users_filter.department_id)) {
            return res.redirect_with_session(303, '/users/')
          }
        } else {
          usersWhere.department_id = { in: supervisedDepartmentIds }
        }
      } else {
        return res.redirect_with_session(303, '/')
      }

      const users = await prisma.users.findMany({
        where: usersWhere,
        include: {
          departments: true,
          leaves_leaves_user_idTousers: {
            where: {
              // Match calendar / allowance: new, approved, pended_revoke (see userUtils.allowanceCountingStatuses).
              status: { in: allowanceStatuses },
              // Any leave that overlaps the current year window (not only leaves
              // whose start/end is inside the year).
              AND: [
                { date_start: { lte: moment.utc().endOf('year').toDate() } },
                { date_end: { gte: moment.utc().startOf('year').toDate() } }
              ]
            },
            include: {
              leave_types: true
            }
          }
        },
        orderBy: [{ lastname: 'asc' }, { departments: { name: 'asc' } }]
      })

      const [bank_holidays, departments, schedulesByUserId, adjustmentsByUser] =
        await Promise.all([
          prisma.bank_holidays.findMany({
            where: { company_id: company.id },
            orderBy: { date: 'asc' }
          }),
          prisma.departments.findMany({
            where: { company_id: company.id },
            orderBy: { name: 'asc' }
          }),
          userUtils.getSchedulesForUsers(users, company.id),
          userUtils.getAllowanceAdjustmentsForUsers(users.map(user => user.id))
        ])

      company.bank_holidays = bank_holidays
      company.departments = departments

      const currentYear = moment().year()
      const users_info = await Promise.all(
        users.map(async user => {
          const schedule = schedulesByUserId[user.id]
          const adjustmentContext = userUtils.resolveAdjustmentForYear(
            user,
            currentYear,
            adjustmentsByUser
          )

          const allowance_obj = await userUtils.getUserAllowanceWithContext(
            {
              ...user,
              company,
              departments: user.departments
            },
            currentYear,
            {
              leaves: user.leaves_leaves_user_idTousers,
              company,
              department: user.departments,
              schedule,
              adjustment: adjustmentContext.record,
              adjustment_and_carry_over: adjustmentContext
            }
          )

          const pendingOnlyStatuses = [leaveConstants.status_new()]
          const pending_taken_from_allowance =
            userUtils.calculateNumberOfDaysTakenFromAllowance(
              user,
              user.leaves_leaves_user_idTousers,
              currentYear,
              {
                company,
                department: user.departments,
                schedule,
                statuses: pendingOnlyStatuses
              }
            )
          const number_of_days_taken_from_allowance_used =
            (allowance_obj.number_of_days_taken_from_allowance || 0) -
            (pending_taken_from_allowance || 0)

          return {
            user_row: {
              ...user,
              company: company,
              department: user.departments,
              my_leaves: user.leaves_leaves_user_idTousers.map(leave => ({
                ...leave,
                user: user,
                leave_type: leave.leave_types
              })),
              cached_schedule: schedule,
              full_name: () => userUtils.fullName(user),
              is_active: () => userUtils.isActive(user),
              calculate_number_of_days_taken_from_allowance: () =>
                number_of_days_taken_from_allowance_used
            },
            number_of_days_available_in_allowance:
              allowance_obj.number_of_days_available_in_allowance,
            allowance: {
              ...allowance_obj,
              number_of_days_taken_from_allowance:
                number_of_days_taken_from_allowance_used
            }
          }
        })
      )

      const users_info_resolved = users_info

      const usersInfoForRendering = users_info_resolved.map(ui => ({
        user_id: ui.user_row.id,
        user_email: ui.user_row.email,
        user_slack_username: ui.user_row.slack_username,
        user_name: ui.user_row.name,
        user_lastname: ui.user_row.lastname,
        user_full_name: userUtils.fullName(ui.user_row),
        department_id: ui.user_row.department.id,
        department_name: ui.user_row.department.name,
        is_admin: ui.user_row.admin,
        is_manager: ui.user_row.manager,
        number_of_days_available_in_allowance:
          ui.number_of_days_available_in_allowance,
        number_of_days_taken_from_allowance: ui.user_row.calculate_number_of_days_taken_from_allowance(),
        is_active: ui.user_row.is_active()
      }))

      const sortedUsersInfoForRendering = usersInfoForRendering.sort((a, b) => {
        if (a.user_lastname < b.user_lastname) return -1
        if (a.user_lastname > b.user_lastname) return 1
        return 0
      })

      if (req.query['as-csv']) {
        return users_list_as_csv({
          users_info: users_info_resolved,
          company: company,
          req: req,
          res: res
        })
      }

      res.render('users', {
        company,
        department_id: Number(department_id),
        title: company.name + "'s people",
        users_info: sortedUsersInfoForRendering
      })
    } catch (error) {
      console.error('Error in users list:', error)
      res.status(500).render('error', {
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error : {}
      })
    }
  })

  router.post('/', async (req, res) => {
    if (!req.accepts('json')) {
      return res.redirect_with_session('../')
    }

    const email = validator.trim(req.body.email || req.query.email).toLowerCase()

    if (!validator.isEmail(email)) {
      req.session.flash_error(
        'Provided email does not look like valid one: "' + email + '"'
      )
      return res.json([])
    }

    try {
      await req.user.ensure_company_with_leave_types()

      let usersWhere = {
        company_id: req.user.company_id,
        email: email
      }

      if (req.user.is_manager() && !req.user.is_admin()) {
        const supervisedDepartments = await req.user.promise_supervised_departments()
        const supervisedDepartmentIds = supervisedDepartments.map(
          department => department.id
        )

        if (supervisedDepartmentIds.length === 0) {
          return res.json([])
        }

        usersWhere.department_id = { in: supervisedDepartmentIds }
      }

      const matchedUsers = await prisma.users.findMany({
        where: usersWhere,
        include: {
          departments: true
        }
      })

      res.json(matchedUsers)
    } catch (error) {
      console.error('Error in user search:', error)
      res.json([])
    }
  })
}
