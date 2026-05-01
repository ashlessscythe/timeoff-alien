import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('users CSV import errors', () => {
  it('imports valid row and skips row with invalid email', async () => {
    const agent = createAgent(app)
    await registerCompanyAndAdmin(agent)

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
