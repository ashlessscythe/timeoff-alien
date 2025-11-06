'use strict'

const webdriver = require('selenium-webdriver')
const By = require('selenium-webdriver').By
const expect = require('chai').expect

const check_booking_func = async function(args) {
  const driver = args.driver
  const type = args.type
  const full_days = args.full_days
  const halfs_1st_days = args.halfs_1st_days || []
  const halfs_2nd_days = args.halfs_2nd_days || []
  let type_css_re

  if (type === 'pended') {
    type_css_re = /\bleave_cell_pended\b/
  } else if (type === 'approved') {
    type_css_re = /\bleave_cell\b/
  } else {
    throw new Error('Mandatory type parameter was not provided')
  }

  const options = [
    { days: full_days, halfs: ['half_1st', 'half_2nd'] },
    { days: halfs_1st_days, halfs: ['half_1st'] },
    { days: halfs_2nd_days, halfs: ['half_2nd'] }
  ]

  for (const option of options) {
    for (const day of option.days) {
      for (const half of option.halfs) {
        const selector =
          'table.month_' +
          day.format('MMMM') +
          ' td.day_' +
          day.format('D') +
          '.' +
          half

        const el = await driver.findElement(By.css(selector))
        const css = await el.getAttribute('class')
        expect(css).to.match(type_css_re)
      }
    }
  }

  return { driver }
}

module.exports = check_booking_func
