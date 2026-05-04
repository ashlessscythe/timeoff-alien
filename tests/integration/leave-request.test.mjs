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

    const leaveComment = await prisma.comments.findFirst({
      where: { entity_type: 'LEAVE', entity_id: leaves[0].id }
    })
    expect(leaveComment?.comment).toBe('Vitest integration')
  })

  it('books leave without reason and does not create a LEAVE comment row', async () => {
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
        from_date: '2026-08-11',
        to_date: '2026-08-11',
        from_date_part: '1',
        to_date_part: '1',
        increment_type: 'day'
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const leave = await prisma.leaves.findFirst({
      where: { user_id: user.id },
      orderBy: { id: 'desc' }
    })
    expect(leave).toBeTruthy()

    const leaveComment = await prisma.comments.findFirst({
      where: { entity_type: 'LEAVE', entity_id: leave.id }
    })
    expect(leaveComment).toBeNull()
  })

  // Regression: new-request emails must await `record_email_addressed_to_me` before
  // `send_mail` and bookleave must await the email promise so audits exist after POST.
  it('records email_audits for new leave request emails before bookleave finishes', async () => {
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

    // Admin is department manager, so new-request emails go to the same user twice
    // (supervisor copy + requestor copy). Both must be in email_audits when the POST
    // completes — regress if audit writes are not awaited before redirect.
    const auditsBefore = await prisma.email_audits.count({
      where: { company_id: user.company_id, user_id: user.id }
    })

    const res = await agent
      .post('/calendar/bookleave/')
      .type('form')
      .send({
        leave_type: String(holiday.id),
        from_date: '2026-09-02',
        to_date: '2026-09-02',
        from_date_part: '1',
        to_date_part: '1',
        reason: 'Vitest email audit',
        increment_type: 'day'
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const auditsAfter = await prisma.email_audits.count({
      where: { company_id: user.company_id, user_id: user.id }
    })

    expect(auditsAfter - auditsBefore).toBeGreaterThanOrEqual(2)

    const newest = await prisma.email_audits.findMany({
      where: { company_id: user.company_id, user_id: user.id },
      orderBy: { id: 'desc' },
      take: 5
    })
    const subjects = newest.map(a => a.subject).join(' ')
    expect(subjects).toMatch(/Leave Request|new leave was added/i)
  })
})
