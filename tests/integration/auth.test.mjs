import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  logout,
  login,
  TEST_PASSWORD
} from '../support/http.mjs'
import { restoreFixtureAdminPassword } from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

const RESET_PASSWORD = 'VitestResetPw!99ab'

/** @type {import('supertest').TestAgent} */
let agent
let adminId
let adminEmail

beforeAll(async () => {
  agent = createAgent(app)
  const { email } = await registerCompanyAndAdmin(agent)
  adminEmail = email
  const row = await prisma.users.findFirst({ where: { email } })
  expect(row).toBeTruthy()
  adminId = row.id
})

afterEach(async () => {
  await restoreFixtureAdminPassword(prisma, {
    userId: adminId,
    plainPassword: TEST_PASSWORD
  })
  await login(agent, adminEmail, TEST_PASSWORD)
})

describe('auth flows', () => {
  it('logout invalidates session (GET /calendar/ redirects)', async () => {
    const ok = await agent.get('/calendar/').redirects(5)
    expect(ok.status).toBe(200)
    await logout(agent)
    const blocked = await agent.get('/calendar/').redirects(0)
    expect(blocked.status).toBe(303)
    expect(blocked.headers.location).toBe('/')
  })

  it('rejects wrong password on login', async () => {
    await logout(agent)
    const res = await agent
      .post('/login')
      .type('form')
      .send({ username: adminEmail, password: `${TEST_PASSWORD}wrong` })
      .redirects(0)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.location || '').toMatch(/login/i)
  })

  it('password reset round-trip: forgot -> reset -> login with new password', async () => {
    await logout(agent)

    const guest = createAgent(app)
    const forgot = await guest
      .post('/forgot-password/')
      .type('form')
      .send({ email: adminEmail })
      .redirects(5)
    expect(forgot.status).toBeLessThan(400)

    const row = await prisma.users.findFirst({ where: { email: adminEmail } })
    expect(row.reset_password_token).toBeTruthy()

    const reset = await guest
      .post('/reset-password/')
      .type('form')
      .send({
        t: row.reset_password_token,
        password: RESET_PASSWORD,
        confirm_password: RESET_PASSWORD
      })
      .redirects(5)
    expect(reset.status).toBeLessThan(400)

    const fresh = createAgent(app)
    await fresh
      .post('/login')
      .type('form')
      .send({ username: adminEmail, password: RESET_PASSWORD })
      .redirects(5)
    const cal = await fresh.get('/calendar/').redirects(5)
    expect(cal.status).toBe(200)

    const oldLogin = await request(app)
      .post('/login')
      .type('form')
      .send({ username: adminEmail, password: TEST_PASSWORD })
      .redirects(0)
    expect(oldLogin.headers.location || '').toMatch(/login/i)
  })
})
