'use strict'

const expect = require('chai').expect
const moment = require('moment')
const Exception = require('../../../lib/error')
const proxyquire = require('proxyquire')

// Set test database URL (using mock URL for tests)
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
process.env.USE_SSL = 'false'
process.env.DB_LOGGING = 'false'

// Mock all required dependencies
const mockModels = {
  Leave: {
    build: attributes => ({
      ...attributes,
      save: () => Promise.resolve({ ...attributes, id: 1 })
    }),
    status_approved: () => 1,
    status_new: () => 2,
    does_skip_approval: () => false
  }
}

const mockComment = {
  commentLeave: () => Promise.resolve()
}

// Mock the leave module with all dependencies
const Leave = proxyquire('../../../lib/model/leave', {
  '../db': mockModels,
  '../comment': mockComment
})

describe('Leave Model', function() {
  describe('Payroll close validation', function() {
    let mockEmployee, mockLeaveType, mockAdmin

    beforeEach(function() {
      // Set a fixed date for all tests
      const fixedDate = moment('2025-01-14') // A Tuesday
      moment.now = () => fixedDate

      // Mock employee
      mockEmployee = {
        id: 1,
        company_id: 1,
        validate_overlapping: () => Promise.resolve(),
        promise_manager: () => Promise.resolve({ id: 2 }),
        validate_leave_fits_into_remaining_allowance: () => Promise.resolve()
      }

      // Mock leave type
      mockLeaveType = {
        id: 1
      }

      // Mock admin user
      mockAdmin = {
        id: 3,
        is_admin: () => true
      }
    })

    afterEach(function() {
      // Reset moment mock
      if (moment.now.restore) {
        moment.now.restore()
      }
    })

    it('Allows admin to create leave requests for past weeks after payroll close', function() {
      // Mock current time to be Tuesday 11am UTC-7
      const tuesday11am = moment
        .utc()
        .startOf('week') // Monday
        .add(1, 'day') // Tuesday
        .add(11, 'hours') // 11am
        .subtract(7, 'hours') // UTC-7

      moment.now = () => tuesday11am

      const lastWeekDate = moment
        .utc()
        .subtract(1, 'week')
        .day(3) // Wednesday of last week

      return Leave.createNewLeave({
        for_employee: mockEmployee,
        of_type: mockLeaveType,
        with_parameters: {
          from_date: lastWeekDate.format('YYYY-MM-DD'),
          to_date: lastWeekDate.format('YYYY-MM-DD')
        },
        created_by: mockAdmin
      }).then(leave => {
        expect(leave).to.be.ok
      })
    })

    it('Prevents non-admin from creating leave requests for past weeks after payroll close', async function() {
      // Mock current time to be Tuesday 11am UTC-7
      const tuesday11am = moment
        .utc()
        .startOf('week') // Monday
        .add(1, 'day') // Tuesday
        .add(11, 'hours') // 11am
        .subtract(7, 'hours') // UTC-7

      moment.now = () => tuesday11am

      const lastWeekDate = moment
        .utc()
        .subtract(1, 'week')
        .day(3) // Wednesday of last week

      const nonAdmin = {
        id: 4,
        is_admin: () => false
      }

      try {
        await Leave.createNewLeave({
          for_employee: mockEmployee,
          of_type: mockLeaveType,
          with_parameters: {
            from_date: lastWeekDate.format('YYYY-MM-DD'),
            to_date: lastWeekDate.format('YYYY-MM-DD')
          },
          created_by: nonAdmin
        })
        throw new Error('Should have failed')
      } catch (error) {
        // Verify it's our custom error
        expect(error.tom_error).to.be.true
        // Verify both system and user error messages
        expect(error.message).to.equal(
          'Failed to add new Leave for user 1 because requested dates (2025-01-08) are in past weeks and payroll is closed'
        )
        expect(error.user_error_message).to.equal(
          'Cannot request leave for past weeks after payroll closes (Monday 9am UTC-7)'
        )
      }
    })

    it('Allows non-admin to create leave requests for past weeks on Monday before payroll close (10am UTC-7)', function() {
      // Mock current time to be Monday 9:30am UTC-7 (before 10am payroll close)
      const monday930am = moment
        .utc()
        .startOf('week') // Monday
        .add(9, 'hours') // 9am
        .add(30, 'minutes') // 9:30am
        .subtract(7, 'hours') // UTC-7

      moment.now = () => monday930am

      const lastWeekDate = moment
        .utc()
        .subtract(1, 'week')
        .day(3) // Wednesday of last week

      const nonAdmin = {
        id: 4,
        is_admin: () => false
      }

      return Leave.createNewLeave({
        for_employee: mockEmployee,
        of_type: mockLeaveType,
        with_parameters: {
          from_date: lastWeekDate.format('YYYY-MM-DD'),
          to_date: lastWeekDate.format('YYYY-MM-DD')
        },
        created_by: nonAdmin
      }).then(leave => {
        expect(leave).to.be.ok
      })
    })
  })
})
