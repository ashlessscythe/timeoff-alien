import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  loginAsNewAgent,
  bookLeave,
  createDepartment,
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

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
})

describe('delegation booking authorization', () => {
  it('employee cannot book leave for another employee (forged user index falls back to self)', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    const emp1Email = `emp1_${Date.now()}@example.com`
    const emp2Email = `emp2_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: emp1Email,
      departmentId: admin.department_id,
      name: 'E1',
      lastname: 'One'
    })
    await addEmployee(adminAgent, {
      email: emp2Email,
      departmentId: admin.department_id,
      name: 'E2',
      lastname: 'Two'
    })

    const emp1 = await prisma.users.findFirst({ where: { email: emp1Email } })
    const emp2 = await prisma.users.findFirst({ where: { email: emp2Email } })
    expect(emp1).toBeTruthy()
    expect(emp2).toBeTruthy()

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })

    const { agent } = await loginAsNewAgent(app, emp1Email, TEST_PASSWORD)
    const beforeEmp2 = await prisma.leaves.count({ where: { user_id: emp2.id } })

    await bookLeave(agent, {
      leaveTypeId: holiday.id,
      fromDate: '2026-09-01',
      toDate: '2026-09-01',
      reason: 'forge-user-index',
      user: 9999
    })

    const afterEmp2 = await prisma.leaves.count({ where: { user_id: emp2.id } })
    expect(afterEmp2).toBe(beforeEmp2)

    const last = await prisma.leaves.findFirst({
      where: { user_id: emp1.id },
      orderBy: { id: 'desc' }
    })
    expect(last).toBeTruthy()
  })

  it('manager cannot book leave for users outside supervised departments', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    const dept2Name = `Dept2 ${Date.now()}`
    await createDepartment(adminAgent, {
      name: dept2Name,
      allowance: '20',
      personal: '0',
      managerId: admin.id,
      allowedIncrements: ['full_day', 'half_day']
    })
    const dept2 = await prisma.departments.findFirst({
      where: { company_id: admin.company_id, name: dept2Name }
    })
    expect(dept2).toBeTruthy()

    const mgrEmail = `mgr_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: admin.department_id,
      manager: true,
      name: 'M',
      lastname: 'Gr'
    })
    const mgr = await prisma.users.findFirst({ where: { email: mgrEmail } })
    expect(mgr).toBeTruthy()

    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { manager_id: mgr.id }
    })

    const outsiderEmail = `outs_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: outsiderEmail,
      departmentId: dept2.id,
      name: 'Out',
      lastname: 'Side'
    })
    const outsider = await prisma.users.findFirst({ where: { email: outsiderEmail } })
    expect(outsider).toBeTruthy()

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })

    const { agent: mgrAgent } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const beforeOutsider = await prisma.leaves.count({
      where: { user_id: outsider.id }
    })

    await bookLeave(mgrAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2026-09-02',
      toDate: '2026-09-02',
      reason: 'mgr-forge-outsider',
      user: 9999
    })

    const afterOutsider = await prisma.leaves.count({
      where: { user_id: outsider.id }
    })
    expect(afterOutsider).toBe(beforeOutsider)

    const lastMgrLeave = await prisma.leaves.findFirst({
      where: { user_id: mgr.id },
      orderBy: { id: 'desc' }
    })
    expect(lastMgrLeave).toBeTruthy()
  })

  it('manager can book leave for a supervised employee using the managed-users index', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    const mgrEmail = `mgr_pos_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: admin.department_id,
      manager: true,
      name: 'Morgan',
      lastname: 'Manager'
    })
    const mgr = await prisma.users.findFirst({ where: { email: mgrEmail } })
    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { manager_id: mgr.id }
    })

    const empEmail = `emp_pos_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'Erin',
      lastname: 'Employee'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })

    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: 'Holiday' }
    })

    const { agent: mgrAgent } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const mgrSession = await loadSessionUserById(prisma, mgr.id)
    await mgrSession.reload_with_session_details()
    const managed = await mgrSession.promise_users_I_can_manage()
    const idx = managed.findIndex(u => u.id === emp.id)
    expect(idx).toBeGreaterThanOrEqual(0)

    const before = await prisma.leaves.count({ where: { user_id: emp.id } })
    await bookLeave(mgrAgent, {
      leaveTypeId: holiday.id,
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
      reason: 'mgr-books-emp',
      user: idx
    })
    expect(await prisma.leaves.count({ where: { user_id: emp.id } })).toBe(before + 1)
    const row = await prisma.leaves.findFirst({
      where: { user_id: emp.id, leave_type_id: holiday.id },
      orderBy: { id: 'desc' }
    })
    expect(row).toBeTruthy()
    expect(row.user_id).toBe(emp.id)
  })
})
