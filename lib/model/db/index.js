'use strict'

const htmlToText = require('html-to-text')
const prisma = require('../../prisma/client')
const leaveConstants = require('../leave_constants')
const sessionUser = require('../sessionUser')
const {
  wrapLeave,
  wrapLeaveType,
  wrapUser,
  wrapCompany,
  createDefaultCompany
} = sessionUser

/** Sequelize-style Op shim for legacy callers (prefer Prisma filters in new code). */
const Op = {
  in: Symbol.for('in'),
  gte: Symbol.for('gte'),
  lte: Symbol.for('lte'),
  ne: Symbol.for('ne'),
  between: Symbol.for('between'),
  or: Symbol.for('or'),
  and: Symbol.for('and')
}

function mapCommentRow(row) {
  if (!row) return row
  return Object.assign({}, row)
}

const Comment = {
  getEntityTypeLeave: () => 'LEAVE',

  async create(attrs) {
    const row = await prisma.comments.create({
      data: {
        entity_type: attrs.entity_type,
        entity_id: attrs.entity_id,
        comment: attrs.comment,
        company_id: attrs.company_id,
        by_user_id: attrs.by_user_id,
        at: new Date()
      }
    })
    return mapCommentRow(row)
  },

  async findAll({ where, attributes }) {
    const rows = await prisma.comments.findMany({
      where: where || {},
      select: attributes
        ? attributes.reduce((acc, a) => {
            acc[a] = true
            return acc
          }, {})
        : undefined
    })
    return rows.map(mapCommentRow)
  }
}

const Leave = {
  status_new: () => leaveConstants.status_new(),
  status_approved: () => leaveConstants.status_approved(),
  status_rejected: () => leaveConstants.status_rejected(),
  status_pended_revoke: () => leaveConstants.status_pended_revoke(),
  status_canceled: () => leaveConstants.status_canceled(),
  leave_day_part_all: () => leaveConstants.leave_day_part_all(),
  leave_day_part_morning: () => leaveConstants.leave_day_part_morning(),
  leave_day_part_afternoon: () => leaveConstants.leave_day_part_afternoon(),

  does_skip_approval(user, leaveType) {
    return user.is_auto_approve() || (leaveType && leaveType.is_auto_approve())
  },

  does_use_personal(leaveType) {
    return !!(leaveType && leaveType.use_personal)
  },

  build(attrs) {
    return wrapLeave(Object.assign({}, attrs), prisma)
  },

  async findOne({ where }) {
    const row = await prisma.leaves.findFirst({
      where: where || {},
      include: sessionUser.getLeaveIncludeForPrisma()
    })
    return row ? wrapLeave(row, prisma) : null
  },

  async findAll({ where, include, order }) {
    const rows = await prisma.leaves.findMany({
      where: where || {},
      include: include ? sessionUser.getLeaveIncludeForPrisma() : undefined,
      orderBy: order ? { date_start: 'asc' } : undefined
    })
    return rows.map(r => wrapLeave(r, prisma))
  }
}

const Company = {
  get_mode_readonly_holidays: () => 2,

  async getCompanyByApiToken({ token }) {
    const row = await prisma.companies.findFirst({
      where: {
        integration_api_token: token,
        integration_api_enabled: true
      },
      include: {
        users: {
          where: {
            admin: true,
            OR: [{ end_date: null }, { end_date: { gte: new Date() } }]
          },
          include: {
            companies: true,
            departments: true
          }
        }
      }
    })
    return row ? wrapCompany(row, prisma) : null
  },

  create_default_company: args => createDefaultCompany(prisma, args),

  async restore_from_dump() {
    throw new Error(
      'Company.restore_from_dump is not implemented for Prisma. Restore from a database backup or re-add a dedicated import tool.'
    )
  },

  scope(scopeName) {
    return {
      async findOne({ where }) {
        const companyRow = await prisma.companies.findFirst({
          where: where || {},
          include:
            scopeName === 'with_simple_departments'
              ? { departments: { orderBy: { name: 'asc' } } }
              : undefined
        })
        if (!companyRow) return null
        return wrapCompany(companyRow, prisma)
      }
    }
  }
}

const Department = {
  default_order_field() {
    return 'name'
  },

  build(attrs) {
    return sessionUser.wrapDepartment(
      Object.assign(
        {
          id: 1,
          name: 'Stub',
          company_id: 1,
          allowance: 20,
          personal: 5,
          include_public_holidays: true,
          is_accrued_allowance: false,
          manager_id: null,
          shifts: null,
          shift_hours: null,
          allowed_increments: null,
          created_at: new Date(),
          updated_at: new Date()
        },
        attrs || {}
      ),
      prisma
    )
  }
}

Department.findOne = async function({ where }) {
  return prisma.departments.findFirst({
    where: where || {}
  })
}

Department.create = async function(data) {
  const now = new Date()
  return prisma.departments.create({
    data: Object.assign(
      {
        allowance: 20,
        personal: 5,
        include_public_holidays: true,
        is_accrued_allowance: false,
        created_at: now,
        updated_at: now
      },
      data
    )
  })
}

const Schedule = {
  build(attrs) {
    return sessionUser.wrapSchedule(
      Object.assign(
        {
          company_id: null,
          user_id: null,
          monday: 1,
          tuesday: 1,
          wednesday: 1,
          thursday: 1,
          friday: 1,
          saturday: 2,
          sunday: 2
        },
        attrs || {}
      ),
      prisma
    )
  },

  promise_to_build_default_for(args) {
    return Promise.resolve(
      sessionUser.wrapSchedule(
        {
          company_id: args.company_id || null,
          user_id: args.user_id || null,
          monday: 1,
          tuesday: 1,
          wednesday: 1,
          thursday: 1,
          friday: 1,
          saturday: 2,
          sunday: 2
        },
        prisma
      )
    )
  }
}

const LeaveType = {
  async create(attributes) {
    const data = Object.assign({}, attributes, {
      created_at: new Date(),
      updated_at: new Date()
    })
    if (data.limit != null && typeof data.limit !== 'number') {
      const parsed = parseInt(String(data.limit), 10)
      data.limit = Number.isNaN(parsed) ? 0 : parsed
    }
    if (data.sort_order != null && typeof data.sort_order !== 'number') {
      const parsed = parseInt(String(data.sort_order), 10)
      data.sort_order = Number.isNaN(parsed) ? 0 : parsed
    }
    const row = await prisma.leave_types.create({ data })
    return wrapLeaveType(row, prisma)
  }
}

const BankHoliday = {
  create(data) {
    return prisma.bank_holidays.create({
      data: Object.assign({}, data, {
        created_at: new Date(),
        updated_at: new Date()
      })
    })
  },

  bulkCreate(rows) {
    return prisma.bank_holidays.createMany({
      data: rows.map(r =>
        Object.assign({}, r, {
          created_at: new Date(),
          updated_at: new Date()
        })
      )
    })
  }
}

const EmailAudit = {
  async findAndCountAll({ where, limit, offset, order, include }) {
    const wherePrisma = {}
    if (where.company_id) wherePrisma.company_id = where.company_id
    if (where.user_id) wherePrisma.user_id = where.user_id
    if (where.created_at) {
      if (where.created_at.$gte)
        wherePrisma.created_at = Object.assign(wherePrisma.created_at || {}, {
          gte: new Date(where.created_at.$gte)
        })
      if (where.created_at.$lte) {
        wherePrisma.created_at = Object.assign(wherePrisma.created_at || {}, {
          lte: new Date(where.created_at.$lte)
        })
      }
    }

    const [rows, count] = await Promise.all([
      prisma.email_audits.findMany({
        where: wherePrisma,
        take: limit,
        skip: offset,
        orderBy: { id: 'desc' },
        include: include
          ? {
              users: true
            }
          : undefined
      }),
      prisma.email_audits.count({ where: wherePrisma })
    ])

    const mappedRows = rows.map(row => {
      const body_as_text =
        row.body && row.body.indexOf('DOCTYPE') > 0
          ? htmlToText.fromString(row.body)
          : row.body || ''
      const { users: userRow, ...rest } = row
      return Object.assign({}, rest, {
        user: userRow ? wrapUser(userRow, prisma) : null,
        body_as_text
      })
    })

    return { rows: mappedRows, count }
  }
}

const Audit = {
  create(data) {
    return prisma.audit.create({
      data: {
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        attribute: data.attribute,
        old_value: data.old_value != null ? String(data.old_value) : null,
        new_value: data.new_value != null ? String(data.new_value) : null,
        company_id: data.company_id != null ? data.company_id : null,
        by_user_id: data.by_user_id != null ? data.by_user_id : null,
        at: new Date()
      }
    })
  },

  async findAll({ where, raw }) {
    const rows = await prisma.audit.findMany({
      where: where || {},
      orderBy: { at: 'desc' }
    })
    if (raw) {
      return rows.map(row => Object.assign({}, row))
    }
    return rows
  }
}

const UserFeed = {
  async find({ where, include }) {
    const row = await prisma.user_feeds.findFirst({
      where: where || {},
      include: {
        users: {
          include: {
            companies: true
          }
        }
      }
    })
    if (!row) return null
    return decorateFeed(row)
  },

  async findOne({ where, include }) {
    return UserFeed.find({ where, include })
  },

  async promise_new_feed(args) {
    const { v4: uuidv4 } = require('uuid')
    const user = args.user
    const type = args.type

    const existing = await prisma.user_feeds.findFirst({
      where: { user_id: user.id, type }
    })

    if (existing) {
      await prisma.user_feeds.update({
        where: { id: existing.id },
        data: { feed_token: uuidv4(), updated_at: new Date() }
      })
      return prisma.user_feeds.findUnique({ where: { id: existing.id } })
    }

    return prisma.user_feeds.create({
      data: {
        name: 'Calendar Feed',
        feed_token: uuidv4(),
        type,
        user_id: user.id,
        created_at: new Date(),
        updated_at: new Date()
      }
    })
  }
}

function decorateFeed(row) {
  const feed = Object.assign({}, row)
  feed.user = wrapUser(row.users, prisma)
  feed.is_calendar = function() {
    return this.type === 'calendar'
  }
  feed.is_team_view = function() {
    return this.type === 'wallchart' || this.type === 'teamview'
  }
  return feed
}

const User = sessionUser.User

User.create = async function(attributes) {
  const now = new Date()
  const data = Object.assign({}, attributes)
  if (data.start_date != null && !(data.start_date instanceof Date)) {
    data.start_date = new Date(data.start_date)
  }
  if (!data.start_date) {
    data.start_date = now
  }
  if (data.slack_username == null) {
    data.slack_username = ''
  }
  data.created_at = now
  data.updated_at = now
  const row = await prisma.users.create({
    data,
    include: {
      companies: true,
      departments: true
    }
  })
  return wrapUser(row, prisma)
}

User.build = function(attrs) {
  const a = attrs || {}
  const row = Object.assign(
    {
      id: 1,
      email: 'stub@test.com',
      name: 'Stub',
      lastname: 'User',
      activated: true,
      admin: false,
      manager: false,
      auto_approve: false,
      company_id: 1,
      department_id: 1,
      password: 'x',
      slack_username: '',
      reset_password_token: null,
      reset_password_expires: null,
      shifts: null,
      shift_hours: null,
      created_at: new Date(),
      updated_at: new Date(),
      end_date: null,
      departments: {
        id: 1,
        name: 'Stub',
        company_id: 1,
        allowance: 20,
        personal: 5,
        include_public_holidays: true,
        is_accrued_allowance: false,
        manager_id: null,
        shifts: null,
        shift_hours: null,
        allowed_increments: null,
        created_at: new Date(),
        updated_at: new Date()
      },
      companies: {
        id: 1,
        name: 'Stub Co',
        timezone: 'UTC',
        date_format: 'YYYY-MM-DD',
        first_day_of_week: 1
      }
    },
    a
  )

  const user = wrapUser(row, prisma)
  if (a.department) {
    user.department = a.department
  }
  return user
}

const Sequelize = { Op }

module.exports = {
  prisma,
  sequelize: null,
  Sequelize,
  User,
  Company,
  Leave,
  Department,
  Schedule,
  LeaveType,
  BankHoliday,
  Comment,
  EmailAudit,
  UserFeed,
  UserAllowanceAdjustment: {},
  DepartmentSupervisor: {},
  Audit
}
