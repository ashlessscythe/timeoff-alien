import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  createDepartment,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let adminEmail
let companyId
let primaryDepartmentId
let managerEmail
let otherDeptEmployeeEmail

beforeAll(async () => {
  adminAgent = createAgent(app)
  const registered = await registerCompanyAndAdmin(adminAgent)
  adminEmail = registered.email
  const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id
})

async function seedScopedUsers() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  managerEmail = `mgr_scope_${suffix}@example.com`
  otherDeptEmployeeEmail = `eng_scope_${suffix}@example.com`

  await addEmployee(adminAgent, {
    email: managerEmail,
    departmentId: primaryDepartmentId,
    manager: true,
    admin: false,
    name: 'Morgan',
    lastname: 'Manager'
  })

  const manager = await prisma.users.findFirst({ where: { email: managerEmail } })
  expect(manager).toBeTruthy()

  await prisma.departments.update({
    where: { id: primaryDepartmentId },
    data: { manager_id: manager.id }
  })

  await createDepartment(adminAgent, {
    name: `Engineering ${suffix}`,
    managerId: adminId
  })

  const engineeringDept = await prisma.departments.findFirst({
    where: { company_id: companyId, name: `Engineering ${suffix}` }
  })
  expect(engineeringDept).toBeTruthy()

  await addEmployee(adminAgent, {
    email: otherDeptEmployeeEmail,
    departmentId: engineeringDept.id,
    manager: false,
    admin: false,
    name: 'Alex',
    lastname: 'Engineer'
  })
}

beforeEach(async () => {
  await seedScopedUsers()
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
})

describe('users list scoping', () => {
  it('admin sees the full company roster', async () => {
    const { agent } = await loginAsNewAgent(app, adminEmail, TEST_PASSWORD)

    const res = await agent.get('/users/').redirects(0)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Morgan Manager')
    expect(res.text).toContain('Alex Engineer')
  })

  it('manager sees only users in supervised departments', async () => {
    const { agent } = await loginAsNewAgent(app, managerEmail, TEST_PASSWORD)

    const res = await agent.get('/users/').redirects(0)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Morgan Manager')
    expect(res.text).not.toContain('Alex Engineer')
  })
})
