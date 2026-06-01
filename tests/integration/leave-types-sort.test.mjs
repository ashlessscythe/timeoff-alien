import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  buildLeavetypesFormBody
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
/** @type {number[]} */
let baselineLeaveTypeIds

function parseLeaveTypeOptionNames(html) {
  const options = []
  const re = /<select[^>]*id="leave_type"[^>]*>([\s\S]*?)<\/select>/i
  const match = html.match(re)
  if (!match) return options
  const inner = match[1]
  const optionRe = /<option[^>]*value=(?:")?(\d+)(?:")?[^>]*>([^<]*)</gi
  let m
  while ((m = optionRe.exec(inner)) !== null) {
    if (m[1] && !m[0].includes('disabled')) {
      options.push({ id: Number(m[1]), name: m[2].trim() })
    }
  }
  return options
}

async function createNamedLeaveTypes(prismaClient, compId, names) {
  const ts = new Date()
  for (const name of names) {
    await prismaClient.leave_types.create({
      data: {
        name,
        color: '#AA5500',
        company_id: compId,
        use_allowance: true,
        use_personal: false,
        auto_approve: false,
        manager_only: false,
        is_special: false,
        allow_non_default_increments: false,
        created_at: ts,
        updated_at: ts
      }
    })
  }
}

async function saveLeavetypesSettings(adminAgent, prismaClient, compId, opts = {}) {
  const body = await buildLeavetypesFormBody(prismaClient, compId, null, {
    leave_types_sort: opts.leave_types_sort || 'name_desc'
  })
  if (opts.first_record != null) {
    body.first_record = String(opts.first_record)
  }
  const res = await adminAgent
    .post('/settings/leavetypes')
    .type('form')
    .send(body)
    .redirects(5)
  expect(res.status).toBeLessThan(400)
  return res
}

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
  await prisma.companies.update({
    where: { id: companyId },
    data: { leave_types_sort: 'name_desc' }
  })
})

describe('leave type sort', () => {
  it('orders booking dropdown Z to A when leave_types_sort is name_desc', async () => {
    const suffix = Date.now()
    await createNamedLeaveTypes(prisma, companyId, [
      `Alpha ${suffix}`,
      `Mango ${suffix}`,
      `Zulu ${suffix}`
    ])

    await saveLeavetypesSettings(agent, prisma, companyId, {
      leave_types_sort: 'name_desc'
    })

    const cal = await agent.get('/calendar/').redirects(5)
    expect(cal.status).toBe(200)

    const names = parseLeaveTypeOptionNames(cal.text)
      .map(o => o.name)
      .filter(n => n.includes(String(suffix)))

    expect(names).toEqual([
      `Zulu ${suffix}`,
      `Mango ${suffix}`,
      `Alpha ${suffix}`
    ])
  })

  it('orders booking dropdown A to Z when leave_types_sort is name_asc', async () => {
    const suffix = Date.now()
    await createNamedLeaveTypes(prisma, companyId, [
      `Alpha ${suffix}`,
      `Mango ${suffix}`,
      `Zulu ${suffix}`
    ])

    await saveLeavetypesSettings(agent, prisma, companyId, {
      leave_types_sort: 'name_asc'
    })

    const cal = await agent.get('/calendar/').redirects(5)
    const names = parseLeaveTypeOptionNames(cal.text)
      .map(o => o.name)
      .filter(n => n.includes(String(suffix)))

    expect(names).toEqual([
      `Alpha ${suffix}`,
      `Mango ${suffix}`,
      `Zulu ${suffix}`
    ])
  })

  it('pins one leave type ahead of name sort', async () => {
    const suffix = Date.now()
    await createNamedLeaveTypes(prisma, companyId, [
      `Alpha ${suffix}`,
      `Mango ${suffix}`,
      `Zulu ${suffix}`
    ])

    const mango = await prisma.leave_types.findFirst({
      where: { company_id: companyId, name: `Mango ${suffix}` }
    })
    expect(mango).toBeTruthy()

    await saveLeavetypesSettings(agent, prisma, companyId, {
      leave_types_sort: 'name_desc',
      first_record: mango.id
    })

    const pinned = await prisma.leave_types.findUnique({
      where: { id: mango.id }
    })
    expect(pinned.sort_order).toBe(1)

    const cal = await agent.get('/calendar/').redirects(5)
    const names = parseLeaveTypeOptionNames(cal.text)
      .map(o => o.name)
      .filter(n => n.includes(String(suffix)))

    expect(names[0]).toBe(`Mango ${suffix}`)
    expect(names.slice(1)).toEqual([`Zulu ${suffix}`, `Alpha ${suffix}`])
  })

  it('persists leave_types_sort on the company', async () => {
    await saveLeavetypesSettings(agent, prisma, companyId, {
      leave_types_sort: 'name_asc'
    })

    const company = await prisma.companies.findUnique({
      where: { id: companyId }
    })
    expect(company.leave_types_sort).toBe('name_asc')
  })
})
