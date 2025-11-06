/*

*/

'use strict'

const By = require('selenium-webdriver').By
const until = require('selenium-webdriver').until
const expect = require('chai').expect
const open_page_func = require('./open_page')
const build_driver = require('./build_driver')
const company_edit_form_id = '#company_edit_form'
const submit_form_func = require('./submit_form')

const register_new_user_func = async function(args) {
  const application_host = args.application_host || args.applicationHost
  const failing_error_message = args.failing_error_message
  const default_date_format = args.default_date_format
  const random_token = new Date().getTime()
  const new_user_email = args.user_email || random_token + '@test.com'

  // Instantiate new driver object if it not provided as paramater
  const driver = args.driver || build_driver()

  // Go to front page
  await driver.get(application_host)
  await driver.wait(until.elementLocated(By.css('h1')), 1000)

  // Check if there is a registration link
  const registerLink = await driver.findElement(By.css('a[href="/register/"]'))
  const linkText = await registerLink.getText()
  expect(linkText).to.match(/Register new company/i)

  // Click on registration link
  await registerLink.click()
  await driver.wait(until.elementLocated(By.css('h1')), 1000)

  // Make sure that new page is a registration page
  const h1 = await driver.findElement(By.css('h1'))
  const h1Text = await h1.getText()
  expect(h1Text).to.be.equal('New company')

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
        value: '123456789012'
      },
      {
        selector: 'input[name="password_confirmed"]',
        value: '123456789012'
      },
      {
        selector: 'select[name="country"]',
        option_selector: 'option[value="US"]'
      }
    ],
    submit_button_selector: '#submit_registration'
  })

  await driver.wait(until.elementLocated(By.css('div')), 5000)

  if (failing_error_message) {
    const errorDiv = await driver.findElement(By.css('div.alert-danger'))
    const errorText = await errorDiv.getText()
    expect(errorText).to.be.equal(failing_error_message)
  } else {
    // Make sure registration completed successfully
    const successDiv = await driver.findElement(By.css('div.alert-success'))
    const successText = await successDiv.getText()
    expect(successText).to.be.equal('Registration is complete.')
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
}

module.exports = register_new_user_func
