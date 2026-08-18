import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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
const { loadSessionUserById } = require('../../lib/model/sessionUser.js')

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** Date-only ISO (UTC), N days from today — avoids payroll "past week" blocks for employees. */
function addDaysIso(n) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({ where: { email } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id
}, 120000)

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
})

async function saveDepartmentLeaveTypes(deptId, leaveTypeIds, otherFields = {}) {
  const body = {
    name: otherFields.name || 'Sales',
    manager_id: String(otherFields.managerId || adminId),
    allowance: '20',
    personal: '5',
    'allowed_increments[]': ['full_day', 'half_day'],
    'allowed_leave_type_ids[]': leaveTypeIds.map(String)
  }
  return adminAgent
    .post(`/settings/departments/edit/${deptId}/`)
    .type('form')
    .send(body)
    .redirects(5)
}

describe('department leave type visibility', () => {
  it('blocks booking disallowed leave types for department members', async () => {
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Holiday' }
    })
    const sick = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Sick Leave' }
    })
    expect(holiday).toBeTruthy()
    expect(sick).toBeTruthy()

    const empEmail = `dept_lt_${uniqueSuffix()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'D',
      lastname: 'Member'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    expect(emp).toBeTruthy()

    const save = await saveDepartmentLeaveTypes(primaryDepartmentId, [holiday.id])
    expect(save.status).toBeLessThan(400)

    const links = await prisma.department_leave_types.findMany({
      where: { department_id: primaryDepartmentId }
    })
    expect(links.map(l => l.leave_type_id).sort()).toEqual([holiday.id])

    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const before = await prisma.leaves.count({ where: { user_id: emp.id } })

    await bookLeave(empAgent, {
      leaveTypeId: sick.id,
      fromDate: addDaysIso(14),
      toDate: addDaysIso(14)
    })

    const after = await prisma.leaves.count({ where: { user_id: emp.id } })
    expect(after).toBe(before)

    await bookLeave(empAgent, {
      leaveTypeId: holiday.id,
      fromDate: addDaysIso(15),
      toDate: addDaysIso(15)
    })
    const afterHoliday = await prisma.leaves.count({ where: { user_id: emp.id } })
    expect(afterHoliday).toBe(before + 1)
  })

  it('allows all leave types when department has no restrictions', async () => {
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Holiday' }
    })
    const sick = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Sick Leave' }
    })

    const allIds = [holiday.id, sick.id]
    await saveDepartmentLeaveTypes(primaryDepartmentId, allIds)

    const links = await prisma.department_leave_types.findMany({
      where: { department_id: primaryDepartmentId }
    })
    expect(links).toHaveLength(0)

    const empEmail = `dept_lt_all_${uniqueSuffix()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'A',
      lastname: 'Ll'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const before = await prisma.leaves.count({ where: { user_id: emp.id } })

    await bookLeave(empAgent, {
      leaveTypeId: sick.id,
      fromDate: addDaysIso(16),
      toDate: addDaysIso(16)
    })

    const after = await prisma.leaves.count({ where: { user_id: emp.id } })
    expect(after).toBe(before + 1)
  })

  it('manager booking for employee respects that employee department restrictions', async () => {
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Holiday' }
    })
    const sick = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: 'Sick Leave' }
    })

    const mgrEmail = `dept_lt_mgr_${uniqueSuffix()}@example.com`
    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: primaryDepartmentId,
      name: 'M',
      lastname: 'Gr',
      manager: true
    })
    const mgr = await prisma.users.findFirst({ where: { email: mgrEmail } })
    expect(mgr).toBeTruthy()

    const empEmail = `dept_lt_sub_${uniqueSuffix()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'S',
      lastname: 'Ub'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    expect(emp).toBeTruthy()

    await prisma.departments.update({
      where: { id: primaryDepartmentId },
      data: { manager_id: mgr.id }
    })

    await saveDepartmentLeaveTypes(primaryDepartmentId, [holiday.id], {
      managerId: mgr.id
    })

    const { agent: mgrAgent } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const supervised = await mgrAgent.get('/calendar/').redirects(5)
    expect(supervised.status).toBe(200)

    const sessionMgr = await loadSessionUserById(prisma, mgr.id)
    const manageable = await sessionMgr.promise_users_I_can_manage()
    const empIndex = manageable.findIndex(u => u.id === emp.id)
    expect(empIndex).toBeGreaterThanOrEqual(0)

    const before = await prisma.leaves.count({ where: { user_id: emp.id } })

    await bookLeave(mgrAgent, {
      leaveTypeId: sick.id,
      fromDate: addDaysIso(17),
      toDate: addDaysIso(17),
      user: String(empIndex)
    })

    const afterBlocked = await prisma.leaves.count({ where: { user_id: emp.id } })
    expect(afterBlocked).toBe(before)

    await bookLeave(mgrAgent, {
      leaveTypeId: holiday.id,
      fromDate: addDaysIso(18),
      toDate: addDaysIso(18),
      user: String(empIndex)
    })
    const afterAllowed = await prisma.leaves.count({ where: { user_id: emp.id } })
    expect(afterAllowed).toBe(before + 1)
  })
})
