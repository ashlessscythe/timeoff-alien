'use strict'

const Bluebird = require('bluebird')
const prisma = require('./db/prisma')

const getAuditCaptureForUser = ({ byUser, forUser, newAttributes }) => async () => {
  const attributeUpdates = Object.keys(newAttributes)
    .filter(k => String(newAttributes[k]) !== String(forUser[k]))
    .map(attribute => ({
      company_id: byUser.company_id,
      by_user_id: byUser.id,
      entity_type: 'USER',
      entity_id: forUser.id,
      attribute,
      old_value: String(forUser[attribute]),
      new_value: String(newAttributes[attribute])
    }))

  // Use Prisma's createMany for better performance
  return prisma.audit.createMany({
    data: attributeUpdates
  })
}

const getAudit = ({ company_id }) =>
  prisma.audit.findMany({
    where: {
      company_id
    }
  })

module.exports = {
  getAuditCaptureForUser,
  getAudit
}
