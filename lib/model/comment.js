'use strict'

const Bluebird = require('bluebird')
const { Comment } = require('../prisma/models')

const commentLeave = ({ leave, comment, company_id }) =>
  Comment.create({
    entity_type: 'leave',
    entity_id: leave.id,
    comment,
    company_id,
    by_user_id: leave.user_id
  })

const getCommentsForLeave = ({ leave }) =>
  Comment.findAll({
    where: {
      entity_type: 'leave',
      entity_id: leave.id
    }
  })

module.exports = {
  commentLeave,
  getCommentsForLeave
}
