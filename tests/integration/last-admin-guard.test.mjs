import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  buildUserEditFormBody,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('last admin guard', () => {
  it('blocks revoking admin from the only admin; allows revoke when another admin exists', async () => {
    const agent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({
      where: { email: adminEmail }
    })
    expect(admin.admin).toBe(true)

    const bodyRevoke = buildUserEditFormBody(admin, {
      admin: false,
      manager: false,
      auto_approve: false
    })
    await agent
      .post(`/users/edit/${admin.id}/`)
      .type('form')
      .send(bodyRevoke)
      .redirects(5)

    const stillAdmin = await prisma.users.findUnique({ where: { id: admin.id } })
    expect(stillAdmin.admin).toBe(true)

    const secondEmail = `admin2_${Date.now()}@example.com`
    const add2 = await addEmployee(agent, {
      email: secondEmail,
      departmentId: admin.department_id,
      admin: true,
      manager: false,
      name: 'Second',
      lastname: 'Admin'
    })
    expect(add2.status).toBeLessThan(400)

    const admin2 = await prisma.users.findFirst({ where: { email: secondEmail } })
    expect(admin2.admin).toBe(true)

    const revokeFirst = buildUserEditFormBody(admin, {
      admin: false,
      manager: false,
      auto_approve: false
    })
    await agent
      .post(`/users/edit/${admin.id}/`)
      .type('form')
      .send(revokeFirst)
      .redirects(5)

    const adminAfter = await prisma.users.findUnique({ where: { id: admin.id } })
    expect(adminAfter.admin).toBe(false)

    const revokeLast = buildUserEditFormBody(admin2, {
      admin: false,
      manager: false,
      auto_approve: false
    })
    await agent
      .post(`/users/edit/${admin2.id}/`)
      .type('form')
      .send(revokeLast)
      .redirects(5)

    const admin2After = await prisma.users.findUnique({ where: { id: admin2.id } })
    expect(admin2After.admin).toBe(true)
  })

  it('allows two admins then revoke one; remaining user stays admin', async () => {
    const agent = createAgent(app)
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { email: a1email } = await registerCompanyAndAdmin(agent, {
      email: `solo_${suffix}@example.com`,
      companyName: `Vitest LastAdmin ${suffix}`
    })
    const u1 = await prisma.users.findFirst({ where: { email: a1email } })

    const a2email = `admin_b_${suffix}@example.com`
    await addEmployee(agent, {
      email: a2email,
      departmentId: u1.department_id,
      admin: true,
      name: 'B',
      lastname: 'Admin'
    })
    const u2 = await prisma.users.findFirst({ where: { email: a2email } })

    await agent
      .post(`/users/edit/${u2.id}/`)
      .type('form')
      .send(
        buildUserEditFormBody(u2, {
          admin: false,
          manager: false,
          auto_approve: false
        })
      )
      .redirects(5)

    const u2After = await prisma.users.findUnique({ where: { id: u2.id } })
    expect(u2After.admin).toBe(false)

    const u1After = await prisma.users.findUnique({ where: { id: u1.id } })
    expect(u1After.admin).toBe(true)

    const agentB = createAgent(app)
    await agentB
      .post('/login')
      .type('form')
      .send({ username: a2email, password: TEST_PASSWORD })
      .redirects(5)
    const blocked = await agentB
      .get('/settings/general/')
      .redirects(0)
    expect(blocked.status).toBe(303)
    expect(blocked.headers.location).toBe('/')
  })
})
