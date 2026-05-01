import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  addEmployee,
  bookLeave,
  buildUserEditFormBody,
  loginAsNewAgent,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('users and leave types CRUD edge cases', () => {
  it('rejects duplicate email on add user', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({ where: { email } })
    const before = await prisma.users.count({
      where: { company_id: admin.company_id }
    })

    const res = await agent
      .post('/users/add/')
      .type('form')
      .send({
        name: 'X',
        lastname: 'Y',
        email_address: email,
        department: String(admin.department_id),
        start_date: '2026-02-01',
        password_one: TEST_PASSWORD,
        password_confirm: TEST_PASSWORD,
        admin: 'false',
        manager: 'false',
        auto_approve: 'false'
      })
      .redirects(5)
    expect(res.status).toBeLessThan(400)

    const after = await prisma.users.count({
      where: { company_id: admin.company_id }
    })
    expect(after).toBe(before)
  })

  it('cannot delete a leave type that is in use', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    await bookLeave(agent, {
      leaveTypeId: holiday.id,
      fromDate: '2026-06-01',
      toDate: '2026-06-01',
      reason: 'block delete'
    })

    const del = await agent
      .post(`/settings/leavetypes/delete/${holiday.id}/`)
      .redirects(5)
    expect(del.status).toBeLessThan(400)

    const still = await prisma.leave_types.findUnique({
      where: { id: holiday.id }
    })
    expect(still).toBeTruthy()
  })

  it('deactivated user (end_date in past) cannot establish a session', async () => {
    const agent = createAgent(app)
    const { email: adminEmail } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({ where: { email: adminEmail } })
    const empEmail = `gone_${Date.now()}@example.com`
    await addEmployee(agent, {
      email: empEmail,
      departmentId: admin.department_id,
      name: 'Gone',
      lastname: 'User'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    await agent
      .post(`/users/edit/${emp.id}/`)
      .type('form')
      .send(
        buildUserEditFormBody(emp, {
          start_date: '2019-01-01',
          end_date: '2020-12-31'
        })
      )
      .redirects(5)

    const empAgent = createAgent(app)
    await empAgent
      .post('/login')
      .type('form')
      .send({ username: empEmail, password: TEST_PASSWORD })
      .redirects(5)
    const cal = await empAgent.get('/calendar/').redirects(0)
    expect(cal.status).toBe(303)
    expect(cal.headers.location).toBe('/')
  })
})
