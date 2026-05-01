import request from 'supertest'

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
