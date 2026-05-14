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
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')
const moment = require('moment')

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

function parseUsersCsvRow(csvText, email) {
  const lines = csvText.trim().split('\n')
  const header = lines[0].split(',').map(s => s.replace(/^"|"$/g, ''))
  const idx = Object.fromEntries(header.map((k, i) => [k, i]))
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map(s => s.replace(/^"|"$/g, ''))
    if ((cols[idx.email] || '').toLowerCase() === email.toLowerCase()) {
      return {
        remaining_allowance: Number(cols[idx.remaining_allowance]),
        remaining_personal: Number(cols[idx.remaining_personal]),
        remaining_vacation: Number(cols[idx.remaining_vacation]),
        days_used: Number(cols[idx.days_used])
      }
    }
  }
  throw new Error(`CSV row not found for ${email}`)
}

function parseCalendarBigNumber(html, marker) {
  const re = new RegExp(
    `<span[^>]*${marker}[^>]*>\\s*([\\s\\S]*?)\\s*<\\/span>`,
    'i'
  )
  const m = html.match(re)
  if (!m) throw new Error(`Could not find calendar marker ${marker}`)
  const chunk = m[1]
  const dm = chunk.match(/(-)?\s*(\d+)d/i)
  if (!dm) throw new Error(`Could not parse days from ${marker} chunk`)
  const sign = dm[1] ? -1 : 1
  const days = Number(dm[2])
  const hm = chunk.match(/(\d+)h/i)
  const hours = hm ? Number(hm[1]) : 0
  return sign * (days + hours / 8)
}

function parseAbsencesUsedRemaining(html) {
  const usedMatch = html.match(/([0-9]+(?:\.[0-9]+)?)\s+days\s+used\s+so\s+far/i)
  const remMatch = html.match(/([0-9]+(?:\.[0-9]+)?)\s+days\s+remaining/i)
  if (!usedMatch || !remMatch) {
    throw new Error('Could not parse used/remaining from absences page HTML')
  }
  return { used: Number(usedMatch[1]), remaining: Number(remMatch[1]) }
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
  it('calendar, users list (csv), and user absences agree on used/available', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { allowance: 10, personal: 2, manager_id: admin.id }
    })

    await prisma.schedules.create({
      data: {
        company_id: admin.company_id,
        user_id: null,
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
    })
    await prisma.schedules.create({
      data: {
        company_id: admin.company_id,
        user_id: admin.id,
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
    })

    const personalName = `Personal ${Date.now()}`
    await createLeaveType(adminAgent, prisma, admin.company_id, {
      name: personalName,
      color: '#AABBCC',
      limit: 0,
      use_allowance: true,
      use_personal: true,
      auto_approve: true,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: false
    })

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })
    const personal = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: personalName }
    })
    expect(holiday).toBeTruthy()
    expect(personal).toBeTruthy()

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

    const usersCsv = await adminAgent.get('/users/?as-csv=1').redirects(0)
    expect(usersCsv.status).toBe(200)
    expect(String(usersCsv.headers['content-type'] || '')).toMatch(/text\/csv/i)
    const csv = parseUsersCsvRow(usersCsv.text, adminEmail)

    const cal = await adminAgent.get('/calendar/?year=2026').redirects(5)
    expect(cal.status).toBe(200)
    const calVacation = parseCalendarBigNumber(cal.text, 'data-tom-days-available-in-allowance')
    const personalSpanRe = new RegExp(
      'data-tom-days-available-in-allowance[\\s\\S]*?<\\/span>' +
        '\\s*<span class="slash"[\\s\\S]*?<\\/span>' +
        '\\s*<span class="big-number[^"]*"[^>]*>\\s*([\\s\\S]*?)\\s*<\\/span>',
      'i'
    )
    const personalSpan = cal.text.match(personalSpanRe)
    if (!personalSpan) throw new Error('Could not locate personal big-number span')
    const personalChunk = personalSpan[1]
    const pd = personalChunk.match(/(-)?\s*(\d+)d/i)
    if (!pd) throw new Error('Could not parse personal days from calendar')
    const personalDays = (pd[1] ? -1 : 1) * Number(pd[2])

    const abs = await adminAgent
      .get(`/users/edit/${admin.id}/absences/?year=2026`)
      .redirects(5)
    expect(abs.status).toBe(200)
    const { used, remaining } = parseAbsencesUsedRemaining(abs.text)

    expect(csv.days_used).toBe(3)
    expect(csv.remaining_allowance).toBe(7)
    expect(csv.remaining_personal).toBe(1)
    expect(csv.remaining_vacation).toBe(6)

    expect(used).toBe(3)
    expect(remaining).toBe(7)

    expect(calVacation).toBe(6)
    expect(personalDays).toBe(1)
  }, 120000)

  it('calendar big numbers deduct pending requests (employee view)', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { allowance: 10, personal: 2, manager_id: admin.id }
    })

    const empEmail = `emp_pending_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'E',
      lastname: 'Pending'
    })

    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    expect(empUser).toBeTruthy()

    await prisma.schedules.create({
      data: {
        company_id: admin.company_id,
        user_id: null,
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
    })
    await prisma.schedules.create({
      data: {
        company_id: admin.company_id,
        user_id: empUser.id,
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
    })

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
    expect(personal).toBeTruthy()

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
    expect(leave).toBeTruthy()
    expect(leave.status).toBe(leaveConstants.status_new())

    const cal = await empAgent.get('/calendar/?year=2026').redirects(5)
    expect(cal.status).toBe(200)

    const calVacation = parseCalendarBigNumber(cal.text, 'data-tom-days-available-in-allowance')
    expect(calVacation).toBe(8)

    const personalSpanRe = new RegExp(
      'data-tom-days-available-in-allowance[\\s\\S]*?<\\/span>' +
        '\\s*<span class="slash"[\\s\\S]*?<\\/span>' +
        '\\s*<span class="big-number[^"]*"[^>]*>\\s*([\\s\\S]*?)\\s*<\\/span>',
      'i'
    )
    const personalSpan = cal.text.match(personalSpanRe)
    if (!personalSpan) throw new Error('Could not locate personal big-number span')
    const personalChunk = personalSpan[1]
    const pd = personalChunk.match(/(-)?\s*(\d+)d/i)
    if (!pd) throw new Error('Could not parse personal days from calendar')
    const personalDays = (pd[1] ? -1 : 1) * Number(pd[2])
    expect(personalDays).toBe(1)

    const usersCsv = await adminAgent.get('/users/?as-csv=1').redirects(0)
    expect(usersCsv.status).toBe(200)
    const csv = parseUsersCsvRow(usersCsv.text, empEmail)
    expect(csv.days_used).toBe(0)
  }, 120000)
})
