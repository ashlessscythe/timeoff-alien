import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  bookLeave,
  createLeaveType,
  createDepartment,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')
const moment = require('moment')
const UserAllowance = require('../../lib/model/user_allowance.js')
const { loadSessionUserById } = require('../../lib/model/sessionUser.js')

/** Date-only ISO (UTC), N days from today — avoids payroll "past week" blocks for employees. */
function addDaysIso(n) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const UTC_DOW = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
}

/** Next `dayName` on/after `from` + `minAheadDays` (UTC). */
function nextUtcWeekdayIso(from, dayName, minAheadDays = 7) {
  const target = UTC_DOW[dayName]
  const d = new Date(from)
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + minAheadDays)
  for (let i = 0; i < 21; i++) {
    if (d.getUTCDay() === target) return d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  throw new Error(`nextUtcWeekdayIso: no ${dayName}`)
}

function addCalendarDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('booking validation', () => {
  it('rejects overlapping bookings on the same day', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    expect(holiday).toBeTruthy()

    const day = addDaysIso(40)
    const body = {
      leave_type: String(holiday.id),
      from_date: day,
      to_date: day,
      from_date_part: '1',
      to_date_part: '1',
      reason: 'first',
      increment_type: 'day'
    }
    const first = await agent
      .post('/calendar/bookleave/')
      .type('form')
      .send(body)
      .redirects(5)
    expect(first.status).toBeLessThan(400)

    const second = await agent
      .post('/calendar/bookleave/')
      .type('form')
      .send({ ...body, reason: 'second' })
      .redirects(5)
    expect(second.status).toBeLessThan(400)

    const rows = await prisma.leaves.findMany({
      where: {
        user_id: user.id,
        leave_type_id: holiday.id
      }
    })
    expect(rows.length).toBe(1)
  })

  it('rejects booking more days than annual allowance', async () => {
    const agent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { allowance: 1, personal: 0, manager_id: admin.id }
    })
    const empEmail = `overbook_${Date.now()}@example.com`
    await addEmployee(agent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'Over',
      lastname: 'Book'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })

    const before = await prisma.leaves.count({ where: { user_id: empUser.id } })
    const from = nextUtcWeekdayIso(new Date(), 'Monday', 7)
    const to = addCalendarDaysIso(from, 9)
    const res = await emp
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(holiday.id),
        from_date: from,
        to_date: to,
        from_date_part: '1',
        to_date_part: '1',
        reason: 'overbook',
        increment_type: 'day'
      })
      .redirects(5)
    expect(res.status).toBeLessThan(400)

    const after = await prisma.leaves.count({ where: { user_id: empUser.id } })
    expect(after).toBe(before)
  })

  it('rejects half-day when department only allows full_day', async () => {
    const agent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    const deptName = `FullDayOnly ${Date.now()}`
    const deptRes = await createDepartment(agent, {
      name: deptName,
      allowance: '20',
      personal: '0',
      managerId: admin.id,
      allowedIncrements: ['full_day']
    })
    expect(deptRes.status).toBeLessThan(400)
    const dept = await prisma.departments.findFirst({
      where: { company_id: admin.company_id, name: deptName }
    })
    expect(dept).toBeTruthy()
    const inc = JSON.parse(dept.allowed_increments || '[]')
    expect(inc).toEqual(['full_day'])

    const empEmail = `emp_half_${Date.now()}@example.com`
    await addEmployee(agent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Half',
      lastname: 'Tester'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })

    const halfDay = addDaysIso(45)
    const fullDay = addDaysIso(46)
    const bad = await emp
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(holiday.id),
        from_date: halfDay,
        to_date: halfDay,
        from_date_part: '1',
        to_date_part: '1',
        reason: 'half',
        increment_type: 'halfday'
      })
      .redirects(5)
    expect(bad.status).toBeLessThan(400)

    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const halfStart = new Date(`${halfDay}T00:00:00.000Z`)
    const halfEnd = new Date(`${halfDay}T23:59:59.999Z`)
    const nHalf = await prisma.leaves.count({
      where: {
        user_id: empUser.id,
        date_start: { gte: halfStart, lte: halfEnd }
      }
    })
    expect(nHalf).toBe(0)

    const good = await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: fullDay,
      toDate: fullDay,
      fromDatePart: '1',
      toDatePart: '1',
      reason: 'full'
    })
    expect(good.status).toBeLessThan(400)
    const fullStart = new Date(`${fullDay}T00:00:00.000Z`)
    const fullEnd = new Date(`${fullDay}T23:59:59.999Z`)
    const nFull = await prisma.leaves.count({
      where: {
        user_id: empUser.id,
        date_start: { gte: fullStart, lte: fullEnd }
      }
    })
    expect(nFull).toBe(1)
  })
})

describe('leave type behavior', () => {
  it('use_allowance=true deducts working days from the allowance pool', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    expect(holiday.use_allowance).toBe(true)

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 7)
    const to = addCalendarDaysIso(from, 2)
    await bookLeave(agent, {
      leaveTypeId: holiday.id,
      fromDate: from,
      toDate: to,
      reason: 'multi-day holiday'
    })

    const rowCount = await prisma.leaves.count({ where: { user_id: user.id } })
    expect(rowCount).toBeGreaterThanOrEqual(1)

    const fresh = await loadSessionUserById(prisma, user.id)
    await fresh.reload_with_session_details()
    const year = moment.utc(from, 'YYYY-MM-DD')
    await fresh.reload_with_leave_details({ year })
    expect(fresh.my_leaves.length).toBeGreaterThanOrEqual(1)
    const allowance = await UserAllowance.promise_allowance({
      user: fresh,
      year
    })
    expect(allowance.number_of_days_taken_from_allowance).toBeGreaterThanOrEqual(1)
  })

  it('use_allowance=false does not block long bookings against allowance', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const ltName = `NoAllow ${Date.now()}`
    await createLeaveType(agent, prisma, user.company_id, {
      name: ltName,
      color: '#00AAFF',
      limit: 0,
      use_allowance: false,
      use_personal: false,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: ltName }
    })
    expect(lt).toBeTruthy()

    const res = await bookLeave(agent, {
      leaveTypeId: lt.id,
      fromDate: addDaysIso(100),
      toDate: addDaysIso(130),
      reason: 'long no allowance'
    })
    expect(res.status).toBeLessThan(400)

    const created = await prisma.leaves.findFirst({
      where: { user_id: user.id, leave_type_id: lt.id }
    })
    expect(created).toBeTruthy()
  })

  it('leave type auto_approve skips approval status', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const ltName = `AutoLt ${Date.now()}`
    await createLeaveType(agent, prisma, user.company_id, {
      name: ltName,
      color: '#FF00AA',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: true,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: ltName }
    })
    const autoDay = addDaysIso(70)
    await bookLeave(agent, {
      leaveTypeId: lt.id,
      fromDate: autoDay,
      toDate: autoDay,
      reason: 'auto lt'
    })
    const rowLt = await prisma.leaves.findFirst({
      where: { user_id: user.id, leave_type_id: lt.id },
      orderBy: { id: 'desc' }
    })
    expect(rowLt.status).toBe(leaveConstants.status_approved())

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    const controlDay = addDaysIso(71)
    await bookLeave(agent, {
      leaveTypeId: holiday.id,
      fromDate: controlDay,
      toDate: controlDay,
      reason: 'control holiday'
    })
    const controlStart = new Date(`${controlDay}T00:00:00.000Z`)
    const rowHol = await prisma.leaves.findFirst({
      where: {
        user_id: user.id,
        leave_type_id: holiday.id,
        date_start: { gte: controlStart, lte: new Date(`${controlDay}T23:59:59.999Z`) }
      }
    })
    expect(rowHol.status).toBe(leaveConstants.status_new())
  })
})

describe('user-level auto_approve', () => {
  it('auto-approves Holiday when employee has auto_approve flag', async () => {
    const agent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    const empEmail = `autoemp_${Date.now()}@example.com`
    await addEmployee(agent, {
      email: empEmail,
      departmentId: admin.department_id,
      autoApprove: true,
      name: 'Auto',
      lastname: 'Emp'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: empUser.company_id, name: 'Holiday' }
    })
    const bookDay = addDaysIso(60)
    await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: bookDay,
      toDate: bookDay,
      reason: 'user auto'
    })
    const row = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: holiday.id },
      orderBy: { id: 'desc' }
    })
    expect(row).toBeTruthy()
    expect(row.status).toBe(leaveConstants.status_approved())
  })
})
