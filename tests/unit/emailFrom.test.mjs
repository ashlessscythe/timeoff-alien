import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const config = require('../../lib/config.js')
const {
  getConfiguredFromAddress,
  withConfiguredFrom
} = require('../../lib/email_from.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', '..')

function setSmtpFrom(value) {
  // nconf.set() does not reliably override nested defaults in this app's
  // argv/env/defaults stack; tests mutate the defaults store directly.
  config.stores.defaults.store.email.smtp.from = value
}

describe('email_from helper (#32)', () => {
  let previousFrom

  beforeEach(() => {
    previousFrom = config.get('email:smtp:from')
  })

  afterEach(() => {
    setSmtpFrom(previousFrom)
  })

  it('getConfiguredFromAddress returns trimmed email:smtp:from', () => {
    setSmtpFrom('  Unit From <unit-from@example.com>  ')
    expect(getConfiguredFromAddress()).toBe(
      'Unit From <unit-from@example.com>'
    )
  })

  it('withConfiguredFrom overwrites blank/undefined from with SMTP_FROM', () => {
    const expected = 'Unit From <unit-from@example.com>'
    setSmtpFrom(expected)

    const blank = withConfiguredFrom({
      from: undefined,
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>'
    })
    expect(blank.from).toBe(expected)
    expect(blank.to).toBe('user@example.com')

    const ignored = withConfiguredFrom({
      from: 'Wrong <wrong@example.com>',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>'
    })
    expect(ignored.from).toBe(expected)
  })

  it('withConfiguredFrom refuses blank sender when requireConfigured', () => {
    setSmtpFrom('')
    expect(() =>
      withConfiguredFrom(
        { to: 'user@example.com', subject: 'x', html: 'y' },
        { requireConfigured: true }
      )
    ).toThrow(/SMTP_FROM|email:smtp:from|blank sender/i)
  })

  it('withConfiguredFrom allows empty from when requireConfigured is false', () => {
    setSmtpFrom('')
    const payload = withConfiguredFrom(
      { to: 'user@example.com', subject: 'x', html: 'y', from: 'x' },
      { requireConfigured: false }
    )
    expect(payload.from).toBe('')
  })

  it('lib sources do not read the nonexistent email:from config key', () => {
    const files = [
      'lib/email.js',
      'lib/email_from.js',
      'lib/route/login.js',
      'lib/route/me.js',
      'lib/route/users/index.js'
    ]
    const bad = /(['"])email:from\1/
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      // Allow documentation that names the bad key; forbid config lookups.
      const lookup = /(?:get|config\.get)\(\s*(['"])email:from\1\s*\)/
      expect(src, rel).not.toMatch(lookup)
      // Also forbid bare string key usage in get() style leftovers
      if (rel !== 'lib/email_from.js') {
        expect(src, rel).not.toMatch(bad)
      }
    }
  })
})
