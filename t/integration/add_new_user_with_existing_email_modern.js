'use strict'

const register_new_user_func = require('../lib/register_new_user_modern')
const add_new_user_func = require('../lib/add_new_user_modern')
const config = require('../lib/config')
const application_host = config.get_application_host()

/*
 *  Scenario to check in this test:
 *
 *  * Create an account and get a note of email
 *  * Try to add user with the same email
 *
 * */

describe('Admin tries to add user with email used for other one', function () {
  this.timeout(config.get_execution_timeout())

  let new_user_email, driver

  it('Create new company', async function () {
    try {
      const data = await register_new_user_func({
        application_host
      })
      driver = data.driver
      new_user_email = data.email
    } catch (error) {
      console.error('Error creating company:', error.message)
      throw error
    }
  })

  it('Create new non-admin user', async function () {
    try {
      await add_new_user_func({
        application_host,
        driver,
        email: new_user_email,
        error_message: 'Email is already in use'
      })
    } catch (error) {
      console.error('Error adding user:', error.message)
      throw error
    }
  })

  after(async function () {
    if (driver) {
      try {
        await driver.quit()
      } catch (err) {
        console.log('Error quitting driver:', err.message)
      }
    }
  })
})