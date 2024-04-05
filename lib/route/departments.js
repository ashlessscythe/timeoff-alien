'use strict'

const { sorter } = require('../util')

const express = require('express')
const router = express.Router()
const validator = require('validator')
const Promise = require('bluebird')
const _ = require('underscore')

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
  // New personal days should be from range of (0;10]
  if (!validator.isFloat(personal)) {
    session.flash_error(
      'New personal allowance for ' + department_name + ' should be numeric'
    )
  } else {
    const personalNumber = parseFloat(personal)
    if (!(personalNumber > 0 && personalNumber <= 10)) {
      session.flash_error(
        'New personal allowance for ' +
          department_name +
          ' should be between 0.5 and 10 days'
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
    allowance,
    personal,
    manager_id,
    include_public_holidays,
    is_accrued_allowance,
    name
  }
}

router.get('/departments/', (req, res) => {
  // Add JS that is specific only to current page
  res.locals.custom_java_script.push('/js/departments.js')

  let company_for_template
  const model = req.app.get('db_model')

  req.user
    .getCompany({
      scope: ['with_active_users', 'order_by_active_users']
    })
    .then(company => {
      company_for_template = company
      return company.getDepartments({
        scope: ['with_simple_users', 'with_manager'],
        order: [[model.Department.default_order_field()]]
      })
    })
    .then(departments => {
      res.render('departments_overview', {
        title: 'Settings - Departments | TimeOff',
        departments: departments.sort((a, b) => sorter(a.name, b.name)),
        allowance_options: generate_all_department_allowances(),
        personal_days_options: generate_department_personal_days(),
        company: company_for_template
      })
    })
})

router.post('/departments/', (req, res) => {
  const model = req.app.get('db_model')

  req.user
    .getCompany({
      scope: ['with_active_users']
    })
    .then(company => {
      const attributes = get_and_validate_department({
        req,
        params: req.body,
        session: req.session,
        suffix: 'new',
        company,
        department_name: 'New department'
      })

      if (req.session.flash_has_errors()) {
        return Promise.resolve(1)
      }

      attributes.company_id = company.id

      return model.Department.create(attributes)
    })

    .then(() => {
      if (!req.session.flash_has_errors()) {
        req.session.flash_message('Changes to departments were saved')
      }

      return res.redirect_with_session('/settings/departments/')
    })

    .catch(error => {
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
    })
})

router.post('/departments/delete/:department_id/', (req, res) => {
  const department_id = req.params.department_id
  let department_to_remove
  console.log('deleting department: '+ department_id)

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

  req.user
    .getCompany()

    .then(company =>
      company.getDepartments({
        scope: ['with_simple_users'],
        where: {
          id: department_id
        }
      })
    )
    .then(departments => {
      department_to_remove = departments[0]

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

      // TODO VPP remove corresponding records in supervisors linking table
      return department_to_remove.destroy()
    })
    .then(() => {
      req.session.flash_message('Department was successfully removed')
      return res.redirect_with_session('/settings/departments/')
    })
    .catch(error => {
      console.error(
        'An error occurred when trying to edit departments by user ' +
          req.user.id +
          ' : ' +
          error,
        error.stack
      )

      return res.redirect_with_session(
        department_to_remove
          ? '/settings/departments/edit/' + department_to_remove.get('id') + '/'
          : '/settings/departments/'
      )
    })
})

function promise_to_extract_company_and_department(req, only_active = true) {
  const department_id =
    req.body.department_id ||
    req.query.department_id ||
    req.params.department_id
  let company

  return Promise.try(() => {
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

    if (only_active) {
      return req.user.getCompany({
        scope: ['with_active_users', 'order_by_active_users']
      })
    } else {
      return req.user.getCompany({
        scope: ['with_all_users']
      })
    }
  })
    .then(c => {
      company = c

      if (!company) {
        throw new Error('Cannot determin company!')
      }

      return company.getDepartments({
        scope: ['with_simple_users', 'with_manager', 'with_supervisors'],
        where: {
          id: department_id
        }
      })
    })
    .then(departments => {
      const department = departments[0]

      // Ensure we have database record for given department ID
      if (!department) {
        throw new Error('Non existing department ID provided')
      }

      return Promise.resolve({
        company,
        department
      })
    })
}

router.get('/departments/edit/:department_id/', (req, res) => {
  const department_id = req.params.department_id
  console.log('editing department: '+ department_id)

  Promise.try(() => promise_to_extract_company_and_department(req))
    .then(result => {
      const department = result.department
      const company = result.company

      res.render('department_details', {
        title: 'Settings - Department details | TimeOff',
        department,
        company,
        allowance_options: generate_all_department_allowances(),
        personal_days_options: generate_department_personal_days()
      })
    })
    .catch(error => {
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
    })
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
router.post('/departments/edit/:department_id/', (req, res) => {
  const department_id = req.body.department_id
  let company
  let department

  Promise.try(() => promise_to_extract_company_and_department(req))
    .then(result => {
      company = result.company
      department = result.department

      // Update include_holiday and is_accrued from req.body
      department.include_holiday = req.body.include_holiday
      department.is_accrued = req.body.is_accrued

      return Promise.resolve(1)
    })

    .then(() => {
      if (req.body.remove_supervisor_id) {
        return promise_to_remove_supervisor({
          supervisor_id: req.body.remove_supervisor_id,
          company,
          department
        }).then(() => {
          req.session.flash_message(
            'Supervisor was removed from ' + department.name
          )
          return Promise.resolve(1)
        })
      } else if (req.body.do_add_supervisors) {
        return promise_to_update_supervisors({
          req,
          company,
          department
        }).then(() => {
          req.session.flash_message(
            'Supervisors were added to department ' + department.name
          )
          return Promise.resolve(1)
        })
      }

      return promise_to_update_department({
        req,
        company,
        department
      }).then(() => {
        req.session.flash_message(
          'Department ' + department.name + ' was updated'
        )
        return Promise.resolve(1)
      })
    })

    .then(() => res.redirect_with_session('.'))

    .catch(error => {
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
    })
})

function promise_to_remove_supervisor(args) {
  const supervisor_id = args.supervisor_id
  const company = args.company
  const department = args.department

  // Make sure that provided supervisor ID belongs to user from current company
  if (
    company.users.map(u => String(u.id)).indexOf(String(supervisor_id)) === -1
  ) {
    return Promise.resolve(1)
  }

  return department.Model.sequelize.models.DepartmentSupervisor.destroy({
    where: {
      department_id: department.id,
      user_id: supervisor_id
    }
  })
}

function promise_to_update_supervisors(args) {
  const req = args.req
  const company = args.company
  const department = args.department

  let supervisor_ids = req.supervisor_id || []

  // Take list of all users as a base of intersaction,
  // so we use submitted data only as criteria and do not save it in database
  supervisor_ids = company.users
    .map(user => user.id)
    .filter(id => supervisor_ids.indexOf(String(id)) !== -1)

  const link_model = department.Model.sequelize.models.DepartmentSupervisor

  return link_model
    .destroy({
      where: {
        department_id: department.id
      }
    })
    .then(() =>
      link_model.bulkCreate(
        supervisor_ids.map(id => ({
          user_id: id,
          department_id: department.id
        }))
      )
    )
}

function promise_to_update_department(args) {
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

  return department.update(attributes)
}

router.get('/departments/available-supervisors/:department_id/', (req, res) => {
  const department_id = req.params.department_id
  let department
  let company

  Promise.try(() => promise_to_extract_company_and_department(req))
    .then(result => {
      department = result.department
      company = result.company

      return department.promise_me_with_supervisors()
    })

    .then(department_with_supervisors => {
      const supervisor_map = {}

      department_with_supervisors.supervisors.forEach(user => {
        supervisor_map[user.id] = true
      })

      res.render('department/available_supervisors', {
        layout: false,
        users: _.map(
          _.filter(company.users, user => user.id !== department.manager_id),
          user => {
            user._marked = supervisor_map[user.id]
            return user
          }
        ),
        title: 'Settings - Department Available Supervisors | TimeOff'
      })
    })
    .catch(error => {
      console.error(
        'An error occurred when trying to get all availabele superviers for department ' +
          department_id +
          ' for user ' +
          req.user.id +
          ' : ' +
          error,
        error.stack
      )

      res.send('REQUEST FAILED')
    })
})

module.exports = router
