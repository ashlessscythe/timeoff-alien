'use strict'

/**
 * Single source of truth for the outbound email sender.
 *
 * Configured via SMTP_FROM → config key email:smtp:from (see lib/config.js).
 * Call sites must not use the nonexistent email:from key.
 */

const config = require('./config')

function getConfiguredFromAddress() {
  const from = config.get('email:smtp:from')
  if (from == null) {
    return ''
  }
  return String(from).trim()
}

/**
 * Ensure mail options use the configured SMTP_FROM for both the From header
 * and the SMTP envelope sender (nodemailer derives envelope from `from`
 * unless `envelope` is set separately).
 *
 * @param {object} mailOptions
 * @param {{ requireConfigured?: boolean }} [options]
 * @returns {object} shallow copy with `from` set
 */
function withConfiguredFrom(mailOptions, options = {}) {
  const requireConfigured = options.requireConfigured !== false
  const from = getConfiguredFromAddress()

  if (requireConfigured && !from) {
    throw new Error(
      'Outbound email requires SMTP_FROM (config email:smtp:from); refusing to send with a blank sender'
    )
  }

  return Object.assign({}, mailOptions, { from })
}

module.exports = {
  getConfiguredFromAddress,
  withConfiguredFrom
}
