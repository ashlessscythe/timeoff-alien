import request from 'supertest'
import { expect } from 'vitest'

export const TEST_PASSWORD = 'TestPassword!12'

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function createAgent(app) {
  return request.agent(app)
}

export async function registerCompanyAndAdmin(agent, opts = {}) {
  const suffix = uniqueSuffix()
  const email = opts.email || `admin_${suffix}@example.com`
  const companyName = opts.companyName || `Vitest Co ${suffix}`
  const res = await agent
    .post('/register')
    .type('form')
    .send({
      company_name: companyName,
      name: 'Admin',
      lastname: 'User',
      email,
      password: TEST_PASSWORD,
      password_confirmed: TEST_PASSWORD,
      country: 'US',
      timezone: 'America/Denver'
    })
    .redirects(5)

  const cal = await agent.get('/calendar/').redirects(5)
  if (cal.status !== 200) {
    throw new Error(
      `Registration did not establish a session (GET /calendar/ returned ${cal.status}). Check DATABASE_URL, migrations, and server logs.`
    )
  }

  return { email, password: TEST_PASSWORD, companyName, response: res }
}

export async function login(agent, email, password) {
  return agent
    .post('/login')
    .type('form')
    .send({ username: email, password })
    .redirects(5)
}

export async function logout(agent) {
  return agent.get('/logout').redirects(5)
}

/** Unauthenticated or forbidden-by-role: app redirects to home with 303. */
export function expectRedirectToHome(res) {
  expect(res.status).toBe(303)
  expect(res.headers.location).toBe('/')
}

function formatStartDate(value) {
  if (!value) return '2026-01-01'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '2026-01-01'
  return d.toISOString().slice(0, 10)
}

/**
 * POST /users/add/ as an already-authenticated admin agent.
 * @param {import('supertest').TestAgent} adminAgent
 */
export async function addEmployee(adminAgent, opts) {
  const {
    name = 'Pat',
    lastname = 'Lee',
    email,
    password = TEST_PASSWORD,
    admin = false,
    manager = false,
    departmentId,
    slackUsername = '',
    startDate = '2026-02-01'
  } = opts

  if (!email) throw new Error('addEmployee: email is required')
  if (!departmentId) throw new Error('addEmployee: departmentId is required')

  const body = {
    name,
    lastname,
    slack_username: slackUsername,
    email_address: email,
    department: String(departmentId),
    start_date: startDate,
    password_one: password,
    password_confirm: password,
    auto_approve: 'false'
  }
  if (admin) body.admin = 'on'
  if (manager) body.manager = 'on'

  return adminAgent
    .post('/users/add/')
    .type('form')
    .send(body)
    .redirects(5)
}

export async function loginAsNewAgent(app, email, password) {
  const agent = createAgent(app)
  const loginRes = await agent
    .post('/login')
    .type('form')
    .send({ username: email, password })
    .redirects(5)
  const cal = await agent.get('/calendar/').redirects(5)
  if (cal.status !== 200) {
    throw new Error(
      `loginAsNewAgent: session not established (GET /calendar/ returned ${cal.status}) for ${email}`
    )
  }
  return { agent, loginRes }
}

/** Build POST body for /users/edit/:id/ from a Prisma user row (checkbox-style flags). */
export function buildUserEditFormBody(user, flags = {}) {
  const admin = flags.admin !== undefined ? flags.admin : !!user.admin
  const manager = flags.manager !== undefined ? flags.manager : !!user.manager
  const autoApprove =
    flags.auto_approve !== undefined ? flags.auto_approve : !!user.auto_approve

  const body = {
    name: user.name,
    lastname: user.lastname,
    email_address: user.email,
    slack_username: user.slack_username || '',
    department: String(user.department_id),
    start_date: formatStartDate(user.start_date)
  }
  if (user.end_date) {
    body.end_date = formatStartDate(user.end_date)
  }
  if (admin) body.admin = 'on'
  if (manager) body.manager = 'on'
  if (autoApprove) body.auto_approve = 'on'
  return body
}
