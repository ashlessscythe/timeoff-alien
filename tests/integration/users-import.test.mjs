import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('users CSV import', () => {
  it('imports users from CSV via POST /users/import/', async () => {
    const agent = createAgent(app)
    await registerCompanyAndAdmin(agent)

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const e1 = `import_one_${suffix}@example.com`
    const e2 = `import_two_${suffix}@example.com`
    const csv = [
      'email,slack_username,lastname,name,department',
      `${e1},,One,Import,Sales`,
      `${e2},,Two,Import,Sales`
    ].join('\n')
    const tmp = path.join(os.tmpdir(), `vitest-import-${suffix}.csv`)
    fs.writeFileSync(tmp, csv, 'utf8')
    const buf = fs.readFileSync(tmp)
    fs.unlinkSync(tmp)

    const res = await agent
      .post('/users/import/')
      .attach('users_import', buf, 'users-import.csv')
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const u1 = await prisma.users.findFirst({
      where: { email: e1 }
    })
    const u2 = await prisma.users.findFirst({
      where: { email: e2 }
    })
    expect(u1).toBeTruthy()
    expect(u2).toBeTruthy()
    expect(u1.password).not.toBe('undefined')
    expect(u2.password).not.toBe('undefined')
  })
})
