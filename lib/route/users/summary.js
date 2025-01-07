'use strict'

const express = require('express')
const router = express.Router()
const Exception = require('../../error')
const Promise = require('bluebird')
const { PrismaClient } = require('@prisma/client')
const TeamView = require('../../model/team_view')
const prisma = new PrismaClient()

router.get('/summary/:userId/', (req, res) => {
  const requestor = req.user
  const user_id = req.params.userId
  console.log('id and requestor is: ', user_id, requestor.id)

  const model = req.app.get('db_model')
  // console.log('model is: ', model)

  // Get user object by provided ID
  let flow = model.User.scope('withDepartments').findOne({
    where: { id: user_id }
  })

  // Ensure that requestor and user belong to the same company
  flow = flow.then(user => {
    if (!user || user.company_id !== requestor.company_id) {
      throw Exception.throwUserError({
        user_error: 'No access to given user',
        system_error: `User ${
          requestor.id
        } tried to access details of user ${user_id}: either ID does not belong to existing user of requestor and Id does not share company`
      })
    }

    return Promise.resolve(user)
  })

  // If requestor is admin OR is manager for given user show detailed INFO
  flow = flow.then(user => {
    // In case admin is asking user's details: show detailed version
    if (requestor.is_admin()) {
      return Promise.resolve({ user, isDetailed: true })
    }

    // Check if given user is among supervised ones
    return requestor.promise_supervised_users().then(users => {
      let isDetailed = false

      if (users.filter(u => u.id === user.id).length === 1) {
        isDetailed = true
      }

      return Promise.resolve({ user, isDetailed })
    })
  })

  flow = flow.then(({ user, isDetailed }) => {
    if (!isDetailed) {
      return Promise.resolve({ user })
    }

    return Promise.all([
      user.promise_allowance(),
      user.promise_supervisors(),
      prisma.leave_types.findMany({
        where: {
          company_id: user.company_id
        }
      })
    ]).then(([userAllowance, supervisors, leaveTypes]) => ({
      user,
      userAllowance,
      supervisors,
      leaveTypes
    }))
  })

  flow = flow.then(({ user, userAllowance, supervisors, leaveTypes }) => {
    const supervisorNames = (supervisors || []).map(u => u.full_name())

    // Get statistics for the current month
    const today = new Date()
    const team_view = new TeamView({ user: requestor, base_date: today })

    return team_view
      .promise_team_view_details()
      .then(details =>
        team_view.inject_statistics({
          team_view_details: details,
          leave_types: leaveTypes
        })
      )
      .then(details => {
        // Find stats for the requested user
        const userStats = details.users_and_leaves.find(
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
          userFullName: user.full_name(),
          departmentName: user.get('department').name,
          userAllowance,
          supervisorNames,
          specialLeaveTypes
        })
      })
  })

  flow.catch(error => {
    console.log(error)
    res.send('Failed to get user details...')
  })
})

module.exports = router
