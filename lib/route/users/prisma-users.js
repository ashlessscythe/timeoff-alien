'use strict'

const express = require('express')
const moment = require('moment')
const validator = require('validator')
const prisma = require('../../prisma/client')
const userUtils = require('../../prisma/userUtils')
const { Op } = require('sequelize') // Still needed for some date operations

const router = express.Router()

/**
 * Prisma-based users endpoint - optimized for performance
 */

/* Handle the root for users section, it shows the list of all users
 * */
router.get('/', async (req, res) => {
  try {
    let department_id = req.query.department
    let users_filter = {}

    if (
      typeof department_id === 'number' ||
      (department_id && validator.isNumeric(department_id))
    ) {
      users_filter = { department_id: parseInt(department_id) }
    } else {
      department_id = undefined
    }

    // Get current user's company
    const currentUser = await prisma.users.findUnique({
      where: { id: req.user.id },
      include: { companies: true }
    })

    if (!currentUser) {
      return res.status(404).render('not_found')
    }

    const company = currentUser.companies

    // Get all users for the company with their related data in a single query
    const users = await prisma.users.findMany({
      where: {
        company_id: company.id,
        ...users_filter
      },
      include: {
        departments: true,
        leaves_leaves_user_idTousers: {
          where: {
            status: { in: [1, 2, 3] }, // approved, new, pended_revoke
            OR: [
              {
                date_start: {
                  gte: moment
                    .utc()
                    .startOf('year')
                    .toDate(),
                  lte: moment
                    .utc()
                    .endOf('year')
                    .toDate()
                }
              },
              {
                date_end: {
                  gte: moment
                    .utc()
                    .startOf('year')
                    .toDate(),
                  lte: moment
                    .utc()
                    .endOf('year')
                    .toDate()
                }
              }
            ]
          },
          include: {
            leave_types: true
          }
        }
      },
      orderBy: [{ lastname: 'asc' }, { departments: { name: 'asc' } }]
    })

    // Get bank holidays and departments for the company
    const [bank_holidays, departments] = await Promise.all([
      prisma.bank_holidays.findMany({
        where: { company_id: company.id },
        orderBy: { date: 'asc' }
      }),
      prisma.departments.findMany({
        where: { company_id: company.id },
        orderBy: { name: 'asc' }
      })
    ])

    // Add company data to the company object
    company.bank_holidays = bank_holidays
    company.departments = departments

    // Process users data in parallel for better performance
    const users_info = await Promise.all(
      users.map(async user => {
        // Calculate allowance for each user
        const allowance_obj = await userUtils.getUserAllowance(user)

        // Get user schedule
        const schedule = await userUtils.getUserSchedule(user)

        // Calculate days taken from allowance
        const days_taken = userUtils.calculateNumberOfDaysTakenFromAllowance(
          user,
          user.leaves_leaves_user_idTousers,
          moment().year()
        )

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
            calculate_number_of_days_taken_from_allowance: () => days_taken
          },
          number_of_days_available_in_allowance:
            allowance_obj.number_of_days_available_in_allowance
        }
      })
    )

    // Prepare data for rendering
    const usersInfoForRendering = users_info.map(ui => ({
      user_id: ui.user_row.id,
      user_email: ui.user_row.email,
      user_slack_username: ui.user_row.slack_username,
      user_name: ui.user_row.name,
      user_lastname: ui.user_row.lastname,
      user_full_name: ui.user_row.full_name(),
      department_id: ui.user_row.department.id,
      department_name: ui.user_row.department.name,
      is_admin: ui.user_row.admin,
      is_manager: ui.user_row.manager,
      number_of_days_available_in_allowance:
        ui.number_of_days_available_in_allowance,
      number_of_days_taken_from_allowance: ui.user_row.calculate_number_of_days_taken_from_allowance(),
      is_active: ui.user_row.is_active()
    }))

    // Sort users by lastname
    const sortedUsersInfoForRendering = usersInfoForRendering.sort((a, b) => {
      if (a.user_lastname < b.user_lastname) return -1
      if (a.user_lastname > b.user_lastname) return 1
      return 0
    })

    if (req.query['as-csv']) {
      return users_list_as_csv({
        users_info: users_info,
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
    console.error('Error in Prisma users endpoint:', error)
    res.status(500).render('error', {
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error : {}
    })
  }
})

/**
 * Handle user search by email (JSON only)
 */
router.post('/', async (req, res) => {
  // Currently we support search only by email and only JSON type requests
  if (!req.accepts('json')) {
    // redirect client to the users index page
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
    // Get current user's company
    const currentUser = await prisma.users.findUnique({
      where: { id: req.user.id },
      include: { companies: true }
    })

    if (!currentUser) {
      return res.json([])
    }

    // Search for users only related to currently logged in admin
    const company = await prisma.companies.findUnique({
      where: { id: currentUser.company_id },
      include: {
        users: {
          where: { email: email },
          include: {
            departments: true
          }
        }
      }
    })

    if (company && company.users) {
      res.json(company.users)
    } else {
      res.json([])
    }
  } catch (error) {
    console.error('Error in user search:', error)
    res.json([])
  }
})

/**
 * CSV export function (simplified version)
 */
function users_list_as_csv(args) {
  const users_info = args.users_info
  const company = args.company
  const res = args.res

  // Simple CSV implementation
  const csv_header = [
    'Name',
    'Last Name',
    'Email',
    'Department',
    'Admin',
    'Manager',
    'Days Available',
    'Days Taken',
    'Active'
  ].join(',')

  const csv_rows = users_info.map(ui => {
    const user = ui.user_row
    return [
      user.name,
      user.lastname,
      user.email,
      user.department.name,
      user.admin ? 'Yes' : 'No',
      user.manager ? 'Yes' : 'No',
      ui.number_of_days_available_in_allowance,
      user.calculate_number_of_days_taken_from_allowance(),
      user.is_active() ? 'Yes' : 'No'
    ]
      .map(field => `"${field}"`)
      .join(',')
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

module.exports = router
