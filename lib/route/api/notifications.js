'use strict'

const express = require('express')
const router = express.Router()
const { User, Leave, Department } = require('../../prisma/models')
const LeaveModel = require('../../model/leave')
const prisma = require('../../prisma/client')

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
    const managedDepartments = await prisma.departments.findMany({
      where: {
        OR: [
          { manager_id: user.id },
          {
            department_supervisors: {
              some: { user_id: user.id }
            }
          }
        ]
      }
    })

    const managedDepartmentIds = managedDepartments.map(dept => dept.id)

    // Get all leaves that the user might need to approve
    const leaves = await prisma.leaves.findMany({
      where: {
        status: 1, // new status
        decided_at: null,
        users_leaves_user_idTousers: {
          department_id: {
            in: managedDepartmentIds
          }
        }
      },
      include: {
        users_leaves_user_idTousers: true
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
