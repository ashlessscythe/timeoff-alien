import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('departments', () => {
  it('creates a department via POST /settings/departments/', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)

    const admin = await prisma.users.findFirst({ where: { email } })
    expect(admin).toBeTruthy()

    const deptName = `Engineering ${Date.now()}`
    const res = await agent
      .post('/settings/departments/')
      .type('form')
      .send({
        name__new: deptName,
        allowance__new: '15',
        personal__new: '3',
        manager_id__new: String(admin.id),
        include_public_holidays__new: 'on',
        is_accrued_allowance__new: 'off',
        'allowed_increments[]': ['full_day', 'half_day']
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const created = await prisma.departments.findFirst({
      where: { company_id: admin.company_id, name: deptName }
    })
    expect(created).toBeTruthy()
    expect(created.allowance).toBe(15)
    expect(created.personal).toBe(3)
  })
})
