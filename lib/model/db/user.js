'use strict'

const crypto = require('crypto')
const _ = require('underscore')
const moment = require('moment')
const Promise = require('bluebird')
const config = require('../../config')
const UserAllowance = require('../user_allowance')
const htmlToText = require('html-to-text')
const prisma = require('./prisma')
const { sorter } = require('../../util')

const LeaveCollectionUtil = require('../leave_collection')()

class User {
  constructor(userData) {
    Object.assign(this, userData)
  }

  // Instance methods
  is_my_password(password) {
    return User.hashify_password(password) === this.password
  }

  async maybe_activate() {
    if (!this.activated) {
      const updated = await prisma.users.update({
        where: { id: this.id },
        data: { activated: true }
      })
      Object.assign(this, updated)
    }
    return this
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
    return this.name + ' ' + this.lastname
  }

  is_active() {
    return this.end_date === null || moment(this.end_date).isAfter(moment())
  }

  async promise_users_I_can_manage() {
    let users = []

    if (this.is_admin()) {
      // Get all users from company if admin
      const company = await prisma.companies.findUnique({
        where: { id: this.company_id },
        include: {
          users: true
        }
      })
      users = company.users
    } else {
      // Get users from supervised departments
      const departments = await this.promise_supervised_departments()
      users = departments.map(({ users }) => users).flat()
    }

    // Make sure current user is considered
    users.push(this)

    // Remove duplicates and sort
    users = _.uniq(users, ({ id }) => id)
    users = users.sort((a, b) => sorter(a.lastname, b.lastname))

    return users.map(user => new User(user))
  }

  async promise_manager() {
    const department = await prisma.departments.findUnique({
      where: { id: this.department_id },
      include: {
        users: {
          where: { manager: true }
        }
      }
    })
    return department.users[0] ? new User(department.users[0]) : null
  }

  async promise_supervisors() {
    const department = await prisma.departments.findUnique({
      where: { id: this.department_id },
      include: {
        users: {
          where: { manager: true }
        },
        department_supervisors: {
          include: {
            users: true
          }
        }
      }
    })

    const supervisors = [
      ...(department.users || []),
      ...(department.department_supervisors.map(ds => ds.users) || [])
    ]
    return supervisors.map(supervisor => new User(supervisor))
  }

  async promise_supervised_departments() {
    const supervisedDepartments = await prisma.departments.findMany({
      where: {
        OR: [
          { manager_id: this.id },
          {
            department_supervisors: {
              some: {
                user_id: this.id
              }
            }
          }
        ]
      },
      include: {
        users: true
      }
    })
    return supervisedDepartments
  }

  async promise_supervised_users() {
    const departments = await this.promise_supervised_departments()
    const users = await prisma.users.findMany({
      where: {
        department_id: {
          in: departments.map(d => d.id)
        }
      }
    })
    return users.map(user => new User(user))
  }

  async promise_personal_adjustment_for_year(year) {
    const adjustment = await prisma.user_allowance_adjustment.findFirst({
      where: {
        user_id: this.id,
        year: year
      }
    })
    return adjustment?.personal_adjustment || 0
  }

  async promise_allowance(args = {}) {
    args.user = this
    return UserAllowance.promise_allowance(args)
  }

  async reload_with_leave_details(args) {
    try {
      const [leaves, department, schedule] = await Promise.all([
        this.promise_my_active_leaves(args).then(leaves =>
          LeaveCollectionUtil.enrichLeavesWithComments({
            leaves,
            dbModel: prisma
          })
        ),
        prisma.departments.findUnique({
          where: { id: this.department_id }
        }),
        this.promise_schedule_I_obey()
      ])

      this.my_leaves = leaves
      this.department = department
      return this
    } catch (error) {
      console.error(
        `Unable to load leaves details for user ${this.email}: ${error}`,
        error.stack
      )
      throw error
    }
  }

  async reload_with_session_details() {
    try {
      const [users, company, schedule] = await Promise.all([
        this.promise_users_I_can_manage(),
        this.get_company_with_all_leave_types(),
        this.promise_schedule_I_obey()
      ])

      this.supervised_users = users || []
      this.company = company
      return this
    } catch (error) {
      console.error(
        `Unable to load session details for user ${this.email}: ${error}`,
        error.stack
      )
      throw error
    }
  }

  async remove() {
    if (this.is_admin()) {
      throw new Error('Cannot remove administrator user')
    }

    const departments = await this.promise_supervised_departments()
    if (departments.length > 0) {
      throw new Error('Cannot remove supervisor')
    }

    await prisma.$transaction([
      prisma.leaves.deleteMany({
        where: { user_id: this.id }
      }),
      prisma.users.delete({
        where: { id: this.id }
      })
    ])
  }

  get_reset_password_token() {
    return Buffer.from(
      this.email + ' ' + User.hashify_password(this.password)
    ).toString('base64')
  }

  async record_email_addressed_to_me(email_obj) {
    if (
      !email_obj ||
      !email_obj.hasOwnProperty('subject') ||
      !email_obj.subject ||
      !email_obj.hasOwnProperty('body') ||
      !email_obj.body
    ) {
      throw new Error(
        'Got incorrect parameters. There should be an object to represent and email and contain subject and body'
      )
    }

    return prisma.email_audits.create({
      data: {
        email: this.email,
        subject: htmlToText.fromString(email_obj.subject),
        body: htmlToText.fromString(email_obj.body),
        user_id: this.id,
        company_id: this.company_id
      }
    })
  }

  async promise_to_update_personal_adjustment({ year, adjustment }) {
    if (!year || !adjustment) {
      throw new Error(
        'User.promise_to_update_personal_adjustment needs year and adjustment parameters'
      )
    }

    return prisma.user_allowance_adjustment.upsert({
      where: {
        user_id_year: {
          user_id: this.id,
          year: year
        }
      },
      update: {
        personal_adjustment: adjustment
      },
      create: {
        user_id: this.id,
        year: year,
        personal_adjustment: adjustment
      }
    })
  }

  async promise_schedule_I_obey() {
    if (this.cached_schedule) {
      return this.cached_schedule
    }

    const schedules = await prisma.schedules.findMany({
      where: {
        OR: [{ user_id: this.id }, { company_id: this.company_id }]
      }
    })

    if (schedules.length === 0) {
      const defaultSchedule = await prisma.schedules.create({
        data: {
          company_id: this.company_id,
          monday: 1,
          tuesday: 1,
          wednesday: 1,
          thursday: 1,
          friday: 1,
          saturday: 2,
          sunday: 2
        }
      })
      this.cached_schedule = defaultSchedule
      return defaultSchedule
    }

    if (schedules.length === 2) {
      const userSchedule = schedules.find(s => s.user_id === this.id)
      this.cached_schedule = userSchedule
      return userSchedule
    }

    this.cached_schedule = schedules[0]
    return schedules[0]
  }

  // Static methods
  static hashify_password(password) {
    return crypto
      .createHash('md5')
      .update(
        password + config.get('crypto_secret'),
        config.get('crypto_hash_encoding') || 'binary'
      )
      .digest('hex')
  }

  static async get_user_by_reset_password_token(token) {
    const unpacked_token = Buffer.from(token, 'base64').toString('ascii')
    const [email, hashed_password] = unpacked_token.split(/\s/)

    const user = await User.find_by_email(email)
    if (user && User.hashify_password(user.password) === hashed_password) {
      return user
    }
    return null
  }

  static async find_by_email(email) {
    const user = await prisma.users.findFirst({
      where: {
        email,
        OR: [
          { end_date: null },
          {
            end_date: {
              gte: moment
                .utc()
                .startOf('day')
                .toDate()
            }
          }
        ]
      }
    })
    return user ? new User(user) : null
  }

  static async find_by_id(id) {
    const user = await prisma.users.findUnique({
      where: { id }
    })
    return user ? new User(user) : null
  }

  static async register_new_admin_user(attributes) {
    const {
      company_name,
      country_code,
      timezone,
      ...userAttributes
    } = attributes

    const existingUser = await User.find_by_email(userAttributes.email)
    if (existingUser) {
      const error = new Error('Email is already used')
      error.show_to_user = true
      throw error
    }

    if (userAttributes.name.toLowerCase().indexOf('http') >= 0) {
      const error = new Error('Name cannot have links')
      error.show_to_user = true
      throw error
    }

    userAttributes.password = User.hashify_password(userAttributes.password)

    return prisma.$transaction(async prisma => {
      // Create company
      const company = await prisma.companies.create({
        data: {
          name: company_name,
          country: country_code,
          timezone,
          start_of_new_year: 1
        }
      })

      // Create default department
      const department = await prisma.departments.create({
        data: {
          name: 'General',
          company_id: company.id
        }
      })

      // Create admin user
      const user = await prisma.users.create({
        data: {
          ...userAttributes,
          company_id: company.id,
          department_id: department.id,
          admin: true
        }
      })

      // Update department with manager
      await prisma.departments.update({
        where: { id: department.id },
        data: { manager_id: user.id }
      })

      return new User(user)
    })
  }
}

module.exports = User
