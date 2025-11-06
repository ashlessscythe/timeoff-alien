'use strict'

const webdriver = require('selenium-webdriver')
const By = require('selenium-webdriver').By
const expect = require('chai').expect

const check_elements_func = async function(args) {
  const driver = args.driver
  const elements_to_check = args.elements_to_check || []

  for (const test_case of elements_to_check) {
    const el = await driver.findElement(By.css(test_case.selector))
    
    let text
    if (test_case.hasOwnProperty('tick')) {
      const isSelected = await el.isSelected()
      text = isSelected ? 'on' : 'off'
    } else {
      text = await el.getAttribute('value')
    }
    
    expect(text).to.be.equal(test_case.value)
  }

  return { driver }
}

module.exports = check_elements_func
