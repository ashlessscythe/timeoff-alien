import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  bookLeave,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')

describe('leave approval', () => {
  it('manager can approve an employee pending leave', async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })

    const mgrEmail = `mgr_appr_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: admin.department_id,
      manager: true,
      name: 'M',
      lastname: 'Manager'
    })
    const empEmail = `emp_appr_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'E',
      lastname: 'Employee'
    })

    const mgrUser = await prisma.users.findFirst({ where: { email: mgrEmail } })
    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { manager_id: mgrUser.id }
    })

    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: empUser.company_id, name: 'Holiday' }
    })
    await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: '2026-12-10',
      toDate: '2026-12-10',
      reason: 'pending'
    })
    const leave = await prisma.leaves.findFirst({
      where: { user_id: empUser.id },
      orderBy: { id: 'desc' }
    })
    expect(leave.status).toBe(leaveConstants.status_new())

    const { agent: mgr } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const appr = await mgr
      .post('/requests/approve/')
      .type('form')
      .send({ request: String(leave.id), comment: 'ok' })
      .redirects(5)
    expect(appr.status).toBeLessThan(400)

    const after = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(after.status).toBe(leaveConstants.status_approved())
  }, 120000)

  it('manager can approve a pending personal leave at exact personal limit', async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })

    // Make sure the department has exactly 1 personal day available.
    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { personal: 1 }
    })

    const mgrEmail = `mgr_personal_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: admin.department_id,
      manager: true,
      name: 'M',
      lastname: 'Manager'
    })
    const empEmail = `emp_personal_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'E',
      lastname: 'Employee'
    })

    const mgrUser = await prisma.users.findFirst({ where: { email: mgrEmail } })
    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { manager_id: mgrUser.id }
    })

    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const ts = new Date()
    const personal = await prisma.leave_types.create({
      data: {
        name: `Personal-${Date.now()}`,
        color: '#999999',
        company_id: empUser.company_id,
        use_allowance: true,
        use_personal: true,
        created_at: ts,
        updated_at: ts
      }
    })

    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    await bookLeave(emp, {
      leaveTypeId: personal.id,
      fromDate: '2026-12-12',
      toDate: '2026-12-12',
      reason: 'personal pending'
    })
    const leave = await prisma.leaves.findFirst({
      where: { user_id: empUser.id, leave_type_id: personal.id },
      orderBy: { id: 'desc' }
    })
    expect(leave.status).toBe(leaveConstants.status_new())

    const { agent: mgr } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const appr = await mgr
      .post('/requests/approve/')
      .type('form')
      .send({ request: String(leave.id), comment: 'ok' })
      .redirects(5)
    expect(appr.status).toBeLessThan(400)

    const after = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(after.status).toBe(leaveConstants.status_approved())
  }, 120000)

  it('employee cannot approve their own pending leave via requests handler', async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    const empEmail = `emp_self_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'S',
      lastname: 'Self'
    })
    const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const empUser = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: empUser.company_id, name: 'Holiday' }
    })
    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { manager_id: admin.id }
    })
    await bookLeave(emp, {
      leaveTypeId: holiday.id,
      fromDate: '2026-12-11',
      toDate: '2026-12-11',
      reason: 'self approve try'
    })
    const leave = await prisma.leaves.findFirst({
      where: { user_id: empUser.id },
      orderBy: { id: 'desc' }
    })

    await emp
      .post('/requests/approve/')
      .type('form')
      .send({ request: String(leave.id) })
      .redirects(5)

    const after = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(after.status).toBe(leaveConstants.status_new())
  })
})
