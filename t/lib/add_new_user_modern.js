'use strict'

const { By, until } = require('selenium-webdriver')
const expect = require('chai').expect
const _ = require('underscore')
const { v4: uuidv4 } = require('uuid')
const submit_form_func = require('./submit_form_modern')
const build_driver = require('./build_driver')
const add_new_user_form_id = '#add_new_user_form'

async function add_new_user_func(args) {
  const application_host = args.application_host
  const department_index = args.department_index
  // optional parameter, if provided the user adding action is expected to fail
  // with that error
  const error_message = args.error_message
  const driver = args.driver || build_driver()

  const random_token = new Date().getTime()
  const new_user_email = args.email || random_token + '@test.com'

  try {
    // Open front page
    await driver.get(application_host + 'users/add/')
    await driver.wait(until.elementLocated(By.css('#add_new_user_form')), 10000)

    let select_department = {}
    if (typeof department_index !== 'undefined') {
      select_department = {
        selector: 'select[name="department"]',
        option_selector: 'option[data-vpp="' + department_index + '"]'
      }
    }

    await submit_form_func({
      driver,
      form_params: [
        {
          selector: add_new_user_form_id + ' input[name="name"]',
          value: 'name' + random_token
        },
        {
          selector: add_new_user_form_id + ' input[name="lastname"]',
          value: 'lastname' + random_token
        },
        {
          selector: add_new_user_form_id + ' input[name="email_address"]',
          value: new_user_email
        },
        {
          selector: add_new_user_form_id + ' input[name="password_one"]',
          value: '123456'
        },
        {
          selector: add_new_user_form_id + ' input[name="password_confirm"]',
          value: '123456'
        },
        select_department,
        {
          selector: add_new_user_form_id + ' input[name="start_date"]',
          value: '2015-06-01'
        }
      ],
      submit_button_selector: add_new_user_form_id + ' #add_new_user_btn',
      should_be_successful: !error_message,
      elements_to_check: [],
      message: error_message
        ? new RegExp(error_message)
        : /New user account successfully added/
    })

    // "export"
    return {
      driver,
      new_user_email
    }
  } catch (error) {
    console.error('Error in add_new_user_func:', error.message)
    throw error
  }
}

module.exports = add_new_user_func