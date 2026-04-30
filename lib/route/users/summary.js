'use strict'

const express = require('express')
const router = express.Router()
const Exception = require('../../error')
const prisma = require('../../prisma/client')
const moment = require('moment')
const {
  calculateNumberOfDaysTakenFromAllowance,
  getUserAllowanceWithContext
} = require('../../prisma/userUtils')

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
    const monthStart = now.clone().startOf('month').toDate()
    const monthEnd = now.clone().endOf('month').toDate()

    const [company, userSchedule, companySchedule, leaveTypes, leaves, supervisors] =
      await Promise.all([
        prisma.companies.findUnique({
          where: { id: user.company_id },
          include: { bank_holidays: true }
        }),
        prisma.schedules.findFirst({ where: { user_id: user.id } }),
        prisma.schedules.findFirst({ where: { company_id: user.company_id, user_id: null } }),
        prisma.leave_types.findMany({ where: { company_id: user.company_id } }),
        prisma.leaves.findMany({
          where: {
            user_id: user.id,
            status: 2, // approved
            AND: [{ date_start: { lte: monthEnd } }, { date_end: { gte: monthStart } }]
          },
          include: { leave_types: true }
        }),
        // Department manager + secondary supervisors
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

    const schedule = userSchedule || companySchedule || null

    const userAllowance = await getUserAllowanceWithContext(
      { ...user, company, departments: user.departments },
      now.year(),
      {
        company,
        department: user.departments,
        schedule
      }
    )

    // Normalize allowance shape for legacy templates.
    // `views/user/popup_user_details.hbs` expects:
    // - remaining_regular_allowance
    // - total_personal_available
    // - total_number_of_days_in_allowance
    const totalAllowancePool =
      (userAllowance.nominal_allowance || 0) +
      (userAllowance.manual_adjustment || 0) +
      (userAllowance.carried_over_allowance || 0)
    const totalPersonalLimit =
      (userAllowance.nominal_personal || 0) + (userAllowance.personal_adjustment || 0)
    const totalNumberOfDaysInAllowance = totalAllowancePool + totalPersonalLimit

    const normalizedUserAllowance = {
      ...userAllowance,
      remaining_regular_allowance:
        typeof userAllowance.vacation_remaining === 'number'
          ? userAllowance.vacation_remaining
          : 0,
      total_number_of_days_in_allowance: totalNumberOfDaysInAllowance
    }

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

    const specialLeaveTypes = (leaveTypes || [])
      .filter(lt => lt.is_special)
      .map(lt => {
        const relevantLeaves = (leaves || []).filter(l => l.leave_type_id === lt.id)
        const days_taken = calculateNumberOfDaysTakenFromAllowance(
          { ...user, company, departments: user.departments },
          relevantLeaves,
          now.year(),
          { company, department: user.departments, schedule }
        )
        return { name: lt.name, days_taken, days_taken_plural: days_taken > 1 }
      })
      .filter(item => item.days_taken > 0)

    return res.render('user/popup_user_details', {
      layout: false,
      userFullName: `${user.name} ${user.lastname}`,
      departmentName: user.departments ? user.departments.name : '',
      userAllowance: normalizedUserAllowance,
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
