'use strict'

const Models = require('./db')

const getAuditCaptureForUser = ({ byUser, forUser, newAttributes }) => () => {
  const changedKeys = Object.keys(newAttributes).filter(
    k => String(newAttributes[k]) !== String(forUser[k])
  )

  return Promise.all(
    changedKeys.map(attribute =>
      Models.Audit.create({
        company_id: byUser.company_id,
        by_user_id: byUser.id,
        entity_type: 'USER',
        entity_id: forUser.id,
        attribute,
        old_value: String(forUser[attribute]),
        new_value: String(newAttributes[attribute])
      })
    )
  )
}

const getAudit = ({ company_id }) =>
  Models.Audit.findAll({
    where: {
      company_id
    },
    raw: true
  })

module.exports = {
  getAuditCaptureForUser,
  getAudit
}
