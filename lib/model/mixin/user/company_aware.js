'use strict'

const Promise = require('bluebird')
const moment = require('moment')
const prisma = require('../../db/prisma')
const { sorter } = require('../../../util')

// These methods will be added to the User class
const CompanyAwareMixin = {
  async promise_supervisors() {
    const department = await prisma.departments.findUnique({
      where: { id: this.department_id },
      include: {
        users: {
          where: {
            OR: [
              { manager: true },
              { admin: true }
            ]
          }
        }
      }
    })
    return department?.users || []
  },

  async get_company_for_user_details({ user_id, year }) {
    year = year || moment.utc()
    const yearStart = moment
      .utc()
      .startOf('year')
      .toDate()
    const yearEnd = moment
      .utc()
      .endOf('year')
      .toDate()

    const company = await prisma.companies.findFirst({
      where: {
        id: this.company_id,
        users: {
          some: {
            id: user_id
          }
        }
      },
      include: {
        users: {
          where: {
            id: user_id
          },
          include: {
            my_leaves: {
              where: {
                OR: [
                  {
                    date_start: {
                      gte: yearStart,
                      lte: yearEnd
                    }
                  },
                  {
                    date_end: {
                      gte: yearStart,
                      lte: yearEnd
                    }
                  }
                ]
              },
              include: {
                leave_type: true,
                users_leaves_user_idTousers: {
                  include: {
                    companies: {
                      include: {
                        bank_holidays: true
                      }
                    }
                  }
                }
              }
            },
            departments: true
          }
        },
        departments: {
          include: {
            users: {
              where: {
                manager: true
              }
            }
          },
          orderBy: {
            name: 'asc'
          }
        }
      }
    })

    if (!company || company.users.length !== 1) {
      throw new Error(
        `User ${this.id
        } tried to edit user ${user_id} but they do not share a company`
      )
    }

    return company
  },

  async get_company_for_add_user() {
    return prisma.companies.findUnique({
      where: {
        id: this.company_id
      },
      include: {
        departments: {
          orderBy: {
            name: 'asc'
          }
        }
      }
    })
  },

  async get_company_with_all_leave_types() {
    return prisma.companies.findUnique({
      where: {
        id: this.company_id
      },
      include: {
        leave_types: {
          orderBy: [
            {
              sort_order: 'desc'
            },
            {
              name: 'asc'
            }
          ]
        }
      }
    })
  }
}

module.exports = CompanyAwareMixin
