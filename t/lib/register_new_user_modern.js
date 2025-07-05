'use strict'

const { By, until } = require('selenium-webdriver')
const expect = require('chai').expect
const open_page_func = require('./open_page')
const build_driver = require('./build_driver')
const company_edit_form_id = '#company_edit_form'
const submit_form_func = require('./submit_form_modern')

async function register_new_user_func(args) {
  const application_host = args.application_host || args.applicationHost
  const failing_error_message = args.failing_error_message
  const default_date_format = args.default_date_format
  const random_token = new Date().getTime()
  const new_user_email = args.user_email || random_token + '@test.com'

  // Instantiate new driver object if it not provided as parameter
  const driver = args.driver || build_driver()

  try {
    // Go to front page
    await driver.get(application_host)
    await driver.wait(until.elementLocated(By.css('h1')), 10000)

    // Check if there is a registration link
    const registerLink = await driver.findElement(By.css('a[href="/register/"]'))
    const linkText = await registerLink.getText()
    expect(linkText).to.match(/Register new company/i)

    // Click on registration link
    await registerLink.click()
    await driver.wait(until.elementLocated(By.css('h1')), 10000)

    // Make sure that new page is a registration page
    const h1Element = await driver.findElement(By.css('h1'))
    const pageTitle = await h1Element.getText()
    expect(pageTitle).to.be.equal('New company')

    // Submit registration form
    await submit_form_func({
      driver,
      form_params: [
        {
          selector: 'input[name="company_name"]',
          value: 'Company ' + new Date().getTime()
        },
        {
          selector: 'input[name="name"]',
          value: 'name' + random_token
        },
        {
          selector: 'input[name="lastname"]',
          value: 'lastname' + random_token
        },
        {
          selector: 'input[name="email"]',
          value: new_user_email
        },
        {
          selector: 'input[name="password"]',
          value: '123456'
        },
        {
          selector: 'input[name="password_confirmed"]',
          value: '123456'
        },
        {
          selector: 'select[name="country"]',
          option_selector: 'option[value="US"]'
        }
      ],
      submit_button_selector: '#submit_registration'
    })

    await driver.wait(until.elementLocated(By.css('div')), 10000)

    if (failing_error_message) {
      const errorElement = await driver.findElement(By.css('div.alert-danger'))
      const errorText = await errorElement.getText()
      expect(errorText).to.be.equal(failing_error_message)
    } else {
      // Make sure registration completed successfully
      const alertElement = await driver.findElement(By.css('div.alert'))
      const alertText = await alertElement.getText()
      console.log('Registration alert text:', alertText)
      expect(alertText).to.match(/Registration is complete\.?/i)
    }

    if (default_date_format) {
      // open company general configuration page and set the default format to be as requested
      await open_page_func({
        url: application_host + 'settings/general/',
        driver
      })

      // update company to use provided date format as a default
      await submit_form_func({
        driver,
        form_params: [
          {
            selector: company_edit_form_id + ' select[name="date_format"]',
            option_selector: 'option[value="' + default_date_format + '"]',
            value: default_date_format
          }
        ],
        submit_button_selector: company_edit_form_id + ' button[type="submit"]',
        message: /successfully/i,
        should_be_successful: true
      })
    }

    // Pass data back to the caller
    await driver.get(application_host)

    return {
      driver,
      email: new_user_email
    }
  } catch (error) {
    console.error('Error in register_new_user_func:', error.message)
    throw error
  }
}

module.exports = register_new_user_func