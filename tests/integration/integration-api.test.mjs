import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'crypto'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  enableIntegrationApi,
  seedIntegrationApiToken
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
  const { email } = await registerCompanyAndAdmin(agent)
  const user = await prisma.users.findFirst({ where: { email } })
  expect(user).toBeTruthy()
  adminId = user.id
  companyId = user.company_id
  primaryDepartmentId = user.department_id
})

afterEach(async () => {
  await resetCompanyToAdminBaseline(prisma, {
    companyId,
    adminUserId: adminId,
    primaryDepartmentId
  })
  await prisma.companies.update({
    where: { id: companyId },
    data: {
      integration_api_enabled: false,
      integration_api_token: null
    }
  })
})

describe('integration API (Bearer)', () => {
  it('enables API via settings UI and accepts bearer token on /integration/v1/', async () => {
    const user = await prisma.users.findUnique({ where: { id: adminId } })
    const save = await enableIntegrationApi(agent)
    expect(save.status).toBeLessThan(400)

    const company = await prisma.companies.findUnique({
      where: { id: user.company_id }
    })
    expect(company.integration_api_enabled).toBe(true)
    expect(company.integration_api_token).toBeTruthy()

    const res = await request(app)
      .get('/integration/v1/')
      .set('Authorization', `Bearer ${company.integration_api_token}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('seeded token works for /report/allowance; wrong or missing token returns 401', async () => {
    const user = await prisma.users.findUnique({ where: { id: adminId } })
    const token = randomUUID()
    await seedIntegrationApiToken(prisma, user.company_id, token)

    const ok = await request(app)
      .get(
        '/integration/v1/report/allowance?start_date=2026-01-01&end_date=2026-01-31'
      )
      .set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)
    expect(ok.body).toHaveProperty('data')

    const bad = await request(app)
      .get('/integration/v1/report/allowance')
      .set('Authorization', 'Bearer wrong-token')
    expect(bad.status).toBe(401)

    const none = await request(app).get('/integration/v1/report/allowance')
    expect(none.status).toBe(401)
  })
})
