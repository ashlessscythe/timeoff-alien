'use strict'

const By = require('selenium-webdriver').By
const expect = require('chai').expect
const until = require('selenium-webdriver').until

const logout_user_func = async function(args) {
  const application_host = args.application_host
  const driver = args.driver
  const logout_link_css_selector =
    'li.hidden-xs > ul.dropdown-menu li > a[href="/logout/"]'

  // Open front page
  await driver.get(application_host)

  // Click on user menu
  const meMenu = await driver.findElement(By.css('a#me_menu'))
  await meMenu.click()

  // Make sure that Logout link exists
  const logoutLinks = await driver.findElements(By.css(logout_link_css_selector))
  expect(logoutLinks.length > 0).to.be.equal(true)

  // Click logout link
  const logoutLink = await driver.findElement(By.css(logout_link_css_selector))
  await logoutLink.click()
  await driver.wait(until.elementLocated(By.css('body')), 1000)

  // Check that there is no more Logout link
  const logoutLinksAfter = await driver.findElements(By.css(logout_link_css_selector))
  expect(logoutLinksAfter.length > 0).to.be.equal(false)

  return { driver }
}

module.exports = logout_user_func
