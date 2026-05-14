import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { resetCompanyToAdminBaseline } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

/** @type {import('supertest').TestAgent} */
let agent
let adminId
let companyId
let primaryDepartmentId
/** @type {number[]} */
let baselineLeaveTypeIds

beforeAll(async () => {
  agent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(agent)
  const admin = await prisma.users.findFirst({ where: { email } })
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
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
  if (baselineLeaveTypeIds?.length) {
    await prisma.leave_types.deleteMany({
      where: { company_id: companyId, id: { notIn: baselineLeaveTypeIds } }
    })
  }
})

describe('leave types', () => {
  it('adds a leave type via POST /settings/leavetypes', async () => {
    const admin = await prisma.users.findUnique({ where: { id: adminId } })
    const ltName = `Conference ${Date.now()}`
    const before = await prisma.leave_types.count({
      where: { company_id: admin.company_id }
    })

    const existing = await prisma.leave_types.findMany({
      where: { company_id: admin.company_id },
      orderBy: { id: 'asc' }
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
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const after = await prisma.leave_types.count({
      where: { company_id: admin.company_id }
    })
    expect(after).toBe(before + 1)

    const created = await prisma.leave_types.findFirst({
      where: { company_id: admin.company_id, name: ltName }
    })
    expect(created).toBeTruthy()
    expect(created.color.toLowerCase()).toBe('#aa5500')
  })
})
