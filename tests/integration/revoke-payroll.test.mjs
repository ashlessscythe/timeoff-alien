import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')

function day(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

/**
 * Pins `lib/model/payrollCloseWindow` "now" via env (see TIMEOFF_TEST_PAYROLL_NOW).
 * Does not replace global Date (avoids breaking sessions / superagent).
 */
async function withTestPayrollNow(isoUtc, fn) {
  const prev = process.env.TIMEOFF_TEST_PAYROLL_NOW
  process.env.TIMEOFF_TEST_PAYROLL_NOW = isoUtc
  try {
    return await fn()
  } finally {
    if (prev === undefined) {
      delete process.env.TIMEOFF_TEST_PAYROLL_NOW
    } else {
      process.env.TIMEOFF_TEST_PAYROLL_NOW = prev
    }
  }
}

/** Wednesday 2026-05-13 12:00 UTC — after Monday May 11 10:00 UTC payroll close for that week. */
function afterPayrollCloseMay2026(fn) {
  return withTestPayrollNow('2026-05-13T12:00:00.000Z', fn)
}

/** Sunday 2026-05-10 08:00 UTC — before Monday May 11 10:00 UTC close. */
function beforePayrollCloseMay2026(fn) {
  return withTestPayrollNow('2026-05-10T08:00:00.000Z', fn)
}

async function setupManagerEmployeeApprovedLeave(opts) {
  const { pastWeekIso, currentWeekIso } = opts
  const adminAgent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({ where: { email: adminEmail } })

  const mgrEmail = `mgr_rev_${Date.now()}@example.com`
  await addEmployee(adminAgent, {
    email: mgrEmail,
    departmentId: admin.department_id,
    manager: true,
    name: 'M',
    lastname: 'Manager'
  })
  const empEmail = `emp_rev_${Date.now()}@example.com`
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
  const pastLeave = await prisma.leaves.create({
    data: {
      user_id: empUser.id,
      leave_type_id: holiday.id,
      approver_id: mgrUser.id,
      status: leaveConstants.status_approved(),
      employee_comment: 'past-week',
      date_start: day(pastWeekIso),
      date_end: day(pastWeekIso),
      day_part_start: 1,
      day_part_end: 1,
      time_start: null,
      time_end: null,
      created_at: ts,
      updated_at: ts
    }
  })

  const currentLeave = await prisma.leaves.create({
    data: {
      user_id: empUser.id,
      leave_type_id: holiday.id,
      approver_id: mgrUser.id,
      status: leaveConstants.status_approved(),
      employee_comment: 'current-week',
      date_start: day(currentWeekIso),
      date_end: day(currentWeekIso),
      day_part_start: 1,
      day_part_end: 1,
      time_start: null,
      time_end: null,
      created_at: ts,
      updated_at: ts
    }
  })

  const { agent: mgr } = await loginAsNewAgent(app, mgrEmail, TEST_PASSWORD)
  const { agent: emp } = await loginAsNewAgent(app, empEmail, TEST_PASSWORD)

  return {
    adminAgent,
    empUser,
    mgrUser,
    pastLeave,
    currentLeave,
    mgr,
    emp
  }
}

describe('POST /requests/revoke/ payroll week + same company', () => {
  it('after payroll close: employee cannot revoke own approved leave from prior Sun–Sat week (status unchanged)', async () => {
    const { pastLeave, emp } = await setupManagerEmployeeApprovedLeave({
      pastWeekIso: '2026-05-05',
      currentWeekIso: '2026-05-12'
    })

    await afterPayrollCloseMay2026(() =>
      emp
        .post('/requests/revoke/')
        .type('form')
        .send({ request: String(pastLeave.id) })
        .redirects(5)
    )

    const row = await prisma.leaves.findUnique({ where: { id: pastLeave.id } })
    expect(row.status).toBe(leaveConstants.status_approved())
  }, 120000)

  it('after payroll close: manager cannot revoke report approved leave from prior week (status unchanged)', async () => {
    const { pastLeave, mgr } = await setupManagerEmployeeApprovedLeave({
      pastWeekIso: '2026-05-06',
      currentWeekIso: '2026-05-12'
    })

    await afterPayrollCloseMay2026(() =>
      mgr
        .post('/requests/revoke/')
        .type('form')
        .send({ request: String(pastLeave.id) })
        .redirects(5)
    )

    const row = await prisma.leaves.findUnique({ where: { id: pastLeave.id } })
    expect(row.status).toBe(leaveConstants.status_approved())
  }, 120000)

  it('after payroll close: admin can revoke approved leave from prior week (pended_revoke)', async () => {
    const { pastLeave, adminAgent } = await setupManagerEmployeeApprovedLeave({
      pastWeekIso: '2026-05-04',
      currentWeekIso: '2026-05-12'
    })

    await afterPayrollCloseMay2026(() =>
      adminAgent
        .post('/requests/revoke/')
        .type('form')
        .send({ request: String(pastLeave.id) })
        .redirects(5)
    )

    const row = await prisma.leaves.findUnique({ where: { id: pastLeave.id } })
    expect(row.status).toBe(leaveConstants.status_pended_revoke())
  }, 120000)

  it('after payroll close: employee can revoke own approved leave in current week (pended_revoke)', async () => {
    const { currentLeave, emp } = await setupManagerEmployeeApprovedLeave({
      pastWeekIso: '2026-05-05',
      currentWeekIso: '2026-05-12'
    })

    await afterPayrollCloseMay2026(() =>
      emp
        .post('/requests/revoke/')
        .type('form')
        .send({ request: String(currentLeave.id) })
        .redirects(5)
    )

    const row = await prisma.leaves.findUnique({
      where: { id: currentLeave.id }
    })
    expect(row.status).toBe(leaveConstants.status_pended_revoke())
  }, 120000)

  it('before payroll close: employee can revoke own approved leave from prior week (pended_revoke)', async () => {
    const { pastLeave, emp, empUser, mgrUser } =
      await setupManagerEmployeeApprovedLeave({
        pastWeekIso: '2026-05-05',
        currentWeekIso: '2026-05-12'
      })

    const auditsMgrBefore = await prisma.email_audits.count({
      where: { user_id: mgrUser.id, company_id: empUser.company_id }
    })
    const auditsEmpBefore = await prisma.email_audits.count({
      where: { user_id: empUser.id, company_id: empUser.company_id }
    })

    await beforePayrollCloseMay2026(() =>
      emp
        .post('/requests/revoke/')
        .type('form')
        .send({ request: String(pastLeave.id) })
        .redirects(5)
    )

    const row = await prisma.leaves.findUnique({ where: { id: pastLeave.id } })
    expect(row.status).toBe(leaveConstants.status_pended_revoke())

    const auditsMgrAfter = await prisma.email_audits.count({
      where: { user_id: mgrUser.id, company_id: empUser.company_id }
    })
    const auditsEmpAfter = await prisma.email_audits.count({
      where: { user_id: empUser.id, company_id: empUser.company_id }
    })
    expect(auditsMgrAfter - auditsMgrBefore).toBeGreaterThanOrEqual(1)
    expect(auditsEmpAfter - auditsEmpBefore).toBeGreaterThanOrEqual(1)

    const supervisorCopy = await prisma.email_audits.findFirst({
      where: {
        company_id: empUser.company_id,
        user_id: mgrUser.id,
        subject: { contains: 'Revoke leave request', mode: 'insensitive' }
      },
      orderBy: { id: 'desc' }
    })
    expect(supervisorCopy).toBeTruthy()

    const requestorCopy = await prisma.email_audits.findFirst({
      where: {
        company_id: empUser.company_id,
        user_id: empUser.id,
        subject: { contains: 'waiting decision', mode: 'insensitive' }
      },
      orderBy: { id: 'desc' }
    })
    expect(requestorCopy).toBeTruthy()
  }, 120000)

  it('admin of another company cannot revoke a leave from a different company (status unchanged)', async () => {
    const { pastLeave, empUser } = await setupManagerEmployeeApprovedLeave({
      pastWeekIso: '2026-05-05',
      currentWeekIso: '2026-05-12'
    })

    const otherAgent = createAgent(app)
    const { email: otherAdminEmail } = await registerCompanyAndAdmin(otherAgent)
    const otherAdmin = await prisma.users.findFirst({
      where: { email: otherAdminEmail }
    })
    expect(String(otherAdmin.company_id)).not.toBe(String(empUser.company_id))

    await afterPayrollCloseMay2026(() =>
      otherAgent
        .post('/requests/revoke/')
        .type('form')
        .send({ request: String(pastLeave.id) })
        .redirects(5)
    )

    const row = await prisma.leaves.findUnique({ where: { id: pastLeave.id } })
    expect(row.status).toBe(leaveConstants.status_approved())
  }, 120000)
})
