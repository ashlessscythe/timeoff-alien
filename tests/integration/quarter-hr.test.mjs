import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  createDepartment,
  addEmployee,
  loginAsNewAgent,
  createLeaveType,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const { loadSessionUserById } = require('../../lib/model/sessionUser.js')
const UserAllowance = require('../../lib/model/user_allowance.js')
const moment = require('moment')

describe('quarter-hour booking', () => {
  it('accepts 15-minute booking when dept + leave type allow it and deducts fractional allowance', async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })

    // Department that allows quarter-hour increments
    const deptName = `QuarterHr ${Date.now()}`
    await createDepartment(adminAgent, {
      name: deptName,
      allowance: '20',
      personal: '0',
      managerId: admin.id,
      allowedIncrements: ['full_day', 'half_day', 'quarter_hr']
    })
    const dept = await prisma.departments.findFirst({
      where: { company_id: admin.company_id, name: deptName }
    })
    expect(dept).toBeTruthy()

    const empEmail = `qemp_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Q',
      lastname: 'Emp'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    expect(emp).toBeTruthy()

    // Leave type that opts into non-default increments
    const ltName = `QuarterLt ${Date.now()}`
    await createLeaveType(adminAgent, prisma, admin.company_id, {
      name: ltName,
      color: '#22DDAA',
      limit: 0,
      use_allowance: true,
      use_personal: false,
      auto_approve: true,
      manager_only: false,
      is_special: false,
      allow_non_default_increments: true
    })
    const lt = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: ltName }
    })
    expect(lt).toBeTruthy()

    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const day = '2026-08-20'
    await agent
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(lt.id),
        from_date: day,
        to_date: day,
        from_date_part: '1',
        to_date_part: '1',
        time_start: '09:00:00',
        time_end: '09:15:00',
        increment_type: 'min',
        increment_value: '15',
        reason: 'quarter-hr'
      })
      .redirects(5)

    const fresh = await loadSessionUserById(prisma, emp.id)
    await fresh.reload_with_session_details()
    const year = moment.utc('2026', 'YYYY')
    await fresh.reload_with_leave_details({ year })

    const allowance = await UserAllowance.promise_allowance({
      user: fresh,
      year
    })

    // 15 minutes out of 8 working hours = 0.25/8 = 0.03125 days
    expect(allowance.number_of_days_taken_from_allowance).toBeGreaterThan(0)
    expect(allowance.number_of_days_taken_from_allowance).toBeCloseTo(0.03125, 4)
  })
})

