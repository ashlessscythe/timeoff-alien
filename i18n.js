const i18n = require('i18n')
const path = require('path')

i18n.configure({
  locales: ['en', 'es'], // Add the languages you want to support
  directory: path.join(__dirname, 'locales'),
  defaultLocale: 'en',
  cookie: 'lang', // Name of the cookie to store the language preference
  queryParameter: 'lang', // Query parameter to change the language
  autoReload: true,
  syncFiles: true,
  objectNotation: true
})

module.exports = i18n
