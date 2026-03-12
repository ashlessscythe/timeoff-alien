'use strict'

const moment = require('moment')
const prisma = require('../prisma/client')

const leaveIntoObjectPrisma = (leave, companyDateFormat = 'YYYY-MM-DD') => {
  const dateFormat = companyDateFormat
  const dateTimeStamp = companyDateFormat + ' HH:mm'

  // Approximate deducted days: full day = 1, half days = 0.5
  const start = moment.utc(leave.date_start)
  const end = moment.utc(leave.date_end)
  const daysSpan = Math.max(end.startOf('day').diff(start.startOf('day'), 'days') + 1, 1)

  let dayPartFactorStart = 1
  let dayPartFactorEnd = 1

  if (leave.day_part_start && leave.day_part_start !== 1) {
    dayPartFactorStart = 0.5
  }
  if (leave.day_part_end && leave.day_part_end !== 1) {
    dayPartFactorEnd = 0.5
  }

  // Very rough approximation – does not account for weekends/bank holidays
  const deductedDays =
    daysSpan === 1 ? Math.max(dayPartFactorStart, dayPartFactorEnd) : daysSpan

  const approver = leave.users_leaves_approver_idTousers

  return {
    startDate: moment.utc(leave.date_start).format(dateFormat),
    endDate: moment.utc(leave.date_end).format(dateFormat),
    dayPartStart: leave.day_part_start,
    dayPartEnd: leave.day_part_end,
    type: leave.leave_types ? leave.leave_types.name : 'N/A',
    deductedDays,
    approver: approver ? `${approver.name} ${approver.lastname}` : 'N/A',
    approverId: approver ? approver.id : null,
    status: leave.status,

    id: leave.id,
    employeeId: leave.user_id,
    employeeFullName: leave.userName || 'N/A',
    employeeLastName: leave.userLastname || 'N/A',
    departmentId: leave.departmentId || null,
    departmentName: leave.departmentName || 'N/A',
    typeId: leave.leave_types ? leave.leave_types.id : null,
    createdAt: moment.utc(leave.created_at || leave.date_start).format(dateFormat),
    createdTimeStamp: moment
      .utc(leave.created_at || leave.date_start)
      .format(dateTimeStamp),

    decidedAt: leave.decided_at
      ? moment.utc(leave.decided_at).format(dateFormat)
      : '',
    decidedTimeStamp: leave.decided_at
      ? moment.utc(leave.decided_at).format(dateTimeStamp)
      : '',

    employee_comment: leave.employee_comment || '',
    approver_comment: leave.approver_comment || ''
  }
}

const getUsersWithLeavesPrisma = async ({
  companyId,
  startDate,
  endDate,
  departmentId = null,
  companyDateFormat = 'YYYY-MM-DD'
}) => {
  const users = await prisma.users.findMany({
    where: {
      company_id: companyId,
      ...(departmentId ? { department_id: Number(departmentId) } : {})
    },
    select: {
      id: true,
      email: true,
      name: true,
      lastname: true,
      departments: {
        select: {
          id: true,
          name: true
        }
      }
    }
  })

  if (!users.length) {
    return []
  }

  const userIds = users.map(u => u.id)

  const leaves = await prisma.leaves.findMany({
    where: {
      user_id: { in: userIds },
      date_start: { lte: endDate.toDate() },
      date_end: { gte: startDate.toDate() }
    },
    select: {
      id: true,
      user_id: true,
      status: true,
      employee_comment: true,
      approver_comment: true,
      decided_at: true,
      date_start: true,
      day_part_start: true,
      date_end: true,
      day_part_end: true,
      created_at: true,
      leave_types: {
        select: {
          id: true,
          name: true,
          use_allowance: true
        }
      },
      users_leaves_approver_idTousers: {
        select: {
          id: true,
          name: true,
          lastname: true
        }
      }
    }
  })

  const leavesByUserId = leaves.reduce((acc, leave) => {
    if (!acc[leave.user_id]) {
      acc[leave.user_id] = []
    }
    acc[leave.user_id].push(leave)
    return acc
  }, {})

  return users.map(user => {
    const department = user.departments

    const enrichedLeaves =
      (leavesByUserId[user.id] || []).map(leave =>
        leaveIntoObjectPrisma(
          {
            ...leave,
            userName: `${user.name} ${user.lastname}`,
            userLastname: user.lastname,
            departmentId: department ? department.id : null,
            departmentName: department ? department.name : 'N/A'
          },
          companyDateFormat
        )
      ) || []

    return {
      user: {
        id: user.id,
        department: department ? department.name : 'N/A',
        email: user.email,
        fullName: `${user.name} ${user.lastname}`
      },
      leaves: enrichedLeaves
    }
  })
}

module.exports = {
  getUsersWithLeavesPrisma
}

