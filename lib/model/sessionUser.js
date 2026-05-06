'use strict'

const bcrypt = require('bcrypt')
const crypto = require('crypto')
const htmlToText = require('html-to-text')
const moment = require('moment')
const momentTz = require('moment-timezone')
const Promise = require('bluebird')
const _ = require('underscore')
const { v4: uuidv4 } = require('uuid')

const CalendarMonth = require('./calendar_month')
const LeaveCollectionUtil = require('./leave_collection')()
const LeaveDay = require('./leave_day')
const leaveConstants = require('./leave_constants')
const UserAllowance = require('./user_allowance')
const {
  evaluateLeaveAgainstAllowance,
  evaluateLeaveAgainstLimit
} = require('./allowance_validator')
const config = require('../config')
const Exception = require('../error')
const { sorter } = require('../util')

const USER_FIELDS = [
  'email',
  'slack_username',
  'password',
  'name',
  'lastname',
  'activated',
  'admin',
  'manager',
  'auto_approve',
  'reset_password_token',
  'reset_password_expires',
  'start_date',
  'end_date',
  'shifts',
  'shift_hours',
  'company_id',
  'department_id'
]

const COMPANY_FIELDS = [
  'name',
  'country',
  'start_of_new_year',
  'share_all_absences',
  'is_team_view_hidden',
  'ldap_auth_enabled',
  'ldap_auth_config',
  'date_format',
  'company_wide_message',
  'company_wide_message_text_color',
  'company_wide_message_bg_color',
  'mode',
  'timezone',
  'integration_api_enabled',
  'integration_api_token',
  'carry_over',
  'last_name_first',
  'payroll_close_time',
  'first_day_of_week',
  'next_year_cutoff_date',
  'limited_departments'
]

const LEAVE_INCLUDE = {
  leave_types: true,
  users_leaves_user_idTousers: {
    include: {
      companies: {
        include: {
          bank_holidays: true
        }
      },
      departments: true
    }
  },
  users_leaves_approver_idTousers: {
    include: {
      companies: {
        include: {
          bank_holidays: true
        }
      },
      departments: true
    }
  }
}

function getPrisma(client) {
  return client || require('../prisma/client')
}

function now() {
  return new Date()
}

function asInt(value) {
  if (value === undefined || value === null) return value
  return parseInt(value, 10)
}

function asFloatOrNull(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  if (typeof value === 'string') {
    const t = value.trim()
    if (t === '') return null
    const n = parseFloat(t)
    return Number.isNaN(n) ? null : n
  }
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function dateStart(value) {
  return moment.utc(value).startOf('day').toDate()
}

function dateEnd(value) {
  return moment.utc(value).endOf('day').toDate()
}

function activeUserWhere(extra) {
  return Object.assign({}, extra || {}, {
    OR: [
      { end_date: null },
      {
        end_date: {
          gte: moment.utc().startOf('day').toDate()
        }
      }
    ]
  })
}

function yearOverlapWhere(year) {
  const start = moment.utc(year).startOf('year').toDate()
  const end = moment.utc(year).endOf('year').toDate()

  return {
    OR: [
      { date_start: { gte: start, lte: end } },
      { date_end: { gte: start, lte: end } }
    ]
  }
}

function rangeOverlapWhere(dateStartValue, dateEndValue) {
  const start = dateStart(dateStartValue)
  const end = dateEnd(dateEndValue)

  return {
    OR: [
      { date_start: { gte: start, lte: end } },
      { date_end: { gte: start, lte: end } },
      {
        AND: [{ date_start: { lte: start } }, { date_end: { gte: end } }]
      }
    ]
  }
}

function shouldCoerceIntIdKey(key) {
  return key === 'id' || (typeof key === 'string' && key.endsWith('_id'))
}

function coerceScalarForPrisma(key, value) {
  if (
    shouldCoerceIntIdKey(key) &&
    typeof value === 'string' &&
    /^\d+$/.test(value)
  ) {
    return parseInt(value, 10)
  }
  return value
}

function coerceWhere(where) {
  if (!where) return {}
  const clean = {}

  Object.keys(where).forEach(key => {
    if (typeof key === 'symbol') return
    clean[key] = coerceScalarForPrisma(key, where[key])
  })

  return clean
}

function copyRow(row) {
  return Object.assign({}, row || {})
}

function decorateRecord(obj) {
  obj.get = function(attr) {
    if (attr && typeof attr === 'object' && attr.plain) {
      const out = {}
      Object.keys(this).forEach(key => {
        if (typeof this[key] !== 'function' && key !== '_prisma') out[key] = this[key]
      })
      return out
    }
    return this[attr]
  }

  obj.set = function(attr, value) {
    if (typeof attr === 'object') {
      Object.assign(this, attr)
    } else {
      this[attr] = value
    }
    return this
  }

  obj.setDataValue = obj.set

  obj.toJSON = function() {
    const out = {}
    Object.keys(this).forEach(key => {
      if (typeof this[key] !== 'function' && key !== '_prisma') out[key] = this[key]
    })
    return out
  }

  return obj
}

function wrapLeaveType(row, prismaClient) {
  if (!row) return row
  const leaveType = decorateRecord(copyRow(row))
  const db = getPrisma(prismaClient)

  leaveType._prisma = db

  leaveType.get_color_value = function() {
    return this.color || '#ffffff'
  }

  leaveType.is_auto_approve = function() {
    return this.auto_approve === true
  }

  leaveType.does_use_personal = function() {
    return this.use_personal === true
  }

  leaveType.update = async function(attributes) {
    const data = Object.assign({}, attributes)
    delete data.id

    for (const key of ['limit', 'sort_order']) {
      if (data[key] === undefined || data[key] === null) continue
      if (typeof data[key] === 'string') {
        const n = parseInt(String(data[key]).trim(), 10)
        data[key] = Number.isNaN(n) ? 0 : n
      }
    }

    data.updated_at = now()
    const saved = await this._prisma.leave_types.update({
      where: { id: this.id },
      data
    })
    Object.assign(this, wrapLeaveType(saved, this._prisma))
    return this
  }

  leaveType.destroy = function() {
    return this._prisma.leave_types.delete({ where: { id: this.id } })
  }

  return leaveType
}

function wrapBankHoliday(row) {
  if (!row) return row
  const bankHoliday = decorateRecord(copyRow(row))

  bankHoliday.get_pretty_date = function() {
    return moment.utc(this.date).format('YYYY-MM-DD')
  }

  return bankHoliday
}

const SCHEDULE_DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
]

function coerceScheduleDayField(dayName, value) {
  const defaultVal = dayName === 'saturday' || dayName === 'sunday' ? 2 : 1
  if (value === undefined || value === null || value === '') return defaultVal
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 2
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase()
    if (t === 'on' || t === 'yes' || t === 'true' || t === '1') return 1
    if (t === 'off' || t === 'no' || t === 'false' || t === '0') return 2
    const n = parseInt(t, 10)
    if (!Number.isNaN(n)) return n
  }
  return defaultVal
}

function wrapSchedule(row, prismaClient) {
  const schedule = decorateRecord(
    copyRow(
      row || {
        monday: 1,
        tuesday: 1,
        wednesday: 1,
        thursday: 1,
        friday: 1,
        saturday: 2,
        sunday: 2
      }
    )
  )

  schedule._prisma = prismaClient

  schedule.is_user_specific = function() {
    return !!this.user_id
  }

  schedule.is_it_working_day = function(args) {
    if (!args || !args.day) {
      throw new Error('"is_it_working_day" requires to have "day" parameter')
    }

    return (
      this[
        moment
          .utc(args.day)
          .format('dddd')
          .toLowerCase()
      ] === 1
    )
  }

  ;[
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
  ].forEach(day => {
    schedule['works_' + day] = function() {
      return this[day] === 1
    }
  })

  schedule.save = async function() {
    if (!this.id) {
      const uid = this.user_id
      const cid = this.company_id
      const canInsert =
        (uid != null && uid !== '') || (cid != null && cid !== '')

      if (canInsert) {
        const ts = now()
        const insertData = {
          created_at: ts,
          updated_at: ts,
          company_id:
            cid == null || cid === '' ? null : asInt(cid),
          user_id: uid == null || uid === '' ? null : asInt(uid)
        }
        for (const day of SCHEDULE_DAY_KEYS) {
          insertData[day] = coerceScheduleDayField(day, this[day])
        }
        const saved = await this._prisma.schedules.create({
          data: insertData
        })
        Object.assign(this, saved)
        return this
      }

      return this
    }

    const data = { updated_at: now() }
    for (const day of SCHEDULE_DAY_KEYS) {
      data[day] = coerceScheduleDayField(day, this[day])
    }

    const saved = await this._prisma.schedules.update({
      where: { id: this.id },
      data
    })

    Object.assign(this, saved)
    return this
  }

  schedule.destroy = async function() {
    if (!this.id) return this
    await this._prisma.schedules.delete({
      where: { id: this.id }
    })
    this.id = undefined
    this.user_id = null
    return this
  }

  return schedule
}

function parseCompanyJson(company) {
  if (!company) return company

  if (typeof company.ldap_auth_config === 'string') {
    try {
      company.ldap_auth_config = JSON.parse(company.ldap_auth_config)
    } catch (err) {
      company.ldap_auth_config = {}
    }
  } else if (!company.ldap_auth_config) {
    company.ldap_auth_config = {}
  }

  if (typeof company.limited_departments === 'string') {
    try {
      company.limited_departments = JSON.parse(company.limited_departments)
    } catch (err) {
      company.limited_departments = []
    }
  } else if (!Array.isArray(company.limited_departments)) {
    company.limited_departments = []
  }

  return company
}

function wrapCompany(row, prismaClient) {
  if (!row) return row
  const company = decorateRecord(parseCompanyJson(copyRow(row)))

  company._prisma = prismaClient
  company.bank_holidays = (row.bank_holidays || []).map(wrapBankHoliday)
  company.leave_types = (row.leave_types || [])
    .map(lt => wrapLeaveType(lt, prismaClient))
    .sort((a, b) => sorter(a.name, b.name))
  company.departments = (row.departments || [])
    .map(department => wrapDepartment(department, prismaClient))
    .sort((a, b) => sorter(a.name, b.name))
  company.users = (row.users || []).map(user => wrapUser(user, prismaClient))

  company.name_for_machine = function() {
    return this.name.replace(/\s+/g, '_')
  }

  company.reload_with_bank_holidays = async function() {
    this.bank_holidays = (
      await this._prisma.bank_holidays.findMany({
        where: { company_id: this.id },
        orderBy: { date: 'asc' }
      })
    ).map(wrapBankHoliday)

    return this
  }

  company.getBank_holidays = async function() {
    return (
      await this._prisma.bank_holidays.findMany({
        where: { company_id: this.id },
        orderBy: { date: 'asc' }
      })
    ).map(wrapBankHoliday)
  }

  company.get_moment_to_datepicker_map = function() {
    return {
      'YYYY-MM-DD': 'yyyy-mm-dd',
      'YYYY/MM/DD': 'yyyy/mm/dd',
      'DD MMM, YY': 'dd M, yy',
      'DD/MM/YY': 'dd/mm/yy',
      'DD/MM/YYYY': 'dd/mm/yyyy',
      'MM/DD/YY': 'mm/dd/yy'
    }
  }

  company.get_default_date_format = function() {
    return this.date_format || 'YYYY-MM-DD'
  }

  company.getDateFormat = company.get_default_date_format

  company.get_available_date_formats = function() {
    return _.keys(this.get_moment_to_datepicker_map())
  }

  company.get_default_date_format_for_date_picker = function() {
    const map = this.get_moment_to_datepicker_map()
    return map[this.get_default_date_format()] || 'yyyy-mm-dd'
  }

  company.normalise_date = function(dateStr) {
    return moment.utc(dateStr, this.get_default_date_format()).format('YYYY-MM-DD')
  }

  company.get_today = function() {
    return moment.utc(
      momentTz
        .utc()
        .tz(this.timezone || 'Europe/London')
        .format('YYYY-MM-DD')
    )
  }

  company.is_mode_readonly_holidays = function() {
    return this.mode === 2
  }

  company.getSortedLeaveTypes = function() {
    return (this.leave_types || []).sort((a, b) => sorter(a.name, b.name))
  }

  company.getDepartments = async function() {
    return (
      await this._prisma.departments.findMany({
        where: { company_id: this.id },
        orderBy: { name: 'asc' }
      })
    ).map(department => wrapDepartment(department, this._prisma))
  }

  company.getUsers = async function(args) {
    const where = Object.assign({ company_id: this.id }, coerceWhere(args && args.where))

    return (
      await this._prisma.users.findMany({
        where,
        orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
        include: {
          companies: true,
          departments: true
        }
      })
    ).map(user => wrapUser(user, this._prisma))
  }

  company.promise_schedule = async function() {
    const schedule = await this._prisma.schedules.findFirst({
      where: { company_id: this.id }
    })

    return wrapSchedule(
      schedule || {
        company_id: this.id,
        user_id: null
      },
      this._prisma
    )
  }

  company.regenerateIntegrationApiToken = function() {
    this.integration_api_token = uuidv4()
    return this.save()
  }

  company.get_ldap_server = function() {
    const LdapAuth = require('ldapauth-fork')
    const ldapConfig = this.get('ldap_auth_config') || {}
    const tlsOptions = ldapConfig.allow_unauthorized_cert
      ? { rejectUnauthorized: false }
      : {}

    if (!ldapConfig.searchfilter) ldapConfig.searchfilter = '(mail={{username}})'

    return new LdapAuth({
      url: ldapConfig.url,
      bindDn: ldapConfig.binddn,
      bindCredentials: ldapConfig.bindcredentials,
      searchBase: ldapConfig.searchbase,
      searchFilter: ldapConfig.searchfilter,
      cache: false,
      tlsOptions
    })
  }

  company.save = async function() {
    const data = {}

    COMPANY_FIELDS.forEach(field => {
      if (this[field] !== undefined) data[field] = this[field]
    })

    if (data.ldap_auth_config && typeof data.ldap_auth_config !== 'string') {
      data.ldap_auth_config = JSON.stringify(data.ldap_auth_config)
    }

    if (data.limited_departments && typeof data.limited_departments !== 'string') {
      data.limited_departments = JSON.stringify(data.limited_departments)
    }

    if (data.carry_over !== undefined && data.carry_over !== null) {
      data.carry_over = parseInt(data.carry_over, 10)
    }

    data.updated_at = now()

    const saved = await this._prisma.companies.update({
      where: { id: this.id },
      data
    })

    Object.assign(this, parseCompanyJson(saved))
    return this
  }

  return company
}

function wrapDepartment(row, prismaClient) {
  if (!row) return row
  const department = decorateRecord(copyRow(row))

  department._prisma = prismaClient
  department.users = (row.users || []).map(user => wrapUser(user, prismaClient))

  department.promise_active_users = async function() {
    return (
      await this._prisma.users.findMany({
        where: activeUserWhere({ department_id: this.id }),
        orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
        include: {
          companies: true,
          departments: true
        }
      })
    ).map(user => wrapUser(user, this._prisma))
  }

  department.getCompany = async function() {
    return wrapCompany(
      await this._prisma.companies.findUnique({
        where: { id: this.company_id },
        include: companyInclude()
      }),
      this._prisma
    )
  }

  department.promise_me_with_supervisors = async function() {
    const links = await this._prisma.department_supervisors.findMany({
      where: { department_id: this.id },
      include: {
        users: {
          include: {
            companies: true,
            departments: true
          }
        }
      }
    })

    this.supervisors = links.map(link => wrapUser(link.users, this._prisma))
    return this
  }

  department.save = async function() {
    const data = {
      name: this.name,
      allowance: this.allowance,
      personal: this.personal,
      include_public_holidays: this.include_public_holidays,
      is_accrued_allowance: this.is_accrued_allowance,
      shifts: this.shifts,
      shift_hours: this.shift_hours,
      allowed_increments: this.allowed_increments,
      company_id: this.company_id,
      manager_id: this.manager_id,
      updated_at: now()
    }

    const saved = await this._prisma.departments.update({
      where: { id: this.id },
      data
    })

    Object.assign(this, saved)
    return this
  }

  department.promise_team_view_for_month = function(month) {
    return this._promise_team_view({ start_date: month })
  }

  department.promise_team_view_for_months_range = function(start_month, end_month) {
    return this._promise_team_view({
      start_date: start_month,
      end_date: end_month
    })
  }

  department._promise_team_view = async function(args) {
    let start_date = args.start_date
    let end_date = args.end_date

    if (!start_date) {
      const companyForToday = await this.getCompany()
      start_date = companyForToday.get_today()
    }

    if (!end_date) {
      end_date = start_date
    } else {
      if (
        moment.utc(end_date).format('YYYY') !==
        moment.utc(start_date).format('YYYY')
      ) {
        Exception.throw_user_error({
          user_error: 'Start and End dates should within single year',
          system_error:
            '_promise_team_view was called with start_date and end_date from different years.'
        })
      }

      if (
        moment.utc(start_date).dayOfYear() > moment.utc(end_date).dayOfYear()
      ) {
        Exception.throw_user_error({
          user_error: 'Start date needs to be before end date',
          system_error:
            '_promise_team_view was called with end_date prior to start_date'
        })
      }
    }

    const users = await this.promise_active_users()
    const prisma = this._prisma

    // Bulk-load leaves for all users in the department for the relevant year.
    // The legacy implementation queried leaves + schedule per user, which becomes
    // extremely slow (and connection-heavy) on larger teams.
    const userIds = users.map(u => u.id)
    const year = moment.utc(start_date).year()
    const yearStart = moment.utc().year(year).startOf('year').toDate()
    const yearEnd = moment.utc().year(year).endOf('year').toDate()

    const leaveRows =
      userIds.length === 0
        ? []
        : await prisma.leaves.findMany({
            where: {
              user_id: { in: userIds },
              status: {
                in: [
                  leaveConstants.status_new(),
                  leaveConstants.status_approved(),
                  leaveConstants.status_pended_revoke()
                ]
              },
              AND: [{ date_start: { lte: yearEnd } }, { date_end: { gte: yearStart } }]
            },
            include: {
              leave_types: true
            }
          })

    const userById = users.reduce((acc, u) => {
      acc[u.id] = u
      return acc
    }, {})

    const leavesByUserId = leaveRows.reduce((acc, row) => {
      const uid = row.user_id
      if (!acc[uid]) acc[uid] = []
      // Attach the already-loaded user so wrapping a leave doesn't refetch it.
      acc[uid].push(Object.assign({}, row, { users_leaves_user_idTousers: userById[uid] }))
      return acc
    }, {})

    // Load schedules with limited concurrency (still potentially heavy).
    const schedulesByUserId = await Promise.map(
      users,
      async user => [user.id, await user.promise_schedule_I_obey()],
      { concurrency: 6 }
    ).then(pairs =>
      pairs.reduce((acc, [uid, sched]) => {
        acc[uid] = sched
        return acc
      }, {})
    )

    const users_and_leaves = users.map(user => {
      const leaves = (leavesByUserId[user.id] || []).map(row => wrapLeave(row, prisma))

      const leave_days = _.flatten(
        _.map(leaves, leave =>
          _.map(leave.get_days(), leave_day => {
            leave_day.leave = leave
            return leave_day
          })
        )
      )

      return {
        user,
        leave_days,
        schedule: schedulesByUserId[user.id]
      }
    })

    const company = await this.getCompany()

    const number_of_months =
      moment.utc(end_date).month() - moment.utc(start_date).month()

    const filteredBankHolidays = company.bank_holidays.map(day => ({
      date: day.date,
      name: day.name
    }))

    users_and_leaves.forEach(user_data => {
      user_data.days = []

      for (let i = 0; i <= number_of_months; i++) {
        const calendar_month = new CalendarMonth(
          moment
            .utc(start_date)
            .clone()
            .add(i, 'months'),
          {
            bank_holidays: this.include_public_holidays
              ? filteredBankHolidays
              : [],
            leave_days: user_data.leave_days,
            schedule: user_data.schedule,
            today: company.get_today(),
            leave_types: company.leave_types,
            first_day_of_week: company.first_day_of_week
          }
        )

        user_data.days.push(calendar_month.as_for_team_view())
      }
      user_data.days = _.flatten(user_data.days)
    })

    return users_and_leaves
  }

  return department
}

function companyInclude() {
  return {
    bank_holidays: {
      orderBy: { date: 'asc' }
    },
    leave_types: {
      orderBy: [{ sort_order: 'desc' }, { name: 'asc' }]
    },
    departments: {
      orderBy: { name: 'asc' }
    }
  }
}

function getLeaveIncludeForPrisma() {
  return LEAVE_INCLUDE
}

function coerceLeaveDayPart(value) {
  const n = parseInt(String(value == null ? '' : value).trim(), 10)
  return Number.isNaN(n) ? leaveConstants.leave_day_part_all() : n
}

function wrapLeave(row, prismaClient) {
  if (!row) return row
  const leave = decorateRecord(copyRow(row))

  leave._prisma = prismaClient
  leave.leave_type = wrapLeaveType(
    row.leave_type || row.leave_types,
    prismaClient
  )
  leave.user = wrapUser(row.user || row.users_leaves_user_idTousers, prismaClient)
  leave.approver = wrapUser(
    row.approver || row.users_leaves_approver_idTousers,
    prismaClient
  )

  leave.getUser = async function() {
    return this.user
  }

  leave.get_days = function() {
    if (this._days) return this._days

    const startDate = moment.utc(new Date(this.date_start)).format('YYYY-MM-DD')
    const endDate = moment.utc(new Date(this.date_end)).format('YYYY-MM-DD')
    const days = [startDate]

    if (startDate !== endDate) {
      const daysBetween = moment.utc(endDate).diff(moment.utc(startDate), 'days') - 1

      for (let i = 1; i <= daysBetween; i++) {
        days.push(
          moment
            .utc(startDate)
            .add(i, 'days')
            .format('YYYY-MM-DD')
        )
      }

      days.push(endDate)
    }

    this._days = days.map(
      day =>
        new LeaveDay({
          leave_type_id: this.leave_type_id,
          date: day,
          day_part:
            day === startDate
              ? this.day_part_start
              : day === endDate
              ? this.day_part_end
              : leaveConstants.leave_day_part_all(),
          time_start: day === startDate ? this.time_start : null,
          time_end: day === endDate ? this.time_end : null
        })
    )

    return this._days
  }

  leave.fit_with_leave_request = function(leave_request) {
    const days = this.get_days()
    if (
      leave_request.is_within_one_day() &&
      (leave_request.does_fit_with_leave_day(_.last(days)) ||
        leave_request.does_fit_with_leave_day(_.first(days)))
    ) {
      return true
    }

    if (
      !leave_request.is_within_one_day() &&
      (leave_request.does_fit_with_leave_day_at_start(_.last(days)) ||
        leave_request.does_fit_with_leave_day_at_end(_.first(days)))
    ) {
      return true
    }

    return false
  }

  leave.is_new_leave = function() {
    return this.status === leaveConstants.status_new()
  }

  leave.is_pended_revoke_leave = function() {
    return this.status === leaveConstants.status_pended_revoke()
  }

  leave.is_approved_leave = function() {
    return (
      this.status === leaveConstants.status_approved() ||
      this.status === leaveConstants.status_pended_revoke()
    )
  }

  leave.is_auto_approve = function() {
    return (
      this.user &&
      this.leave_type &&
      (this.user.is_auto_approve() || this.leave_type.is_auto_approve())
    )
  }

  leave.get_start_leave_day = function() {
    return this.get_days()[0]
  }

  leave.get_end_leave_day = function() {
    return this.get_days()[this.get_days().length - 1]
  }

  leave.get_leave_type_name = function() {
    return this.leave_type ? this.leave_type.name : ''
  }

  leave.get_working_hours_per_day = function(user) {
    try {
      if (user && user.shift_hours) {
        const shiftHours =
          typeof user.shift_hours === 'string'
            ? JSON.parse(user.shift_hours)
            : user.shift_hours
        const shifts = Object.keys(shiftHours)

        if (shifts.length > 0 && shiftHours[shifts[0]].start && shiftHours[shifts[0]].end) {
          const start = moment(shiftHours[shifts[0]].start, 'HH:mm')
          const end = moment(shiftHours[shifts[0]].end, 'HH:mm')
          if (end.isBefore(start)) end.add(1, 'day')
          return end.diff(start, 'hours', true)
        }
      }

      if (user && user.department && user.department.shift_hours) {
        const shiftHours =
          typeof user.department.shift_hours === 'string'
            ? JSON.parse(user.department.shift_hours)
            : user.department.shift_hours
        const shifts = Object.keys(shiftHours)

        if (shifts.length > 0 && shiftHours[shifts[0]].start && shiftHours[shifts[0]].end) {
          const start = moment(shiftHours[shifts[0]].start, 'HH:mm')
          const end = moment(shiftHours[shifts[0]].end, 'HH:mm')
          if (end.isBefore(start)) end.add(1, 'day')
          return end.diff(start, 'hours', true)
        }
      }
    } catch (err) {
      console.error('Error parsing shift hours:', err)
    }

    return 8
  }

  leave.get_deducted_days_number = function(args) {
    args = args || {}
    const leaveDays = this.get_deducted_days(args)
    let numberOfDays = leaveDays.length
    const isTimeBased = !!(this.time_start || this.time_end)

    if (isTimeBased) {
      const user = this.user || this.approver || args.user
      const workingHours = this.get_working_hours_per_day(user)
      let totalHours = 0

      leaveDays.forEach(leaveDay => {
        if (leaveDay.is_time_based_leave()) {
          const hours = leaveDay.get_duration_hours()
          totalHours += hours !== null ? hours : workingHours
        } else {
          totalHours += leaveDay.is_all_day_leave() ? workingHours : workingHours / 2
        }
      })

      return totalHours / workingHours
    }

    if (numberOfDays === 1 && !this.get_start_leave_day().is_all_day_leave()) {
      numberOfDays = numberOfDays - 0.5
    } else if (numberOfDays > 1) {
      if (!this.get_start_leave_day().is_all_day_leave()) numberOfDays = numberOfDays - 0.5
      if (!this.get_end_leave_day().is_all_day_leave()) numberOfDays = numberOfDays - 0.5
    }

    return numberOfDays
  }

  leave.get_deducted_days = function(args) {
    args = args || {}
    const leaveType = this.get('leave_type') || args.leave_type
    const ignoreAllowance = args.ignore_allowance || false

    if (!ignoreAllowance && leaveType && !leaveType.use_allowance) return []

    const user = this.user || this.approver || args.user
    if (!user) return []

    const includePublicHolidays = user.department
      ? user.department.include_public_holidays
      : true
    const bankHolidayMap = {}

    if (includePublicHolidays && user.company && user.company.bank_holidays) {
      user.company.bank_holidays.forEach(bankHoliday => {
        bankHolidayMap[bankHoliday.get_pretty_date()] = 1
      })
    }

    const year = args.year ? moment.utc(args.year, 'YYYY') : null
    const schedule = user.cached_schedule || wrapSchedule(null, this._prisma)

    return _.filter(
      _.map(this.get_days(), leaveDay => {
        if (includePublicHolidays && bankHolidayMap[leaveDay.get_pretty_date()]) {
          return
        }

        if (year && year.year() !== moment.utc(leaveDay.date).year()) return

        if (!schedule.is_it_working_day({ day: moment.utc(leaveDay.date) })) return

        return leaveDay
      }),
      leaveDay => !!leaveDay
    )
  }

  leave.promise_approver = async function() {
    if (this.approver) return this.approver

    if (this.approver_id == null) {
      this.approver = null
      return null
    }

    this.approver = wrapUser(
      await this._prisma.users.findUnique({
        where: { id: this.approver_id },
        include: {
          companies: {
            include: {
              bank_holidays: true
            }
          },
          departments: true
        }
      }),
      this._prisma
    )

    return this.approver
  }

  leave.reload = async function() {
    const fresh = await this._prisma.leaves.findUnique({
      where: { id: this.id },
      include: getLeaveIncludeForPrisma()
    })

    Object.assign(this, wrapLeave(fresh, this._prisma))
    return this
  }

  leave.reloadWithAssociates = async function() {
    return this.reload()
  }

  leave.save = async function() {
    const data = {
      status: this.status,
      employee_comment: this.employee_comment,
      approver_comment: this.approver_comment,
      decided_at: this.decided_at,
      date_start: this.date_start,
      day_part_start: coerceLeaveDayPart(this.day_part_start),
      time_start: this.time_start,
      date_end: this.date_end,
      day_part_end: coerceLeaveDayPart(this.day_part_end),
      time_end: this.time_end,
      user_id: this.user_id,
      approver_id: this.approver_id,
      leave_type_id: this.leave_type_id,
      updated_at: now()
    }

    let saved
    if (!this.id) {
      saved = await this._prisma.leaves.create({
        data: Object.assign(
          {
            created_at: now()
          },
          data
        ),
        include: getLeaveIncludeForPrisma()
      })
    } else {
      saved = await this._prisma.leaves.update({
        where: { id: this.id },
        data,
        include: getLeaveIncludeForPrisma()
      })
    }

    Object.assign(this, wrapLeave(saved, this._prisma))
    return this
  }

  leave.promise_to_reject = function(args) {
    if (!args || !args.by_user) {
      throw new Error('promise_to_reject has to have by_user parameter')
    }

    this.status = this.is_pended_revoke_leave()
      ? leaveConstants.status_approved()
      : leaveConstants.status_rejected()
    this.decided_at = now()
    this.approver_id = args.by_user.id

    return this.save()
  }

  leave.promise_to_approve = async function(args) {
    if (!args || !args.by_user) {
      throw new Error('promise_to_approve has to have by_user parameter')
    }

    const newStatus = this.is_pended_revoke_leave()
      ? leaveConstants.status_rejected()
      : leaveConstants.status_approved()

    if (newStatus === leaveConstants.status_approved()) {
      const user = await loadSessionUserById(this._prisma, this.user_id)
      const leaveType = wrapLeaveType(
        await this._prisma.leave_types.findUnique({
          where: { id: this.leave_type_id }
        }),
        this._prisma
      )

      await validateApprovalOverlap({
        prisma: this._prisma,
        leave: this,
        user
      })

      if (leaveType.use_allowance) {
        await user.validate_leave_fits_into_remaining_allowance({
          year: moment.utc(this.date_start),
          leave_type: leaveType,
          leave: this,
          // Do not allow approval if the employee would end up overbooked when
          // accounting for other pending requests.
          include_pending: true
        })
      } else if (leaveType.limit && leaveType.limit > 0) {
        await user.validate_leave_fits_into_limit({
          year: moment.utc(this.date_start),
          leave_type: leaveType,
          leave: this,
          // Limit enforcement should also consider pending requests.
          include_pending: true
        })
      }
    }

    this.status = newStatus
    this.approver_id = args.by_user.id
    this.decided_at = now()

    return this.save()
  }

  leave.promise_to_revoke = async function() {
    const user = await loadSessionUserById(this._prisma, this.user_id)
    const department = await user.getDepartment()

    this.approver_id = department ? department.manager_id : this.approver_id
    this.status = user.is_auto_approve()
      ? leaveConstants.status_rejected()
      : leaveConstants.status_pended_revoke()

    return this.save()
  }

  leave.promise_to_cancel = function() {
    if (!this.is_new_leave()) {
      throw new Error('An attempt to cancel non-new leave request id : ' + this.id)
    }

    this.status = leaveConstants.status_canceled()
    this.decided_at = now()

    return this.save()
  }

  leave.destroy = function() {
    return this._prisma.leaves.delete({ where: { id: this.id } })
  }

  return leave
}

function buildIntervalsForLeaveLike(leaveLike) {
  const fromDate = moment
    .utc(leaveLike.from_date || leaveLike.date_start)
    .format('YYYY-MM-DD')
  const toDate = moment
    .utc(leaveLike.to_date || leaveLike.date_end)
    .format('YYYY-MM-DD')
  const fromPart = leaveLike.from_date_part || leaveLike.day_part_start
  const toPart = leaveLike.to_date_part || leaveLike.day_part_end
  const timeStart = leaveLike.time_start || null
  const timeEnd = leaveLike.time_end || null
  const intervals = []
  const startDay = moment.utc(fromDate)
  const endDay = moment.utc(toDate)
  const daysSpan = endDay.diff(startDay, 'days')

  for (let i = 0; i <= daysSpan; i++) {
    const day = moment
      .utc(fromDate)
      .add(i, 'days')
      .format('YYYY-MM-DD')

    if (daysSpan === 0 && (timeStart || timeEnd)) {
      if (timeStart && timeEnd) {
        const start = moment.utc(day + 'T' + timeStart)
        const end = moment.utc(day + 'T' + timeEnd)
        if (!end.isAfter(start)) end.add(1, 'day')
        intervals.push({ start, end })
      } else {
        intervals.push(dayIntervalForPart(day, leaveConstants.leave_day_part_all()))
      }
      continue
    }

    intervals.push(
      dayIntervalForPart(
        day,
        i === 0
          ? fromPart
          : i === daysSpan
          ? toPart
          : leaveConstants.leave_day_part_all()
      )
    )
  }

  return intervals
}

function dayIntervalForPart(dateStr, dayPart) {
  const start = moment.utc(dateStr).startOf('day')
  const end = moment.utc(dateStr).add(1, 'day').startOf('day')
  const midday = moment.utc(dateStr).hour(12).minute(0).second(0).millisecond(0)

  if (String(dayPart) === String(leaveConstants.leave_day_part_morning())) {
    return { start, end: midday }
  }

  if (String(dayPart) === String(leaveConstants.leave_day_part_afternoon())) {
    return { start: midday, end }
  }

  return { start, end }
}

function intervalsOverlap(a, b) {
  return a.start.isBefore(b.end) && b.start.isBefore(a.end)
}

function anyOverlap(aIntervals, bIntervals) {
  for (const a of aIntervals) {
    for (const b of bIntervals) {
      if (intervalsOverlap(a, b)) return true
    }
  }

  return false
}

async function validateApprovalOverlap({ prisma, leave, user }) {
  const overlapping = await findLeaves(prisma, {
    where: {
      AND: [
        {
          user_id: user.id,
          status: {
            in: [
              leaveConstants.status_new(),
              leaveConstants.status_approved(),
              leaveConstants.status_pended_revoke()
            ]
          }
        },
        { id: { not: leave.id } },
        rangeOverlapWhere(leave.date_start, leave.date_end)
      ]
    },
    include: getLeaveIncludeForPrisma()
  })

  const intervals = buildIntervalsForLeaveLike(leave)
  const conflicting = overlapping.find(existingLeave =>
    anyOverlap(intervals, buildIntervalsForLeaveLike(existingLeave))
  )

  if (conflicting) {
    const error = new Error('Overlapping booking!')
    error.user_message = 'Overlapping booking!'
    throw error
  }
}

async function findLeaves(prismaClient, args) {
  return (
    await prismaClient.leaves.findMany({
      where: args.where || {},
      include: args.include || getLeaveIncludeForPrisma(),
      orderBy: { date_start: 'desc' }
    })
  ).map(leave => wrapLeave(leave, prismaClient))
}

/** Prisma DateTime columns reject plain YYYY-MM-DD strings; normalize to UTC midnight. */
function coerceUserDateTimeField(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return moment.utc(trimmed, 'YYYY-MM-DD').startOf('day').toDate()
    }
    const parsed = moment.utc(trimmed)
    return parsed.isValid() ? parsed.toDate() : value
  }
  return value
}

function wrapUser(row, prismaClient) {
  if (!row) return row
  const user = decorateRecord(copyRow(row))

  user._prisma = prismaClient
  user.company = wrapCompany(row.company || row.companies, prismaClient)
  user.department = wrapDepartment(row.department || row.departments, prismaClient)
  user.my_leaves = (row.my_leaves || row.leaves_leaves_user_idTousers || []).map(leave =>
    wrapLeave(leave, prismaClient)
  )
  user.feeds = row.feeds || row.user_feeds
  user.adjustments = row.adjustments || row.user_allowance_adjustment

  user.is_my_password = function(password) {
    return User.verify_password(password, this.password)
  }

  user.maybe_activate = function() {
    if (!this.activated) this.activated = true
    return this.save()
  }

  user.is_admin = function() {
    return this.admin === true
  }

  user.is_manager = function() {
    return this.manager === true
  }

  user.is_auto_approve = function() {
    return this.auto_approve === true
  }

  Object.defineProperty(user, 'full_name', {
    get() {
      const n = this.name == null ? '' : String(this.name)
      const ln = this.lastname == null ? '' : String(this.lastname)
      return `${n} ${ln}`.trim()
    },
    // Non-enumerable so Object.assign() won't attempt to overwrite it
    // on existing wrapped objects (no setter).
    enumerable: false,
    configurable: true
  })

  user.is_active = function() {
    return this.end_date === null || moment(this.end_date).isAfter(moment())
  }

  user.save = async function() {
    const data = {}

    USER_FIELDS.forEach(field => {
      if (this[field] !== undefined) data[field] = this[field]
    })

    if (data.department_id !== undefined && data.department_id !== null) {
      if (typeof data.department_id === 'string' && /^\d+$/.test(data.department_id)) {
        data.department_id = parseInt(data.department_id, 10)
      }
    }
    if (data.company_id !== undefined && data.company_id !== null) {
      if (typeof data.company_id === 'string' && /^\d+$/.test(data.company_id)) {
        data.company_id = parseInt(data.company_id, 10)
      }
    }

    if (data.start_date !== undefined) {
      data.start_date = coerceUserDateTimeField(data.start_date)
    }
    if (data.end_date !== undefined) {
      data.end_date =
        data.end_date === '' || data.end_date === null
          ? null
          : coerceUserDateTimeField(data.end_date)
    }
    if (data.reset_password_expires !== undefined && data.reset_password_expires !== null) {
      if (typeof data.reset_password_expires === 'string') {
        data.reset_password_expires = coerceUserDateTimeField(data.reset_password_expires)
      }
    }

    data.updated_at = now()

    const saved = await this._prisma.users.update({
      where: { id: this.id },
      data,
      include: {
        companies: true,
        departments: true
      }
    })

    Object.assign(this, wrapUser(saved, this._prisma))
    return this
  }

  user.update = async function(attributes) {
    if (attributes && typeof attributes === 'object') {
      for (const field of USER_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(attributes, field)) continue
        let v = attributes[field]
        if (
          (field === 'department_id' || field === 'company_id') &&
          v !== undefined &&
          v !== null &&
          v !== ''
        ) {
          if (typeof v === 'string' && /^\d+$/.test(v)) v = parseInt(v, 10)
        }
        this[field] = v
      }
    }
    return this.save()
  }

  user.reload_with_session_details = async function() {
    const users = await this.promise_users_I_can_manage()
    const company = await this.get_company_with_all_leave_types()
    const schedule = await this.promise_schedule_I_obey()

    this.supervised_users = users || []
    this.company = company
    this.cached_schedule = schedule

    return this
  }

  user.reload_with_leave_details = async function(args) {
    const leaves = await this.promise_my_active_leaves(args)

    this.my_leaves = await LeaveCollectionUtil.enrichLeavesWithComments({
      leaves,
      dbModel: {}
    })
    // Track which year `my_leaves` corresponds to, so callers can ensure
    // they are calculating allowance against the intended year.
    if (args && args.year) {
      this._my_leaves_year = moment.utc(args.year).year()
    } else {
      this._my_leaves_year = moment.utc().year()
    }
    // Always refetch department: allowance and increments can change in DB
    // while the session user still holds a cached wrapDepartment instance.
    this.department = null
    this.department = await this.getDepartment()
    this.cached_schedule = await this.promise_schedule_I_obey()

    return this
  }

  user.getCompany = async function(options) {
    const include = companyInclude()

    if (options && options.scope && options.scope.indexOf('with_all_users') >= 0) {
      include.users = {
        orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
        include: {
          departments: true
        }
      }
    }

    if (options && Array.isArray(options.include)) {
      const leaveTypesInc = options.include.find(i => i.as === 'leave_types')
      if (
        leaveTypesInc &&
        leaveTypesInc.include &&
        leaveTypesInc.include.find(s => s.as === 'leaves')
      ) {
        include.leave_types = {
          orderBy: [{ sort_order: 'desc' }, { name: 'asc' }],
          include: {
            leaves: {
              select: { id: true }
            }
          }
        }
      }
    }

    return wrapCompany(
      await this._prisma.companies.findUnique({
        where: { id: this.company_id },
        include
      }),
      this._prisma
    )
  }

  user.get_company_with_all_leave_types = function() {
    return this.getCompany()
  }

  user.get_company_for_add_user = function() {
    return this.getCompany()
  }

  user.get_company_for_user_details = async function(args) {
    const userId = asInt(args.user_id)
    const year = args.year || moment.utc()
    const company = await this.getCompany()
    const selectedUser = await this._prisma.users.findFirst({
      where: {
        id: userId,
        company_id: this.company_id
      },
      include: {
        departments: true,
        companies: {
          include: {
            bank_holidays: true
          }
        },
        leaves_leaves_user_idTousers: {
          where: yearOverlapWhere(year),
          include: getLeaveIncludeForPrisma(),
          orderBy: { date_start: 'desc' }
        }
      }
    })

    if (!selectedUser) {
      throw new Error(
        'User ' +
          this.id +
          ' tried to edit user ' +
          userId +
          ' but they do not share a company'
      )
    }

    company.users = [wrapUser(selectedUser, this._prisma)]
    company.departments = (
      await this._prisma.departments.findMany({
        where: { company_id: this.company_id },
        orderBy: { name: 'asc' }
      })
    ).map(department => wrapDepartment(department, this._prisma))

    for (const leave of company.users[0].my_leaves) {
      if (leave.user) {
        leave.user.department = company.users[0].department
        leave.user.cached_schedule = await company.users[0].promise_schedule_I_obey()
      }
      leave.approver = await leave.promise_approver()
    }

    return company
  }

  user.getDepartment = async function() {
    if (this.department) return this.department

    this.department = wrapDepartment(
      await this._prisma.departments.findUnique({
        where: { id: this.department_id }
      }),
      this._prisma
    )

    return this.department
  }

  user.getMy_leaves = async function(args) {
    args = args || {}
    const where = Object.assign({ user_id: this.id }, coerceWhere(args.where))

    return findLeaves(this._prisma, {
      where,
      include: getLeaveIncludeForPrisma()
    })
  }

  user.getFeeds = async function() {
    return this._prisma.user_feeds.findMany({
      where: { user_id: this.id },
      orderBy: { created_at: 'asc' }
    })
  }

  user.getAdjustments = function(args) {
    return this._prisma.user_allowance_adjustment.findMany({
      where: Object.assign({ user_id: this.id }, coerceWhere(args && args.where)),
      orderBy: { year: 'desc' }
    })
  }

  user.promise_schedule_I_obey = async function() {
    if (this.cached_schedule) return this.cached_schedule

    const schedules = await this._prisma.schedules.findMany({
      where: {
        OR: [{ user_id: this.id }, { company_id: this.company_id }]
      }
    })

    if (schedules.length === 0) {
      // Use the built-in default Mon–Fri schedule; passing a partial row
      // would omit weekday keys and make `is_it_working_day` false every day.
      this.cached_schedule = wrapSchedule(null, this._prisma)
      return this.cached_schedule
    }

    if (schedules.length === 2) {
      this.cached_schedule = wrapSchedule(
        schedules.find(schedule => schedule.user_id) || schedules[0],
        this._prisma
      )
      return this.cached_schedule
    }

    this.cached_schedule = wrapSchedule(schedules.pop(), this._prisma)
    return this.cached_schedule
  }

  user.promise_supervised_departments = async function() {
    const links = await this._prisma.department_supervisors.findMany({
      where: { user_id: this.id }
    })
    const departmentIds = links.map(link => link.department_id)

    return (
      await this._prisma.departments.findMany({
        where: {
          OR: [{ id: { in: departmentIds } }, { manager_id: this.id }]
        },
        orderBy: { name: 'asc' },
        include: {
          users: {
            orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
            include: {
              companies: true,
              departments: true
            }
          }
        }
      })
    ).map(department => wrapDepartment(department, this._prisma))
  }

  user.promise_supervised_users = async function() {
    const departments = await this.promise_supervised_departments()
    const departmentIds = departments.map(department => department.id)

    if (departmentIds.length === 0) return []

    return (
      await this._prisma.users.findMany({
        where: { department_id: { in: departmentIds } },
        orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
        include: {
          companies: true,
          departments: true
        }
      })
    ).map(supervisedUser => wrapUser(supervisedUser, this._prisma))
  }

  user.promise_users_I_can_manage = async function() {
    let users

    if (this.is_admin()) {
      users = (
        await this._prisma.users.findMany({
          where: { company_id: this.company_id },
          include: {
            companies: true,
            departments: true
          }
        })
      ).map(managedUser => wrapUser(managedUser, this._prisma))
    } else {
      const departments = await this.promise_supervised_departments()
      users = departments.map(department => department.users || []).flat()
    }

    users.push(this)

    return _.uniq(users, user => user.id).sort((a, b) =>
      sorter(a.lastname, b.lastname)
    )
  }

  user.promise_manager = async function() {
    const department = await this.getDepartment()

    if (!department || !department.manager_id) return null

    return loadSessionUserById(this._prisma, department.manager_id)
  }

  user.promise_supervisors = async function() {
    const department = await this.getDepartment()

    if (!department) {
      console.log('Warning: Department not found for user')
      return []
    }

    const supervisors = []

    if (department.manager_id) {
      const manager = await loadSessionUserById(this._prisma, department.manager_id)
      if (manager) supervisors.push(manager)
    }

    const links = await this._prisma.department_supervisors.findMany({
      where: { department_id: department.id },
      include: {
        users: {
          include: {
            companies: true,
            departments: true
          }
        }
      }
    })

    links.forEach(link => {
      if (link.users) supervisors.push(wrapUser(link.users, this._prisma))
    })

    return _.uniq(supervisors, supervisor => supervisor.id)
  }

  user.promise_allowance = function(args) {
    args = args || {}
    args.user = this
    return UserAllowance.promise_allowance(args)
  }

  user.promise_personal_adjustment_for_year = async function(year) {
    const adjustment = await this._prisma.user_allowance_adjustment.findUnique({
      where: {
        user_id_year: {
          user_id: this.id,
          year: asInt(year)
        }
      }
    })

    return adjustment && adjustment.personal_adjustment !== null
      ? adjustment.personal_adjustment
      : 0
  }

  user.promise_adjustment_and_carry_over_for_year = async function(inputYear) {
    const startYear = moment.utc(this.start_date).year()
    let year = asInt(moment.utc(inputYear || moment.utc()).format('YYYY'))

    while (year >= startYear) {
      const adjustment = await this._prisma.user_allowance_adjustment.findUnique({
        where: {
          user_id_year: {
            user_id: this.id,
            year
          }
        }
      })

      if (adjustment) {
        return {
          adjustment: adjustment.adjustment || 0,
          carried_over_allowance: adjustment.carried_over_allowance || 0
        }
      }

      year--
    }

    return {
      adjustment: 0,
      carried_over_allowance: 0
    }
  }

  user.promise_adjustment_for_year = function(year) {
    return this.promise_adjustment_and_carry_over_for_year(year).then(record => record.adjustment)
  }

  user.promise_carried_over_allowance_for_year = function(year) {
    return this.promise_adjustment_and_carry_over_for_year(year).then(
      record => record.carried_over_allowance
    )
  }

  user.promise_to_update_personal_adjustment = async function(args) {
    if (!args.year || !Object.prototype.hasOwnProperty.call(args, 'adjustment')) {
      throw new Error(
        'User.promise_to_update_personal_adjustment needs year and adjustment parameters'
      )
    }

    const personalAdjustment = asFloatOrNull(args.adjustment)
    return this._prisma.user_allowance_adjustment.upsert({
      where: {
        user_id_year: {
          user_id: this.id,
          year: asInt(args.year)
        }
      },
      create: {
        user_id: this.id,
        year: asInt(args.year),
        personal_adjustment: personalAdjustment,
        created_at: now()
      },
      update: {
        personal_adjustment: personalAdjustment
      }
    })
  }

  user.promise_to_update_adjustment = async function(args) {
    const year = asInt(args.year || moment.utc().format('YYYY'))
    const adjustment = asFloatOrNull(args.adjustment)

    return this._prisma.user_allowance_adjustment.upsert({
      where: {
        user_id_year: {
          user_id: this.id,
          year
        }
      },
      create: {
        user_id: this.id,
        year,
        adjustment,
        created_at: now()
      },
      update: {
        adjustment
      }
    })
  }

  user.promise_to_update_carried_over_allowance = async function(args) {
    const year = asInt(args.year || moment.utc().format('YYYY'))

    return this._prisma.user_allowance_adjustment.upsert({
      where: {
        user_id_year: {
          user_id: this.id,
          year
        }
      },
      create: {
        user_id: this.id,
        year,
        carried_over_allowance: args.carried_over_allowance,
        created_at: now()
      },
      update: {
        carried_over_allowance: args.carried_over_allowance
      }
    })
  }

  user.promise_my_leaves = async function(args) {
    args = args || {}
    const year = args.year || moment.utc().year()
    const where = {
      user_id: this.id
    }

    const and = []
    if (args.filter_status) and.push({ status: { in: [].concat(args.filter_status) } })
    if (args.filter && args.filter.id) and.push({ id: asInt(args.filter.id) })

    if (!args.ignore_year) {
      and.push(yearOverlapWhere(year))
    } else if (args.dateStart && args.dateEnd) {
      and.push(rangeOverlapWhere(args.dateStart, args.dateEnd))
    }

    if (and.length > 0) where.AND = and

    const leaves = await findLeaves(this._prisma, {
      where,
      include: getLeaveIncludeForPrisma()
    })

    for (const leave of leaves) {
      if (leave.user) {
        leave.user.cached_schedule = this.cached_schedule
        leave.user.department = await this.getDepartment()
        await leave.user.promise_schedule_I_obey()
      }
      leave.approver = await leave.promise_approver()
    }

    return LeaveCollectionUtil.promise_to_sort_leaves(leaves)
  }

  user.promise_my_active_leaves = function(args) {
    return this.promise_my_leaves({
      year: args && args.year ? args.year : moment.utc().year(),
      filter_status: [
        leaveConstants.status_approved(),
        leaveConstants.status_new(),
        leaveConstants.status_pended_revoke()
      ]
    }).then(leaves => LeaveCollectionUtil.promise_to_sort_leaves(leaves))
  }

  user.promise_my_active_leaves_ever = function() {
    return this.promise_my_leaves({
      ignore_year: true,
      filter_status: [
        leaveConstants.status_approved(),
        leaveConstants.status_new(),
        leaveConstants.status_pended_revoke()
      ]
    }).then(leaves => LeaveCollectionUtil.promise_to_sort_leaves(leaves))
  }

  user.promise_leaves_to_be_processed = async function() {
    const users = await this.promise_supervised_users()
    const userIds = users.map(supervisedUser => supervisedUser.id)

    if (userIds.length === 0) return []

    const leaves = await findLeaves(this._prisma, {
      where: {
        status: {
          in: [
            leaveConstants.status_new(),
            leaveConstants.status_pended_revoke()
          ]
        },
        user_id: { in: userIds }
      },
      include: getLeaveIncludeForPrisma()
    })

    await Promise.map(
      leaves,
      leave => (leave.user ? leave.user.promise_schedule_I_obey() : Promise.resolve()),
      { concurrency: 10 }
    )

    return LeaveCollectionUtil.promise_to_sort_leaves(leaves)
  }

  user.promise_cancelable_leaves = function() {
    return this.promise_my_leaves({
      ignore_year: true,
      filter_status: [leaveConstants.status_new()]
    }).then(leaves =>
      Promise.map(
        leaves,
        leave => (leave.user ? leave.user.promise_schedule_I_obey() : Promise.resolve()),
        { concurrency: 10 }
      ).then(() => LeaveCollectionUtil.promise_to_sort_leaves(leaves))
    )
  }

  user.promise_my_leaves_for_calendar = function(args) {
    return this.getMy_leaves({
      where: {
        AND: [
          { status: { not: leaveConstants.status_rejected() } },
          { status: { not: leaveConstants.status_canceled() } },
          yearOverlapWhere(args.year || moment.utc())
        ]
      }
    })
  }

  user.promise_calendar = async function(args) {
    args = args || {}
    const year = args.year || this.company.get_today()
    const showFullYear = args.show_full_year || false
    const months = showFullYear
      ? _.map([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], i =>
          moment.utc(year.format('YYYY') + '-' + i + '-01')
        )
      : _.map([0, 1, 2, 3], delta =>
          this.company
            .get_today()
            .add(delta, 'months')
            .startOf('month')
        )

    const department = await this.getDepartment()
    const company = await this.getCompany()
    const leaves = await this.getMy_leaves({
      where: {
        AND: [
          { status: { not: leaveConstants.status_rejected() } },
          { status: { not: leaveConstants.status_canceled() } },
          yearOverlapWhere(year)
        ]
      }
    })
    const schedule = await this.promise_schedule_I_obey()
    const leaveDays = _.flatten(
      _.map(leaves, leave =>
        _.map(leave.get_days(), leaveDay => {
          leaveDay.leave = leave
          return leaveDay
        })
      )
    )

    return _.map(
      months,
      month =>
        new CalendarMonth(month, {
          bank_holidays: department.include_public_holidays
            ? company.bank_holidays
            : [],
          leave_days: leaveDays,
          schedule,
          today: company.get_today(),
          leave_types: company.leave_types,
          first_day_of_week: company.first_day_of_week
        })
    )
  }

  user.calculate_number_of_days_taken_from_allowance = function(args) {
    args = args || {}
    let leaves = _.uniq(this.my_leaves || [], leave => leave.id)

    leaves.forEach(leave => {
      if (leave.user) leave.user.cached_schedule = this.cached_schedule
    })

    if (args.count_personal) {
      leaves = leaves.filter(leave => leave.leave_type && leave.leave_type.use_personal)
    } else if (args.count_regular) {
      leaves = leaves.filter(
        leave =>
          leave.leave_type &&
          leave.leave_type.use_allowance &&
          !leave.leave_type.use_personal
      )
    } else if (args.leave_type) {
      leaves = leaves.filter(leave =>
        args.leave_type.use_personal
          ? leave.leave_type && leave.leave_type.use_personal
          : leave.leave_type_id === args.leave_type.id
      )
    } else {
      // Default (UserAllowance pool): total days taken from allowance (regular + personal).
      // This value is used to compute overall remaining allowance. Regular/vacation-only
      // remaining is derived later by subtracting remaining personal allowance.
      leaves = leaves.filter(
        leave =>
          leave.leave_type &&
          leave.leave_type.use_allowance
      )
    }

    const includeApproved =
      args.include_approved === undefined ? true : !!args.include_approved
    const includePending =
      args.include_pending === undefined ? false : !!args.include_pending
    const includePendedRevoke =
      args.include_pended_revoke === undefined
        ? true
        : !!args.include_pended_revoke

    return leaves.reduce((memo, leave) => {
      if (args.exclude_leave_id && String(leave.id) === String(args.exclude_leave_id)) {
        return memo
      }

      if (
        leave.status === leaveConstants.status_canceled() ||
        leave.status === leaveConstants.status_rejected()
      ) {
        return memo
      }

      const isApproved = leave.status === leaveConstants.status_approved()
      const isPending = leave.status === leaveConstants.status_new()
      const isPendedRevoke = leave.status === leaveConstants.status_pended_revoke()

      if (
        (includeApproved && isApproved) ||
        (includePending && isPending) ||
        (includePendedRevoke && isPendedRevoke)
      ) {
        return memo + leave.get_deducted_days_number(args)
      }

      return memo
    }, 0)
  }

  user.get_leave_statistics_by_types = async function(args) {
    args = args || {}
    const statistics = {}
    const year = args.year || moment.utc().year()
    const company = await this.get_company_with_all_leave_types()

    if (!this.department) this.department = await this.getDepartment()

    for (const leaveType of company.leave_types) {
      const stat = {
        leave_type: leaveType,
        days_taken: 0,
        limit: leaveType.limit ? leaveType.limit : 0
      }

      if (leaveType.use_personal) {
        const personalAdjustment = await this.promise_personal_adjustment_for_year(year)
        stat.limit = this.department.personal + (personalAdjustment || 0)
      }

      statistics[leaveType.id] = stat
    }

    const yearForDays =
      typeof year === 'number'
        ? String(year)
        : moment.isMoment(year)
          ? year.format('YYYY')
          : String(year)

    _.filter(
      _.uniq(this.my_leaves || [], l => l.id),
      leave =>
        (leave.is_approved_leave() || leave.is_pended_revoke_leave()) &&
        leave.status !== leaveConstants.status_canceled() &&
        leave.status !== leaveConstants.status_rejected()
    ).forEach(leave => {
      const stat = statistics[leave.leave_type.id]
      if (stat) {
        stat.days_taken += leave.get_deducted_days_number({
          ignore_allowance: true,
          year: yearForDays
        })
      }
    })

    let stats = Object.values(statistics)
      .sort((a, b) => sorter(a.days_taken, b.days_taken))
      .reverse()

    if (args.limit_by_top) stats = _.first(stats, 4)

    return stats.sort((a, b) => sorter(a.leave_type.name, b.leave_type.name))
  }

  user.validate_overlapping = async function(newLeaveAttributes) {
    const leaves = await findLeaves(this._prisma, {
      where: {
        AND: [
          {
            user_id: this.id,
            status: {
              in: [
                leaveConstants.status_new(),
                leaveConstants.status_approved(),
                leaveConstants.status_pended_revoke()
              ]
            }
          },
          rangeOverlapWhere(newLeaveAttributes.from_date, newLeaveAttributes.to_date)
        ]
      },
      include: getLeaveIncludeForPrisma()
    })

    if (leaves.length === 0) return 1

    const newIntervals = buildIntervalsForLeaveLike(newLeaveAttributes)
    const conflicting = leaves.find(existingLeave =>
      anyOverlap(newIntervals, buildIntervalsForLeaveLike(existingLeave))
    )

    if (conflicting) {
      const error = new Error('Overlapping booking!')
      error.user_message = 'Overlapping booking!'
      throw error
    }

    return 1
  }

  user._sum_days_for_leave_type = function(args) {
    const year =
      typeof args.year === 'number'
        ? String(args.year)
        : moment.isMoment(args.year)
          ? args.year.format('YYYY')
          : args.year
          ? String(args.year)
          : moment.utc().format('YYYY')
    const leaveTypeId = args.leave_type && args.leave_type.id
    const excludeLeaveId = args.exclude_leave_id
    const includeApproved =
      args.include_approved === undefined ? true : !!args.include_approved
    const includePending =
      args.include_pending === undefined ? false : !!args.include_pending
    const includePendedRevoke =
      args.include_pended_revoke === undefined
        ? true
        : !!args.include_pended_revoke

    const leaves = _.uniq(this.my_leaves || [], leave => leave.id)
    return leaves.reduce((memo, leave) => {
      if (
        excludeLeaveId &&
        String(leave.id) === String(excludeLeaveId)
      ) {
        return memo
      }
      if (
        leave.status === leaveConstants.status_canceled() ||
        leave.status === leaveConstants.status_rejected()
      ) {
        return memo
      }
      const isApproved = leave.status === leaveConstants.status_approved()
      const isPending = leave.status === leaveConstants.status_new()
      const isPendedRevoke = leave.status === leaveConstants.status_pended_revoke()
      const shouldCount =
        (includeApproved && isApproved) ||
        (includePending && isPending) ||
        (includePendedRevoke && isPendedRevoke)
      if (!shouldCount) return memo
      if (leaveTypeId && leave.leave_type_id !== leaveTypeId) {
        return memo
      }
      return (
        memo +
        leave.get_deducted_days_number({
          year,
          user: this,
          ignore_allowance: true
        })
      )
    }, 0)
  }

  user.validate_leave_fits_into_remaining_allowance = async function(args) {
    const leaveType = args.leave_type
    const leave = args.leave
    const year = args.year || moment.utc(leave.date_start)
    const include_pending = args.include_pending === undefined ? false : !!args.include_pending
    const employee = await this.reload_with_leave_details({ year })
    await employee.reload_with_session_details()
    await employee.company.reload_with_bank_holidays()

    const excludeLeaveId = leave && leave.id ? leave.id : undefined

    const allowance = await employee.promise_allowance({
      year,
      exclude_leave_id: excludeLeaveId,
      // Caller decides whether pending (status_new) requests count as consuming
      // allowance via `include_pending`.
      include_pending
    })
    const deductedDays = leave.get_deducted_days_number({
      year: year.format('YYYY'),
      user: employee,
      leave_type: leaveType
    })

    const daysTakenForLeaveType = leaveType
      ? employee._sum_days_for_leave_type({
          year: year.format('YYYY'),
          leave_type: leaveType,
          exclude_leave_id: excludeLeaveId,
          include_pending
        })
      : 0

    const verdict = evaluateLeaveAgainstAllowance({
      allowance,
      leaveType,
      deductedDays,
      daysTakenForLeaveType
    })

    if (!verdict.ok) {
      const error = new Error(verdict.message)
      error.user_message = verdict.message
      error.code = verdict.code
      throw error
    }

    return employee
  }

  user.validate_leave_fits_into_limit = async function(args) {
    const leaveType = args.leave_type
    const leave = args.leave
    const year = args.year || moment.utc(leave.date_start)
    const include_pending = args.include_pending === undefined ? false : !!args.include_pending

    if (!leaveType || !leaveType.limit || leaveType.limit <= 0) {
      return this
    }

    const excludeLeaveId = leave && leave.id ? leave.id : undefined
    const employee = await this.reload_with_leave_details({ year })
    await employee.reload_with_session_details()
    await employee.company.reload_with_bank_holidays()

    const deductedDays = leave.get_deducted_days_number({
      year: year.format('YYYY'),
      user: employee,
      leave_type: leaveType,
      ignore_allowance: true
    })

    const daysTakenForLeaveType = employee._sum_days_for_leave_type({
      year: year.format('YYYY'),
      leave_type: leaveType,
      exclude_leave_id: excludeLeaveId,
      include_pending
    })

    const verdict = evaluateLeaveAgainstLimit({
      leaveType,
      deductedDays,
      daysTakenForLeaveType
    })

    if (!verdict.ok) {
      const error = new Error(verdict.message)
      error.user_message = verdict.message
      error.code = verdict.code
      throw error
    }

    return employee
  }

  user.remove = async function() {
    if (this.is_admin()) throw new Error('Cannot remove administrator user')

    const departments = await this.promise_supervised_departments()
    if (departments.length > 0) throw new Error('Cannot remove supervisor')

    await this._prisma.comments.deleteMany({ where: { by_user_id: this.id } })
    await this._prisma.user_feeds.deleteMany({ where: { user_id: this.id } })
    await this._prisma.user_allowance_adjustment.deleteMany({
      where: { user_id: this.id }
    })
    await this._prisma.email_audits.deleteMany({ where: { user_id: this.id } })
    await this._prisma.schedules.deleteMany({ where: { user_id: this.id } })
    await this._prisma.leaves.deleteMany({ where: { user_id: this.id } })

    return this._prisma.users.delete({ where: { id: this.id } })
  }

  user.get_reset_password_token = async function() {
    const token = crypto.randomBytes(32).toString('hex')

    this.reset_password_token = token
    this.reset_password_expires = moment()
      .add(3, 'hour')
      .toDate()

    await this.save()
    return token
  }

  user.record_email_addressed_to_me = function(emailObj) {
    if (!emailObj || !emailObj.subject || !emailObj.body) {
      throw new Error(
        'Got incorrect parameters. There should be an object to represent and email and contain subject and body'
      )
    }

    return this._prisma.email_audits.create({
      data: {
        email: this.email,
        subject: htmlToText.fromString(emailObj.subject),
        body: htmlToText.fromString(emailObj.body),
        user_id: this.id,
        company_id: this.company_id,
        created_at: now()
      }
    })
  }

  return user
}

async function loadSessionUserById(prismaClient, id) {
  const db = getPrisma(prismaClient)
  const user = await db.users.findUnique({
    where: { id: asInt(id) },
    include: {
      companies: true,
      departments: true
    }
  })

  return wrapUser(user, db)
}

async function createDefaultCompany(db, args) {
  const countryCode = args.country_code || 'UK'
  const timezone = args.timezone || 'Europe/London'

  return db.$transaction(async tx => {
    const company = await tx.companies.create({
      data: {
        name: args.name || 'New company',
        country: countryCode,
        start_of_new_year: 1,
        timezone,
        integration_api_token: uuidv4(),
        created_at: now(),
        updated_at: now()
      }
    })

    await tx.departments.create({
      data: {
        name: 'Sales',
        company_id: company.id,
        created_at: now(),
        updated_at: now()
      }
    })

    let bankHolidays = [
      {
        name: 'Early May bank holiday',
        date: new Date('2015-05-04T00:00:00.000Z'),
        company_id: company.id,
        created_at: now(),
        updated_at: now()
      }
    ]

    const countries = config.get('countries') || {}
    if (
      countries[countryCode] &&
      countries[countryCode].bank_holidays &&
      countries[countryCode].bank_holidays.length > 0
    ) {
      bankHolidays = countries[countryCode].bank_holidays.map(bankHoliday => ({
        name: bankHoliday.name,
        date: new Date(bankHoliday.date),
        company_id: company.id,
        created_at: now(),
        updated_at: now()
      }))
    }

    await tx.bank_holidays.createMany({ data: bankHolidays })
    await tx.leave_types.createMany({
      data: [
        {
          name: 'Holiday',
          color: '#22AA66',
          company_id: company.id,
          created_at: now(),
          updated_at: now()
        },
        {
          name: 'Sick Leave',
          color: '#459FF3',
          company_id: company.id,
          limit: 10,
          use_allowance: false,
          created_at: now(),
          updated_at: now()
        }
      ]
    })

    return company
  })
}

const User = {
  hashify_password(password) {
    return bcrypt.hashSync(password, 12)
  },

  verify_password(password, hash) {
    return bcrypt.compareSync(password, hash)
  },

  scope(_scopeName) {
    return {
      findOne: opts => User.findOne(opts)
    }
  },

  async find_by_email(email, prismaClient) {
    const db = getPrisma(prismaClient)
    return User.findOne({
      where: activeUserWhere({ email })
    }, db)
  },

  async findOne(args, prismaClient) {
    const db = getPrisma(prismaClient)
    const user = await db.users.findFirst({
      where: coerceWhere(args && args.where),
      include: {
        companies: true,
        departments: true
      }
    })

    return wrapUser(user, db)
  },

  async findAll(args, prismaClient) {
    const db = getPrisma(prismaClient)
    return (
      await db.users.findMany({
        where: coerceWhere(args && args.where),
        orderBy: [{ lastname: 'asc' }, { name: 'asc' }],
        include: {
          companies: true,
          departments: true
        }
      })
    ).map(user => wrapUser(user, db))
  },

  async count(args, prismaClient) {
    const db = getPrisma(prismaClient)
    return db.users.count({
      where: coerceWhere(args && args.where)
    })
  },

  async get_user_by_reset_password_token(token, prismaClient) {
    const db = getPrisma(prismaClient)
    return User.findOne({
      where: {
        reset_password_token: token,
        reset_password_expires: {
          gt: new Date()
        }
      }
    }, db)
  },

  async register_new_admin_user(attributes, prismaClient) {
    const db = getPrisma(prismaClient)
    const userAttributes = Object.assign({}, attributes)
    const countryCode = userAttributes.country_code
    const timezone = userAttributes.timezone
    const companyName = userAttributes.company_name

    delete userAttributes.company_name
    delete userAttributes.country_code
    delete userAttributes.timezone

    const existingUser = await User.find_by_email(userAttributes.email, db)
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

    const company = await createDefaultCompany(db, {
      name: companyName,
      country_code: countryCode,
      timezone
    })
    const departments = await db.departments.findMany({
      where: { company_id: company.id },
      orderBy: { name: 'asc' }
    })
    const newUser = await db.users.create({
      data: Object.assign(userAttributes, {
        company_id: company.id,
        department_id: departments[0].id,
        admin: true,
        activated: userAttributes.activated || false,
        auto_approve: userAttributes.auto_approve || false,
        manager: userAttributes.manager || false,
        start_date: userAttributes.start_date || now(),
        created_at: now(),
        updated_at: now()
      }),
      include: {
        companies: true,
        departments: true
      }
    })

    await db.departments.updateMany({
      where: { company_id: company.id },
      data: {
        manager_id: newUser.id,
        updated_at: now()
      }
    })

    return wrapUser(newUser, db)
  }
}

module.exports = {
  loadSessionUserById,
  User,
  wrapLeave,
  wrapLeaveType,
  wrapUser,
  wrapCompany,
  wrapDepartment,
  wrapSchedule,
  createDefaultCompany,
  getLeaveIncludeForPrisma
}
