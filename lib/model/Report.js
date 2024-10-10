'use strict'

const Promise = require('bluebird')
const moment = require('moment')
const { Op } = require('sequelize')

const getUsersWithLeaves = async ({
  company,
  startDate = company.get_today(),
  endDate = company.get_today(),
  department_id = null
}) => {
  const { User, Leave, LeaveType, Department } = company.sequelize.models

  const whereClause = { company_id: company.id }
  if (department_id) {
    whereClause.department_id = department_id
  }

  const users = await User.findAll({
    where: whereClause,
    include: [
      {
        model: Department,
        attributes: ['name']
      },
      {
        model: Leave,
        required: false,
        include: [
          {
            model: LeaveType,
            attributes: ['name']
          }
        ],
        where: {
          [company.sequelize.Op.or]: [
            {
              date_start: {
                [company.sequelize.Op.between]: [startDate, endDate]
              }
            },
            {
              date_end: {
                [company.sequelize.Op.between]: [startDate, endDate]
              }
            }
          ]
        }
      }
    ]
  })

  return users.map(user => ({
    user: {
      id: user.id,
      department: user.Department.name,
      email: user.email,
      fullName: user.full_name()
    },
    leaves: user.Leaves.map(leave => leaveIntoObject(leave))
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

  return {
    startDate: moment.utc(leave.get_start_leave_day().date).format(dateFormat),
    endDate: moment.utc(leave.get_end_leave_day().date).format(dateFormat),
    dayPartStart: leave.day_part_start,
    dayPartEnd: leave.day_part_end,
    type: leave.leave_type ? leave.leave_type.name : 'N/A',
    deductedDays: leave.leave_type ? leave.get_deducted_days_number() : 'N/A',
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
  const { User, Leave, LeaveType, Department, Comment } = dbModel

  // Convert Moment objects to ISO string format
  const startDateStr = moment(startDate).format('YYYY-MM-DD')
  const endDateStr = moment(endDate).format('YYYY-MM-DD')

  const whereClause = {
    company_id: actingUser.company_id,
    '$my_leaves.date_start$': { [Op.lte]: endDateStr },
    '$my_leaves.date_end$': { [Op.gte]: startDateStr }
  }

  if (departmentId) {
    whereClause.department_id = departmentId
  }

  if (leaveTypeId) {
    whereClause['$my_leaves.leave_type_id$'] = leaveTypeId
  }

  const users = await User.findAll({
    where: whereClause,
    include: [
      {
        model: Department,
        as: 'department',
        attributes: ['name']
      },
      {
        model: Leave,
        as: 'my_leaves',
        required: true,
        include: [
          {
            model: LeaveType,
            as: 'leave_type',
            attributes: ['name']
          },
          {
            model: User,
            as: 'approver',
            attributes: ['id', 'name', 'lastname']
          }
        ]
      }
    ],
    order: [
      ['lastname', 'ASC'],
      ['name', 'ASC'],
      [{ model: Leave, as: 'my_leaves' }, 'date_start', 'ASC']
    ]
  })

  const leaveIds = users.flatMap(user => user.my_leaves.map(leave => leave.id))

  const comments = await Comment.findAll({
    where: {
      company_id: actingUser.company_id,
      entity_type: Comment.getEntityTypeLeave(),
      entity_id: { [Op.in]: leaveIds }
    }
  })

  const commentsMap = comments.reduce((map, comment) => {
    if (!map[comment.entity_id]) {
      map[comment.entity_id] = []
    }
    map[comment.entity_id].push(comment.comment)
    return map
  }, {})

  const leaves = users.flatMap(user =>
    user.my_leaves.map(leave => ({
      ...leaveIntoObject(leave),
      employeeFullName: user.full_name(),
      employeeLastName: user.lastname,
      departmentName: user.department ? user.department.name : 'N/A',
      comment: commentsMap[leave.id] ? commentsMap[leave.id].join('. ') : ''
    }))
  )

  return { leaves }
}

module.exports = {
  getUsersWithLeaves,
  fetchLeavesForLeavesReport,
  leaveIntoObject
}
