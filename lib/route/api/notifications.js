'use strict'

const express = require('express')
const router = express.Router()
const models = require('../../model/db')
const { Op } = require('sequelize')
const LeaveModel = require('../../model/leave')

// Middleware to ensure user is authenticated
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({ error: 'Unauthorized' })
}

router.get('/count', ensureAuthenticated, async (req, res) => {
  try {
    const user = req.user

    // Get all departments where the user is either a manager or a supervisor
    const managedDepartments = await models.Department.findAll({
      where: {
        [Op.or]: [{ manager_id: user.id }, { '$supervisors.id$': user.id }]
      },
      include: [
        {
          model: models.User,
          as: 'supervisors',
          attributes: ['id'],
          through: { attributes: [] }
        }
      ]
    })

    const managedDepartmentIds = managedDepartments.map(dept => dept.id)

    // Get all leaves that the user might need to approve
    const leaves = await models.Leave.findAll({
      include: [
        {
          model: models.User,
          as: 'user',
          where: {
            department_id: managedDepartmentIds
          }
        }
      ],
      where: {
        status: models.Leave.status_new(),
        decided_at: null
      }
    })

    // Filter leaves based on user's extended view permissions
    const relevantLeaves = await Promise.all(
      leaves.map(async leave => {
        const hasExtendedView = await LeaveModel.doesUserHasExtendedViewOfLeave(
          { user, leave }
        )
        return hasExtendedView ? leave : null
      })
    )

    const count = relevantLeaves.filter(leave => leave !== null).length

    res.json({ count })
  } catch (error) {
    console.error('Error fetching notification count:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
