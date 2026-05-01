import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const commonPasswords = require('../../lib/util/common-passwords.js')

describe('common-passwords list', () => {
  it('includes known weak passwords', () => {
    expect(commonPasswords).toContain('password')
    expect(commonPasswords).toContain('qwerty')
  })

  it('does not include our test password', () => {
    expect(commonPasswords).not.toContain('TestPassword!12')
  })
})
