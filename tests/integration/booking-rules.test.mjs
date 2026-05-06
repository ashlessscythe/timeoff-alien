import { createRequire } from 'module'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addEmployee,
  bookLeave,
  createAgent,
  createDepartment,
  createLeaveType,
  loginAsNewAgent,
  registerCompanyAndAdmin,
  TEST_PASSWORD
} from '../support/http.mjs'
import { cleanupCompanyVolatileData } from '../support/dbCleanup.mjs'
import app from '../support/loadEnvAndApp.mjs'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')
const moment = require('moment')
const UserAllowance = require('../../lib/model/user_allowance.js')
const { loadSessionUserById } = require('../../lib/model/sessionUser.js')

let adminAgent
let adminUser
let companyId
let holidayType
let sickLeaveType

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

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(adminAgent)
  adminUser = await prisma.users.findFirst({ where: { email } })
  companyId = adminUser.company_id
  holidayType = await prisma.leave_types.findFirst({
    where: { company_id: companyId, name: 'Holiday' }
  })
  sickLeaveType = await prisma.leave_types.findFirst({
    where: { company_id: companyId, name: 'Sick Leave' }
  })
})

beforeEach(async () => {
  await cleanupCompanyVolatileData(prisma, companyId)
})

describe('booking validation', () => {
  it('rejects overlapping bookings on the same day', async () => {
    expect(holidayType).toBeTruthy()

    const day = addDaysIso(40)
    const body = {
      leave_type: String(holidayType.id),
      from_date: day,
      to_date: day,
      from_date_part: '1',
      to_date_part: '1',
      reason: 'first',
      increment_type: 'day'
    }
    const first = await adminAgent
      .post('/calendar/bookleave/')
      .type('form')
      .send(body)
      .redirects(5)
    expect(first.status).toBeLessThan(400)

    const second = await adminAgent
      .post('/calendar/bookleave/')
      .type('form')
      .send({ ...body, reason: 'second' })
      .redirects(5)
    expect(second.status).toBeLessThan(400)

    const rows = await prisma.leaves.findMany({
      where: {
        user_id: adminUser.id,
        leave_type_id: holidayType.id
      }
    })
    expect(rows.length).toBe(1)
  })

  it('rejects booking more days than annual allowance', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 1, personal: 0, manager_id: adminUser.id }
    })
    const empEmail = `overbook_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Over',
      lastname: 'Book'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = holidayType

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

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })

  it('rejects half-day when department only allows full_day', async () => {
    const deptName = `FullDayOnly ${Date.now()}`
    const deptRes = await createDepartment(adminAgent, {
      name: deptName,
      allowance: '20',
      personal: '0',
      managerId: adminUser.id,
      allowedIncrements: ['full_day']
    })
    expect(deptRes.status).toBeLessThan(400)
    const dept = await prisma.departments.findFirst({
      where: { company_id: companyId, name: deptName }
    })
    expect(dept).toBeTruthy()
    const inc = JSON.parse(dept.allowed_increments || '[]')
    expect(inc).toEqual(['full_day'])

    const empEmail = `emp_half_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Half',
      lastname: 'Tester'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const holiday = holidayType

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
    expect(holidayType.use_allowance).toBe(true)

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 7)
    const to = addCalendarDaysIso(from, 2)
    await bookLeave(adminAgent, {
      leaveTypeId: holidayType.id,
      fromDate: from,
      toDate: to,
      reason: 'multi-day holiday'
    })

    const rowCount = await prisma.leaves.count({ where: { user_id: adminUser.id } })
    expect(rowCount).toBeGreaterThanOrEqual(1)

    const fresh = await loadSessionUserById(prisma, adminUser.id)
    await fresh.reload_with_session_details()
    const year = moment.utc(from, 'YYYY-MM-DD')
    await fresh.reload_with_leave_details({ year })
    expect(fresh.my_leaves.length).toBeGreaterThanOrEqual(1)
    const allowance = await UserAllowance.promise_allowance({
      user: fresh,
      year,
      // Newly-booked leave is pending (status_new) in this flow; for this test we
      // want to assert the allowance pool deduction includes pending bookings.
      include_pending: true
    })
    expect(allowance.number_of_days_taken_from_allowance).toBeGreaterThanOrEqual(1)
  })

  it('use_allowance=false does not block long bookings against allowance', async () => {
    const ltName = `NoAllow ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
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
      where: { company_id: companyId, name: ltName }
    })
    expect(lt).toBeTruthy()

    const res = await bookLeave(adminAgent, {
      leaveTypeId: lt.id,
      fromDate: addDaysIso(100),
      toDate: addDaysIso(130),
      reason: 'long no allowance'
    })
    expect(res.status).toBeLessThan(400)

    const created = await prisma.leaves.findFirst({
      where: { user_id: adminUser.id, leave_type_id: lt.id }
    })
    expect(created).toBeTruthy()
  })

  it('leave type auto_approve skips approval status', async () => {
    const ltName = `AutoLt ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
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
      where: { company_id: companyId, name: ltName }
    })
    const autoDay = addDaysIso(70)
    await bookLeave(adminAgent, {
      leaveTypeId: lt.id,
      fromDate: autoDay,
      toDate: autoDay,
      reason: 'auto lt'
    })
    const rowLt = await prisma.leaves.findFirst({
      where: { user_id: adminUser.id, leave_type_id: lt.id },
      orderBy: { id: 'desc' }
    })
    expect(rowLt.status).toBe(leaveConstants.status_approved())

    const holiday = holidayType
    const controlDay = addDaysIso(71)
    await bookLeave(adminAgent, {
      leaveTypeId: holiday.id,
      fromDate: controlDay,
      toDate: controlDay,
      reason: 'control holiday'
    })
    const controlStart = new Date(`${controlDay}T00:00:00.000Z`)
    const rowHol = await prisma.leaves.findFirst({
      where: {
        user_id: adminUser.id,
        leave_type_id: holiday.id,
        date_start: { gte: controlStart, lte: new Date(`${controlDay}T23:59:59.999Z`) }
      }
    })
    expect(rowHol.status).toBe(leaveConstants.status_new())
  })
})

describe('user-level auto_approve', () => {
  it('auto-approves Holiday when employee has auto_approve flag', async () => {
    const empEmail = `autoemp_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
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

describe('allowance pool routing', () => {
  it('rejects personal leave that exceeds personal pool even when regular pool has room', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    // 10 total = 5 regular + 5 personal
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 10, personal: 5, manager_id: adminUser.id }
    })

    const ltName = `Personal ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
      name: ltName,
      color: '#AABBCC',
      limit: 0,
      use_allowance: true,
      use_personal: true,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const personalLt = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: ltName }
    })

    const empEmail = `pers_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Pers',
      lastname: 'Test'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 14)
    const to = addCalendarDaysIso(from, 5) // 6 weekdays Mon..Sat, 5 working days

    const before = await prisma.leaves.count({ where: { user_id: empUser.id } })
    await bookLeave(emp, {
      leaveTypeId: personalLt.id,
      fromDate: from,
      toDate: addCalendarDaysIso(from, 7),
      reason: 'overpersonal'
    })
    const after = await prisma.leaves.count({ where: { user_id: empUser.id } })
    expect(after).toBe(before)

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })

  it('allows personal leave that fits within personal pool', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 10, personal: 5, manager_id: adminUser.id }
    })
    const ltName = `Personal ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
      name: ltName,
      color: '#AABBCC',
      limit: 0,
      use_allowance: true,
      use_personal: true,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const personalLt = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: ltName }
    })
    const empEmail = `persok_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'OK',
      lastname: 'Pers'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 21)
    const to = addCalendarDaysIso(from, 4) // Mon..Fri = 5 working days

    await bookLeave(emp, {
      leaveTypeId: personalLt.id,
      fromDate: from,
      toDate: to,
      reason: 'fitspersonal'
    })

    const row = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: personalLt.id },
      orderBy: { id: 'desc' }
    })
    expect(row).toBeTruthy()

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })

  it('rejects regular leave that exceeds regular pool even when personal pool is intact', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    // 7 total = 2 regular + 5 personal
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 7, personal: 5, manager_id: adminUser.id }
    })

    const empEmail = `reg_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Reg',
      lastname: 'Pool'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = holidayType

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 14)
    const to = addCalendarDaysIso(from, 4) // 5 working days > 2 regular
    const before = await prisma.leaves.count({ where: { user_id: empUser.id } })
    await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: from,
      toDate: to,
      reason: 'overregular'
    })
    const after = await prisma.leaves.count({ where: { user_id: empUser.id } })
    expect(after).toBe(before)

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })

  it('personal_adjustment increases personal pool capacity', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 20, personal: 2, manager_id: adminUser.id }
    })

    const ltName = `Personal ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
      name: ltName,
      color: '#AABBCC',
      limit: 0,
      use_allowance: true,
      use_personal: true,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const personalLt = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: ltName }
    })

    const empEmail = `padj_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Padj',
      lastname: 'Pers'
    })
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    // Seed personal_adjustment of +3 -> total personal = 5
    const from = nextUtcWeekdayIso(new Date(), 'Monday', 14)
    const year = parseInt(from.slice(0, 4), 10)
    await prisma.user_allowance_adjustment.upsert({
      where: { user_id_year: { user_id: empUser.id, year } },
      update: { personal_adjustment: 3 },
      create: {
        user_id: empUser.id,
        year,
        personal_adjustment: 3,
        adjustment: 0,
        carried_over_allowance: 0,
        created_at: new Date()
      }
    })

    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const to = addCalendarDaysIso(from, 4) // 5 working days
    await bookLeave(emp, {
      leaveTypeId: personalLt.id,
      fromDate: from,
      toDate: to,
      reason: 'personal-adjusted'
    })
    const row = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: personalLt.id },
      orderBy: { id: 'desc' }
    })
    expect(row).toBeTruthy()

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })

  it('carried_over_allowance increases regular pool', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    // 5 total, 0 personal -> regular pool = 5; with carry_over=5 regular pool = 10
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 5, personal: 0, manager_id: adminUser.id }
    })

    const empEmail = `carry_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Carry',
      lastname: 'Over'
    })
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 14)
    const year = parseInt(from.slice(0, 4), 10)
    await prisma.user_allowance_adjustment.upsert({
      where: { user_id_year: { user_id: empUser.id, year } },
      update: { carried_over_allowance: 5 },
      create: {
        user_id: empUser.id,
        year,
        adjustment: 0,
        personal_adjustment: 0,
        carried_over_allowance: 5,
        created_at: new Date()
      }
    })

    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const holiday = holidayType

    // Book 8 working days (> 5 base allowance, fits with +5 carry over -> 10)
    const to = addCalendarDaysIso(from, 11)
    await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: from,
      toDate: to,
      reason: 'carry-over-fits'
    })
    const row = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: holiday.id },
      orderBy: { id: 'desc' }
    })
    expect(row).toBeTruthy()

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })
})

describe('per-leave-type limit enforcement', () => {
  it('rejects when Sick Leave booking exceeds limit and accepts when it fits', async () => {
    // Tighten Sick Leave limit to 2 for this test
    const sick = sickLeaveType
    expect(sick).toBeTruthy()
    expect(sick.use_allowance).toBe(false)
    const originalLimit = sick.limit
    await prisma.leave_types.update({
      where: { id: sick.id },
      data: { limit: 2 }
    })

    const empEmail = `sick_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Sicky',
      lastname: 'Limit'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const tooLongFrom = nextUtcWeekdayIso(new Date(), 'Monday', 14)
    const tooLongTo = addCalendarDaysIso(tooLongFrom, 2) // 3 working days
    const before = await prisma.leaves.count({
      where: { user_id: empUser.id, leave_type_id: sick.id }
    })
    await bookLeave(emp, {
      leaveTypeId: sick.id,
      fromDate: tooLongFrom,
      toDate: tooLongTo,
      reason: 'over-limit'
    })
    const afterRej = await prisma.leaves.count({
      where: { user_id: empUser.id, leave_type_id: sick.id }
    })
    expect(afterRej).toBe(before)

    // Now book 2 days -> should succeed
    const okFrom = nextUtcWeekdayIso(new Date(), 'Monday', 35)
    const okTo = addCalendarDaysIso(okFrom, 1) // 2 working days
    await bookLeave(emp, {
      leaveTypeId: sick.id,
      fromDate: okFrom,
      toDate: okTo,
      reason: 'within-limit'
    })
    const afterOk = await prisma.leaves.count({
      where: { user_id: empUser.id, leave_type_id: sick.id }
    })
    expect(afterOk).toBe(before + 1)

    await prisma.leave_types.update({
      where: { id: sick.id },
      data: { limit: originalLimit }
    })
  })
})

describe('non-default increments enforcement (server-side)', () => {
  it('rejects hourly when department is restricted to default increments even if leave type opts in', async () => {
    const deptName = `DefaultsOnly ${Date.now()}`
    await createDepartment(adminAgent, {
      name: deptName,
      allowance: '20',
      personal: '0',
      managerId: adminUser.id,
      allowedIncrements: ['full_day', 'half_day']
    })
    const dept = await prisma.departments.findFirst({
      where: { company_id: companyId, name: deptName }
    })

    const ltName = `HourlyAllowed ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
      name: ltName,
      color: '#22DDAA',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: true
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: ltName }
    })

    const empEmail = `hr_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Hr',
      lastname: 'DeptBlock'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const day = addDaysIso(20)
    const before = await prisma.leaves.count({
      where: { user_id: empUser.id }
    })
    await emp
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(lt.id),
        from_date: day,
        to_date: day,
        from_date_part: '1',
        to_date_part: '1',
        time_start: '09:00:00',
        time_end: '11:00:00',
        increment_type: 'hr',
        increment_value: '2',
        reason: 'dept-blocks-hourly'
      })
      .redirects(5)
    const after = await prisma.leaves.count({
      where: { user_id: empUser.id }
    })
    expect(after).toBe(before)
  })

  it('rejects hourly when department allows it but leave type does not opt in', async () => {
    const deptName = `HourlyOk ${Date.now()}`
    await createDepartment(adminAgent, {
      name: deptName,
      allowance: '20',
      personal: '0',
      managerId: adminUser.id,
      allowedIncrements: ['full_day', 'half_day', 'hourly']
    })
    const dept = await prisma.departments.findFirst({
      where: { company_id: companyId, name: deptName }
    })

    const ltName = `NoNonDefault ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
      name: ltName,
      color: '#3344FF',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: ltName }
    })

    const empEmail = `hr2_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Hr',
      lastname: 'LtBlock'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const day = addDaysIso(21)
    const before = await prisma.leaves.count({
      where: { user_id: empUser.id }
    })
    await emp
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(lt.id),
        from_date: day,
        to_date: day,
        from_date_part: '1',
        to_date_part: '1',
        time_start: '09:00:00',
        time_end: '11:00:00',
        increment_type: 'hr',
        increment_value: '2',
        reason: 'lt-blocks-hourly'
      })
      .redirects(5)
    const after = await prisma.leaves.count({
      where: { user_id: empUser.id }
    })
    expect(after).toBe(before)
  })

  it('accepts hourly when both department and leave type allow it', async () => {
    const deptName = `BothOk ${Date.now()}`
    await createDepartment(adminAgent, {
      name: deptName,
      allowance: '20',
      personal: '0',
      managerId: adminUser.id,
      allowedIncrements: ['full_day', 'half_day', 'hourly']
    })
    const dept = await prisma.departments.findFirst({
      where: { company_id: companyId, name: deptName }
    })

    const ltName = `HrFully ${Date.now()}`
    await createLeaveType(adminAgent, prisma, companyId, {
      name: ltName,
      color: '#BB99CC',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: true
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: ltName }
    })

    const empEmail = `hrok_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Ok',
      lastname: 'Hourly'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })

    const day = nextUtcWeekdayIso(new Date(), 'Tuesday', 14)
    await emp
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(lt.id),
        from_date: day,
        to_date: day,
        from_date_part: '1',
        to_date_part: '1',
        time_start: '09:00:00',
        time_end: '11:00:00',
        increment_type: 'hr',
        increment_value: '2',
        reason: 'hourly-success'
      })
      .redirects(5)

    const row = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: lt.id },
      orderBy: { id: 'desc' }
    })
    expect(row).toBeTruthy()
    expect(row.time_start).toBe('09:00:00')
    expect(row.time_end).toBe('11:00:00')
  })
})

describe('approval-time pool re-validation', () => {
  it('hard-rejects approval when allowance is reduced after a leave is pending', async () => {
    const originalDept = await prisma.departments.findUnique({
      where: { id: adminUser.department_id }
    })
    // Allow 5 days, 0 personal, admin is manager of department
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 5, personal: 0, manager_id: adminUser.id }
    })

    const empEmail = `racey_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: adminUser.department_id,
      name: 'Race',
      lastname: 'Cond'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = holidayType

    const from = nextUtcWeekdayIso(new Date(), 'Monday', 14)
    const to = addCalendarDaysIso(from, 2) // 3 working days

    // Booking succeeds (5 - 3 = 2 remaining)
    await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: from,
      toDate: to,
      reason: 'pending-before-cap'
    })
    const pending = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: holiday.id },
      orderBy: { id: 'desc' }
    })
    expect(pending).toBeTruthy()
    expect(pending.status).toBe(leaveConstants.status_new())

    // Admin reduces department allowance to 2, but the leave is for 3 days
    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: { allowance: 2 }
    })

    // Manager (admin) attempts to approve -> hard reject
    await adminAgent
      .post('/requests/approve/')
      .type('form')
      .send({ request: String(pending.id), comment: 'try-approve' })
      .redirects(5)

    const after = await prisma.leaves.findUnique({ where: { id: pending.id } })
    expect(after.status).toBe(leaveConstants.status_new())

    await prisma.departments.update({
      where: { id: adminUser.department_id },
      data: {
        allowance: originalDept.allowance,
        personal: originalDept.personal,
        manager_id: originalDept.manager_id
      }
    })
  })
})
