'use strict'

const Promise = require('bluebird')
const moment = require('moment')

const prisma = require('./db/prisma')

const getUsersWithLeaves = async ({
  company,
  startDate = company.get_today(),
  endDate = company.get_today(),
  department_id = null
}) => {
  const users = await prisma.users.findMany({
    where: {
      company_id: company.id,
      ...(department_id ? { department_id } : {})
    },
    select: {
      id: true,
      email: true,
      name: true,
      lastname: true,
      departments: {
        select: {
          name: true
        }
      }
    }
  })

  const leaves = await prisma.leaves.findMany({
    where: {
      user_id: {
        in: users.map(user => user.id)
      },
      OR: [
        {
          date_start: {
            lte: endDate.toDate()
          },
          date_end: {
            gte: startDate.toDate()
          }
        }
      ]
    },
    include: {
      leave_type: {
        select: {
          name: true
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

  return users.map(user => ({
    user: {
      id: user.id,
      department: user.departments.name,
      email: user.email,
      fullName: `${user.name} ${user.lastname}`
    },
    leaves: (leavesByUserId[user.id] || []).map(leave => leaveIntoObject(leave))
  }))
}

const leaveIntoObject = leave => {
  const dateFormat = 'YYYY-MM-DD'
  const dateTimeStamp = 'YYYY-MM-DD HH:mm'

  const statusMap = {
    1: 'New',
    2: 'Approved',
    3: 'Rejected',
    4: 'Canceled',
    6: 'Pended Revoke'
  }

  // Ensure department is properly associated with user for deducted days calculation
  if (leave.user && leave.user.department) {
    leave.user.department = leave.user.department.toJSON()
  }

  let deductedDays = leave.get_deducted_days_number()

  return {
    startDate: moment.utc(leave.get_start_leave_day().date).format(dateFormat),
    endDate: moment.utc(leave.get_end_leave_day().date).format(dateFormat),
    dayPartStart: leave.day_part_start,
    dayPartEnd: leave.day_part_end,
    type: leave.leave_type ? leave.leave_type.name : 'N/A',
    deductedDays,
    approver: leave.approver ? leave.approver.full_name() : 'N/A',
    approverId: leave.approver_id,
    status: statusMap[leave.status] || 'Unknown',

    id: leave.id,
    employeeId: leave.user_id,
    employeeFullName: leave.user ? leave.user.full_name() : 'N/A',
    employeeLastName: leave.user ? leave.user.lastname : 'N/A',
    departmentId: leave.user ? leave.user.departmentId : null,
    departmentName:
      leave.user && leave.user.department ? leave.user.department.name : 'N/A',
    typeId: leave.leaveTypeId,
    createdAt: moment.utc(leave.createdAt).format(dateFormat),
    createdTimeStamp: moment
      .utc(leave.createdAt)
      .tz('America/Denver')
      .format(dateTimeStamp),

    employee_comment: leave.employee_comment || '',
    approver_comment: leave.approver_comment || ''
  }
}

const fetchLeavesForLeavesReport = async ({
  startDate,
  endDate,
  departmentId,
  leaveTypeId,
  actingUser
}) => {
  // Convert Moment objects to JavaScript Date objects
  const startDateJS = startDate.toDate()
  const endDateJS = endDate.toDate()

  const leaves = await prisma.leaves.findMany({
    where: {
      OR: [
        {
          date_start: {
            gte: startDateJS,
            lte: endDateJS
          }
        },
        {
          date_end: {
            gte: startDateJS,
            lte: endDateJS
          }
        },
        {
          AND: [
            { date_start: { lte: startDateJS } },
            { date_end: { gte: endDateJS } }
          ]
        }
      ],
      status: {
        notIn: [3, 4] // Rejected, Canceled
      },
      ...(leaveTypeId ? { leave_type_id: leaveTypeId } : {}),
      users_leaves_user_idTousers: {
        company_id: actingUser.company_id,
        ...(departmentId ? { department_id: departmentId } : {})
      }
    },
    include: {
      users_leaves_user_idTousers: {
        include: {
          departments: {
            select: {
              id: true,
              name: true,
              include_public_holidays: true
            }
          },
          companies: {
            include: {
              bank_holidays: {
                select: {
                  id: true,
                  name: true,
                  date: true
                }
              }
            }
          }
        }
      },
      leave_type: {
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
    },
    orderBy: {
      date_start: 'asc'
    }
  })

  const leaveIds = leaves.map(leave => leave.id)

  const comments = await prisma.comments.findMany({
    where: {
      entity_type: 'Leave',
      entity_id: {
        in: leaveIds
      }
    },
    select: {
      entity_id: true,
      comment: true
    }
  })

  const commentsMap = comments.reduce((acc, comment) => {
    if (!acc[comment.entity_id]) {
      acc[comment.entity_id] = []
    }
    acc[comment.entity_id].push(comment.comment)
    return acc
  }, {})

  // Fetch all relevant schedules
  const schedules = await prisma.schedules.findMany({
    where: {
      OR: [
        { company_id: actingUser.company_id, user_id: null },
        {
          user_id: {
            in: leaves.map(leave => leave.users_leaves_user_idTousers.id)
          }
        }
      ]
    }
  })

  const userSchedules = schedules.reduce((acc, schedule) => {
    if (schedule.user_id) {
      acc[schedule.user_id] = schedule
    } else {
      acc.companyWide = schedule
    }
    return acc
  }, {})

  // First, ensure all users have their schedules
  for (const leave of leaves) {
    const user = leave.users_leaves_user_idTousers
    if (user) {
      // Get user-specific schedule or fall back to company-wide schedule
      const schedule = userSchedules[user.id] || userSchedules.companyWide
      if (schedule) {
        user.cached_schedule = schedule
      } else {
        // If no schedule found, create a default schedule
        user.cached_schedule = {
          monday: 1,
          tuesday: 1,
          wednesday: 1,
          thursday: 1,
          friday: 1,
          saturday: 2,
          sunday: 2
        }
      }
    }
  }

  const processedLeaves = leaves.map(leave => {
    const leaveObj = leaveIntoObject(leave)
    return {
      ...leaveObj,
      comment: commentsMap[leave.id] ? commentsMap[leave.id].join('. ') : ''
    }
  })

  return { leaves: processedLeaves }
}

module.exports = {
  getUsersWithLeaves,
  fetchLeavesForLeavesReport,
  leaveIntoObject
}
