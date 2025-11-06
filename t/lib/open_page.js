'use strict'

module.exports = async ({ url, driver }) => {
  await driver.get(url)
  return { driver }
}
