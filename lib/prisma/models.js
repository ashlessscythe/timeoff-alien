'use strict'

const prisma = require('./client')
const moment = require('moment-timezone')
const bcrypt = require('bcrypt')
const { fullName, isActive, getUserAllowance } = require('./userUtils')

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
    // Extract relation fields that shouldn't be updated directly
    const {
      id,
      companies,
      departments,
      company, // singular company object
      department, // singular department object
      audit,
      comments,
      department_supervisors,
      email_audits,
      leaves_leaves_approver_idTousers,
      leaves_leaves_user_idTousers,
      schedules,
      user_allowance_adjustment,
      user_feeds,
      user_messages,
      ...updateData
    } = this

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
        } else if (inc.model === 'BankHoliday' && inc.as === 'bank_holidays') {
          include.bank_holidays = true
        }
      })
    }

    const company = await prisma.companies.findUnique({
      where: { id: this.company_id },
      include
    })

    return company ? new PrismaCompany(company) : null
  }

  async getDepartment() {
    const department = await prisma.departments.findUnique({
      where: { id: this.department_id }
    })
    return department ? new PrismaDepartment(department) : null
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
    const company = await prisma.companies.findUnique({
      where: { id: this.company_id },
      include: {
        leave_types: {
          orderBy: { sort_order: 'asc' }
        }
      }
    })
    return company ? new PrismaCompany(company) : null
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
      // Map the Prisma relation fields to the expected singular names and wrap in model classes
      this.company = new PrismaCompany(user.companies)
      this.department = new PrismaDepartment(user.departments)
    }

    return this
  }

  async reload_with_leave_details(args = {}) {
    const year = args.year || this.company.get_today()

    // Get user's leaves for the specified year
    const leaves = await prisma.leaves.findMany({
      where: {
        user_id: this.id,
        status: { in: [1, 2, 3] }, // new, approved, pended_revoke
        OR: [
          {
            date_start: {
              gte: moment
                .utc(year)
                .startOf('year')
                .toDate(),
              lte: moment
                .utc(year)
                .endOf('year')
                .toDate()
            }
          },
          {
            date_end: {
              gte: moment
                .utc(year)
                .startOf('year')
                .toDate(),
              lte: moment
                .utc(year)
                .endOf('year')
                .toDate()
            }
          }
        ]
      },
      include: {
        leave_types: true,
        users_leaves_approver_idTousers: true
      }
    })

    // Set my_leaves property
    this.my_leaves = leaves.map(leave => new PrismaLeave(leave))

    return this
  }

  async promise_calendar(args = {}) {
    const year = args.year || this.company.get_today()
    const show_full_year = args.show_full_year || false

    // Find out if we need to show multi year calendar
    const is_multi_year = this.company.get_today().month() > 8

    const months_to_show = this._get_calendar_months_to_show({
      year: year.clone(),
      show_full_year
    })

    // Get department, company, leaves, and schedule
    const [department, company, leaves, schedule] = await Promise.all([
      this.getDepartment(),
      this.getCompany({
        include: [
          { model: 'BankHoliday', as: 'bank_holidays' },
          { model: 'LeaveType', as: 'leave_types' }
        ]
      }),
      this.promise_my_active_leaves_ever(),
      this.promise_schedule_I_obey()
    ])

    // Filter leaves for the year
    const yearStart = moment
      .utc(year)
      .startOf('year')
      .format('YYYY-MM-DD')
    const yearEnd = moment
      .utc(year.clone().add(is_multi_year ? 1 : 0, 'years'))
      .endOf('year')
      .format('YYYY-MM-DD 23:59:59')

    const relevantLeaves = leaves.filter(
      leave =>
        (leave.date_start >= yearStart && leave.date_start <= yearEnd) ||
        (leave.date_end >= yearStart && leave.date_end <= yearEnd)
    )

    const leave_days = []
    for (const leave of relevantLeaves) {
      const days = leave.get_days()
      for (const day of days) {
        day.leave = leave
        leave_days.push(day)
      }
    }

    // Create calendar months
    const CalendarMonth = require('../model/calendar_month')
    return months_to_show.map(
      month =>
        new CalendarMonth(month, {
          bank_holidays: department.include_public_holidays
            ? company.bank_holidays
            : [],
          leave_days,
          schedule,
          today: company.get_today(),
          leave_types: company.leave_types,
          first_day_of_week: company.first_day_of_week
        })
    )
  }

  _get_calendar_months_to_show(args) {
    const year = args.year || moment.utc()
    const show_full_year = args.show_full_year || false

    if (show_full_year) {
      const months = []
      for (let i = 0; i < 12; i++) {
        months.push(
          year
            .clone()
            .add(i, 'months')
            .startOf('month')
        )
      }
      return months
    } else {
      // Show current month and next 2 months
      return [
        year.clone().startOf('month'),
        year
          .clone()
          .add(1, 'months')
          .startOf('month'),
        year
          .clone()
          .add(2, 'months')
          .startOf('month')
      ]
    }
  }

  async promise_schedule_I_obey() {
    // Get user's schedule from database
    const schedule = await prisma.schedules.findFirst({
      where: {
        OR: [
          { user_id: this.id },
          { company_id: this.company_id, user_id: null }
        ]
      },
      orderBy: [
        { user_id: 'asc' }, // User-specific schedules first
        { company_id: 'asc' }
      ]
    })

    if (schedule) {
      return new PrismaSchedule(schedule)
    }

    // Return default schedule if none found
    return new PrismaSchedule({
      monday: 1,
      tuesday: 1,
      wednesday: 1,
      thursday: 1,
      friday: 1,
      saturday: 2,
      sunday: 2
    })
  }

  async get_leave_statistics_by_types() {
    if (!this.my_leaves) {
      await this.reload_with_leave_details()
    }

    const leaveTypes = await prisma.leave_types.findMany({
      where: { company_id: this.company_id }
    })

    const statistics = leaveTypes.map(leaveType => {
      const relevantLeaves = this.my_leaves.filter(
        leave => leave.leave_type_id === leaveType.id
      )

      let days_taken = 0
      for (const leave of relevantLeaves) {
        const days = leave.get_days()
        days_taken += days.length
      }

      return {
        leave_type_id: leaveType.id,
        leave_type_name: leaveType.name,
        days_taken
      }
    })

    return statistics
  }

  async promise_allowance(args = {}) {
    const year = args.year || this.company.get_today()
    return await getUserAllowance(this, year)
  }

  async promise_adjustment_and_carry_over_for_year(year) {
    const adjustment = await prisma.user_allowance_adjustment.findFirst({
      where: {
        user_id: this.id,
        year: year.year()
      }
    })

    return {
      manual_adjustment: adjustment ? adjustment.adjustment : 0,
      personal_adjustment: adjustment ? adjustment.personal_adjustment : 0,
      carried_over_allowance: adjustment ? adjustment.carried_over_allowance : 0
    }
  }

  toJSON() {
    // Return a plain object representation for JSON serialization
    return {
      id: this.id,
      email: this.email,
      slack_username: this.slack_username,
      name: this.name,
      lastname: this.lastname,
      activated: this.activated,
      admin: this.admin,
      manager: this.manager,
      auto_approve: this.auto_approve,
      reset_password_token: this.reset_password_token,
      reset_password_expires: this.reset_password_expires,
      start_date: this.start_date,
      end_date: this.end_date,
      created_at: this.created_at,
      updated_at: this.updated_at,
      company_id: this.company_id,
      department_id: this.department_id
    }
  }
}

class PrismaLeave {
  constructor(data) {
    Object.assign(this, data)
  }

  async save() {
    // Extract relation fields that shouldn't be updated directly
    const {
      id,
      users_leaves_approver_idTousers,
      leave_types,
      users_leaves_user_idTousers,
      ...updateData
    } = this

    const updated = await prisma.leaves.update({
      where: { id: this.id },
      data: updateData
    })
    Object.assign(this, updated)
    return this
  }

  async destroy() {
    await prisma.leaves.delete({
      where: { id: this.id }
    })
  }

  get_days() {
    // Generate array of leave days between date_start and date_end
    const days = []
    const start = moment(this.date_start)
    const end = moment(this.date_end)

    const current = start.clone()
    while (current.isSameOrBefore(end, 'day')) {
      days.push({
        date: current.clone(),
        day_part_start: this.day_part_start,
        day_part_end: this.day_part_end,
        leave: this
      })
      current.add(1, 'day')
    }

    return days
  }

  is_new_leave() {
    return this.status === 1 // new/pending status
  }

  toJSON() {
    // Return a plain object representation for JSON serialization
    return {
      id: this.id,
      status: this.status,
      employee_comment: this.employee_comment,
      approver_comment: this.approver_comment,
      decided_at: this.decided_at,
      date_start: this.date_start,
      day_part_start: this.day_part_start,
      date_end: this.date_end,
      day_part_end: this.day_part_end,
      created_at: this.created_at,
      updated_at: this.updated_at,
      user_id: this.user_id,
      approver_id: this.approver_id,
      leave_type_id: this.leave_type_id
    }
  }
}

class PrismaSchedule {
  constructor(data) {
    Object.assign(this, data)
  }

  is_it_working_day(args) {
    const day = args.day
    const dayOfWeek = day.day() // 0 = Sunday, 1 = Monday, etc.

    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday'
    ]
    const dayName = dayNames[dayOfWeek]

    // Check if this day is a working day (value 1) or non-working day (value 2)
    return this[dayName] === 1
  }

  is_user_specific() {
    return this.user_id !== null
  }

  async save() {
    if (this.id) {
      const updated = await prisma.schedules.update({
        where: { id: this.id },
        data: {
          monday: this.monday,
          tuesday: this.tuesday,
          wednesday: this.wednesday,
          thursday: this.thursday,
          friday: this.friday,
          saturday: this.saturday,
          sunday: this.sunday
        }
      })
      Object.assign(this, updated)
    } else {
      const created = await prisma.schedules.create({
        data: {
          monday: this.monday,
          tuesday: this.tuesday,
          wednesday: this.wednesday,
          thursday: this.thursday,
          friday: this.friday,
          saturday: this.saturday,
          sunday: this.sunday,
          company_id: this.company_id,
          user_id: this.user_id
        }
      })
      Object.assign(this, created)
    }
    return this
  }

  async destroy() {
    if (this.id) {
      await prisma.schedules.delete({
        where: { id: this.id }
      })
    }
  }
}

class PrismaCompany {
  constructor(data) {
    Object.assign(this, data)
  }

  is_mode_readonly_holidays() {
    return this.mode === 2 // Assuming mode 2 is readonly holidays
  }

  get_today() {
    // Return current date in company's timezone
    const timezone = this.timezone || 'America/Denver'
    return moment().tz(timezone)
  }

  normalise_date(date) {
    // Normalize a date according to company's timezone and date format
    const timezone = this.timezone || 'America/Denver'
    const dateFormat = this.date_format || 'YYYY-MM-DD'

    if (!date) return null

    // If date is already a moment object, convert to company timezone
    if (moment.isMoment(date)) {
      return date.tz(timezone)
    }

    // If date is a string, parse it and convert to company timezone
    if (typeof date === 'string') {
      return moment.tz(date, timezone)
    }

    // If date is a Date object, convert to moment and company timezone
    if (date instanceof Date) {
      return moment(date).tz(timezone)
    }

    return moment.tz(date, timezone)
  }

  async reload_with_bank_holidays() {
    // Load bank holidays for this company
    this.bank_holidays = await prisma.bank_holidays.findMany({
      where: { company_id: this.id }
    })
    return this
  }

  get_default_date_format() {
    return this.date_format || 'YYYY-MM-DD'
  }

  get_default_date_format_for_date_picker() {
    // Convert from moment format to datepicker format
    const format = this.get_default_date_format()
    return format
      .replace('YYYY', 'yyyy')
      .replace('MM', 'mm')
      .replace('DD', 'dd')
  }

  toJSON() {
    // Return a plain object representation for JSON serialization
    return {
      id: this.id,
      name: this.name,
      country: this.country,
      start_of_new_year: this.start_of_new_year,
      share_all_absences: this.share_all_absences,
      is_team_view_hidden: this.is_team_view_hidden,
      ldap_auth_enabled: this.ldap_auth_enabled,
      ldap_auth_config: this.ldap_auth_config,
      date_format: this.date_format,
      company_wide_message: this.company_wide_message,
      company_wide_message_text_color: this.company_wide_message_text_color,
      company_wide_message_bg_color: this.company_wide_message_bg_color,
      mode: this.mode,
      timezone: this.timezone,
      integration_api_enabled: this.integration_api_enabled,
      integration_api_token: this.integration_api_token,
      carry_over: this.carry_over,
      created_at: this.created_at,
      updated_at: this.updated_at,
      last_name_first: this.last_name_first,
      payroll_close_time: this.payroll_close_time,
      first_day_of_week: this.first_day_of_week
    }
  }

  async save() {
    // Extract relation fields that shouldn't be updated directly
    const {
      id,
      audit,
      bank_holidays,
      comments,
      departments,
      email_audits,
      leave_types,
      schedules,
      users,
      user_messages,
      ...updateData
    } = this

    const updated = await prisma.companies.update({
      where: { id: this.id },
      data: updateData
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
    // Extract relation fields that shouldn't be updated directly
    const { id, department_supervisors, companies, users, ...updateData } = this

    const updated = await prisma.departments.update({
      where: { id: this.id },
      data: updateData
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
      data
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
  PrismaDepartment,
  PrismaSchedule
}
