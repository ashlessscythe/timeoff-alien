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
import {
  expectBookLeaveModalIncludesLeaveTypes,
  expectBookLeaveModalEmployeeDropdownAbsent,
  expectBookLeaveModalEmployeeNames,
  expectBookLeaveModalLeaveTypeOrder
} from '../support/bookLeaveModal.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const { loadSessionUserById } = require('../../lib/model/sessionUser.js')
const { sortLeaveTypes } = require('../../lib/util/leaveTypeSort.js')

/**
 * Regression: the book-leave modal lives in {{> footer}}. After lazy session
 * hydration, leave types must be attached on every authenticated request (app
 * middleware), not only on routes that call ensure_company_with_leave_types().
 *
 * Existing leave-types-sort tests only GET /calendar/, which always loaded
 * full company data — so an empty modal on /settings/general/ was never caught.
 *
 * Only pages that include {{> footer}} are listed here (/me/ has no footer).
 */
const ROUTES_WITH_BOOK_LEAVE_MODAL = [
  '/settings/general/',
  '/requests/',
  '/reports/'
]

const MODAL_ROUTE = '/requests/'

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let adminEmail
let companyId
let primaryDepartmentId
/** @type {string[]} */
let defaultLeaveTypeNames

beforeAll(async () => {
  adminAgent = createAgent(app)
  const registered = await registerCompanyAndAdmin(adminAgent)
  adminEmail = registered.email
  const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
  expect(admin).toBeTruthy()
  adminId = admin.id
  companyId = admin.company_id
  primaryDepartmentId = admin.department_id

  defaultLeaveTypeNames = (
    await prisma.leave_types.findMany({
      where: { company_id: companyId },
      select: { name: true },
      orderBy: { name: 'asc' }
    })
  ).map(row => row.name)
  expect(defaultLeaveTypeNames.length).toBeGreaterThan(0)
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
})

async function expectedSupervisedUserNames(userId) {
  const sessionUser = await loadSessionUserById(prisma, userId)
  await sessionUser.ensure_supervised_users()
  return sessionUser.supervised_users.map(user => user.full_name)
}

async function expectedBookLeaveModalLeaveTypeNames(compId) {
  const company = await prisma.companies.findUnique({ where: { id: compId } })
  const leaveTypes = await prisma.leave_types.findMany({
    where: { company_id: compId },
    select: {
      id: true,
      name: true,
      manager_only: true,
      allow_non_default_increments: true,
      sort_order: true
    }
  })
  return sortLeaveTypes(leaveTypes, company).map(row => row.name)
}

describe('book leave modal leave types', () => {
  let employeeEmail

  beforeEach(async () => {
    employeeEmail = `emp_modal_${Date.now()}@example.com`
    await addEmployee(adminAgent, {
      email: employeeEmail,
      departmentId: primaryDepartmentId,
      manager: false,
      admin: false,
      name: 'Erin',
      lastname: 'Employee'
    })
  })

  it.each(ROUTES_WITH_BOOK_LEAVE_MODAL)(
    'admin sees company leave types in modal on %s',
    async path => {
      const res = await adminAgent.get(path).redirects(0)
      expect(res.status).toBe(200)
      expect(res.text).toContain('id="book_leave_modal"')
      expectBookLeaveModalIncludesLeaveTypes(res.text, defaultLeaveTypeNames)
    }
  )

  it('employee sees company leave types in modal on /requests/', async () => {
    const { agent } = await loginAsNewAgent(app, employeeEmail, TEST_PASSWORD)

    const res = await agent.get('/requests/').redirects(0)
    expect(res.status).toBe(200)
    expect(res.text).toContain('id="book_leave_modal"')
    expectBookLeaveModalIncludesLeaveTypes(res.text, defaultLeaveTypeNames)
  })

  it('preserves leave type sort order in the dropdown on /requests/', async () => {
    const expectedOrder = await expectedBookLeaveModalLeaveTypeNames(companyId)
    const res = await adminAgent.get(MODAL_ROUTE).redirects(0)
    expect(res.status).toBe(200)
    expectBookLeaveModalLeaveTypeOrder(res.text, expectedOrder)
  })
})

describe('book leave modal employee dropdown', () => {
  let managerEmail
  let teammateEmail
  let outsiderEmail

  beforeEach(async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    managerEmail = `mgr_modal_${suffix}@example.com`
    teammateEmail = `team_modal_${suffix}@example.com`
    outsiderEmail = `eng_modal_${suffix}@example.com`

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

    await addEmployee(adminAgent, {
      email: teammateEmail,
      departmentId: primaryDepartmentId,
      manager: false,
      admin: false,
      name: 'Taylor',
      lastname: 'Teammate'
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
      email: outsiderEmail,
      departmentId: engineeringDept.id,
      manager: false,
      admin: false,
      name: 'Alex',
      lastname: 'Engineer'
    })
  })

  it('regular employee does not see the employee dropdown', async () => {
    const { agent } = await loginAsNewAgent(app, teammateEmail, TEST_PASSWORD)

    const res = await agent.get(MODAL_ROUTE).redirects(0)
    expect(res.status).toBe(200)
    expectBookLeaveModalEmployeeDropdownAbsent(res.text)
  })

  it('manager sees only supervised employees in the dropdown', async () => {
    const manager = await prisma.users.findFirst({ where: { email: managerEmail } })
    expect(manager).toBeTruthy()

    const { agent } = await loginAsNewAgent(app, managerEmail, TEST_PASSWORD)
    const res = await agent.get(MODAL_ROUTE).redirects(0)
    expect(res.status).toBe(200)

    const expectedNames = await expectedSupervisedUserNames(manager.id)
    expect(expectedNames.length).toBeGreaterThan(1)
    expectBookLeaveModalEmployeeNames(res.text, expectedNames)
    expect(expectedNames).not.toContain('Alex Engineer')
  })

  it('admin sees all company employees in the dropdown', async () => {
    const { agent } = await loginAsNewAgent(app, adminEmail, TEST_PASSWORD)
    const res = await agent.get(MODAL_ROUTE).redirects(0)
    expect(res.status).toBe(200)

    const expectedNames = await expectedSupervisedUserNames(adminId)
    expect(expectedNames).toContain('Morgan Manager')
    expect(expectedNames).toContain('Taylor Teammate')
    expect(expectedNames).toContain('Alex Engineer')
    expectBookLeaveModalEmployeeNames(res.text, expectedNames)
  })
})
