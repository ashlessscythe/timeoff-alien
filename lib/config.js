'use strict'

const nconf = require('nconf')
const SEND_EMAIL = process.env.SEND_EMAIL || 'false'
const BRANDING_URL = process.env.BRANDING_URL || 'https://timeoff.management'
const BRANDING_WEBSITE =
  process.env.BRANDING_WEBSITE || 'https://timeoff.management'
const CRYPTO_SECRET = process.env.CRYPTO_SECRET || 'uhoh,youshouldreallysetthis'
const SESSION_SECRET = process.env.SESSION_SECRET || 'reallydod,setthis'

nconf
  .argv()
  .env({
    separator: '_',
    lowerCase: true,
    parseValues: true,
    transform: function(obj) {
      if (obj.key === 'GOOGLE_AUTH_DOMAINS') {
        obj.value = obj.value.split(',')
      }
      return obj
    }
  })
  .file('localisation', { file: __dirname + '/../config/localisation.json' })
  .file({ file: __dirname + '/../config/app.json' })
  .defaults({
    branding: {
      url: BRANDING_URL,
      website: BRANDING_WEBSITE
    },
    crypto_secret: CRYPTO_SECRET,
    login: {
      default: true,
      google: false
    },
    send_email: SEND_EMAIL,
    smtp: {
      host: 'localhost',
      port: 25,
      from: 'email@test.com',
      auth: {
        user: '',
        pass: '',
        required: true
      }
    },
    sessions: {
      secret: SESSION_SECRET,
      store: 'sequelize',
      redis: {
        host: 'localhost',
        port: 6379
      }
    },
    google: {
      analytics: {
        tracker: ''
      },
      auth: {
        clientId: '',
        clientSecret: '',
        domains: []
      }
    },
    slack: {
      token: '',
      icon_url: '',
      bot_name: ''
    },
    options: {
      registration: false
    },
    locale_code_for_sorting: 'en',
    force_to_explicitly_select_type_when_requesting_new_leave: false
  })

module.exports = nconf
