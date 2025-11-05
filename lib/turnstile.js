'use strict'

const axios = require('axios')
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
    const formData = new URLSearchParams({
      secret: secretKey,
      response: token
    })

    if (remoteip) {
      formData.append('remoteip', remoteip)
    }

    const response = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000 // 10 second timeout
      }
    )

    return {
      success: response.data.success === true,
      error: response.data.success === false ? (response.data['error-codes'] || ['unknown_error']).join(', ') : null,
      challenge_ts: response.data['challenge_ts'],
      hostname: response.data.hostname
    }
  } catch (error) {
    console.error('Turnstile verification error:', error)
    return { success: false, error: 'Verification request failed' }
  }
}

module.exports = {
  verifyTurnstileToken
}