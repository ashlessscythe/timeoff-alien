'use strict'

const Bluebird = require('bluebird')
const { Audit } = require('../prisma/models')

const getAuditCaptureForUser = ({ byUser, forUser, newAttributes }) => () => {
  const attributeUpdates = Object.keys(newAttributes)
    .filter(k => String(newAttributes[k]) !== String(forUser[k]))
    .map(attribute =>
      Audit.create({
        company_id: byUser.company_id,
        by_user_id: byUser.id,
        entity_type: 'USER',
        entity_id: forUser.id,
        attribute,
        old_value: String(forUser[attribute]),
        new_value: String(newAttributes[attribute])
      })
    )

  return Bluebird.map(attributeUpdates, f => f, { concurrency: 5 })
}

const getAudit = ({ company_id }) =>
  Audit.findAll({
    where: {
      company_id
    }
  })

module.exports = {
  getAuditCaptureForUser,
  getAudit
}
