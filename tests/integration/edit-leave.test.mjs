import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  addEmployee,
  bookLeave,
  createAgent,
  createDepartment,
  editLeave,
  loginAsNewAgent,
  registerCompanyAndAdmin,
  TEST_PASSWORD
} from '../support/http.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId
let holidayTypeId
let sickLeaveTypeId

function addDaysIso(n) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function addCalendarDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function nextUtcWeekdayIso(dayName, minAheadDays = 14) {
  const UTC_DOW = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
  }
  const target = UTC_DOW[dayName]
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + minAheadDays)
  for (let i = 0; i < 21; i++) {
    if (d.getUTCDay() === target) return d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  throw new Error(`nextUtcWeekdayIso: no ${dayName}`)
}

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({ where: { email } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id

  const holiday = await prisma.leave_types.findFirst({
    where: { company_id: companyId, name: 'Holiday' }
  })
  const sick = await prisma.leave_types.findFirst({
    where: { company_id: companyId, name: 'Sick Leave' }
  })
  holidayTypeId = holiday.id
  sickLeaveTypeId = sick.id

  await prisma.departments.update({
    where: { id: primaryDepartmentId },
    data: { allowance: 10, personal: 2, manager_id: adminId }
  })
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
  await prisma.departments.update({
    where: { id: primaryDepartmentId },
    data: { allowance: 10, personal: 2, manager_id: adminId }
  })
})

describe('edit pending leave', () => {
  it('requester can edit own pending leave and sets edited_at', async () => {
    const empEmail = `edit_emp_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Edit',
      lastname: 'Me'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(14)
    const toDate = addDaysIso(16)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate,
      reason: 'original'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })
    expect(leave.status).toBe(leaveConstants.status_new())
    const createdAt = leave.created_at

    const newFrom = addDaysIso(15)
    const newTo = addDaysIso(15)
    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: newFrom,
      toDate: newTo,
      reason: 'updated'
    })
    expect(res.status).toBeLessThan(400)

    const updated = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(updated.status).toBe(leaveConstants.status_new())
    expect(updated.created_at.getTime()).toBe(createdAt.getTime())
    expect(updated.edited_at).toBeTruthy()
    expect(momentUtc(updated.date_start)).toBe(newFrom)
    expect(momentUtc(updated.date_end)).toBe(newTo)
    expect(updated.employee_comment).toBe('updated')
  })

  it('admin can edit another employee pending leave', async () => {
    const empEmail = `edit_admin_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'AdminEdit',
      lastname: 'Target'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(10)
    const toDate = addDaysIso(12)
    await bookLeave(empAgent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const res = await editLeave(adminAgent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: addDaysIso(11),
      toDate,
      reason: 'admin edit'
    })
    expect(res.status).toBeLessThan(400)

    const updated = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(updated.edited_at).toBeTruthy()
    expect(momentUtc(updated.date_start)).toBe(addDaysIso(11))
    expect(momentUtc(updated.date_end)).toBe(toDate)
  })

  it('manager cannot edit report pending leave', async () => {
    const mgrEmail = `edit_mgr_${Date.now()}@example.com`
    const empEmail = `edit_report_${Date.now()}@example.com`

    const deptName = `EditDept ${Date.now()}`
    const deptRes = await createDepartment(adminAgent, {
      name: deptName,
      allowance: '10',
      managerId: adminId
    })
    expect(deptRes.status).toBeLessThan(400)
    const dept = await prisma.departments.findFirst({
      where: { company_id: companyId, name: deptName }
    })

    await addEmployee(adminAgent, {
      email: mgrEmail,
      departmentId: dept.id,
      name: 'Mgr',
      lastname: 'Boss',
      manager: true
    })
    const mgr = await prisma.users.findFirst({ where: { email: mgrEmail } })
    await prisma.departments.update({
      where: { id: dept.id },
      data: { manager_id: mgr.id }
    })

    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: dept.id,
      name: 'Rep',
      lastname: 'Port'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent: empAgent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)
    const { agent: mgrAgent } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(15)
    await bookLeave(empAgent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: fromDate
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const res = await editLeave(mgrAgent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: addDaysIso(16),
      toDate: addDaysIso(16)
    })
    expect(res.status).toBeLessThan(500)

    const unchanged = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(unchanged.edited_at).toBeNull()
    expect(momentUtc(unchanged.date_start)).toBe(fromDate)
  })

  it('rejects edit when change would exceed allowance', async () => {
    const empEmail = `edit_balance_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Bal',
      lastname: 'Ance'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    await prisma.departments.update({
      where: { id: primaryDepartmentId },
      data: { allowance: 2, personal: 0, manager_id: adminId }
    })

    const fromDate = addDaysIso(30)
    const toDate = addDaysIso(31)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate,
      reason: 'two day pending'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: addDaysIso(40),
      reason: 'too many days'
    })
    expect(res.status).toBeLessThan(500)
    expect(res.text).toMatch(/only shorten/i)

    const unchanged = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(unchanged.edited_at).toBeNull()
    expect(momentUtc(unchanged.date_end)).toBe(toDate)
  })

  it('rejects extending a pending request when remaining balance is already 0', async () => {
    const empEmail = `edit_zero_bal_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Zero',
      lastname: 'Bal'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    await prisma.departments.update({
      where: { id: primaryDepartmentId },
      data: { allowance: 1, personal: 0, manager_id: adminId }
    })

    const monday = nextUtcWeekdayIso('Monday', 14)
    const tuesday = addCalendarDaysIso(monday, 1)

    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate: monday,
      toDate: monday,
      reason: 'last remaining day'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })
    expect(leave).toBeTruthy()

    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: monday,
      toDate: tuesday,
      reason: 'grow by one'
    })
    expect(res.status).toBeLessThan(500)
    expect(res.text).toMatch(/only shorten/i)

    const unchanged = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(unchanged.edited_at).toBeNull()
    expect(momentUtc(unchanged.date_end)).toBe(monday)
  })

  it('rejects extending the end date beyond the original span', async () => {
    const empEmail = `edit_extend_end_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Extend',
      lastname: 'End'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(14)
    const toDate = addDaysIso(16)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: addDaysIso(17)
    })
    expect(res.status).toBeLessThan(500)
    expect(res.text).toMatch(/only shorten/i)

    const unchanged = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(unchanged.edited_at).toBeNull()
    expect(momentUtc(unchanged.date_end)).toBe(toDate)
  })

  it('allows shrinking to a later subset within the original span', async () => {
    const empEmail = `edit_shrink_later_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Later',
      lastname: 'Subset'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(14)
    const toDate = addDaysIso(18)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate,
      reason: 'wide block'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const newFrom = addDaysIso(17)
    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: newFrom,
      toDate,
      reason: 'keep only last days'
    })
    expect(res.status).toBeLessThan(400)

    const updated = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(updated.edited_at).toBeTruthy()
    expect(momentUtc(updated.date_start)).toBe(newFrom)
    expect(momentUtc(updated.date_end)).toBe(toDate)
  })

  it('rejects editing to a completely different date period', async () => {
    const empEmail = `edit_far_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Far',
      lastname: 'Away'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(14)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: addDaysIso(16),
      reason: 'original nearby'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: addDaysIso(90),
      toDate: addDaysIso(94),
      reason: 'jump months'
    })
    expect(res.status).toBeLessThan(500)
    expect(res.text).toMatch(/only shorten/i)

    const unchanged = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(unchanged.edited_at).toBeNull()
    expect(momentUtc(unchanged.date_start)).toBe(fromDate)
    expect(momentUtc(unchanged.date_end)).toBe(addDaysIso(16))
  })

  it('rejects an adjacent range outside the original span', async () => {
    const empEmail = `edit_adj_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Adj',
      lastname: 'Acent'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(14)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: addDaysIso(16)
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const res = await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: addDaysIso(17),
      toDate: addDaysIso(18)
    })
    expect(res.status).toBeLessThan(500)
    expect(res.text).toMatch(/only shorten/i)

    const unchanged = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(unchanged.edited_at).toBeNull()
    expect(momentUtc(unchanged.date_start)).toBe(fromDate)
  })

  it('cannot edit approved leave', async () => {
    const fromDate = addDaysIso(18)
    await bookLeave(adminAgent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: fromDate
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: adminId },
      orderBy: { id: 'desc' }
    })

    await prisma.leaves.update({
      where: { id: leave.id },
      data: { status: leaveConstants.status_approved() }
    })

    const res = await editLeave(adminAgent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: addDaysIso(19),
      toDate: addDaysIso(19)
    })
    expect(res.status).toBeLessThan(500)

    const stillApproved = await prisma.leaves.findUnique({ where: { id: leave.id } })
    expect(stillApproved.status).toBe(leaveConstants.status_approved())
    expect(stillApproved.edited_at).toBeNull()
  })

  it('GET leave-edit returns 403 for unauthorized user', async () => {
    const emp1Email = `edit_a_${Date.now()}@example.com`
    const emp2Email = `edit_b_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: emp1Email,
      departmentId: primaryDepartmentId,
      name: 'A',
      lastname: 'One'
    })
    await addEmployee(adminAgent, {
      email: emp2Email,
      departmentId: primaryDepartmentId,
      name: 'B',
      lastname: 'Two'
    })
    const emp1 = await prisma.users.findFirst({ where: { email: emp1Email } })
    const { agent: agent1 } = await loginAsNewAgent(app, emp1Email, TEST_PASSWORD)
    const { agent: agent2 } = await loginAsNewAgent(app, emp2Email, TEST_PASSWORD)

    const fromDate = addDaysIso(22)
    await bookLeave(agent1, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: fromDate
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp1.id },
      orderBy: { id: 'desc' }
    })

    const res = await agent2.get(`/calendar/leave-edit/${leave.id}/`)
    expect(res.status).toBe(403)
  })

  it('records edit emails when substantive fields change', async () => {
    const empEmail = `edit_email_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Mail',
      lastname: 'Test'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(25)
    const toDate = addDaysIso(26)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate,
      reason: 'before email'
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    const beforeAudits = await prisma.email_audits.count({
      where: { user_id: emp.id }
    })

    await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: sickLeaveTypeId,
      fromDate,
      toDate,
      reason: 'type change'
    })

    const afterAudits = await prisma.email_audits.count({
      where: { user_id: emp.id }
    })
    expect(afterAudits).toBeGreaterThan(beforeAudits)
  })

  it('leave summary popover shows edited date after edit', async () => {
    const empEmail = `edit_popover_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: empEmail,
      departmentId: primaryDepartmentId,
      name: 'Pop',
      lastname: 'Over'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const { agent } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

    const fromDate = addDaysIso(28)
    const toDate = addDaysIso(29)
    await bookLeave(agent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate
    })

    const leave = await prisma.leaves.findFirst({
      where: { user_id: emp.id },
      orderBy: { id: 'desc' }
    })

    await editLeave(agent, {
      leaveId: leave.id,
      leaveTypeId: holidayTypeId,
      fromDate: toDate,
      toDate,
      reason: 'drop first day'
    })

    const summary = await agent.get(`/calendar/leave-summary/${leave.id}/`)
    expect(summary.status).toBe(200)
    expect(summary.text).toContain('Edited on')
    expect(summary.text).toContain('edit-leave-btn')
  })

  it('calendar page spaces request actions and includes confirm modals', async () => {
    const fromDate = addDaysIso(21)
    await bookLeave(adminAgent, {
      leaveTypeId: holidayTypeId,
      fromDate,
      toDate: fromDate,
      reason: 'show actions'
    })

    const page = await adminAgent.get('/calendar/').redirects(5)
    expect(page.status).toBe(200)
    expect(page.text).toContain('leave-request-actions')
    expect(page.text).toContain('edit-leave-btn')
    expect(page.text).toContain('leave-cancel-form')
    expect(page.text).toContain('confirm_edit_leave_modal')
    expect(page.text).toContain('confirm_leave_action_modal')
    expect(page.text).toContain('leave-request-confirm.js')
  })
})

function momentUtc(date) {
  return new Date(date).toISOString().slice(0, 10)
}
