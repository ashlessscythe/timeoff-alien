import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('leave request', () => {
  it('books a single-day leave via POST /calendar/bookleave/', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)

    const user = await prisma.users.findFirst({
      where: { email },
      include: { companies: true }
    })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    expect(holiday).toBeTruthy()

    const res = await agent
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(holiday.id),
        from_date: '2026-08-10',
        to_date: '2026-08-10',
        from_date_part: '1',
        to_date_part: '1',
        reason: 'Vitest integration',
        increment_type: 'day'
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const leaves = await prisma.leaves.findMany({
      where: { user_id: user.id },
      orderBy: { id: 'desc' },
      take: 3
    })
    expect(leaves.length).toBeGreaterThan(0)
    expect(leaves[0].leave_type_id).toBe(holiday.id)
  })
})
