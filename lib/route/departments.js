'use strict'

const { sorter } = require('../util')

const express = require('express')
const router = express.Router()
const validator = require('validator')
const Promise = require('bluebird')
const _ = require('underscore')
const prisma = require('../prisma/client')

// Make sure that current user is authorized to deal with settings
router.all(/.*/, require('../middleware/ensure_user_is_admin'))

// fill dropdown for personal days
function generate_department_personal_days() {
  const personal_days_options = [{ value: 0, caption: 'None' }]
  let personal_days = 1

  while (personal_days <= 10) {
    personal_days_options.push({ value: personal_days, caption: personal_days })
    personal_days += 1
  }

  return personal_days_options
}

function generate_all_department_allowances() {
  const allowance_options = [{ value: 0, caption: 'None' }]
  let allowance = 0.5

  while (allowance <= 50) {
    allowance_options.push({ value: allowance, caption: allowance })
    allowance += 0.5
  }

  return allowance_options
}

function get_and_validate_department(args) {
  const req = args.req
  const session = req.session
  const index = args.suffix
  const company = args.company
  // If no_suffix is set then parameter names are considered without "indexes"
  const no_suffix = args.no_suffix
  const department_name = args.department_name

  function getParam(name) {
    return req.body[no_suffix ? name : name + '__' + index]
  }

  // Get user parameters
  const name = getParam('name') ? validator.trim(getParam('name')) : ''
  const allowance = getParam('allowance')
    ? validator.trim(getParam('allowance'))
    : ''
  const personal = getParam('personal')
    ? validator.trim(getParam('personal'))
    : ''
  const manager_id = getParam('manager_id')
    ? validator.trim(getParam('manager_id'))
    : ''
  const include_public_holidays = getParam('include_public_holidays')
    ? validator.toBoolean(getParam('include_public_holidays'))
    : false
  const is_accrued_allowance = getParam('is_accrued_allowance')
    ? validator.toBoolean(getParam('is_accrued_allowance'))
    : false

  // Get allowed_increments from form (array of checkboxes)
  // Handle both 'allowed_increments[]' (with brackets) and 'allowed_increments' (without brackets)
  let allowed_increments = []
  if (req.body['allowed_increments[]']) {
    // Form field name has brackets
    allowed_increments = Array.isArray(req.body['allowed_increments[]'])
      ? req.body['allowed_increments[]']
      : [req.body['allowed_increments[]']]
  } else if (req.body.allowed_increments) {
    // Form field name without brackets (or already parsed)
    allowed_increments = Array.isArray(req.body.allowed_increments)
      ? req.body.allowed_increments
      : [req.body.allowed_increments]
  }

  // Default to full_day and half_day if nothing is selected
  if (allowed_increments.length === 0) {
    allowed_increments = ['full_day', 'half_day']
  }

  // Validate provided parameters
  //
  // New allowance should be from range of (0;50]
  if (!validator.isFloat(allowance)) {
    session.flash_error(
      'New allowance for ' + department_name + ' should be numeric'
    )
  } else {
    const allowanceNumber = parseFloat(allowance)
    if (!(allowanceNumber > 0 && allowanceNumber <= 50)) {
      session.flash_error(
        'New allowance for ' +
          department_name +
          ' should be between 0.5 and 50 days'
      )
    }
  }

  // New personal days should be from range of [0,10]
  if (!validator.isFloat(personal)) {
    session.flash_error(
      `New personal allowance for ${department_name} should be numeric`
    )
  } else {
    const personalNumber = parseFloat(personal)
    if (personalNumber < 0 || personalNumber > 10) {
      session.flash_error(
        `New personal allowance for ${department_name} should be between 0 and 10 days (inclusive)`
      )
    }
  }

  // New manager ID should be numeric and from within
  // current company
  if (
    typeof manager_id !== 'number' &&
    (!manager_id || !validator.isNumeric(manager_id))
  ) {
    session.flash_error(
      'New manager reference for ' + department_name + ' should be numeric'
    )
  } else if (
    !_.contains(
      _.map(company.users, user => String(user.id)),
      String(manager_id)
    )
  ) {
    req.session.flash_error(
      'New manager for ' + department_name + ' is unknown'
    )
  }

  return {
    allowance: allowance ? parseFloat(allowance) : 0,
    personal: personal ? parseFloat(personal) : 0,
    manager_id: manager_id ? parseInt(manager_id) : null,
    include_public_holidays,
    is_accrued_allowance,
    name,
    allowed_increments: JSON.stringify(allowed_increments)
  }
}

router.get('/departments/', async (req, res) => {
  try {
    // Add JS that is specific only to current page
    res.locals.custom_java_script.push('/js/departments.js')

    // Get current user's company
    const currentUser = await prisma.users.findUnique({
      where: { id: req.user.id },
      include: { companies: true }
    })

    if (!currentUser) {
      return res.status(404).render('not_found')
    }

    const company = currentUser.companies

    // Get active users for the company
    const users = await prisma.users.findMany({
      where: {
        company_id: company.id,
        OR: [
          { end_date: null },
          { end_date: { gte: new Date() } }
        ]
      },
      orderBy: [{ lastname: 'asc' }, { name: 'asc' }]
    })

    // Get departments with users and manager
    const departments = await prisma.departments.findMany({
      where: { company_id: company.id },
      include: {
        users: {
          where: {
            OR: [
              { end_date: null },
              { end_date: { gte: new Date() } }
            ]
          }
        }
      },
      orderBy: { name: 'asc' }
    })

    // Get managers for departments
    const managerIds = departments
      .map(d => d.manager_id)
      .filter(id => id !== null)

    const managers = managerIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: managerIds } }
        })
      : []

    const managerMap = {}
    managers.forEach(manager => {
      managerMap[manager.id] = manager
    })

    // Attach managers to departments and parse allowed_increments
    const departmentsWithData = departments.map(dept => {
      const deptData = { ...dept }
      deptData.manager = dept.manager_id ? managerMap[dept.manager_id] : null
      // Parse allowed_increments JSON
      deptData.allowed_increments_array = dept.allowed_increments
        ? JSON.parse(dept.allowed_increments)
        : ['full_day', 'half_day']
      return deptData
    })

    // Add users to company object for template compatibility
    company.users = users

    res.render('departments_overview', {
      title: 'Settings - Departments | TimeOff',
      departments: departmentsWithData.sort((a, b) => sorter(a.name, b.name)),
      allowance_options: generate_all_department_allowances(),
      personal_days_options: generate_department_personal_days(),
      company
    })
  } catch (error) {
    console.error('Error in GET /departments/:', error)
    req.session.flash_error('Failed to load departments')
    return res.redirect_with_session('/settings/')
  }
})

router.post('/departments/', async (req, res) => {
  try {
    // Get current user's company
    const currentUser = await prisma.users.findUnique({
      where: { id: req.user.id },
      include: {
        companies: {
          include: {
            users: {
              where: {
                OR: [
                  { end_date: null },
                  { end_date: { gte: new Date() } }
                ]
              }
            }
          }
        }
      }
    })

    if (!currentUser) {
      req.session.flash_error('Failed to find user')
      return res.redirect_with_session('/settings/departments/')
    }

    const company = currentUser.companies

    const attributes = get_and_validate_department({
      req,
      params: req.body,
      session: req.session,
      suffix: 'new',
      company,
      department_name: 'New department'
    })

    if (req.session.flash_has_errors()) {
      return res.redirect_with_session('/settings/departments/')
    }

    await prisma.departments.create({
      data: {
        ...attributes,
        company_id: company.id
      }
    })

    if (!req.session.flash_has_errors()) {
      req.session.flash_message('Changes to departments were saved')
    }

    return res.redirect_with_session('/settings/departments/')
  } catch (error) {
    console.error(
      'An error occurred when trying to add department by user ' +
        req.user.id +
        ' : ',
      error,
      error.stack
    )

    req.session.flash_error(
      'Failed to add new department, please contact customer service'
    )

    return res.redirect_with_session('/settings/departments/')
  }
})

router.post('/departments/delete/:department_id/', async (req, res) => {
  const department_id = req.params.department_id
  let department_to_remove
  console.log('deleting department: ' + department_id)

  if (
    typeof department_id !== 'number' &&
    (!department_id || !validator.isInt(department_id))
  ) {
    console.error(
      'User ' + req.user.id + ' submited non-int department ID ' + department_id
    )

    req.session.flash_error('Cannot remove department: wronge parameters')

    return res.redirect_with_session('/settings/departments/')
  }

  try {
    // Get current user's company
    const currentUser = await prisma.users.findUnique({
      where: { id: req.user.id },
      include: { companies: true }
    })

    if (!currentUser) {
      req.session.flash_error('Cannot remove department: user not found')
      return res.redirect_with_session('/settings/departments/')
    }

    const company = currentUser.companies

    // Get department with users
    department_to_remove = await prisma.departments.findFirst({
      where: {
        id: parseInt(department_id),
        company_id: company.id
      },
      include: {
        users: true
      }
    })

    // Check if user specify valid department number
    if (!department_to_remove) {
      req.session.flash_error('Cannot remove department: wronge parameters')

      throw new Error(
        'User ' +
          req.user.id +
          ' tried to remove non-existing department ID' +
          department_id
      )
    }

    if (department_to_remove.users.length > 0) {
      req.session.flash_error(
        'Cannot remove department ' +
          department_to_remove.name +
          ' as it still has ' +
          department_to_remove.users.length +
          ' users.'
      )

      throw new Error('Department still has users')
    }

    // Delete department (supervisors will be deleted automatically due to cascade)
    await prisma.departments.delete({
      where: { id: department_to_remove.id }
    })

    req.session.flash_message('Department was successfully removed')
    return res.redirect_with_session('/settings/departments/')
  } catch (error) {
    console.error(
      'An error occurred when trying to edit departments by user ' +
        req.user.id +
        ' : ' +
        error,
      error.stack
    )

    return res.redirect_with_session(
      department_to_remove
        ? '/settings/departments/edit/' + department_to_remove.id + '/'
        : '/settings/departments/'
    )
  }
})

async function promise_to_extract_company_and_department(req, only_active = true) {
  const department_id =
    req.body.department_id ||
    req.query.department_id ||
    req.params.department_id

  if (
    typeof department_id !== 'number' &&
    (!department_id || !validator.isInt(department_id))
  ) {
    throw new Error(
      'User ' +
        req.user.id +
        ' tried to open department refered by  non-int ID ' +
        department_id
    )
  }

  // Get current user's company
  const currentUser = await prisma.users.findUnique({
    where: { id: req.user.id },
    include: { companies: true }
  })

  if (!currentUser) {
    throw new Error('Cannot determine company!')
  }

  const company = currentUser.companies

  // Get users for company
  const usersWhere = only_active
    ? {
        company_id: company.id,
        OR: [
          { end_date: null },
          { end_date: { gte: new Date() } }
        ]
      }
    : { company_id: company.id }

  const users = await prisma.users.findMany({
    where: usersWhere,
    orderBy: [{ lastname: 'asc' }, { name: 'asc' }]
  })

  // Get department with supervisors
  const department = await prisma.departments.findFirst({
    where: {
      id: parseInt(department_id),
      company_id: company.id
    },
    include: {
      department_supervisors: {
        include: {
          users: true
        }
      }
    }
  })

  // Ensure we have database record for given department ID
  if (!department) {
    throw new Error('Non existing department ID provided')
  }

  // Get manager if exists
  let manager = null
  if (department.manager_id) {
    manager = await prisma.users.findUnique({
      where: { id: department.manager_id }
    })
  }

  // Transform department to match expected structure
  const departmentData = {
    ...department,
    manager,
    supervisors: department.department_supervisors.map(ds => ds.users),
    users: users.filter(u => u.department_id === department.id),
    // Parse allowed_increments JSON
    allowed_increments_array: department.allowed_increments
      ? JSON.parse(department.allowed_increments)
      : ['full_day', 'half_day']
  }

  // Add users to company for template compatibility
  company.users = users

  return {
    company,
    department: departmentData
  }
}

router.get('/departments/edit/:department_id/', async (req, res) => {
  const department_id = req.params.department_id
  console.log('editing department: ' + department_id)

  try {
    const result = await promise_to_extract_company_and_department(req)
    const department = result.department
    const company = result.company

    res.render('department_details', {
      title: 'Settings - Department details | TimeOff',
      department,
      company,
      allowance_options: generate_all_department_allowances(),
      personal_days_options: generate_department_personal_days()
    })
  } catch (error) {
    console.error(
      'An error occurred when trying to edit department ' +
        department_id +
        ' for user ' +
        req.user.id +
        ' : ' +
        error,
      error.stack
    )

    req.session.flash_error('Failed to fetch details for given department')

    return res.redirect_with_session('/settings/departments/')
  }
})

/**
 * Handles the POST request to edit a department.
 *
 * This route is responsible for updating the details of a department, including
 * adding or removing supervisors. It first extracts the company and department
 * information from the request, then performs the appropriate update operation
 * based on the request body.
 *
 * If the request body includes a `remove_supervisor_id`, it will remove the
 * specified supervisor from the department. If the `do_add_supervisors` flag is
 * set, it will update the supervisors for the department. Otherwise, it will
 * update the department details directly.
 *
 * After the update is complete, it redirects the user back to the department
 * details page.
 *
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 */
router.post('/departments/edit/:department_id/', async (req, res) => {
  const department_id = req.body.department_id
  let company
  let department

  try {
    const result = await promise_to_extract_company_and_department(req)
    company = result.company
    department = result.department

    if (req.body.remove_supervisor_id) {
      await promise_to_remove_supervisor({
        supervisor_id: req.body.remove_supervisor_id,
        company,
        department
      })
      req.session.flash_message(
        'Supervisor was removed from ' + department.name
      )
    } else if (req.body.do_add_supervisors) {
      await promise_to_update_supervisors({
        req,
        company,
        department
      })
      req.session.flash_message(
        'Supervisors were added to department ' + department.name
      )
    } else {
      await promise_to_update_department({
        req,
        company,
        department
      })
      req.session.flash_message(
        'Department ' + department.name + ' was updated'
      )
    }

    return res.redirect_with_session('.')
  } catch (error) {
    console.error(
      'An error occurred when trying to update secondary superwisors for depertment ' +
        department_id +
        ' by user ' +
        req.user.id +
        ' : ' +
        error,
      error.stack
    )

    req.session.flash_error("Failed to update department's details")

    return res.redirect_with_session('../../')
  }
})

async function promise_to_remove_supervisor(args) {
  const supervisor_id = args.supervisor_id
  const company = args.company
  const department = args.department

  // Make sure that provided supervisor ID belongs to user from current company
  if (
    company.users.map(u => String(u.id)).indexOf(String(supervisor_id)) === -1
  ) {
    return Promise.resolve(1)
  }

  await prisma.department_supervisors.deleteMany({
    where: {
      department_id: department.id,
      user_id: parseInt(supervisor_id)
    }
  })
}

async function promise_to_update_supervisors(args) {
  const req = args.req
  const company = args.company
  const department = args.department
  console.log('updating supervisors for department:', department.id)

  // added .body here
  let supervisor_ids = req.body.supervisor_id || []
  if (!Array.isArray(supervisor_ids)) {
    supervisor_ids = [supervisor_ids]
  }
  console.log('pre-filtered supervisor ids:' + supervisor_ids)

  // Take list of all users as a base of intersection,
  // so we use submitted data only as criteria and do not save it in database
  supervisor_ids = company.users
    .map(user => user.id)
    .filter(id => supervisor_ids.indexOf(String(id)) !== -1)

  console.log('filtered supervisor ids:' + supervisor_ids)

  // Get existing supervisors
  const existingSupervisors = await prisma.department_supervisors.findMany({
    where: {
      department_id: department.id
    },
    select: {
      user_id: true
    }
  })

  const existingSupervisorIds = existingSupervisors.map(
    supervisor => supervisor.user_id
  )

  // Find supervisors to remove
  const supervisorsToRemove = existingSupervisorIds.filter(
    id => !supervisor_ids.includes(id)
  )

  // Find supervisors to add
  const supervisorsToAdd = supervisor_ids.filter(
    id => !existingSupervisorIds.includes(id)
  )

  // Remove supervisors
  const removePromises = supervisorsToRemove.map(id =>
    prisma.department_supervisors.deleteMany({
      where: {
        department_id: department.id,
        user_id: id
      }
    })
  )

  // Add supervisors
  const addPromises = supervisorsToAdd.map(id =>
    prisma.department_supervisors.create({
      data: {
        user_id: id,
        department_id: department.id,
        created_at: new Date()
      }
    })
  )

  await Promise.all([...removePromises, ...addPromises])
}

async function promise_to_update_department(args) {
  const req = args.req
  const company = args.company
  const department = args.department

  const attributes = get_and_validate_department({
    company,
    department_name: department.name,
    no_suffix: true,
    req
  })

  // If there were any validation errors: do not update department
  if (req.session.flash_has_errors()) {
    throw new Error(
      'Invalid parameters submitted while while attempt to update department details'
    )
  }

  await prisma.departments.update({
    where: { id: department.id },
    data: attributes
  })
}

router.get('/departments/available-supervisors/:department_id/', async (req, res) => {
  const department_id = req.params.department_id

  try {
    const result = await promise_to_extract_company_and_department(req)
    const department = result.department
    const company = result.company

    const supervisor_map = {}

    department.supervisors.forEach(user => {
      supervisor_map[user.id] = true
    })

    const availableSupervisors = _.map(
      _.filter(company.users, user => user.id !== department.manager_id),
      user => {
        user._marked = supervisor_map[user.id]
        return user
      }
    )

    res.render('department/available_supervisors', {
      layout: false,
      users: availableSupervisors,
      title: 'Settings - Department Available Supervisors | TimeOff'
    })
  } catch (error) {
    console.error(
      'An error occurred when trying to get all available supervisors for department ' +
        department_id +
        ' for user ' +
        req.user.id +
        ' : ' +
        error,
      error.stack
    )

    res.status(500).send('REQUEST FAILED')
  }
})

module.exports = router
