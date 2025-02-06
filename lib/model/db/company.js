'use strict'

const moment = require('moment-timezone')
const { prisma } = require('./prisma')

const Company = {
  // Add custom methods
  get_today() {
    const timezone = this.timezone || 'UTC'
    return moment().tz(timezone)
  },

  getToday(company) {
    if (!company) {
      return moment.utc()
    }
    const timezone = company.timezone || 'UTC'
    return moment().tz(timezone)
  },

  get_default_date_format() {
    return this.date_format || 'YYYY-MM-DD'
  }
}

// Add Prisma model methods
Object.assign(Company, prisma.company)

module.exports = Company
