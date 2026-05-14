import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  TEST_PASSWORD
} from '../support/http.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

/** @type {import('supertest').TestAgent} */
let agent
let adminId
let companyId
let primaryDepartmentId

beforeAll(async () => {
  agent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(agent)
  const admin = await prisma.users.findFirst({
    where: { email: adminEmail },
    include: { departments: true }
  })
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

describe('add user (admin)', () => {
  it('creates an employee via POST /users/add/', async () => {
    const admin = await prisma.users.findUnique({
      where: { id: adminId },
      include: { departments: true }
    })

    const newEmail = `employee_${Date.now()}@example.com`
    const res = await agent
      .post('/users/add/')
      .type('form')
      .send({
        name: 'Pat',
        lastname: 'Lee',
        slack_username: 'pat',
        email_address: newEmail,
        department: String(admin.department_id),
        start_date: '2026-02-01',
        password_one: TEST_PASSWORD,
        password_confirm: TEST_PASSWORD,
        admin: 'false',
        manager: 'false',
        auto_approve: 'false'
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const created = await prisma.users.findFirst({
      where: { email: newEmail }
    })
    expect(created).toBeTruthy()
    expect(created.password).not.toBe('undefined')
    expect(created.password.length).toBeGreaterThan(10)
  })
})
