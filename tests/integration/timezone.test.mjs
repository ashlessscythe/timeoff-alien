import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')

describe('registration timezone', () => {
  it('persists timezone and serves calendar for Asia/Tokyo and America/New_York', async () => {
    for (const tz of ['Asia/Tokyo', 'America/New_York']) {
      const agent = createAgent(app)
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await registerCompanyAndAdmin(agent, {
        email: `tz_${tz.replace(/\//g, '_')}_${suffix}@example.com`,
        companyName: `Vitest TZ ${suffix}`,
        timezone: tz
      })
      const row = await prisma.companies.findFirst({
        where: { name: `Vitest TZ ${suffix}` }
      })
      expect(row.timezone).toBe(tz)
      const cal = await agent.get('/calendar/').redirects(5)
      expect(cal.status).toBe(200)
    }
  })
})
