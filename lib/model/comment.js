'use strict'

const Bluebird = require('bluebird')
const prisma = require('./db/prisma')

const ENTITY_TYPE_LEAVE = 'Leave'

const commentLeave = ({ leave, comment, company_id }) =>
  prisma.comments.create({
    data: {
      entity_type: ENTITY_TYPE_LEAVE,
      entity_id: leave.id,
      comment,
      company_id,
      by_user_id: leave.user_id
    }
  })

const getCommentsForLeave = ({ leave }) =>
  prisma.comments.findMany({
    where: {
      entity_type: ENTITY_TYPE_LEAVE,
      entity_id: leave.id
    }
  })

module.exports = {
  commentLeave,
  getCommentsForLeave
}
