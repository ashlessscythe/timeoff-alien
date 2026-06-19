import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import moment from 'moment'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  loginAsNewAgent,
  bookLeave,
  TEST_PASSWORD
} from '../support/http.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId
/** @type {Date | null} */
let baselineNextYearCutoff
/** @type {string | null} */
let baselineLimitedDepartments

/** Cutoff must stay in the future for "before cutoff" booking to be blocked. */
function futureNextYearCutoffDate() {
  return moment.utc().add(90, 'days').startOf('day').toDate()
}

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id
  const c = await prisma.companies.findUnique({ where: { id: companyId } })
  baselineNextYearCutoff = c.next_year_cutoff_date
  baselineLimitedDepartments = c.limited_departments
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
  await prisma.companies.update({
    where: { id: companyId },
    data: {
      next_year_cutoff_date: baselineNextYearCutoff,
      limited_departments: baselineLimitedDepartments
    }
  })
})

describe('next year PTO cutoff + limited_departments', () => {
  it('blocks non-admin in a limited department before cutoff; allows after widening limited list', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    await prisma.companies.update({
      where: { id: admin.company_id },
      data: {
        next_year_cutoff_date: futureNextYearCutoffDate(),
        limited_departments: JSON.stringify([admin.department_id])
      }
    })

    const empEmail = `ny_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'N',
      lastname: 'Year'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })

    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const before = await prisma.leaves.count({ where: { user_id: emp.id } })

    await bookLeave(empAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2027-01-10',
      toDate: '2027-01-10',
      reason: 'next-year-blocked'
    })
    expect(await prisma.leaves.count({ where: { user_id: emp.id } })).toBe(before)

    await prisma.companies.update({
      where: { id: admin.company_id },
      data: { limited_departments: JSON.stringify([]) }
    })

    await bookLeave(empAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2027-01-11',
      toDate: '2027-01-11',
      reason: 'next-year-ok'
    })
    expect(await prisma.leaves.count({ where: { user_id: emp.id } })).toBe(before + 1)
  })

  it('allows admin to book next-year leave even when department is limited before cutoff', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    await prisma.companies.update({
      where: { id: admin.company_id },
      data: {
        next_year_cutoff_date: futureNextYearCutoffDate(),
        limited_departments: JSON.stringify([admin.department_id])
      }
    })

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })
    const before = await prisma.leaves.count({ where: { user_id: admin.id } })

    await bookLeave(adminAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2027-02-01',
      toDate: '2027-02-01',
      reason: 'admin-next-year'
    })
    expect(await prisma.leaves.count({ where: { user_id: admin.id } })).toBe(before + 1)
  })
})
