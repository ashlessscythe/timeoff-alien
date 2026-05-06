import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')

function day(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

describe('allowance counting by leave status', () => {
  it('counts only approved and pended_revoke toward used days (rejected/canceled/new excluded)', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const user = await prisma.users.findFirst({ where: { email } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: user.company_id, name: 'Holiday' }
    })
    expect(holiday).toBeTruthy()

    await prisma.departments.update({
      where: { id: user.department_id },
      data: { allowance: 25, personal: 0, manager_id: user.id }
    })

    const base = {
      user_id: user.id,
      leave_type_id: holiday.id,
      approver_id: user.id,
      day_part_start: 1,
      day_part_end: 1,
      time_start: null,
      time_end: null,
      employee_comment: 'status-matrix',
      created_at: new Date(),
      updated_at: new Date()
    }

    const rows = [
      { status: leaveConstants.status_new(), date_start: day('2026-10-06'), date_end: day('2026-10-06') },
      { status: leaveConstants.status_approved(), date_start: day('2026-10-07'), date_end: day('2026-10-07') },
      { status: leaveConstants.status_rejected(), date_start: day('2026-10-08'), date_end: day('2026-10-08') },
      { status: leaveConstants.status_pended_revoke(), date_start: day('2026-10-09'), date_end: day('2026-10-09') },
      { status: leaveConstants.status_canceled(), date_start: day('2026-10-10'), date_end: day('2026-10-10') }
    ]

    for (const r of rows) {
      await prisma.leaves.create({
        data: Object.assign({}, base, r)
      })
    }

    const csv = await agent.get('/users/?as-csv=1').redirects(0)
    expect(csv.status).toBe(200)
    const lines = csv.text.trim().split('\n')
    const header = lines[0].split(',').map(s => s.replace(/^"|"$/g, ''))
    const idx = Object.fromEntries(header.map((k, i) => [k, i]))
    const row = lines.slice(1).find(line => {
      const cols = line.split(',').map(s => s.replace(/^"|"$/g, ''))
      return (cols[idx.email] || '').toLowerCase() === email.toLowerCase()
    })
    expect(row).toBeTruthy()
    const cols = row.split(',').map(s => s.replace(/^"|"$/g, ''))
    // "Used" should reflect only approved leave (pended_revoke is treated as approved),
    // while pending requests are shown separately as deducted/pending in the UI.
    expect(Number(cols[idx.days_used])).toBe(2)
    // Remaining allowance in the CSV reflects allowance AFTER deducting pending requests too.
    expect(Number(cols[idx.remaining_allowance])).toBe(22)
  })
})
