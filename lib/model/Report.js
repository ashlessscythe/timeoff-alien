'use strict'

const moment = require('moment')
const prisma = require('../prisma/client')
const leaveConstants = require('./leave_constants')
const {
  wrapLeave,
  wrapSchedule,
  getLeaveIncludeForPrisma
} = require('./sessionUser')

const dateRangeOverlapWhere = (startDateJS, endDateJS) => ({
  OR: [
    { date_start: { gte: startDateJS, lte: endDateJS } },
    { date_end: { gte: startDateJS, lte: endDateJS } },
    {
      AND: [{ date_start: { lte: startDateJS } }, { date_end: { gte: endDateJS } }]
    }
  ]
})

const leaveIntoObject = (leave, companyDateFormat = 'YYYY-MM-DD') => {
  const dateFormat = companyDateFormat
  const dateTimeStamp = companyDateFormat + ' HH:mm'

  const statusMap = {
    [leaveConstants.status_new()]: 'New',
    [leaveConstants.status_approved()]: 'Approved',
    [leaveConstants.status_rejected()]: 'Rejected',
    [leaveConstants.status_pended_revoke()]: 'Pended Revoke',
    [leaveConstants.status_canceled()]: 'Canceled'
  }

  if (leave.user && leave.user.department && typeof leave.user.department.toJSON === 'function') {
    leave.user.department = leave.user.department.toJSON()
  }

  const deductedDays = leave.get_deducted_days_number()

  const createdAt = leave.created_at || leave.createdAt

  return {
    startDate: moment.utc(leave.get_start_leave_day().date).format(dateFormat),
    endDate: moment.utc(leave.get_end_leave_day().date).format(dateFormat),
    dayPartStart: leave.day_part_start,
    dayPartEnd: leave.day_part_end,
    type: leave.leave_type ? leave.leave_type.name : 'N/A',
    deductedDays,
    approver: leave.approver ? leave.approver.full_name : 'N/A',
    approverId: leave.approver_id,
    status: statusMap[leave.status] || 'Unknown',

    id: leave.id,
    employeeId: leave.user_id,
    employeeFullName: leave.user ? leave.user.full_name : 'N/A',
    employeeLastName: leave.user ? leave.user.lastname : 'N/A',
    departmentId: leave.user ? leave.user.department_id : null,
    departmentName:
      leave.user && leave.user.department ? leave.user.department.name : 'N/A',
    typeId: leave.leave_type_id,
    createdAt: moment.utc(createdAt).format(dateFormat),
    createdTimeStamp: moment.utc(createdAt).tz('America/Denver').format(dateTimeStamp),

    editedAt: leave.edited_at
      ? moment.utc(leave.edited_at).format(dateFormat)
      : '',
    editedTimeStamp: leave.edited_at
      ? moment.utc(leave.edited_at).tz('America/Denver').format(dateTimeStamp)
      : '',
    wasEdited: !!leave.edited_at,

    decidedAt: leave.decided_at ? moment.utc(leave.decided_at).format(dateFormat) : '',
    decidedTimeStamp: leave.decided_at
      ? moment.utc(leave.decided_at).tz('America/Denver').format(dateTimeStamp)
      : '',

    employee_comment: leave.employee_comment || '',
    approver_comment: leave.approver_comment || ''
  }
}

const fetchLeavesForLeavesReport = async ({
  startDate,
  endDate,
  departmentId,
  leaveTypeId,
  actingUser,
  dbModel,
  companyDateFormat = 'YYYY-MM-DD',
  statusFilter
}) => {
  const startDateJS = startDate.toDate()
  const endDateJS = endDate.toDate()

  const userRelationWhere = {
    company_id: actingUser.company_id,
    ...(departmentId ? { department_id: departmentId } : {})
  }

  const statusClause =
    statusFilter && Array.isArray(statusFilter) && statusFilter.length > 0
      ? { status: { in: statusFilter } }
      : {
          status: {
            notIn: [leaveConstants.status_rejected(), leaveConstants.status_canceled()]
          }
        }

  const rows = await prisma.leaves.findMany({
    where: {
      AND: [
        dateRangeOverlapWhere(startDateJS, endDateJS),
        statusClause,
        leaveTypeId ? { leave_type_id: leaveTypeId } : {},
        { users_leaves_user_idTousers: userRelationWhere }
      ]
    },
    include: getLeaveIncludeForPrisma(),
    orderBy: { date_start: 'asc' }
  })

  const leaves = rows.map(r => wrapLeave(r, prisma))
  const leaveIds = leaves.map(l => l.id)

  const comments =
    leaveIds.length === 0
      ? []
      : await prisma.comments.findMany({
          where: {
            entity_type: dbModel.Comment.getEntityTypeLeave(),
            entity_id: { in: leaveIds }
          },
          select: { entity_id: true, comment: true }
        })

  const commentsMap = comments.reduce((acc, comment) => {
    if (!acc[comment.entity_id]) acc[comment.entity_id] = []
    acc[comment.entity_id].push(comment.comment)
    return acc
  }, {})

  const userIds = [...new Set(leaves.map(l => l.user && l.user.id).filter(Boolean))]

  const scheduleRows = await prisma.schedules.findMany({
    where: {
      OR: [
        { company_id: actingUser.company_id, user_id: null },
        { user_id: { in: userIds } }
      ]
    }
  })

  const userSchedules = scheduleRows.reduce((acc, schedule) => {
    if (schedule.user_id) {
      acc[schedule.user_id] = schedule
    } else {
      acc.companyWide = schedule
    }
    return acc
  }, {})

  for (const leave of leaves) {
    if (leave.user) {
      const schedule = userSchedules[leave.user.id] || userSchedules.companyWide
      if (schedule) {
        leave.user.cached_schedule = wrapSchedule(schedule, prisma)
      } else {
        leave.user.cached_schedule = wrapSchedule(
          await dbModel.Schedule.promise_to_build_default_for({
            company_id: actingUser.company_id
          }),
          prisma
        )
      }
    }
  }

  const processedLeaves = leaves.map(leave => {
    const leaveObj = leaveIntoObject(leave, companyDateFormat)
    return {
      ...leaveObj,
      comment: commentsMap[leave.id] ? commentsMap[leave.id].join('. ') : ''
    }
  })

  return { leaves: processedLeaves }
}

const fetchLeavesForHeatmap = async ({
  startDate,
  endDate,
  actingUser,
  dbModel: _dbModel,
  companyDateFormat = 'YYYY-MM-DD'
}) => {
  const startDateJS = startDate.toDate()
  const endDateJS = endDate.toDate()

  const rows = await prisma.leaves.findMany({
    where: {
      AND: [
        dateRangeOverlapWhere(startDateJS, endDateJS),
        {
          status: {
            in: [
              leaveConstants.status_approved(),
              leaveConstants.status_new(),
              leaveConstants.status_pended_revoke()
            ]
          }
        },
        {
          users_leaves_user_idTousers: {
            company_id: actingUser.company_id
          }
        }
      ]
    },
    include: getLeaveIncludeForPrisma(),
    orderBy: { date_start: 'asc' }
  })

  const leaves = rows.map(r => wrapLeave(r, prisma))

  const leavesByDate = {}
  const leavesDetails = {}

  leaves.forEach(leave => {
    const start = moment.utc(leave.date_start)
    const end = moment.utc(leave.date_end)
    const dateKey = start.clone()

    while (dateKey.isSameOrBefore(end, 'day')) {
      const dateStr = dateKey.format('YYYY-MM-DD')

      if (!leavesByDate[dateStr]) {
        leavesByDate[dateStr] = {
          count: 0,
          users: []
        }
      }

      const existingUser = leavesByDate[dateStr].users.find(u => u.id === leave.user.id)

      if (!existingUser) {
        const userName = leave.user ? leave.user.full_name : 'N/A'
        leavesByDate[dateStr].count++
        leavesByDate[dateStr].users.push({
          id: leave.user ? leave.user.id : null,
          name: userName,
          email: leave.user ? leave.user.email : 'N/A',
          department:
            leave.user && leave.user.department ? leave.user.department.name : 'N/A',
          leaveType: leave.leave_type ? leave.leave_type.name : 'N/A'
        })
      }

      if (!leavesDetails[dateStr]) {
        leavesDetails[dateStr] = []
      }
      const userName = leave.user ? leave.user.full_name : 'N/A'
      leavesDetails[dateStr].push({
        userId: leave.user ? leave.user.id : null,
        userName,
        userEmail: leave.user ? leave.user.email : 'N/A',
        department:
          leave.user && leave.user.department ? leave.user.department.name : 'N/A',
        leaveType: leave.leave_type ? leave.leave_type.name : 'N/A',
        startDate: moment.utc(leave.date_start).format(companyDateFormat),
        endDate: moment.utc(leave.date_end).format(companyDateFormat)
      })

      dateKey.add(1, 'day')
    }
  })

  return { leavesByDate, leavesDetails }
}

module.exports = {
  fetchLeavesForLeavesReport,
  leaveIntoObject,
  fetchLeavesForHeatmap
}
