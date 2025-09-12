'use strict'

const express = require('express')
const router = express.Router()
const Promise = require('bluebird')
const validator = require('validator')
const _ = require('underscore')
const LeaveCollectionUtil = require('../model/leave_collection')()
const EmailTransport = require('../email')
const SlackTransport = require('../slack')
const moment = require('moment')

router.get('/', (req, res) => {
  const dbModel = req.app.get('db_model')

  // Get filter parameters from query string
  const selectedDepartments = req.query.departments
    ? req.query.departments.split(',')
    : []
  const selectedTypes = req.query.types ? req.query.types.split(',') : []
  const selectedMonth = req.query.month || ''
  const selectedYear = req.query.year || ''

  // Create promises for all required data
  Promise.join(
    // Get user's leaves
    req.user
      .promise_my_active_leaves_ever()
      .then(leaves =>
        LeaveCollectionUtil.enrichLeavesWithComments({ leaves, dbModel })
      )
      .then(leaves => LeaveCollectionUtil.promise_to_group_leaves(leaves)),

    // Get leaves to be processed
    req.user
      .promise_leaves_to_be_processed()
      .then(leaves =>
        LeaveCollectionUtil.enrichLeavesWithComments({ leaves, dbModel })
      ),

    // Get user's company
    req.user.getCompany({
      include: [
        {
          model: dbModel.Department,
          as: 'departments',
          order: [['name', 'ASC']]
        },
        {
          model: dbModel.LeaveType,
          as: 'leave_types',
          order: [['name', 'ASC']]
        }
      ]
    }),

    (my_leaves_grouped, to_be_approved_leaves, company) => {
      // Get unique departments from leaves to be approved
      const uniqueDepartments = _.uniq(
        to_be_approved_leaves
          .filter(leave => leave.user && leave.user.department)
          .map(leave => ({
            id: leave.user.department.id,
            name: leave.user.department.name
          })),
        false,
        dept => dept.id
      ).sort((a, b) => a.name.localeCompare(b.name))

      // Get unique leave types from leaves to be approved
      const uniqueLeaveTypes = _.uniq(
        to_be_approved_leaves
          .filter(leave => leave.leave_type)
          .map(leave => ({
            id: leave.leave_type.id,
            name: leave.leave_type.name
          })),
        false,
        type => type.id
      ).sort((a, b) => a.name.localeCompare(b.name))

      // Get unique months and years from leave start dates
      const uniqueDates = _.uniq(
        to_be_approved_leaves
          .filter(leave => leave.date_start)
          .map(leave => {
            const date = moment(leave.date_start)
            return {
              month: date.format('MMMM'),
              year: date.format('YYYY')
            }
          }),
        false,
        date => date.month + date.year
      )

      const uniqueMonths = _.uniq(uniqueDates.map(d => d.month)).sort(
        (a, b) => moment(a, 'MMMM').month() - moment(b, 'MMMM').month()
      )

      const uniqueYears = _.uniq(uniqueDates.map(d => d.year)).sort(
        (a, b) => a - b
      )

      // Add isPastPayroll flag and filter leaves based on selected departments, types, month, and year
      const filtered_leaves = to_be_approved_leaves
        .map(leave => {
          // Add isPastPayroll flag for leaves from past weeks
          leave.isPastPayroll = moment(leave.date_start).isBefore(
            moment(),
            'week'
          )
          return leave
        })
        .filter(leave => {
          const departmentMatch =
            selectedDepartments.length === 0 ||
            (leave.user &&
              leave.user.department &&
              selectedDepartments.includes(String(leave.user.department.id)))

          const typeMatch =
            selectedTypes.length === 0 ||
            (leave.leave_type &&
              selectedTypes.includes(String(leave.leave_type.id)))

          const dateMatch = (() => {
            if (!selectedMonth && !selectedYear) return true
            const leaveDate = moment(leave.date_start)
            const monthMatch =
              !selectedMonth || leaveDate.format('MMMM') === selectedMonth
            const yearMatch =
              !selectedYear || leaveDate.format('YYYY') === selectedYear
            return monthMatch && yearMatch
          })()

          return departmentMatch && typeMatch && dateMatch
        })

      res.render('requests', {
        my_leaves_grouped,
        to_be_approved_leaves: filtered_leaves,
        departments: uniqueDepartments,
        leave_types: uniqueLeaveTypes,
        unique_months: uniqueMonths,
        unique_years: uniqueYears,
        selected_filters: {
          departments: selectedDepartments,
          types: selectedTypes,
          month: selectedMonth,
          year: selectedYear
        },
        title: 'Requests | TimeOff'
      })
    }
  )
})

function leave_request_action(args) {
  const current_action = args.action
  const leave_action_method = args.leave_action_method
  let was_pended_revoke = false

  return function(req, res) {
    const request_id = validator.trim(req.body.request)
    const comment = req.body.comment ? validator.trim(req.body.comment) : ''
    const returnTo = req.header('Referer') || '/requests/'

    if (
      typeof request_id !== 'number' &&
      (!request_id || !validator.isNumeric(request_id))
    ) {
      req.session.flash_error('Failed to ' + current_action)
    }

    if (req.session.flash_has_errors()) {
      console.error(
        'Got validation errors on ' + current_action + ' request handler'
      )

      return res.redirect_with_session(returnTo)
    }

    Promise.try(() => req.user.promise_leaves_to_be_processed())
      .then(leaves => {
        const leave_to_process = _.find(
          leaves,
          leave =>
            String(leave.id) === String(request_id) &&
            (leave.is_new_leave() || leave.is_pended_revoke_leave())
        )

        if (!leave_to_process) {
          throw new Error(
            'Provided ID ' +
              request_id +
              'does not correspond to any leave requests to be ' +
              current_action +
              'ed for user ' +
              req.user.id
          )
        }

        was_pended_revoke = leave_to_process.is_pended_revoke_leave()

        return leave_to_process[leave_action_method]({ by_user: req.user })
      })
      .then(processed_leave => {
        processed_leave.approver_comment = comment
        return processed_leave.save()
      })
      .then(processed_leave =>
        processed_leave.reload({
          include: [
            { model: req.app.get('db_model').User, as: 'user' },
            { model: req.app.get('db_model').User, as: 'approver' },
            { model: req.app.get('db_model').LeaveType, as: 'leave_type' }
          ]
        })
      )
      .then(processed_leave => {
        const Email = new EmailTransport()

        return Email.promise_leave_request_decision_emails({
          leave: processed_leave,
          action: current_action,
          was_pended_revoke
        })
          .then(() => Promise.resolve(processed_leave))
          .catch(error => {
            console.error(
              'Failed to send email for the leave request: ' + error,
              error.stack
            )
            return Promise.resolve(processed_leave)
          })
      })
      .then(processed_leave => {
        const Slack = new SlackTransport()

        return Slack.promise_leave_request_decision_slacks({
          leave: processed_leave,
          action: current_action,
          was_pended_revoke
        })
          .then(() => Promise.resolve(processed_leave))
          .catch(error => {
            console.error(
              'Failed to send slack notification for the leave request: ' +
                error,
              error.stack
            )
            return Promise.resolve(processed_leave)
          })
      })
      .then(processed_leave => {
        req.session.flash_message(
          'Request from ' + processed_leave.user.full_name() + ' was processed'
        )

        return res.redirect_with_session(returnTo)
      })
      .catch(error => {
        console.error(
          'An error occurred when attempting to ' +
            current_action +
            ' leave request ' +
            request_id +
            ' by user ' +
            req.user.id +
            ' Error: ' +
            error,
          error.stack
        )

        // Check if this is a balance validation error
        if (error.user_message) {
          req.session.flash_error(error.user_message)
        } else {
          req.session.flash_error('Failed to ' + current_action)
        }

        return res.redirect_with_session(returnTo)
      })
  }
}

router.post(
  '/reject/',
  leave_request_action({
    action: 'reject',
    leave_action_method: 'promise_to_reject'
  })
)

router.post(
  '/approve/',
  leave_request_action({
    action: 'approve',
    leave_action_method: 'promise_to_approve'
  })
)

router.post('/cancel/', (req, res) => {
  const request_id = validator.trim(req.body.request)
  const returnTo = req.header('Referer') || '/requests/'

  let canceledLeave = null

  Promise.try(() => req.user.promise_cancelable_leaves())
    .then(leaves => {
      const leave_to_cancel = _.find(
        leaves,
        leave => String(leave.id) === String(request_id)
      )

      if (!leave_to_cancel) {
        throw new Error(
          'Given leave request is not among those current user can cancel'
        )
      }

      return Promise.resolve(leave_to_cancel)
    })
    .then(leave => leave.promise_to_cancel().then(() => Promise.resolve(leave)))
    .then(leave => {
      canceledLeave = leave
      return leave.reload({
        include: [
          { model: req.app.get('db_model').User, as: 'user' },
          { model: req.app.get('db_model').LeaveType, as: 'leave_type' }
        ]
      })
    })
    .then(leave => {
      if (leave.user && leave.user.email) {
        const Email = new EmailTransport()
        return Email.promise_leave_request_cancel_emails({ leave })
          .then(() => Promise.resolve(leave))
          .catch(error => {
            console.error(
              'Failed to send email for the leave request: ' + error,
              error.stack
            )
            return Promise.resolve(leave)
          })
      }
      return Promise.resolve(leave)
    })
    .then(leave => {
      if (leave.user && leave.user.slack_username) {
        const Slack = new SlackTransport()
        return Slack.promise_leave_request_cancel_slacks({ leave })
          .then(() => Promise.resolve(leave))
          .catch(error => {
            console.error(
              'Failed to send slack notification for the leave request: ' +
                error,
              error.stack
            )
            return Promise.resolve(leave)
          })
      }
      return Promise.resolve(leave)
    })
    .then(() => {
      req.session.flash_message('The leave request was canceled')
      return res.redirect_with_session(returnTo)
    })
    .catch(error => {
      console.error('An error occurred: ' + error, error.stack)
      if (canceledLeave) {
        req.session.flash_message('The leave request was canceled')
      } else {
        req.session.flash_error('Failed to cancel leave request')
      }
      return res.redirect_with_session(returnTo)
    })
})

router.post('/revoke/', (req, res) => {
  const request_id = validator.trim(req.body.request)
  const returnTo = req.header('Referer') || '/requests/'

  if (
    typeof request_id !== 'number' &&
    (!request_id || !validator.isNumeric(request_id))
  ) {
    req.session.flash_error('Failed to revoke leave request')
  }

  if (req.session.flash_has_errors()) {
    console.log(
      'Got validation errors when revoking leave request for user ' +
        req.user.id
    )

    return res.redirect_with_session(returnTo)
  }

  Promise.try(() =>
    req.app.get('db_model').Leave.findOne({ where: { id: request_id } })
  )
    .then(requested_leave => {
      if (String(requested_leave.user_id) === String(req.user.id)) {
        return Promise.resolve(requested_leave)
      }

      return req.user.promise_users_I_can_manage().then(users => {
        if (users.find(u => String(u.id) === String(requested_leave.user_id))) {
          return Promise.resolve(requested_leave)
        }

        return Promise.resolve()
      })
    })
    .then(leave_to_process => {
      if (!leave_to_process) {
        throw new Error(
          'Provided ID ' +
            request_id +
            ' does not correspond to any leave requests to be revoked by user ' +
            req.user.id
        )
      }

      const leaveStartDate = moment(leave_to_process.date_start)
      const currentDate = moment()

      if (
        leaveStartDate.isBefore(currentDate, 'week') &&
        !req.user.is_admin()
      ) {
        const error = new Error(
          'Only administrators can revoke leaves from past pay periods'
        )
        error.user_message =
          'Only administrators can revoke leaves from past pay periods'
        throw error
      }

      return leave_to_process.promise_to_revoke()
    })
    .then(processed_leave =>
      processed_leave.reload({
        include: [
          { model: req.app.get('db_model').User, as: 'user' },
          { model: req.app.get('db_model').User, as: 'approver' },
          { model: req.app.get('db_model').LeaveType, as: 'leave_type' }
        ]
      })
    )
    .then(processed_leave => {
      if (processed_leave.user && processed_leave.user.email) {
        const Email = new EmailTransport()
        return Email.promise_leave_request_revoke_emails({
          leave: processed_leave
        })
          .then(() => Promise.resolve(processed_leave))
          .catch(error => {
            console.error(
              'Failed to send email for the leave request: ' + error,
              error.stack
            )
            return Promise.resolve(processed_leave)
          })
      }
      return Promise.resolve(processed_leave)
    })
    .then(processed_leave => {
      if (processed_leave.user && processed_leave.user.slack_username) {
        const Slack = new SlackTransport()
        return Slack.promise_leave_request_revoke_slacks({
          leave: processed_leave
        })
          .then(() => Promise.resolve(processed_leave))
          .catch(error => {
            console.error(
              'Failed to send slack notification for the leave request: ' +
                error,
              error.stack
            )
            return Promise.resolve(processed_leave)
          })
      }
      return Promise.resolve(processed_leave)
    })
    .then(processed_leave => {
      req.session.flash_message(
        'You have requested leave to be revoked. ' +
          (processed_leave.is_auto_approve()
            ? ''
            : 'Your supervisor needs to approve it')
      )

      return res.redirect_with_session(returnTo)
    })
    .catch(error => {
      console.error(
        'An error occurred when attempting to revoke leave request ' +
          request_id +
          ' by user ' +
          req.user.id +
          ' Error: ',
        error,
        error.stack
      )

      req.session.flash_error(
        error.user_message || 'Failed to revoke leave request'
      )
      return res.redirect_with_session(returnTo)
    })
})

module.exports = router
