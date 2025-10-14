'use strict'

const { throwUserError } = require('../error')
const Promise = require('bluebird')

const prisma = require('../prisma/client')

module.exports = ({ token, User }) => {
  if (!token) {
    throwUserError({
      system_error: 'Provided token has FALSY value',
      user_error: 'Wrong access token'
    })
  }

  let action = prisma.companies.findFirst({
    where: { integration_api_token: token },
    include: {
      users: {
        where: { admin: true }
      }
    }
  })

  action = action.then(company => {
    if (!company) {
      throwUserError({
        system_error: `Cannot find company record for provided token ${token}`,
        user_error: 'Wrong access token'
      })
    }

    const adminUser = company.users[0]

    if (!adminUser) {
      throwUserError({
        system_error: `Failed to find admin users for company ${company.id}`,
        user_error: 'Wrong access token'
      })
    }

    return Promise.resolve(new (require('../prisma/models').PrismaUser)(adminUser))
  })

  return action
}
