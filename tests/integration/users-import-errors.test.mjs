import fs from 'fs'
import os from 'os'
import path from 'path'
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

beforeAll(async () => {
  agent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(agent)
  const admin = await prisma.users.findFirst({ where: { email } })
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

describe('users CSV import errors', () => {
  it('imports valid row and skips row with invalid email', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const good = `good_${suffix}@example.com`
    const csv = [
      'email,slack_username,lastname,name,department',
      `not-an-email,,-,Bad,Sales`,
      `${good},,Good,Import,Sales`
    ].join('\n')
    const tmp = path.join(os.tmpdir(), `vitest-import-err-${suffix}.csv`)
    fs.writeFileSync(tmp, csv, 'utf8')
    const buf = fs.readFileSync(tmp)
    fs.unlinkSync(tmp)

    const res = await agent
      .post('/users/import/')
      .attach('users_import', buf, 'users-import.csv')
      .redirects(5)
    expect(res.status).toBeLessThan(400)

    const okUser = await prisma.users.findFirst({ where: { email: good } })
    expect(okUser).toBeTruthy()
    const badUser = await prisma.users.findFirst({
      where: { email: 'not-an-email' }
    })
    expect(badUser).toBeNull()
  })
})
