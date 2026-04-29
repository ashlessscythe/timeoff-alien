'use strict'

const express = require('express')
const router = express.Router()
const prisma = require('../../prisma/client')
const LeaveModel = require('../../model/leave')
const Models = require('../../model/db')
const { wrapLeave } = require('../../model/sessionUser')

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({ error: 'Unauthorized' })
}

router.get('/count', ensureAuthenticated, async (req, res) => {
  try {
    const user = req.user

    const managedDepartments = await prisma.departments.findMany({
      where: {
        company_id: user.company_id,
        OR: [{ manager_id: user.id }, { department_supervisors: { some: { user_id: user.id } } }]
      },
      select: { id: true }
    })

    const managedDepartmentIds = managedDepartments.map(dept => dept.id)

    if (managedDepartmentIds.length === 0) {
      return res.json({ count: 0 })
    }

    const leaves = await prisma.leaves.findMany({
      where: {
        status: Models.Leave.status_new(),
        decided_at: null,
        users_leaves_user_idTousers: {
          department_id: { in: managedDepartmentIds }
        }
      },
      include: {
        users_leaves_user_idTousers: true,
        leave_types: true,
        users_leaves_approver_idTousers: true
      }
    })

    const wrapped = leaves.map(row => wrapLeave(row, prisma))

    const relevantLeaves = await Promise.all(
      wrapped.map(async leave => {
        const hasExtendedView = await LeaveModel.doesUserHasExtendedViewOfLeave({
          user,
          leave
        })
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
