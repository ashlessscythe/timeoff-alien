'use strict'

const expect = require('chai').expect
const moment = require('moment')
const UserAllowance = require('../../../lib/model/user_allowance')
const model = require('../../../lib/model/db')

describe('employement_range_adjustment attribute', function() {
  describe('Employee start day is in previouse year and no end date', function() {
    const employee = model.User.build({
      start_date: moment('2015-07-14')
    })

    it('no automatic adjustment', function() {
      const ul = new UserAllowance({
        user: employee,
        now: moment('2016-07-20'),
        number_of_days_taken_from_allowance: 0,
        manual_adjustment: 0,
        carry_over: 0,
        nominal_allowance: 20,
        nominal_personal: 5
      })

      expect(ul.employement_range_adjustment).to.be.equal(0)
    })
  })

  describe('Employee start date is in prevouse year but end date is in current year', function() {
    const employee = model.User.build({
      start_date: moment('2015-04-23'),
      end_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-02-20'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5
    })

    it('ajustment is made based on end date', function() {
      expect(ul.employement_range_adjustment).to.be.equal(-15)
    })
  })

  describe('Employee start date is in previouse year and end date is in next year', function() {
    const employee = model.User.build({
      start_date: moment('2015-04-23'),
      end_date: moment('2017-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-20'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5
    })

    it('ajustment is made based on end date', function() {
      expect(ul.employement_range_adjustment).to.be.equal(0)
    })
  })

  describe('Start date is in current year, no end date', function() {
    const employee = model.User.build({
      start_date: moment('2018-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2018-07-20'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5 // Added this line
    })

    it('adjustment is made based on start date', function() {
      expect(ul.employement_range_adjustment).to.be.equal(-5)
    })
  })

  describe('Start date is in current year, end date is in current year either', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01'),
      end_date: moment('2016-10-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-20'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5 // Added this line
    })

    it('adjustment is made based on start and end dates', function() {
      expect(ul.employement_range_adjustment).to.be.equal(-10)
    })
  })

  describe('Start date is in current year, end date is in next year', function() {
    const employee = model.User.build({
      start_date: moment('2018-04-01'),
      end_date: moment('2019-10-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2018-07-20'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5
    })

    it('adjustment is made based on start date', function() {
      expect(ul.employement_range_adjustment).to.be.equal(-5)
    })
  })

  describe('Start date is in next year, no end date', function() {
    const employee = model.User.build({
      start_date: moment('2018-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-20'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5 // Added this line
    })

    it('No adjustment is needed', function() {
      expect(ul.employement_range_adjustment).to.be.equal(0)
    })
  })

  describe('Start date is in next year, end date is defined', function() {
    const employee = model.User.build({
      start_date: moment('2017-04-01'),
      end_date: moment('2017-10-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-20'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 0
    })

    it('No adjustment is needed', function() {
      expect(ul.employement_range_adjustment).to.be.equal(0)
    })
  })
})

describe('accrued_adjustment attribute', function() {
  describe('Employee started last year, today is is beginning of Feb', function() {
    const employee = model.User.build({
      start_date: moment('2016-10-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2017-02-01'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 5
    })

    it('Ensure year total alloance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(24)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-22)
    })
  })

  describe('Started in Apr, today is Jul', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-01'),
      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 5 // Added this line
    })

    it('Ensure year total alloance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(18)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-12)
    })
  })

  describe('Started in Apr, today is Jul: carry over is ignored in accrual adjustment', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-01'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 10,
      nominal_allowance: 24,
      nominal_personal: 5
    })

    it('Ensure year total alloance is correct', function() {
      // 18, because start/end adjustment affects only nominal allowance
      // but not manula adjuatements
      // so 18 = 24 * .75 + 10
      expect(ul.total_number_of_days_in_allowance).to.be.eql(28)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-12)
    })
  })

  describe('Started in Apr, today is Jul: manual adjustments is taked into consideration', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2016-07-01'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 4,
      carry_over: 0,
      nominal_allowance: 20,
      nominal_personal: 5
    })

    it('Ensure year total alloance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(20 * 0.75 + 4)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-12.5)
    })
  })

  describe('Started last year, today is 1 of January', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2017-01-01'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 2
    })

    it('Ensure year total allowance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(24)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-24)
    })
  })

  describe('Started last year, today is 14th of January', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2017-01-14'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 2
    })

    it('Ensure year total allowance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(24)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-23)
    })
  })

  describe('Started last year, today is 31th of December', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2017-12-31'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 5
    })

    it('Ensure year total allowance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(24)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-0)
    })
  })

  describe('Started last year, today is 15th of December', function() {
    const employee = model.User.build({
      start_date: moment('2016-04-01')
    })

    const ul = new UserAllowance({
      user: employee,
      now: moment('2017-12-15'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 0
    })

    it('Ensure year total allowance is correct', function() {
      expect(ul.total_number_of_days_in_allowance).to.be.eql(24)
    })

    it('Check accrued_adjustment', function() {
      expect(ul.accrued_adjustment).to.be.eql(-1)
    })
  })

  describe('Started this year, calculate available allowance for previous year', function() {
    const employee = model.User.build({
      start_date: moment.utc('2019-01-01')
    })

    const department = model.Department.build({
      is_accrued_allowance: false
    })

    employee.department = department

    const ul = new UserAllowance({
      user: employee,
      now: moment('2018-01-01'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 9
    })

    it('Ensure available allowance is correct', function() {
      expect(ul.number_of_days_available_in_allowance).to.be.eql(0)
    })
  })

  describe('Started this year, calculate available allowance for current year', function() {
    const employee = model.User.build({
      start_date: moment.utc('2019-01-01')
    })

    const department = model.Department.build({
      is_accrued_allowance: false
    })

    employee.department = department

    const ul = new UserAllowance({
      user: employee,
      now: moment('2019-06-01'),

      number_of_days_taken_from_allowance: 0,
      manual_adjustment: 0,
      carry_over: 0,
      nominal_allowance: 24,
      nominal_personal: 5 // Added this line
    })

    it('Ensure available allowance is correct', function() {
      expect(ul.number_of_days_available_in_allowance).to.be.eql(24)
    })
  })
})
