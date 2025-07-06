'use strict'

const nconf = require('nconf')
const SEND_EMAIL = process.env.SEND_EMAIL || 'false'
const BRANDING_URL = process.env.BRANDING_URL || 'https://timeoff.management'
const BRANDING_WEBSITE =
  process.env.BRANDING_WEBSITE || 'https://timeoff.management'
const SESSION_SECRET = process.env.SESSION_SECRET || 'reallydod,setthis'

nconf
  .argv()
  .env({
    separator: '_',
    lowerCase: true,
    parseValues: true,
    transform: function (obj) {
      if (obj.key === 'GOOGLE_AUTH_DOMAINS') {
        obj.value = obj.value.split(',')
      }
      return obj
    }
  })
  .defaults({
    branding: {
      url: BRANDING_URL,
      website: BRANDING_WEBSITE
    },
    login: {
      default: true,
      google: false
    },
    send_email: SEND_EMAIL,
    email: {
      smtp: {
        host: process.env.SMTP_HOST || 'localhost',
        port: process.env.SMTP_PORT || 25,
        from: process.env.SMTP_FROM || process.env.SMTP_AUTH_USER || '',
        requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
        auth: {
          user: process.env.SMTP_AUTH_USER || '',
          pass: process.env.SMTP_AUTH_PASS || '',
          required: process.env.SMTP_AUTH_REQUIRED !== 'false'
        }
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
    turnstile: {
      site_key: process.env.TURNSTILE_SITE_KEY || '',
      secret_key: process.env.TURNSTILE_SECRET_KEY || ''
    },
    options: {
      registration: false
    },
    locale_code_for_sorting: 'en',
    force_to_explicitly_select_type_when_requesting_new_leave: false,
    countries: {
      US: { name: 'United States' },
      GB: { name: 'United Kingdom' },
      DE: { name: 'Germany' },
      FR: { name: 'France' },
      ES: { name: 'Spain' },
      IT: { name: 'Italy' },
      MX: { name: 'Mexico' },
      CA: { name: 'Canada' },
      CN: { name: 'China' },
      JP: { name: 'Japan' },
      BR: { name: 'Brazil' },
      IN: { name: 'India' },
      AU: { name: 'Australia' }
    }
  })

module.exports = nconf
