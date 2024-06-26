'use strict'

const test = require('selenium-webdriver/testing')
const By = require('selenium-webdriver').By
const expect = require('chai').expect
const _ = require('underscore')
const moment = require('moment')
const Promise = require('bluebird')
const until = require('selenium-webdriver').until
const register_new_user_func = require('../../lib/register_new_user')
const login_user_func = require('../../lib/login_with_user')
const open_page_func = require('../../lib/open_page')
const submit_form_func = require('../../lib/submit_form')
const add_new_user_func = require('../../lib/add_new_user')
const logout_user_func = require('../../lib/logout_user')
const check_booking_func = require('../../lib/check_booking_on_calendar')
const check_elements_func = require('../../lib/check_elements')
const config = require('../../lib/config')
const application_host = config.get_application_host()
const department_edit_form_id = '#department_edit_form'
const currentYear = moment.utc().year()

/*
 *  Scenario to check:
 *    * Add MANAGER_A
 *    * Add MANAGER_B
 *    * Add EMPLOYEE
 *    * Make sure department has MANAGER_A as a supervisor
 *    * Login as a EMPLOYEE
 *    * Book a leave request
 *    * Login as MANAGER_A and approve leave request
 *    * Login as ADMIN and change supervisor to be MANAGER_B
 *    * Login as an EMPLOYEE and revoke leave request
 *
 *    * Login as a MANAGER_B and make sure that there is
 *      a revoke request to process
 *    * Approve revoke request and make sure that EMPLOYEE
 *    does not have leave any more
 *
 * */

describe('Revoke leave request', function() {
  this.timeout(config.get_execution_timeout())

  let email_admin,
    admin_user_id,
    email_manager_a,
    manager_a_user_id,
    email_manager_b,
    manager_b_user_id,
    email_employee,
    employee_user_id,
    driver

  it('Create new company', function(done) {
    register_new_user_func({
      application_host
    }).then(function(data) {
      driver = data.driver
      email_admin = data.email
      done()
    })
  })

  it('Create MANAGER_A-to-be user', function(done) {
    add_new_user_func({
      application_host,
      driver
    }).then(function(data) {
      email_manager_a = data.new_user_email
      done()
    })
  })

  it('Create MANAGER_A-to-be user', function(done) {
    add_new_user_func({
      application_host,
      driver
    }).then(function(data) {
      email_manager_b = data.new_user_email
      done()
    })
  })

  it('Create EMPLOYEE-to-be user', function(done) {
    add_new_user_func({
      application_host,
      driver
    }).then(function(data) {
      email_employee = data.new_user_email
      done()
    })
  })

  it('Open department management page', function(done) {
    open_page_func({
      url: application_host + 'settings/departments/',
      driver
    }).then(function() {
      done()
    })
  })

  it('Update department to be supervised by MANAGER_A', function(done) {
    open_page_func({
      url: application_host + 'settings/departments/',
      driver
    })
      .then(() =>
        driver
          .findElements(By.css('a[href*="/settings/departments/edit/"]'))
          .then(links => links[0].click())
      )
      .then(() =>
        submit_form_func({
          driver,
          form_params: [
            {
              selector: 'input[name="name"]',
              // Just to make sure it is always first in the lists
              value: 'AAAAA'
            },
            {
              selector: 'select[name="allowance"]',
              option_selector: 'option[value="15"]',
              value: '15'
            },
            {
              selector: 'select[name="manager_id"]',
              option_selector: 'select[name="manager_id"] option:nth-child(2)'
            }
          ],
          submit_button_selector:
            department_edit_form_id + ' button[type="submit"]',
          message: /Department .* was updated/
        })
      )
      .then(() => done())
  })

  it('Logout from admin account', function(done) {
    logout_user_func({
      application_host,
      driver
    }).then(function() {
      done()
    })
  })

  it('Login as EMPLOYEE user', function(done) {
    login_user_func({
      application_host,
      user_email: email_employee,
      driver
    }).then(function() {
      done()
    })
  })

  it('Open calendar page', function(done) {
    open_page_func({
      url: application_host + 'calendar/?show_full_year=1',
      driver
    }).then(function() {
      done()
    })
  })

  it('And make sure that it is calendar indeed', function(done) {
    driver.getTitle().then(function(title) {
      expect(title).to.be.equal('Calendar')
      done()
    })
  })

  it('Request new leave', function(done) {
    driver
      .findElement(By.css('#book_time_off_btn'))
      .then(function(el) {
        return el.click()
      })
      .then(function() {
        // This is very important line when working with Bootstrap modals!
        driver.sleep(1000)

        submit_form_func({
          driver,
          // The order matters here as we need to populate dropdown prior date filds
          form_params: [
            {
              selector: 'select[name="from_date_part"]',
              option_selector: 'option[value="2"]',
              value: '2'
            },
            {
              selector: 'input#from',
              value: `${currentYear}-05-11`
            },
            {
              selector: 'input#to',
              value: `${currentYear}-05-12`
            }
          ],
          message: /New leave request was added/
        }).then(function() {
          done()
        })
      })
  })

  it('Check that all days are marked as pended', function(done) {
    check_booking_func({
      driver,
      full_days: [moment.utc(`${currentYear}-05-12`)],
      halfs_1st_days: [moment.utc(`${currentYear}-05-11`)],
      type: 'pended'
    }).then(function() {
      done()
    })
  })

  it('Logout from EMPLOYEE account', function(done) {
    logout_user_func({
      application_host,
      driver
    }).then(function() {
      done()
    })
  })

  it('Login as MANAGER_A user', function(done) {
    login_user_func({
      application_host,
      user_email: email_manager_a,
      driver
    }).then(function() {
      done()
    })
  })

  it('Open requests page', function(done) {
    open_page_func({
      url: application_host + 'requests/',
      driver
    }).then(function() {
      done()
    })
  })

  it('Make sure that newly created request is waiting for approval', function(done) {
    check_elements_func({
      driver,
      elements_to_check: [
        {
          selector:
            'tr[vpp="pending_for__' + email_employee + '"] .btn-warning',
          value: 'Reject'
        }
      ]
    }).then(function() {
      done()
    })
  })

  it('Approve newly added leave request', function(done) {
    driver
      .findElement(
        By.css('tr[vpp="pending_for__' + email_employee + '"] .btn-success')
      )
      .then(function(el) {
        return el.click()
      })
      .then(function() {
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000)
      })
      .then(function() {
        done()
      })
  })

  it('Logout from MANAGER_A account', function(done) {
    logout_user_func({
      application_host,
      driver
    }).then(function() {
      done()
    })
  })

  it('Login as ADMIN user', function(done) {
    login_user_func({
      application_host,
      user_email: email_admin,
      driver
    }).then(function() {
      done()
    })
  })

  it('Open department management page', function(done) {
    open_page_func({
      url: application_host + 'settings/departments/',
      driver
    }).then(function() {
      done()
    })
  })

  it('Update department to be supervised by MANAGER_B', function(done) {
    open_page_func({
      url: application_host + 'settings/departments/',
      driver
    })
      .then(() =>
        driver
          .findElements(By.css('a[href*="/settings/departments/edit/"]'))
          .then(links => links[0].click())
      )
      .then(() =>
        submit_form_func({
          driver,
          form_params: [
            {
              selector: 'input[name="name"]',
              // Just to make sure it is always first in the lists
              value: 'AAAAA'
            },
            {
              selector: 'select[name="allowance"]',
              option_selector: 'option[value="15"]',
              value: '15'
            },
            {
              selector: 'select[name="manager_id"]',
              option_selector: 'select[name="manager_id"] option:nth-child(3)'
            }
          ],
          submit_button_selector:
            department_edit_form_id + ' button[type="submit"]',
          message: /Department .* was updated/
        })
      )
      .then(() => done())
  })

  it('Logout from admin account', function(done) {
    logout_user_func({
      application_host,
      driver
    }).then(function() {
      done()
    })
  })

  it('Login as EMPLOYEE user', function(done) {
    login_user_func({
      application_host,
      user_email: email_employee,
      driver
    }).then(function() {
      done()
    })
  })

  it('Open requests page', function(done) {
    open_page_func({
      url: application_host + 'requests/',
      driver
    }).then(function() {
      done()
    })
  })

  it('Revoke request', function(done) {
    driver
      .findElement(By.css('button.revoke-btn'))
      .then(function(el) {
        return el.click()
      })
      .then(function() {
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000)
      })
      .then(function() {
        done()
      })
  })

  it('Logout from EMPLOYEE account', function(done) {
    logout_user_func({
      application_host,
      driver
    }).then(function() {
      done()
    })
  })

  it('Login as MANAGER_B user', function(done) {
    login_user_func({
      application_host,
      user_email: email_manager_b,
      driver
    }).then(function() {
      done()
    })
  })

  it('Open requests page', function(done) {
    open_page_func({
      url: application_host + 'requests/',
      driver
    }).then(function() {
      done()
    })
  })

  it('Make sure newly revoked request is shown for approval', function(done) {
    check_elements_func({
      driver,
      elements_to_check: [
        {
          selector:
            'tr[vpp="pending_for__' + email_employee + '"] .btn-warning',
          value: 'Reject'
        }
      ]
    }).then(function() {
      done()
    })
  })

  it('Approve revoke request', function(done) {
    driver
      .findElement(
        By.css('tr[vpp="pending_for__' + email_employee + '"] .btn-success')
      )
      .then(function(el) {
        return el.click()
      })
      .then(function() {
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000)
      })
      .then(function() {
        done()
      })
  })

  after(function(done) {
    driver.quit().then(function() {
      done()
    })
  })
})
