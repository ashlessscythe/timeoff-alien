import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  loginAsNewAgent,
  expectRedirectToHome,
  TEST_PASSWORD
} from '../support/http.mjs'
import { resetCompanyToAdminBaseline, deleteCompanyAndChildren } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

const ADMIN_ONLY_GETS = [
  '/settings/general/',
  '/settings/departments/',
  '/settings/bankholidays/',
  '/settings/leavetypes/',
  '/audit/email/',
  '/messages/',
  '/users/add/',
  '/users/import/'
]

const MANAGER_OR_ADMIN_GETS = ['/reports/', '/users/']

const AUTHENTICATED_GETS = [
  '/calendar/',
  '/calendar/teamview/',
  '/requests/',
  '/me/'
]

async function expectGetForbidden(agent, path) {
  const res = await agent.get(path).redirects(0)
  expectRedirectToHome(res)
}

async function expectGetOk(agent, path) {
  const res = await agent.get(path).redirects(0)
  expect(res.status).toBe(200)
}

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId
let departmentId
let managerEmail
let employeeEmail

async function seedManagerAndEmployee() {
  const admin = await prisma.users.findUnique({ where: { id: adminId } })
  const deptId = admin.department_id
  await addEmployee(adminAgent, {
    email: managerEmail,
    departmentId: deptId,
    manager: true,
    admin: false,
    name: 'Morgan',
    lastname: 'Manager'
  })
  await addEmployee(adminAgent, {
    email: employeeEmail,
    departmentId: deptId,
    manager: false,
    admin: false,
    name: 'Erin',
    lastname: 'Employee'
  })
}

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
  const admin = await prisma.users.findFirst({
    where: { email: adminEmail }
  })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id
  departmentId = admin.department_id

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  managerEmail = `mgr_${suffix}@example.com`
  employeeEmail = `emp_${suffix}@example.com`

  await seedManagerAndEmployee()
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
  await seedManagerAndEmployee()
})

describe('role-based access', () => {
  describe('guest', () => {
    it('redirects unauthenticated users from restricted routes', async () => {
      const agent = createAgent(app)
      for (const path of ADMIN_ONLY_GETS) {
        await expectGetForbidden(agent, path)
      }
      for (const path of MANAGER_OR_ADMIN_GETS) {
        await expectGetForbidden(agent, path)
      }
      for (const path of AUTHENTICATED_GETS) {
        await expectGetForbidden(agent, path)
      }
    })
  })

  describe('employee', () => {
    it('cannot access admin or manager pages; can use calendar and requests', async () => {
      const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)

      for (const path of ADMIN_ONLY_GETS) {
        await expectGetForbidden(agent, path)
      }
      for (const path of MANAGER_OR_ADMIN_GETS) {
        await expectGetForbidden(agent, path)
      }
      for (const path of AUTHENTICATED_GETS) {
        await expectGetOk(agent, path)
      }
    })
  })

  describe('manager', () => {
    it('can access users list and reports; cannot access admin-only settings', async () => {
      const { agent } = await loginAsNewAgent(app, managerEmail, TEST_PASSWORD)

      for (const path of ADMIN_ONLY_GETS) {
        await expectGetForbidden(agent, path)
      }
      for (const path of MANAGER_OR_ADMIN_GETS) {
        await expectGetOk(agent, path)
      }
      for (const path of AUTHENTICATED_GETS) {
        await expectGetOk(agent, path)
      }
    })
  })

  describe('admin', () => {
    it('can GET all representative routes', async () => {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const agent = createAgent(app)
      await registerCompanyAndAdmin(agent, {
        email: `admin_paths_${suffix}@example.com`,
        companyName: `Vitest RBAC ${suffix}`
      })

      const paths = [
        ...ADMIN_ONLY_GETS,
        ...MANAGER_OR_ADMIN_GETS,
        ...AUTHENTICATED_GETS
      ]
      for (const path of paths) {
        await expectGetOk(agent, path)
      }

      const createdAdmin = await prisma.users.findFirst({
        where: { email: `admin_paths_${suffix}@example.com` }
      })
      expect(createdAdmin).toBeTruthy()
      await deleteCompanyAndChildren(prisma, createdAdmin.company_id)
    })
  })

  describe('team view visibility', () => {
    afterEach(async () => {
      await prisma.companies.update({
        where: { id: companyId },
        data: { is_team_view_hidden: false }
      })
    })

    it('allows employees when team view is not hidden', async () => {
      const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)
      await expectGetOk(agent, '/calendar/teamview/')
    })

    it('blocks employees when team view is hidden; managers and admins still access', async () => {
      await prisma.companies.update({
        where: { id: companyId },
        data: { is_team_view_hidden: true }
      })

      const { agent: employeeAgent } = await loginAsNewAgent(
        app,
        employeeEmail,
        TEST_PASSWORD
      )
      // Team view uses redirect_with_session('/') (302), not the 303 role-gate.
      const blocked = await employeeAgent
        .get('/calendar/teamview/')
        .redirects(0)
      expect(blocked.status).toBe(302)
      expect(blocked.headers.location).toBe('/')

      const { agent: managerAgent } = await loginAsNewAgent(
        app,
        managerEmail,
        TEST_PASSWORD
      )
      await expectGetOk(managerAgent, '/calendar/teamview/')

      await expectGetOk(adminAgent, '/calendar/teamview/')
    })
  })

  describe('write actions enforce roles', () => {
    it('blocks employee from creating users or departments', async () => {
      const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)
      const userCountBefore = await prisma.users.count({
        where: { company_id: companyId }
      })
      const deptCountBefore = await prisma.departments.count({
        where: { company_id: companyId }
      })

      const addRes = await agent
        .post('/users/add/')
        .type('form')
        .send({
          name: 'X',
          lastname: 'Y',
          email_address: `should_not_create_${Date.now()}@example.com`,
          department: String(departmentId),
          start_date: '2026-02-01',
          password_one: TEST_PASSWORD,
          password_confirm: TEST_PASSWORD,
          admin: 'false',
          manager: 'false',
          auto_approve: 'false'
        })
        .redirects(0)
      expectRedirectToHome(addRes)

      const deptRes = await agent
        .post('/settings/departments/')
        .type('form')
        .send({
          name__new: 'Blocked Dept',
          allowance__new: '10',
          personal__new: '0',
          manager_id__new: '1',
          include_public_holidays__new: 'on',
          is_accrued_allowance__new: 'off',
          'allowed_increments[]': ['full_day', 'half_day']
        })
        .redirects(0)
      expectRedirectToHome(deptRes)

      expect(
        await prisma.users.count({ where: { company_id: companyId } })
      ).toBe(userCountBefore)
      expect(
        await prisma.departments.count({ where: { company_id: companyId } })
      ).toBe(deptCountBefore)
    })

    it('blocks manager from POSTing leave types', async () => {
      const { agent } = await loginAsNewAgent(app, managerEmail, TEST_PASSWORD)
      const mgr = await prisma.users.findFirst({ where: { email: managerEmail } })
      const existing = await prisma.leave_types.findMany({
        where: { company_id: mgr.company_id },
        orderBy: { id: 'asc' }
      })
      const ltName = `BlockedByManager ${Date.now()}`
      const before = await prisma.leave_types.count({
        where: { company_id: mgr.company_id }
      })

      const body = {
        name__new: ltName,
        color__new: '#AA5500',
        limit__new: '0',
        use_allowance__new: 'on',
        use_personal__new: 'off',
        auto_approve__new: 'off',
        manager_only__new: 'off',
        is_special__new: 'off',
        allow_non_default_increments__new: 'off',
        first_record: 'new'
      }
      for (const lt of existing) {
        const s = String(lt.id)
        body[`name__${s}`] = lt.name
        body[`color__${s}`] = lt.color
        body[`limit__${s}`] = String(lt.limit)
        body[`use_allowance__${s}`] = lt.use_allowance ? 'on' : 'off'
        body[`use_personal__${s}`] = lt.use_personal ? 'on' : 'off'
        body[`auto_approve__${s}`] = lt.auto_approve ? 'on' : 'off'
        body[`manager_only__${s}`] = lt.manager_only ? 'on' : 'off'
        body[`is_special__${s}`] = lt.is_special ? 'on' : 'off'
        body[`allow_non_default_increments__${s}`] = lt.allow_non_default_increments
          ? 'on'
          : 'off'
      }

      const res = await agent
        .post('/settings/leavetypes')
        .type('form')
        .send(body)
        .redirects(0)
      expectRedirectToHome(res)

      const after = await prisma.leave_types.count({
        where: { company_id: mgr.company_id }
      })
      expect(after).toBe(before)
      expect(
        await prisma.leave_types.findFirst({
          where: { company_id: mgr.company_id, name: ltName }
        })
      ).toBeNull()
    })
  })
})
