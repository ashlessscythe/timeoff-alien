'use strict'

const crypto = require('crypto')

function hashify_password(password) {
  const crypto_secret = process.env.CRYPTO_SECRET || 'uhoh,youshouldreallysetthis'
  return crypto
    .createHash('md5')
    .update(password + crypto_secret, 'binary')
    .digest('hex')
}

function verify_password(password, hashed_password) {
  const crypto_secret = process.env.CRYPTO_SECRET || 'uhoh,youshouldreallysetthis'
  const hash = crypto
    .createHash('md5')
    .update(password + crypto_secret, 'binary')
    .digest('hex')
  return hash === hashed_password
}

module.exports = {
  hashify_password,
  verify_password
}
