import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import {
  createAgent,
  registerCompanyAndAdmin,
  logout
} from '../support/http.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const config = require('../../lib/config.js')
const Email = require('../../lib/email.js')

/**
 * Captures outbound mail payloads after get_send_email normalizes `from`
 * via email:smtp:from (SMTP_FROM). Works with SEND_EMAIL=false (CI default):
 * the no-op sender still runs withConfiguredFrom and invokes _testMailCapture.
 */
function setSmtpFrom(value) {
  // nconf.set() does not reliably override nested defaults here.
  config.stores.defaults.store.email.smtp.from = value
}

describe('outbound email from address (#32)', () => {
  const expectedFrom = 'CI From <ci-smtp-from@example.com>'
  let previousFrom
  let captured

  beforeEach(() => {
    previousFrom = config.get('email:smtp:from')
    setSmtpFrom(expectedFrom)
    captured = []
    Email._testMailCapture = mail => {
      captured.push(mail)
    }
  })

  afterEach(() => {
    Email._testMailCapture = null
    setSmtpFrom(previousFrom)
  })

  it('registration email uses configured SMTP_FROM as from (header/envelope source)', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)

    const registrationMails = captured.filter(
      m =>
        m &&
        m.to === email &&
        m.subject &&
        /registration/i.test(String(m.subject))
    )
    expect(registrationMails.length).toBeGreaterThanOrEqual(1)
    for (const mail of registrationMails) {
      expect(mail.from).toBe(expectedFrom)
      expect(mail.from).toBeTruthy()
      // Nodemailer uses `from` for both From header and envelope MAIL FROM
      // unless `envelope` is set separately — we must not set a blank envelope.
      expect(mail.envelope).toBeUndefined()
    }
  })

  it('forgot-password email uses configured SMTP_FROM (not blank sender)', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    await logout(agent)

    captured.length = 0

    const res = await agent
      .post('/forgot-password/')
      .type('form')
      .send({ email })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const resetMails = captured.filter(
      m =>
        m &&
        m.to === email &&
        m.subject &&
        /reset|password/i.test(String(m.subject))
    )
    expect(resetMails.length).toBeGreaterThanOrEqual(1)
    for (const mail of resetMails) {
      expect(mail.from).toBe(expectedFrom)
      expect(String(mail.from).trim().length).toBeGreaterThan(0)
      expect(mail.envelope).toBeUndefined()
    }
  })

  it('no captured outbound mail has a blank or undefined from', async () => {
    const agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    await logout(agent)
    await agent
      .post('/forgot-password/')
      .type('form')
      .send({ email })
      .redirects(5)

    expect(captured.length).toBeGreaterThan(0)
    for (const mail of captured) {
      expect(mail.from, JSON.stringify(mail)).toBeTruthy()
      expect(String(mail.from).trim()).not.toBe('')
      expect(String(mail.from).trim()).not.toBe('<>')
    }
  })
})
