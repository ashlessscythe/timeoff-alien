import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { expectBookLeaveModalIncludesLeaveTypes } from '../support/bookLeaveModal.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

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

/** @type {import('supertest').TestAgent} */
let adminAgent
let adminId
let companyId
let primaryDepartmentId
let employeeEmail
/** @type {string[]} */
let defaultLeaveTypeNames

beforeAll(async () => {
  adminAgent = createAgent(app)
  const { email: adminEmail } = await registerCompanyAndAdmin(adminAgent)
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

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
})

describe('book leave modal leave types', () => {
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
})
