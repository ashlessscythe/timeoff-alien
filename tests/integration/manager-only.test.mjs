import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  loginAsNewAgent,
  createLeaveType,
  bookLeave,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('manager_only leave type enforcement', () => {
  it('blocks non-manager employees from booking manager_only leave types', async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })

    const empEmail = `emp_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'E',
      lastname: 'Mp'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    expect(emp).toBeTruthy()

    const ltName = `MgrOnly ${Date.now()}`
    await createLeaveType(adminAgent, prisma, admin.company_id, {
      name: ltName,
      color: '#3344FF',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: true,
      manager_only: true,
      is_special: false,
      allow_non_default_increments: false
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: ltName }
    })
    expect(lt).toBeTruthy()

    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const before = await prisma.leaves.count({ where: { user_id: emp.id } })
    await bookLeave(empAgent, {
      leaveTypeId: lt.id,
      fromDate: '2026-09-10',
      toDate: '2026-09-10',
      reason: 'should-block'
    })
    const after = await prisma.leaves.count({ where: { user_id: emp.id } })
    expect(after).toBe(before)
  })

  it('allows managers to book manager_only leave types', async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })

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

    const ltName = `MgrOnly ${Date.now()}`
    await createLeaveType(adminAgent, prisma, admin.company_id, {
      name: ltName,
      color: '#3344FF',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: true,
      manager_only: true,
      is_special: false,
      allow_non_default_increments: false
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: ltName }
    })
    expect(lt).toBeTruthy()

    const { agent: mgrAgent } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const before = await prisma.leaves.count({ where: { user_id: mgr.id } })
    await bookLeave(mgrAgent, {
      leaveTypeId: lt.id,
      fromDate: '2026-09-11',
      toDate: '2026-09-11',
      reason: 'should-allow'
    })
    const after = await prisma.leaves.count({ where: { user_id: mgr.id } })
    expect(after).toBe(before + 1)
  })
})

