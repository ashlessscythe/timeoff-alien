import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  login,
  logout,
  TEST_PASSWORD
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('registration and login', () => {
  it('registers a new company and lands on an authenticated page', async () => {
    const agent = createAgent(app)
    const { email, response } = await registerCompanyAndAdmin(agent)

    expect(response.status).toBeLessThan(400)
    const row = await prisma.users.findFirst({ where: { email } })
    expect(row).toBeTruthy()
    expect(row.admin).toBe(true)

    const home = await agent.get('/calendar/').redirects(5)
    expect(home.status).toBe(200)
    expect(home.text).toMatch(/calendar|book|leave/i)
  })

  it('logs in after logout with the same credentials', async () => {
    const agent = createAgent(app)
    const { email, password } = await registerCompanyAndAdmin(agent)
    await logout(agent)

    const loginRes = await login(agent, email, password)
    expect(loginRes.status).toBeLessThan(400)

    const cal = await agent.get('/calendar/').redirects(5)
    expect(cal.status).toBe(200)
    const row = await prisma.users.findFirst({ where: { email } })
    expect(row).toBeTruthy()
  })

  it('rejects wrong password', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    await logout(agent)

    const loginRes = await login(agent, email, `${TEST_PASSWORD}wrong`)
    expect(loginRes.text.toLowerCase()).toMatch(/incorrect|login/i)
  })
})
