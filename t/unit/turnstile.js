'use strict'

const expect = require('chai').expect
const { verifyTurnstileToken } = require('../../lib/turnstile')
const config = require('../../lib/config')

describe('Turnstile Integration', () => {
  describe('verifyTurnstileToken', () => {
    it('should return error when no token provided', async () => {
      const result = await verifyTurnstileToken()
      expect(result.success).to.be.false
      expect(result.error).to.equal('No token provided')
    })

    it('should return error when no secret key configured', async () => {
      // Temporarily clear the secret key
      const originalSecret = config.get('turnstile:secret_key')
      config.set('turnstile:secret_key', null)

      const result = await verifyTurnstileToken('test-token')
      expect(result.success).to.be.false
      expect(result.error).to.equal('Turnstile not configured')

      // Restore the original secret key
      config.set('turnstile:secret_key', originalSecret)
    })

    it('should handle invalid tokens gracefully', async () => {
      // This test assumes a valid secret key is configured
      const secretKey = config.get('turnstile:secret_key')
      if (!secretKey) {
        console.log('Skipping test - no Turnstile secret key configured')
        return
      }

      const result = await verifyTurnstileToken('invalid-token')
      expect(result.success).to.be.false
      expect(result.error).to.be.a('string')
    })
  })
})