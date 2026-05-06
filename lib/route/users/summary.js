'use strict'

const express = require('express')
const router = express.Router()
const Exception = require('../../error')
const prisma = require('../../prisma/client')
const moment = require('moment')
const UserAllowance = require('../../model/user_allowance')
const { wrapUser } = require('../../model/sessionUser')
const leaveConstants = require('../../model/leave_constants')

router.get('/summary/:userId/', async (req, res) => {
  const requestor = req.user
  const userId = Number(req.params.userId)

  try {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { departments: true }
    })

    if (!user || user.company_id !== requestor.company_id) {
      throw Exception.throwUserError({
        user_error: 'No access to given user',
        system_error: `User ${requestor.id} tried to access details of user ${userId}: either ID does not belong to existing user of requestor and Id does not share company`
      })
    }

    // Determine if requestor can see detailed view.
    let isDetailed = false
    if (requestor.is_admin && requestor.is_admin()) {
      isDetailed = true
    } else {
      const department = await prisma.departments.findUnique({
        where: { id: user.department_id },
        select: { manager_id: true }
      })

      const isManager = !!(requestor.manager || (requestor.is_manager && requestor.is_manager && requestor.is_manager()))
      const isDeptManager = department && department.manager_id === requestor.id
      const isSecondarySupervisor = await prisma.department_supervisors.findFirst({
        where: { department_id: user.department_id, user_id: requestor.id },
        select: { user_id: true }
      })

      isDetailed = isManager && (isDeptManager || !!isSecondarySupervisor)
    }

    if (!isDetailed) {
      return res.render('user/popup_user_details', {
        layout: false,
        userFullName: `${user.name} ${user.lastname}`,
        departmentName: user.departments ? user.departments.name : ''
      })
    }

    const now = moment.utc()
    const yearMoment = now.clone().startOf('year')

    const [leaveTypes, supervisors] = await Promise.all([
      prisma.leave_types.findMany({ where: { company_id: user.company_id } }),
      prisma.departments.findUnique({
        where: { id: user.department_id },
        select: {
          manager_id: true,
          department_supervisors: {
            include: { users: { select: { name: true, lastname: true, id: true } } }
          }
        }
      })
    ])

    // Use the exact same allowance pipeline as the rest of the app:
    // `UserAllowance.promise_allowance` + `user.calculate_number_of_days_taken_from_allowance`
    // (includes accrued allowance, employment proration, bank holidays via leave objects, etc.)
    const employee = wrapUser(user, prisma)
    await employee.reload_with_leave_details({ year: yearMoment })
    await employee.reload_with_session_details()
    if (employee.company && employee.company.reload_with_bank_holidays) {
      await employee.company.reload_with_bank_holidays()
    }

    const userAllowanceRaw = await UserAllowance.promise_allowance({
      user: employee,
      year: yearMoment
    })
    const userAllowance =
      userAllowanceRaw && typeof userAllowanceRaw.toJSON === 'function'
        ? userAllowanceRaw.toJSON()
        : userAllowanceRaw

    const supervisorNames = []
    if (supervisors && supervisors.manager_id) {
      const mgr = await prisma.users.findUnique({
        where: { id: supervisors.manager_id },
        select: { name: true, lastname: true }
      })
      if (mgr) supervisorNames.push(`${mgr.name} ${mgr.lastname}`)
    }
    ;(supervisors?.department_supervisors || []).forEach(link => {
      const u = link.users
      if (u) supervisorNames.push(`${u.name} ${u.lastname}`)
    })

    const monthStart = now.clone().startOf('month')
    const monthEnd = now.clone().endOf('month')
    const yearForDays = now.format('YYYY')

    function monthDeductedDaysForLeave(leave, leaveType) {
      const s = moment.utc(leave.date_start)
      const e = moment.utc(leave.date_end)
      if (s.isAfter(monthEnd) || e.isBefore(monthStart)) return 0

      const deductedDays = leave.get_deducted_days({
        ignore_allowance: true,
        year: yearForDays,
        leave_type: leaveType,
        user: employee
      })

      let total = 0
      deductedDays.forEach(leaveDay => {
        const d = moment.utc(leaveDay.date)
        if (d.isBefore(monthStart) || d.isAfter(monthEnd)) return

        if (leaveDay.is_time_based_leave && leaveDay.is_time_based_leave()) {
          const hours = leaveDay.get_duration_hours ? leaveDay.get_duration_hours() : null
          const workingHours = leave.get_working_hours_per_day
            ? leave.get_working_hours_per_day(employee)
            : 8
          if (hours !== null && Number.isFinite(hours) && workingHours > 0) {
            total += hours / workingHours
          } else {
            total += 1
          }
          return
        }

        if (leaveDay.is_morning_leave && leaveDay.is_morning_leave()) total += 0.5
        if (leaveDay.is_afternoon_leave && leaveDay.is_afternoon_leave()) total += 0.5
        if (leaveDay.is_all_day_leave && leaveDay.is_all_day_leave()) total += 1
      })

      return total
    }

    const specialLeaveTypes = (leaveTypes || [])
      .filter(lt => lt.is_special)
      .map(lt => {
        const days_taken = (employee.my_leaves || []).reduce((memo, leave) => {
          if (!leave || !leave.leave_type) return memo
          if (leave.leave_type_id !== lt.id && leave.leave_type.id !== lt.id) return memo

          if (
            leave.status === leaveConstants.status_canceled() ||
            leave.status === leaveConstants.status_rejected()
          ) {
            return memo
          }

          // "Used/taken" should not count pending, but should count pended_revoke.
          if (
            !(
              leave.is_approved_leave() ||
              leave.is_pended_revoke_leave()
            )
          ) {
            return memo
          }

          return memo + monthDeductedDaysForLeave(leave, leave.leave_type)
        }, 0)

        return { name: lt.name, days_taken, days_taken_plural: days_taken > 1 }
      })
      .filter(item => item.days_taken > 0)

    return res.render('user/popup_user_details', {
      layout: false,
      userFullName: `${user.name} ${user.lastname}`,
      departmentName: user.departments ? user.departments.name : '',
      userAllowance,
      supervisorNames,
      specialLeaveTypes
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(error)
    return res.send('Failed to get user details...')
  }
})

module.exports = router
