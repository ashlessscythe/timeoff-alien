import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  bookLeave,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')

function day(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId
/** @type {number[]} */
let baselineLeaveTypeIds

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
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
})

/** Pending holiday leave for an employee; department manager is mgr agent. */
async function setupManagerEmployeePendingLeave() {
  const admin = await prisma.users.findUnique({ where: { id: adminId } })
  const sfx = uniqueSuffix()

  const mgrEmail = `mgr_appr_${sfx}@example.com`
  await addEmployee(adminAgent, {
    email: mgrEmail,
    departmentId: admin.department_id,
    manager: true,
    name: 'M',
    lastname: 'Manager'
  })
  const empEmail = `emp_appr_${sfx}@example.com`
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
  const { agent: mgr } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
  return { mgr, leave }
}

describe('leave approval', () => {
  it('manager can approve an employee pending leave', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

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
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

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
    const admin = await prisma.users.findUnique({ where: { id: adminId } })
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

  it('manager cannot approve a leave if employee would exceed allowance including other pending requests', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })

    await prisma.departments.update({
      where: { id: admin.department_id },
      data: { allowance: 1, personal: 0 }
    })

    const mgrEmail = `mgr_over_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: admin.department_id,
      manager: true,
      name: 'M',
      lastname: 'Manager'
    })
    const empEmail = `emp_over_${Date.now()}@example.com`
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
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: empUser.company_id, name: 'Holiday' }
    })
    expect(holiday).toBeTruthy()

    const ts = new Date()
    const leave1 = await prisma.leaves.create({
      data: {
        user_id: empUser.id,
        leave_type_id: holiday.id,
        approver_id: mgrUser.id,
        status: leaveConstants.status_new(),
        employee_comment: 'pending-1',
        date_start: day('2026-12-21'),
        date_end: day('2026-12-21'),
        day_part_start: 1,
        day_part_end: 1,
        time_start: null,
        time_end: null,
        created_at: ts,
        updated_at: ts
      }
    })
    const leave2 = await prisma.leaves.create({
      data: {
        user_id: empUser.id,
        leave_type_id: holiday.id,
        approver_id: mgrUser.id,
        status: leaveConstants.status_new(),
        employee_comment: 'pending-2',
        date_start: day('2026-12-22'),
        date_end: day('2026-12-22'),
        day_part_start: 1,
        day_part_end: 1,
        time_start: null,
        time_end: null,
        created_at: ts,
        updated_at: ts
      }
    })

    const { agent: mgr } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
    const res = await mgr
      .post('/requests/approve/')
      .type('form')
      .send({ request: String(leave1.id), comment: 'try approve' })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const after1 = await prisma.leaves.findUnique({ where: { id: leave1.id } })
    const after2 = await prisma.leaves.findUnique({ where: { id: leave2.id } })
    expect(after1.status).toBe(leaveConstants.status_new())
    expect(after2.status).toBe(leaveConstants.status_new())
  }, 120000)

  it.each([
    ['/requests/', 'requests list'],
    ['/calendar/teamview/', 'team calendar'],
    ['/calendar/', 'employee calendar']
  ])(
    'manager approves pending leave with same handler (Referer: %s — %s)',
    async (referer, _surfaceLabel) => {
      const { mgr, leave } = await setupManagerEmployeePendingLeave()
      expect(leave.status).toBe(leaveConstants.status_new())

      const appr = await mgr
        .post('/requests/approve/')
        .set('Referer', referer)
        .type('form')
        .send({ request: String(leave.id), comment: 'ok' })
        .redirects(5)
      expect(appr.status).toBeLessThan(400)

      const after = await prisma.leaves.findUnique({ where: { id: leave.id } })
      expect(after.status).toBe(leaveConstants.status_approved())
    },
    120000
  )

  it('employee calendar page includes approval modals used by leave-summary popover', async () => {
    const cal = await adminAgent.get('/calendar/').redirects(5)
    expect(cal.status).toBe(200)
    expect(cal.text).toContain('id="approveModal"')
    expect(cal.text).toContain('id="rejectModal"')
    expect(cal.text).toContain('action="/requests/approve/"')
    expect(cal.text).toContain('action="/requests/reject/"')
  }, 120000)
})
