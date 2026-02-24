'use strict'

const By = require('selenium-webdriver').By
const expect = require('chai').expect
const until = require('selenium-webdriver').until
const build_driver = require('./build_driver')

const login_with_user_func = async function(args) {
  const application_host = args.application_host
  const user_email = args.user_email
  const password = args.password || '123456789012'
  const should_fail = args.should_fail || false

  // Create new instance of driver
  const driver = args.driver || build_driver()

  // Make sure we are in desktop version
  await driver
    .manage()
    .window()
    .setSize(1024, 768)

  // Open front page
  await driver.get(application_host)
  await driver.wait(until.elementLocated(By.css('h1')), 1000)

  // Check that there is a login button
  const loginLink = await driver.findElement(By.css('a[href="/login/"]'))
  const loginLinkText = await loginLink.getText()
  expect(loginLinkText).to.be.equal('Login')

  // Click on Login button
  await loginLink.click()
  await driver.wait(until.elementLocated(By.css('h1')), 1000)

  // Check that it is actually login page
  const h1 = await driver.findElement(By.css('h1'))
  const h1Text = await h1.getText()
  expect(h1Text).to.be.equal('Login')

  // Fill login form
  const usernameInput = await driver.findElement(
    By.css('input[name="username"]')
  )
  await usernameInput.sendKeys(user_email)

  const passwordInput = await driver.findElement(
    By.css('input[name="password"]')
  )
  await passwordInput.sendKeys(password)

  // Submit login button
  const submitButton = await driver.findElement(By.css('#submit_login'))
  await submitButton.click()

  if (should_fail) {
    const errorDiv = await driver.findElement(By.css('div.alert-danger'))
    const errorText = await errorDiv.getText()
    expect(errorText).to.match(/Incorrect credentials/)
  } else {
    await driver.wait(until.elementLocated(By.css('div.alert-success')), 1000)

    // Make sure login was successful, check that we landed on user account page
    const title = await driver.getTitle()
    expect(title).to.match(/Calendar/)

    const successDiv = await driver.findElement(By.css('div.alert-success'))
    const successText = await successDiv.getText()
    expect(successText).to.match(/Welcome back/)
  }

  // Go back to the front page and pass data to the caller
  await driver.get(application_host)
  return { driver }
}

module.exports = login_with_user_func
