import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin, bookLeave } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('bookleave dedupe window', () => {
  it('does not create a second row when the same booking is POSTed twice in quick succession', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    expect(holiday).toBeTruthy()

    const before = await prisma.leaves.count({ where: { user_id: user.id } })
    const opts = {
      leaveTypeId: holiday.id,
      fromDate: '2026-11-02',
      toDate: '2026-11-02',
      reason: 'dedupe-twice'
    }
    await bookLeave(agent, opts)
    await bookLeave(agent, opts)
    const after = await prisma.leaves.count({ where: { user_id: user.id } })
    expect(after).toBe(before + 1)
  })
})
