'use strict'

const prisma = require('./client')
const moment = require('moment')
const bcrypt = require('bcrypt')
const {
  fullName,
  isActive,
  getUserAllowance,
  getUserSchedule
} = require('./userUtils')

/**
 * Prisma-based model layer to replace Sequelize models
 * This provides a similar interface to the original Sequelize models
 */

class PrismaUser {
  constructor(data) {
    Object.assign(this, data)
  }

  // Instance methods
  is_my_password(password) {
    return bcrypt.compareSync(password, this.password)
  }

  maybe_activate() {
    if (!this.activated) {
      this.activated = true
    }
    return this.save()
  }

  is_admin() {
    return this.admin === true
  }

  is_manager() {
    return this.manager === true
  }

  is_auto_approve() {
    return this.auto_approve === true
  }

  full_name() {
    return fullName(this)
  }

  is_active() {
    return isActive(this)
  }

  async save() {
    const { id, companies, departments, ...updateData } = this
    const updated = await prisma.users.update({
      where: { id: this.id },
      data: updateData
    })
    Object.assign(this, updated)
    return this
  }

  async getCompany(options = {}) {
    const include = {}
    if (options.include) {
      options.include.forEach(inc => {
        if (inc.model === 'Department' && inc.as === 'departments') {
          include.departments = true
        } else if (inc.model === 'LeaveType' && inc.as === 'leave_types') {
          include.leave_types = true
        } else if (inc.model === 'User' && inc.as === 'users') {
          include.users = true
        }
      })
    }

    return await prisma.companies.findUnique({
      where: { id: this.company_id },
      include
    })
  }

  async getDepartment() {
    return await prisma.departments.findUnique({
      where: { id: this.department_id }
    })
  }

  async promise_allowance(year = moment().year()) {
    return await getUserAllowance(this, year)
  }

  async promise_supervisors() {
    // Get departments where this user is a supervisor
    const departmentSupervisors = await prisma.department_supervisors.findMany({
      where: { user_id: this.id },
      include: {
        departments: {
          include: {
            users: true
          }
        }
      }
    })

    // Get all users from supervised departments
    const supervisedUsers = []
    for (const ds of departmentSupervisors) {
      supervisedUsers.push(...ds.departments.users)
    }

    return supervisedUsers.map(user => new PrismaUser(user))
  }

  async promise_supervised_users() {
    return await this.promise_supervisors()
  }

  async promise_supervised_departments() {
    const departmentSupervisors = await prisma.department_supervisors.findMany({
      where: { user_id: this.id },
      include: {
        departments: {
          include: {
            users: true
          }
        }
      }
    })

    return departmentSupervisors.map(ds => ({
      ...ds.departments,
      users: ds.departments.users.map(user => new PrismaUser(user))
    }))
  }

  async promise_users_I_can_manage() {
    let users = []

    if (this.is_admin()) {
      const company = await this.getCompany({
        include: [{ model: 'User', as: 'users' }]
      })
      users = company.users.map(user => new PrismaUser(user))
    } else {
      const departments = await this.promise_supervised_departments()
      users = departments.map(({ users }) => users).flat()
    }

    users.push(this)
    return users
  }

  async promise_my_active_leaves_ever() {
    const leaves = await prisma.leaves.findMany({
      where: {
        user_id: this.id,
        status: { in: [1, 2, 3] } // new, approved, pended_revoke
      },
      include: {
        leave_types: true,
        users_leaves_approver_idTousers: true
      }
    })

    return leaves.map(leave => new PrismaLeave(leave))
  }

  async promise_leaves_to_be_processed() {
    const leaves = await prisma.leaves.findMany({
      where: {
        approver_id: this.id,
        status: 1 // new/pending
      },
      include: {
        leave_types: true,
        users_leaves_user_idTousers: true
      }
    })

    return leaves.map(leave => new PrismaLeave(leave))
  }

  async get_company_with_all_leave_types() {
    return await prisma.companies.findUnique({
      where: { id: this.company_id },
      include: {
        leave_types: {
          orderBy: { sort_order: 'asc' }
        }
      }
    })
  }

  async get_company_for_add_user() {
    return await this.get_company_with_all_leave_types()
  }

  async reload_with_session_details() {
    // Reload user with all necessary details for session
    const user = await prisma.users.findUnique({
      where: { id: this.id },
      include: {
        companies: true,
        departments: true
      }
    })

    if (user) {
      Object.assign(this, user)
    }

    return this
  }
}

class PrismaLeave {
  constructor(data) {
    Object.assign(this, data)
  }

  async save() {
    const updated = await prisma.leaves.update({
      where: { id: this.id },
      data: this
    })
    Object.assign(this, updated)
    return this
  }

  async destroy() {
    await prisma.leaves.delete({
      where: { id: this.id }
    })
  }
}

class PrismaCompany {
  constructor(data) {
    Object.assign(this, data)
  }

  is_mode_readonly_holidays() {
    return this.mode === 2 // Assuming mode 2 is readonly holidays
  }

  async save() {
    const updated = await prisma.companies.update({
      where: { id: this.id },
      data: this
    })
    Object.assign(this, updated)
    return this
  }
}

class PrismaDepartment {
  constructor(data) {
    Object.assign(this, data)
  }

  async save() {
    const updated = await prisma.departments.update({
      where: { id: this.id },
      data: this
    })
    Object.assign(this, updated)
    return this
  }

  async destroy() {
    await prisma.departments.delete({
      where: { id: this.id }
    })
  }
}

// Static methods for model classes
const User = {
  async findOne(options) {
    const user = await prisma.users.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return user ? new PrismaUser(user) : null
  },

  async findAll(options = {}) {
    const users = await prisma.users.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return users.map(user => new PrismaUser(user))
  },

  async findByPk(id, options = {}) {
    const user = await prisma.users.findUnique({
      where: { id },
      include: options.include || {}
    })
    return user ? new PrismaUser(user) : null
  },

  async create(data) {
    const user = await prisma.users.create({
      data,
      include: data.include || {}
    })
    return new PrismaUser(user)
  },

  async update(data, options) {
    await prisma.users.updateMany({
      where: options.where,
      data: data
    })
  },

  async destroy(options) {
    await prisma.users.deleteMany({
      where: options.where
    })
  },

  async verify_password(password, hash) {
    return bcrypt.compareSync(password, hash)
  },

  async hash_password(password) {
    return bcrypt.hashSync(password, 10)
  },

  async find_by_email(email) {
    const user = await prisma.users.findFirst({
      where: { email: email.toLowerCase() },
      include: {
        companies: true,
        departments: true
      }
    })
    return user ? new PrismaUser(user) : null
  }
}

const Company = {
  async findOne(options) {
    const company = await prisma.companies.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return company ? new PrismaCompany(company) : null
  },

  async findAll(options = {}) {
    const companies = await prisma.companies.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return companies.map(company => new PrismaCompany(company))
  },

  async findByPk(id, options = {}) {
    const company = await prisma.companies.findUnique({
      where: { id },
      include: options.include || {}
    })
    return company ? new PrismaCompany(company) : null
  },

  async create(data) {
    const company = await prisma.companies.create({
      data,
      include: data.include || {}
    })
    return new PrismaCompany(company)
  }
}

const Department = {
  async findOne(options) {
    const department = await prisma.departments.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return department ? new PrismaDepartment(department) : null
  },

  async findAll(options = {}) {
    const departments = await prisma.departments.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return departments.map(department => new PrismaDepartment(department))
  },

  async findByPk(id, options = {}) {
    const department = await prisma.departments.findUnique({
      where: { id },
      include: options.include || {}
    })
    return department ? new PrismaDepartment(department) : null
  },

  async create(data) {
    const department = await prisma.departments.create({
      data,
      include: data.include || {}
    })
    return new PrismaDepartment(department)
  }
}

const Leave = {
  async findOne(options) {
    const leave = await prisma.leaves.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return leave ? new PrismaLeave(leave) : null
  },

  async findAll(options = {}) {
    const leaves = await prisma.leaves.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return leaves.map(leave => new PrismaLeave(leave))
  },

  async findByPk(id, options = {}) {
    const leave = await prisma.leaves.findUnique({
      where: { id },
      include: options.include || {}
    })
    return leave ? new PrismaLeave(leave) : null
  },

  async create(data) {
    const leave = await prisma.leaves.create({
      data,
      include: data.include || {}
    })
    return new PrismaLeave(leave)
  }
}

// Additional models
const LeaveType = {
  async findOne(options) {
    const leaveType = await prisma.leave_types.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return leaveType
  },

  async findAll(options = {}) {
    const leaveTypes = await prisma.leave_types.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return leaveTypes
  }
}

const BankHoliday = {
  async findOne(options) {
    const bankHoliday = await prisma.bank_holidays.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return bankHoliday
  },

  async findAll(options = {}) {
    const bankHolidays = await prisma.bank_holidays.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return bankHolidays
  }
}

const Comment = {
  async findOne(options) {
    const comment = await prisma.comments.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return comment
  },

  async findAll(options = {}) {
    const comments = await prisma.comments.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return comments
  },

  async create(data) {
    return await prisma.comments.create({
      data,
      include: data.include || {}
    })
  }
}

const Audit = {
  async findOne(options) {
    const audit = await prisma.audit.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return audit
  },

  async findAll(options = {}) {
    const audits = await prisma.audit.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return audits
  },

  async create(data) {
    return await prisma.audit.create({
      data,
      include: data.include || {}
    })
  }
}

const EmailAudit = {
  async findOne(options) {
    const emailAudit = await prisma.email_audits.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return emailAudit
  },

  async findAll(options = {}) {
    const emailAudits = await prisma.email_audits.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return emailAudits
  },

  async create(data) {
    return await prisma.email_audits.create({
      data,
      include: data.include || {}
    })
  }
}

const Schedule = {
  async findOne(options) {
    const schedule = await prisma.schedules.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return schedule
  },

  async findAll(options = {}) {
    const schedules = await prisma.schedules.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return schedules
  },

  async create(data) {
    return await prisma.schedules.create({
      data,
      include: data.include || {}
    })
  }
}

const UserFeed = {
  async findOne(options) {
    const userFeed = await prisma.user_feeds.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return userFeed
  },

  async findAll(options = {}) {
    const userFeeds = await prisma.user_feeds.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return userFeeds
  },

  async create(data) {
    return await prisma.user_feeds.create({
      data,
      include: data.include || {}
    })
  }
}

const UserAllowanceAdjustment = {
  async findOne(options) {
    const adjustment = await prisma.user_allowance_adjustment.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return adjustment
  },

  async findAll(options = {}) {
    const adjustments = await prisma.user_allowance_adjustment.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return adjustments
  },

  async create(data) {
    return await prisma.user_allowance_adjustment.create({
      data,
      include: data.include || {}
    })
  }
}

const DepartmentSupervisor = {
  async findOne(options) {
    const supervisor = await prisma.department_supervisors.findFirst({
      where: options.where,
      include: options.include || {}
    })
    return supervisor
  },

  async findAll(options = {}) {
    const supervisors = await prisma.department_supervisors.findMany({
      where: options.where,
      include: options.include || {},
      orderBy: options.order || []
    })
    return supervisors
  },

  async create(data) {
    return await prisma.department_supervisors.create({
      data,
      include: data.include || {}
    })
  },

  async destroy(options) {
    await prisma.department_supervisors.deleteMany({
      where: options.where
    })
  }
}

module.exports = {
  User,
  Company,
  Department,
  Leave,
  LeaveType,
  BankHoliday,
  Comment,
  Audit,
  EmailAudit,
  Schedule,
  UserFeed,
  UserAllowanceAdjustment,
  DepartmentSupervisor,
  PrismaUser,
  PrismaLeave,
  PrismaCompany,
  PrismaDepartment
}
