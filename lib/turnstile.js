'use strict'

const rp = require('request-promise')
const config = require('./config')

/**
 * Verify Cloudflare Turnstile token
 * @param {string} token - The token from the client-side Turnstile widget
 * @param {string} remoteip - Optional IP address of the user
 * @returns {Promise<Object>} - Verification result
 */
async function verifyTurnstileToken(token, remoteip = null) {
  if (!token) {
    return { success: false, error: 'No token provided' }
  }

  const secretKey = config.get('turnstile:secret_key')
  if (!secretKey) {
    console.error('Turnstile secret key not configured')
    return { success: false, error: 'Turnstile not configured' }
  }

  try {
    const formData = {
      secret: secretKey,
      response: token
    }

    if (remoteip) {
      formData.remoteip = remoteip
    }

    const response = await rp({
      method: 'POST',
      url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      form: formData,
      json: true,
      timeout: 10000 // 10 second timeout
    })

    return {
      success: response.success === true,
      error: response.success === false ? (response['error-codes'] || ['unknown_error']).join(', ') : null,
      challenge_ts: response['challenge_ts'],
      hostname: response.hostname
    }
  } catch (error) {
    console.error('Turnstile verification error:', error)
    return { success: false, error: 'Verification request failed' }
  }
}

module.exports = {
  verifyTurnstileToken
}