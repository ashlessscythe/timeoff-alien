import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  createLeaveType,
  bookLeave,
  addEmployee,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import {
  assertBalanceInvariants,
  collectBalanceSnapshots,
  parseAbsencesBreakdownTaken,
  parseFormattedDays,
  parseUsersCsvRow
} from '../support/balanceSurfaces.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')
const moment = require('moment')

const TEST_YEAR = '2026'
const POOL = 10
const PERSONAL_POOL = 2

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId
let adminEmail
/** @type {number[]} */
let baselineLeaveTypeIds
let holidayTypeId
let baselineHolidayAutoApprove

async function setupDepartmentAllowance(departmentId, managerId) {
  await prisma.departments.update({
    where: { id: departmentId },
    data: {
      allowance: POOL,
      personal: PERSONAL_POOL,
      manager_id: managerId
    }
  })
}

async function setupWorkWeekSchedule(companyId, userId) {
  const scheduleRow = {
    monday: 1,
    tuesday: 1,
    wednesday: 1,
    thursday: 1,
    friday: 1,
    saturday: 2,
    sunday: 2,
    created_at: moment.utc().toDate(),
    updated_at: moment.utc().toDate()
  }
  await prisma.schedules.create({
    data: { company_id: companyId, user_id: null, ...scheduleRow }
  })
  await prisma.schedules.create({
    data: { company_id: companyId, user_id: userId, ...scheduleRow }
  })
}

async function ensurePersonalLeaveType(name) {
  await createLeaveType(adminAgent, prisma, companyId, {
    name,
    color: '#AABBCC',
    limit: 0,
    use_allowance: true,
    use_personal: true,
    auto_approve: true,
    manager_only: false,
    is_special: false,
    allow_non_default_increments: false
  })
  return prisma.leave_types.findFirst({
    where: { company_id: companyId, name }
  })
}

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(adminAgent)
  adminEmail = email
  const admin = await prisma.users.findFirst({ where: { email } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id
  baselineLeaveTypeIds = (
    await prisma.leave_types.findMany({
      where: { company_id: companyId },
      select: { id: true }
    })
  ).map(r => r.id)
  const holiday = await prisma.leave_types.findFirst({
    where: { company_id: companyId, name: 'Holiday' }
  })
  expect(holiday).toBeTruthy()
  holidayTypeId = holiday.id
  baselineHolidayAutoApprove = holiday.auto_approve
}, 120000)

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
  if (baselineLeaveTypeIds?.length) {
    await prisma.leave_types.deleteMany({
      where: {
        company_id: companyId,
        id: { notIn: baselineLeaveTypeIds }
      }
    })
  }
  await prisma.leave_types.update({
    where: { id: holidayTypeId },
    data: { auto_approve: baselineHolidayAutoApprove }
  })
})

describe('balance consistency across app surfaces', () => {
  it('approved leave: calendar, users list, CSV, absences, edit-calendar, and summary agree', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })
    await setupDepartmentAllowance(admin.department_id, admin.id)
    await setupWorkWeekSchedule(admin.company_id, admin.id)

    const personalName = `Personal ${Date.now()}`
    const personal = await ensurePersonalLeaveType(personalName)
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })
    await prisma.leave_types.update({
      where: { id: holiday.id },
      data: { auto_approve: true }
    })

    await bookLeave(adminAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2026-08-10',
      toDate: '2026-08-11',
      reason: 'vac2'
    })
    await bookLeave(adminAgent, {
      leaveTypeId: personal.id,
      fromDate: '2026-08-12',
      toDate: '2026-08-12',
      reason: 'per1'
    })

    const snap = await collectBalanceSnapshots(adminAgent, {
      userId: admin.id,
      email: adminEmail,
      year: TEST_YEAR
    })

    expect(snap.days_used_csv).toBe(3)
    expect(snap.days_used_with_pending).toBe(3)
    expect(snap.remaining_allowance).toBe(7)
    expect(snap.remaining_personal).toBe(1)
    expect(snap.remaining_vacation).toBe(6)
    expect(snap.calendar_vacation).toBe(6)
    expect(snap.calendar_personal).toBe(1)
    expect(snap.absences.used).toBe(3)
    expect(snap.absences.remaining).toBe(7)
    expect(snap.absences.available).toBe(7)
    expect(snap.absences.total).toBe(POOL)
    expect(snap.summary).toEqual({ regular: 6, personal: 1, total: POOL })

    assertBalanceInvariants(snap, { poolTotal: POOL })
  }, 120000)

  it('pending leave: remaining deducts pending everywhere; days_used excludes pending on list/CSV only', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })
    await setupDepartmentAllowance(admin.department_id, admin.id)

    const empEmail = `emp_pending_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'E',
      lastname: 'Pending'
    })
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    expect(empUser).toBeTruthy()
    await setupWorkWeekSchedule(admin.company_id, empUser.id)

    const personalName = `Personal Pending ${Date.now()}`
    await createLeaveType(adminAgent, prisma, admin.company_id, {
      name: personalName,
      color: '#AABBCC',
      limit: 0,
      use_allowance: true,
      use_personal: true,
      auto_approve: false,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })
    const personal = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: personalName }
    })

    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    await bookLeave(empAgent, {
      leaveTypeId: personal.id,
      fromDate: '2026-08-13',
      toDate: '2026-08-13',
      reason: 'pending personal'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: personal.id },
      orderBy: { id: 'desc' }
    })
    expect(leave.status).toBe(leaveConstants.status_new())

    const snap = await collectBalanceSnapshots(adminAgent, {
      userId: empUser.id,
      email: empEmail,
      year: TEST_YEAR,
      selfCalendarAgent: empAgent
    })

    expect(snap.days_used_csv).toBe(0)
    expect(snap.days_used_with_pending).toBe(1)
    expect(snap.remaining_allowance).toBe(9)
    expect(snap.remaining_personal).toBe(1)
    expect(snap.remaining_vacation).toBe(8)
    expect(snap.calendar_vacation).toBe(8)
    expect(snap.calendar_personal).toBe(1)
    expect(snap.absences.used).toBe(1)
    expect(snap.absences.remaining).toBe(9)
    expect(snap.summary).toEqual({ regular: 8, personal: 1, total: POOL })

    assertBalanceInvariants(snap, { poolTotal: POOL, allowPendingSplit: true })
    expect(snap.users_list.days_used).toBe(0)
    expect(snap.users_list.remaining).toBe(9)
  }, 120000)

  it('manual adjustment and carry-over appear consistently in CSV and absences breakdown', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })
    await setupDepartmentAllowance(admin.department_id, admin.id)
    await setupWorkWeekSchedule(admin.company_id, admin.id)

    await prisma.user_allowance_adjustment.upsert({
      where: {
        user_id_year: { user_id: admin.id, year: Number(TEST_YEAR) }
      },
      create: {
        user_id: admin.id,
        year: Number(TEST_YEAR),
        adjustment: 2,
        personal_adjustment: 1,
        carried_over_allowance: 3,
        created_at: new Date()
      },
      update: {
        adjustment: 2,
        personal_adjustment: 1,
        carried_over_allowance: 3
      }
    })

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Holiday' }
    })
    await prisma.leave_types.update({
      where: { id: holiday.id },
      data: { auto_approve: true }
    })
    await bookLeave(adminAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2026-09-01',
      toDate: '2026-09-01',
      reason: 'adj test'
    })

    const csvRes = await adminAgent.get('/users/?as-csv=1').redirects(0)
    const csv = parseUsersCsvRow(csvRes.text, adminEmail)
    expect(csv.nominal_allowance).toBe(POOL)
    expect(csv.manual_adjustment).toBe(2)
    expect(csv.personal_adjustment).toBe(1)
    expect(csv.carried_over_allowance).toBe(3)

    const abs = await adminAgent
      .get(`/users/edit/${admin.id}/absences/?year=${TEST_YEAR}`)
      .redirects(5)
    expect(abs.status).toBe(200)

    const nominalAllowance = abs.text.match(
      /id=['"]nominalAllowancePart['"][^>]*>([^<]+)/i
    )
    const nominalPersonal = abs.text.match(
      /id=['"]nominalPersonalPart['"][^>]*>([^<]+)/i
    )
    const carriedOver = abs.text.match(
      /id=['"]allowanceCarriedOverPart['"][^>]*>([^<]+)/i
    )
    expect(parseFormattedDays(nominalAllowance[1])).toBe(12)
    expect(parseFormattedDays(nominalPersonal[1])).toBe(3)
    expect(parseFormattedDays(carriedOver[1])).toBe(3)

    const taken = parseAbsencesBreakdownTaken(abs.text)
    expect(taken).toBe(1)

    const poolTotal = POOL + 2 + 3
    expect(csv.remaining_allowance).toBe(poolTotal - 1)
    expect(csv.days_used).toBe(1)
  }, 120000)
})
