'use strict'

const Promise = require('bluebird')
const moment = require('moment')

const getUsersWithLeaves = async ({
  company,
  startDate = company.get_today(),
  endDate = company.get_today(),
  department_id = null
}) => {
  const { User, Leave, LeaveType, Department } = company.sequelize.models

  const userWhereClause = { company_id: company.id }
  if (department_id) {
    userWhereClause.department_id = department_id
  }

  const users = await User.findAll({
    attributes: ['id', 'email'],
    where: userWhereClause,
    include: [
      {
        model: Department,
        attributes: ['name']
      }
    ]
  })

  const userIds = users.map(user => user.id)

  const leaves = await Leave.findAll({
    where: {
      user_id: { [company.sequelize.Op.in]: userIds },
      [company.sequelize.Op.and]: [
        { start_date: { [company.sequelize.Op.lte]: endDate } },
        { end_date: { [company.sequelize.Op.gte]: startDate } }
      ]
    },
    include: [
      {
        model: LeaveType,
        attributes: ['name']
      }
    ]
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
      department: user.Department.name,
      email: user.email,
      fullName: user.full_name()
    },
    leaves: (leavesByUserId[user.id] || []).map(leave => leaveIntoObject(leave))
  }))
}

const leaveIntoObject = leave => {
  const dateFormat = 'YYYY-MM-DD'
  const dateTimeStamp = 'YYYY-MM-DD HH:mm'

  const Leave = leave.sequelize.models.Leave

  const statusMap = {
    [Leave.status_new()]: 'New',
    [Leave.status_approved()]: 'Approved',
    [Leave.status_rejected()]: 'Rejected',
    [Leave.status_pended_revoke()]: 'Pended Revoke',
    [Leave.status_canceled()]: 'Canceled'
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
  actingUser,
  dbModel
}) => {
  const {
    User,
    Leave,
    LeaveType,
    Department,
    Comment,
    Company,
    BankHoliday,
    Schedule
  } = dbModel

  // Convert Moment objects to JavaScript Date objects
  const startDateJS = startDate.toDate()
  const endDateJS = endDate.toDate()

  const whereClause = {
    [dbModel.Sequelize.Op.or]: [
      {
        date_start: {
          [dbModel.Sequelize.Op.between]: [startDateJS, endDateJS]
        }
      },
      {
        date_end: {
          [dbModel.Sequelize.Op.between]: [startDateJS, endDateJS]
        }
      },
      {
        [dbModel.Sequelize.Op.and]: [
          { date_start: { [dbModel.Sequelize.Op.lte]: startDateJS } },
          { date_end: { [dbModel.Sequelize.Op.gte]: endDateJS } }
        ]
      }
    ],
    status: {
      [dbModel.Sequelize.Op.notIn]: [
        Leave.status_rejected(),
        Leave.status_canceled()
      ]
    }
  }

  if (leaveTypeId) {
    whereClause.leave_type_id = leaveTypeId
  }

  const includeArray = [
    {
      model: User,
      as: 'user',
      attributes: ['id', 'name', 'lastname', 'email'],
      where: {
        company_id: actingUser.company_id,
        ...(departmentId ? { department_id: departmentId } : {})
      },
      include: [
        {
          model: Department,
          as: 'department',
          attributes: ['id', 'name']
        },
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'country', 'timezone'],
          include: [
            {
              model: BankHoliday,
              as: 'bank_holidays',
              attributes: ['id', 'name', 'date']
            }
          ]
        }
      ]
    },
    {
      model: LeaveType,
      as: 'leave_type',
      attributes: ['id', 'name', 'use_allowance']
    },
    {
      model: User,
      as: 'approver',
      attributes: ['id', 'name', 'lastname']
    }
  ]

  const leaves = await Leave.findAll({
    where: whereClause,
    include: includeArray,
    order: [['date_start', 'ASC']]
  })

  const leaveIds = leaves.map(leave => leave.id)

  const comments = await Comment.findAll({
    where: {
      entity_type: Comment.getEntityTypeLeave(),
      entity_id: { [dbModel.Sequelize.Op.in]: leaveIds }
    },
    attributes: ['entity_id', 'comment']
  })

  const commentsMap = comments.reduce((acc, comment) => {
    if (!acc[comment.entity_id]) {
      acc[comment.entity_id] = []
    }
    acc[comment.entity_id].push(comment.comment)
    return acc
  }, {})

  // Fetch all relevant schedules
  const schedules = await Schedule.findAll({
    where: {
      [dbModel.Sequelize.Op.or]: [
        { company_id: actingUser.company_id, user_id: null },
        { user_id: leaves.map(leave => leave.user.id) }
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
    if (leave.user) {
      // Get user-specific schedule or fall back to company-wide schedule
      const schedule = userSchedules[leave.user.id] || userSchedules.companyWide
      if (schedule) {
        leave.user.cached_schedule = schedule
      } else {
        // If no schedule found, create a default one
        leave.user.cached_schedule = await Schedule.promise_to_build_default_for(
          {
            company_id: actingUser.company_id
          }
        )
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
