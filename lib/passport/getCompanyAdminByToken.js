'use strict'

const { throwUserError } = require('../error')
const Promise = require('bluebird')

module.exports = async ({ token, prisma }) => {
  if (!token) {
    throwUserError({
      system_error: 'Provided token has FALSY value',
      user_error: 'Wrong access token'
    })
  }

  // Find company with admin users
  const company = await prisma.companies.findFirst({
    where: {
      integration_api_token: token
    },
    include: {
      users: {
        where: {
          admin: true
        }
      }
    }
  })

  if (!company) {
    throwUserError({
      system_error: `Cannot find company record for provided token ${token}`,
      user_error: 'Wrong access token'
    })
  }

  if (!company.users || company.users.length === 0) {
    throwUserError({
      system_error: `Failed to find admin users for company ${company.id}`,
      user_error: 'Wrong access token'
    })
  }

  // Get first admin user
  const adminUser = company.users[0]

  // Add company to user object to maintain compatibility
  adminUser.company = company
  delete company.users

  // Add required methods
  adminUser.reload_with_session_details = async () => adminUser
  adminUser.maybe_activate = async () => adminUser
  adminUser.is_admin = () => adminUser.admin

  return adminUser
}
