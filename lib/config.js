'use strict'

const nconf = require('nconf')
const SEND_EMAIL = process.env.SEND_EMAIL || 'false'

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
      url: 'http://app.timeoff.management',
      website: 'http://timeoff.management'
    },
    crypto_secret: '!2~`HswpPPLa22+=±§sdq qwe,appp qwwokDF_',
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
      secret: 'my dirty secret ;khjsdkjahsdajhasdam,nnsnad,',
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
