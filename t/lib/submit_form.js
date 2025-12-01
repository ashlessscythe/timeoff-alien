'use strict'

const webdriver = require('selenium-webdriver')
const By = require('selenium-webdriver').By
const Key = require('selenium-webdriver').Key
const expect = require('chai').expect
const until = require('selenium-webdriver').until
const check_elements = require('./check_elements')

const submit_form_func = async function(args) {
  let driver = args.driver
  // Regex to check the message that is shown after form is submitted
  const message = args.message || /.*/
  // Array of object that have at least two keys: selector - css selector
  // and value - value to be entered
  const form_params = args.form_params || []
  // Defined how elemts are going to be checked in case of success,
  // if that parameter is omitted - 'form_params' is used instead
  const elements_to_check = args.elements_to_check || form_params
  // Indicates whether form submission is going to be successful
  const should_be_successful = args.should_be_successful || false
  // Indicate if message to be searched through all messages shown,
  // bu defaul it looks into firts message only
  const multi_line_message = args.multi_line_message || false
  // Indicates if there is a confirmation dialog
  const confirm_dialog = args.confirm_dialog || false
  // CSS selecetor for form submition button
  const submit_button_selector =
    args.submit_button_selector || 'button[type="submit"]'

  // Enter form parameters
  for (const test_case of form_params) {
    // Handle case when test case is empty
    if (Object.keys(test_case).length === 0) {
      continue
    }

    const el = await driver.findElement(By.css(test_case.selector))
    
    if (test_case.hasOwnProperty('option_selector')) {
      await el.click()
      const option = await el.findElement(By.css(test_case.option_selector))
      await option.click()
    } else if (test_case.hasOwnProperty('tick')) {
      await el.click()
    } else if (test_case.file) {
      await el.sendKeys(test_case.value)
    } else if (test_case.hasOwnProperty('dropdown_option')) {
      await el.click()
      const dd = await driver.findElement(By.css(test_case.dropdown_option))
      await dd.click()
    } else {
      // Prevent the browser validations to allow backend validations to occur
      if (test_case.change_step) {
        await driver.executeScript("return arguments[0].step = '0.1'", el)
      }

      await el.clear()
      await el.sendKeys(test_case.value)
      // Tabs to trigger the calendars overlays
      // to close so the modal submit button can be clicked
      await el.sendKeys(Key.TAB)
    }
  }

  // Accept the confirm dialog
  if (confirm_dialog) {
    await driver.executeScript('window.confirm = function(msg) { return true; }')
  }

  // Submit the form
  const submitButton = await driver.findElement(By.css(submit_button_selector))
  await submitButton.click()
  await driver.wait(until.elementLocated(By.css('title')), 1000)

  // TODO this is not doing what it supposed to be doing
  if (should_be_successful) {
    const result = await check_elements({
      driver,
      elements_to_check
    })
    driver = result.driver
  }

  // Check that message is as expected
  if (multi_line_message) {
    const els = await driver.findElements(By.css('div.alert'))
    const texts = await Promise.all(els.map(el => el.getText()))
    const hasMatch = texts.some(text => message.test(text))
    expect(hasMatch).to.be.equal(true)
  } else {
    const alertDiv = await driver.findElement(By.css('div.alert'))
    const text = await alertDiv.getText()
    expect(text).to.match(message)
  }

  return { driver }
}

module.exports = submit_form_func
