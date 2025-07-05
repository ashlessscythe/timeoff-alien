const webdriver = require('selenium-webdriver')
const chrome = require('selenium-webdriver/chrome')
const firefox = require('selenium-webdriver/firefox')

module.exports = function () {
  // Default to Chrome, but allow Firefox if specified
  const browser = process.env.USE_FIREFOX ? 'firefox' : 'chrome'

  if (browser === 'firefox') {
    const options = new firefox.Options()
    if (!process.env.SHOW_BROWSER) {
      options.headless()
    }

    return new webdriver.Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .build()
  }

  const options = new chrome.Options()
  if (!process.env.SHOW_BROWSER) {
    options.addArguments('headless')
    options.addArguments('disable-gpu')
    options.addArguments('no-sandbox')
    options.addArguments('disable-dev-shm-usage')
  }

  return new webdriver.Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build()
}
