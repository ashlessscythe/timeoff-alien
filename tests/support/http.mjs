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
      timezone: opts.timezone || 'America/Denver'
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
    startDate = '2026-02-01',
    autoApprove = false
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
    password_confirm: password
  }
  if (admin) body.admin = 'on'
  if (manager) body.manager = 'on'
  if (autoApprove) body.auto_approve = 'on'
  else body.auto_approve = 'false'

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
    start_date:
      flags.start_date !== undefined
        ? flags.start_date
        : formatStartDate(user.start_date)
  }
  if (flags.end_date !== undefined && flags.end_date !== null) {
    body.end_date = flags.end_date
  } else if (user.end_date) {
    body.end_date = formatStartDate(user.end_date)
  }
  if (admin) body.admin = 'on'
  if (manager) body.manager = 'on'
  if (autoApprove) body.auto_approve = 'on'
  return body
}

/** POST /calendar/bookleave/ (defaults: self, full day). */
export async function bookLeave(agent, opts) {
  const {
    leaveTypeId,
    fromDate,
    toDate,
    fromDatePart = '1',
    toDatePart = '1',
    incrementType = 'day',
    incrementValue,
    reason = 'Vitest',
    user
  } = opts
  const body = {
    leave_type: String(leaveTypeId),
    from_date: fromDate,
    to_date: toDate || fromDate,
    from_date_part: String(fromDatePart),
    to_date_part: String(toDatePart),
    reason,
    increment_type: incrementType
  }
  if (user !== undefined && user !== null && user !== '') {
    body.user = String(user)
  }
  if (incrementValue) body.increment_value = String(incrementValue)

  return agent
    .post('/calendar/bookleave/')
    .type('form')
    .send(body)
    .redirects(5)
}

export async function editLeave(agent, opts) {
  const {
    leaveId,
    leaveTypeId,
    fromDate,
    toDate,
    fromDatePart = '1',
    toDatePart = '1',
    incrementType = 'day',
    incrementValue,
    reason = 'Vitest edit',
    redirectBackTo
  } = opts
  const body = {
    request: String(leaveId),
    leave_type: String(leaveTypeId),
    from_date: fromDate,
    to_date: toDate || fromDate,
    from_date_part: String(fromDatePart),
    to_date_part: String(toDatePart),
    reason,
    increment_type: incrementType
  }
  if (incrementValue) body.increment_value = String(incrementValue)
  if (redirectBackTo) body.redirect_back_to = redirectBackTo

  return agent
    .post('/calendar/editleave/')
    .type('form')
    .send(body)
    .redirects(5)
}

/**
 * Build POST body for /settings/leavetypes including all existing rows + optional __new row.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function buildLeavetypesFormBody(
  prisma,
  companyId,
  newRow = null,
  opts = {}
) {
  const existing = await prisma.leave_types.findMany({
    where: { company_id: companyId },
    orderBy: { id: 'asc' }
  })
  const body = {
    leave_types_sort: opts.leave_types_sort || 'name_desc'
  }
  if (newRow) {
    body.name__new = newRow.name
    body.color__new = newRow.color || '#AA5500'
    body.limit__new = String(newRow.limit ?? 0)
    body.use_allowance__new = newRow.use_allowance ? 'on' : 'off'
    body.use_personal__new = newRow.use_personal ? 'on' : 'off'
    body.auto_approve__new = newRow.auto_approve ? 'on' : 'off'
    body.manager_only__new = newRow.manager_only ? 'on' : 'off'
    body.is_special__new = newRow.is_special ? 'on' : 'off'
    body.allow_non_default_increments__new = newRow.allow_non_default_increments
      ? 'on'
      : 'off'
    body.first_record = 'new'
  }
  for (const lt of existing) {
    const s = String(lt.id)
    body[`name__${s}`] = lt.name
    body[`color__${s}`] = lt.color
    body[`limit__${s}`] = String(lt.limit)
    body[`use_allowance__${s}`] = lt.use_allowance ? 'on' : 'off'
    body[`use_personal__${s}`] = lt.use_personal ? 'on' : 'off'
    body[`auto_approve__${s}`] = lt.auto_approve ? 'on' : 'off'
    body[`manager_only__${s}`] = lt.manager_only ? 'on' : 'off'
    body[`is_special__${s}`] = lt.is_special ? 'on' : 'off'
    body[`allow_non_default_increments__${s}`] = lt.allow_non_default_increments
      ? 'on'
      : 'off'
  }
  return body
}

export async function createLeaveType(adminAgent, prisma, companyId, newRow) {
  const body = await buildLeavetypesFormBody(prisma, companyId, newRow)
  return adminAgent
    .post('/settings/leavetypes')
    .type('form')
    .send(body)
    .redirects(5)
}

export async function createDepartment(adminAgent, opts) {
  const {
    name,
    allowance = '15',
    personal = '0',
    managerId,
    includePublicHolidays = true,
    isAccrued = false,
    allowedIncrements = ['full_day', 'half_day']
  } = opts
  return adminAgent
    .post('/settings/departments/')
    .type('form')
    .send({
      name__new: name,
      allowance__new: String(allowance),
      personal__new: String(personal),
      manager_id__new: String(managerId),
      include_public_holidays__new: includePublicHolidays ? 'on' : 'off',
      is_accrued_allowance__new: isAccrued ? 'on' : 'off',
      'allowed_increments[]': allowedIncrements
    })
    .redirects(5)
}

export async function enableIntegrationApi(adminAgent) {
  return adminAgent
    .post('/settings/company/integration-api/')
    .type('form')
    .send({
      integration_api_enabled: 'on',
      regenerate_token: '1'
    })
    .redirects(5)
}

export async function seedIntegrationApiToken(prisma, companyId, token) {
  await prisma.companies.update({
    where: { id: companyId },
    data: {
      integration_api_enabled: true,
      integration_api_token: token
    }
  })
  return token
}
