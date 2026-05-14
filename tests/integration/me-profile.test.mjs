import { describe, it, expect, beforeAll } from 'vitest'
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

describe('GET /me/ profile', () => {
  let employeeEmail
  let companyId

  beforeAll(async () => {
    const adminAgent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    expect(admin).toBeTruthy()
    companyId = admin.company_id

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    employeeEmail = `emp_me_${suffix}@example.com`
    const empRes = await addEmployee(adminAgent, {
      email: employeeEmail,
      departmentId: admin.department_id,
      manager: false,
      admin: false,
      name: 'Pat',
      lastname: 'Profile'
    })
    expect(empRes.status).toBeLessThan(400)
  })

  it('returns 200 for logged-in employee', async () => {
    const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)
    const res = await agent.get('/me/').redirects(0)
    expect(res.status).toBe(200)
    expect(res.text).toContain('My profile')
    expect(res.text).toContain('Contact administrators')
  })

  it('POST /me/email sets pending address and does not change login email yet', async () => {
    const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)
    const newEmail = `pat_pending_${Date.now()}@example.com`

    const postRes = await agent
      .post('/me/email')
      .type('form')
      .send({ email_address: newEmail })
      .redirects(0)

    expect([301, 302, 303]).toContain(postRes.status)
    expect(postRes.headers.location).toContain('/me')

    const row = await prisma.users.findFirst({
      where: { company_id: companyId, email: employeeEmail }
    })
    expect(row).toBeTruthy()
    expect(row.email).toBe(employeeEmail)
    expect(row.pending_email).toBe(newEmail)
    expect(row.email_change_token).toBeTruthy()
    expect(row.email_change_expires).toBeTruthy()

    const audit = await prisma.email_audits.findFirst({
      where: { user_id: row.id, email: newEmail },
      orderBy: { id: 'desc' }
    })
    expect(audit).toBeTruthy()
    expect(audit.subject.toLowerCase()).toContain('verify')
  })

  it('POST /me/email/confirm with wrong code leaves email unchanged', async () => {
    const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)
    const newEmail = `pat_wrong_${Date.now()}@example.com`

    await agent
      .post('/me/email')
      .type('form')
      .send({ email_address: newEmail })
      .redirects(0)

    const before = await prisma.users.findFirst({
      where: { company_id: companyId, email: employeeEmail }
    })
    expect(before.pending_email).toBe(newEmail)

    const bad = await agent
      .post('/me/email/confirm')
      .type('form')
      .send({ verification_code: 'deadbeefdeadbeef' })
      .redirects(0)
    expect([301, 302, 303]).toContain(bad.status)

    const after = await prisma.users.findUnique({ where: { id: before.id } })
    expect(after.email).toBe(employeeEmail)
    expect(after.pending_email).toBe(newEmail)
  })

  it('POST /me/email/confirm with correct code updates email and clears pending', async () => {
    const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)
    const newEmail = `pat_ok_${Date.now()}@example.com`

    await agent
      .post('/me/email')
      .type('form')
      .send({ email_address: newEmail })
      .redirects(0)

    const pendingRow = await prisma.users.findFirst({
      where: { company_id: companyId, email: employeeEmail }
    })
    expect(pendingRow.email_change_token).toBeTruthy()

    const ok = await agent
      .post('/me/email/confirm')
      .type('form')
      .send({ verification_code: pendingRow.email_change_token })
      .redirects(0)
    expect([301, 302, 303]).toContain(ok.status)

    const updated = await prisma.users.findUnique({ where: { id: pendingRow.id } })
    expect(updated.email).toBe(newEmail)
    expect(updated.pending_email).toBeNull()
    expect(updated.email_change_token).toBeNull()
    expect(updated.email_change_expires).toBeNull()

    const successPage = await agent.get('/me/').redirects(0)
    expect(successPage.status).toBe(200)
    expect(successPage.text).toContain('Email updated')
    expect(successPage.text).toContain('Continue to profile')
    expect(successPage.text).toContain('disabled')

    const normalPage = await agent.get('/me/').redirects(0)
    expect(normalPage.status).toBe(200)
    expect(normalPage.text).toContain(newEmail)
    expect(normalPage.text).not.toContain('Continue to profile')

    employeeEmail = newEmail
  })

  it('rejects email already used by another user at request step', async () => {
    const adminAgent = createAgent(app)
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const otherEmail = `other_${suffix}@example.com`
    const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent, {
      email: `admin_dup_${suffix}@example.com`,
      companyName: `Co dup ${suffix}`
    })
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    await addEmployee(adminAgent, {
      email: otherEmail,
      departmentId: admin.department_id,
      manager: false,
      admin: false
    })

    const victimEmail = `victim_${suffix}@example.com`
    await addEmployee(adminAgent, {
      email: victimEmail,
      departmentId: admin.department_id,
      manager: false,
      admin: false
    })

    const { agent } = await loginAsNewAgent(app, victimEmail, TEST_PASSWORD)
    const before = await prisma.users.findFirst({ where: { email: victimEmail } })

    const postRes = await agent
      .post('/me/email')
      .type('form')
      .send({ email_address: otherEmail })
      .redirects(0)

    expect([301, 302, 303]).toContain(postRes.status)

    const after = await prisma.users.findUnique({ where: { id: before.id } })
    expect(after.email).toBe(victimEmail)
    expect(after.pending_email).toBeNull()
  })
})
