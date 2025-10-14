'use strict'

const express = require('express')
const router = express.Router()
const Exception = require('../../error')
const Promise = require('bluebird')
const prisma = require('../../prisma/client')
const { User } = require('../../prisma/models')
const TeamView = require('../../model/team_view')

router.get('/summary/:userId/', async (req, res) => {
  try {
    const requestor = req.user
    const user_id = parseInt(req.params.userId)
    console.log('id and requestor is: ', user_id, requestor.id)

    // Get user object by provided ID with department info
    const user = await User.findOne({
      where: { id: user_id },
      include: {
        departments: true
      }
    })

    // Ensure that requestor and user belong to the same company
    if (!user || user.company_id !== requestor.company_id) {
      throw Exception.throwUserError({
        user_error: 'No access to given user',
        system_error: `User ${
          requestor.id
        } tried to access details of user ${user_id}: either ID does not belong to existing user of requestor and Id does not share company`
      })
    }

    // If requestor is admin OR is manager for given user show detailed INFO
    let isDetailed = false

    // In case admin is asking user's details: show detailed version
    if (requestor.is_admin()) {
      isDetailed = true
    } else {
      // Check if given user is among supervised ones
      const supervisedUsers = await requestor.promise_supervised_users()
      isDetailed = supervisedUsers.filter(u => u.id === user.id).length === 1
    }

    if (!isDetailed) {
      return res.render('user/popup_user_details', {
        layout: false,
        userFullName: user.name + ' ' + user.lastname,
        departmentName: user.departments.name,
        userAllowance: null,
        supervisorNames: [],
        specialLeaveTypes: []
      })
    }

    // Get detailed information
    const [userAllowance, supervisors, leaveTypes] = await Promise.all([
      user.promise_allowance(),
      user.promise_supervisors(),
      prisma.leave_types.findMany({
        where: {
          company_id: user.company_id
        }
      })
    ])

    const supervisorNames = (supervisors || []).map(u => u.full_name())

    // Get statistics for the current month
    const today = new Date()
    const team_view = new TeamView({ user: requestor, base_date: today })

    const details = await team_view.promise_team_view_details()
    const detailsWithStats = await team_view.inject_statistics({
      team_view_details: details,
      leave_types: leaveTypes
    })

    // Find stats for the requested user
    const userStats = detailsWithStats.users_and_leaves.find(
      item => item.user.id === user.id
    )
    const leaveStats = userStats
      ? userStats.statistics.leave_type_break_down.lite_version
      : {}

    // Filter special leave types to only include ones that have been taken
    const specialLeaveTypes = leaveTypes
      ? leaveTypes
          .filter(lt => lt.is_special)
          .filter(lt => leaveStats[lt.id] > 0)
          .map(lt => ({
            name: lt.name,
            days_taken: leaveStats[lt.id],
            days_taken_plural: leaveStats[lt.id] > 1
          }))
      : []

    res.render('user/popup_user_details', {
      layout: false,
      userFullName: user.name + ' ' + user.lastname,
      departmentName: user.departments.name,
      userAllowance,
      supervisorNames,
      specialLeaveTypes
    })
  } catch (error) {
    console.log(error)
    res.send('Failed to get user details...')
  }
})

module.exports = router
