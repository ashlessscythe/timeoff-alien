'use strict'

const { By, Key, until } = require('selenium-webdriver')
const expect = require('chai').expect
const _ = require('underscore')
const check_elements = require('./check_elements')

async function submit_form_func(args) {
  let driver = args.driver
  // Regex to check the message that is shown after form is submitted
  const message = args.message || /.*/
  // Array of object that have at least two keys: selector - css selector
  // and value - value to be entered
  const form_params = args.form_params || []
  // Defined how elements are going to be checked in case of success,
  // if that parameter is omitted - 'form_params' is used instead
  const elements_to_check = args.elements_to_check || form_params
  // Indicates whether form submission is going to be successful
  const should_be_successful = args.should_be_successful || false
  // Indicate if message to be searched through all messages shown,
  // by default it looks into first message only
  const multi_line_message = args.multi_line_message || false
  // Indicates if there is a confirmation dialog
  const confirm_dialog = args.confirm_dialog || false
  // CSS selector for form submission button
  const submit_button_selector =
    args.submit_button_selector || 'button[type="submit"]'

  try {
    // Enter form parameters
    for (const test_case of form_params) {
      // Handle case when test case is empty
      if (Object.keys(test_case).length === 0) {
        continue
      }

      const el = await driver.findElement(By.css(test_case.selector))

      if (test_case.hasOwnProperty('option_selector')) {
        await el.click()
        const optionEl = await el.findElement(By.css(test_case.option_selector))
        await optionEl.click()
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

    await driver.wait(until.elementLocated(By.css('title')), 10000)

    // TODO this is not doing what it supposed to be doing
    if (should_be_successful) {
      const data = await check_elements({
        driver,
        elements_to_check
      })
      driver = data.driver
    }

    // Check that message is as expected
    if (multi_line_message) {
      const els = await driver.findElements(By.css('div.alert'))
      const texts = await Promise.all(
        els.map(el => el.getText())
      )

      expect(
        _.any(texts, function (text) {
          return message.test(text)
        })
      ).to.be.equal(true)
    } else {
      const alertElement = await driver.findElement(By.css('div.alert'))
      const text = await alertElement.getText()
      expect(text).to.match(message)
    }

    // "export" current driver
    return {
      driver
    }
  } catch (error) {
    console.error('Error in submit_form_func:', error.message)
    throw error
  }
}

module.exports = submit_form_func