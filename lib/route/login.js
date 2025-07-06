/*
 *  Contain handlers for dealing with user account:
 *      - login
 *      - logout
 *      - register
 *      - forget password
 *
 *  Module exports FUNCTION that create a router object,
 *  not the router itself!
 *  Exported function gets passport object.
 * */
'use strict'

const validator = require('validator')
const Promise = require('bluebird')
const fs = require('fs')
const config = require('../config')
const bcrypt = require('bcrypt')
const commonPasswords = require('../util/common-passwords')
const { verifyTurnstileToken } = require('../turnstile')

// Function to check if a password is in the common passwords list
function isCommonPassword(password) {
  return commonPasswords.includes(password.toLowerCase())
}
const moment_tz = require('moment-timezone')
const EmailTransport = require('../email')
const SlackTransport = require('../slack')
const env_var = process.env

const multer = require('multer')
const upload = multer()

Promise.promisifyAll(fs)

// Helper function to safely add flash messages
function safeFlashMessage(req, message) {
  if (typeof req.session.flash_message === 'function') {
    req.session.flash_message(message)
  } else {
    // Create flash message directly
    if (!req.session.flash) {
      req.session.flash = {}
    }
    if (!Array.isArray(req.session.flash.messages)) {
      req.session.flash.messages = []
    }
    req.session.flash.messages.push(message)
  }
}

// Helper function to safely add flash errors
function safeFlashError(req, message) {
  if (typeof req.session.flash_error === 'function') {
    req.session.flash_error(message)
  } else {
    // Create flash error directly
    if (!req.session.flash) {
      req.session.flash = {}
    }
    if (!Array.isArray(req.session.flash.errors)) {
      req.session.flash.errors = []
    }
    req.session.flash.errors.push(message)
  }
}

function get_contact_email_address_for_anonymous_session(req) {
  return process.env.CONTACT_EMAIL_ADDRESS || config.get('contact:email')
}

function get_url_to_site_root_for_anonymous_session(req) {
  return req.get('host').indexOf('app.timeoff') < 0
    ? '/'
    : config.get('branding:website')
}

/**
 * Determines if registration is allowed based on environment and configuration settings.
 *
 * @returns {boolean} True if registration is allowed, false otherwise.
 */
function isRegistrationAllowed() {
  const envRegOption = process.env.OPTION_ALLOW_NEW_REGISTRATIONS
  console.log(
    'Environment variable OPTION_ALLOW_NEW_REGISTRATIONS: ' + envRegOption
  )

  // First priority to the environment variable if it's explicitly set to 'true' or 'false'
  if (envRegOption === 'true') {
    return true
  } else if (envRegOption === 'false') {
    return false
  }

  // Next, check the application configuration
  const configRegOption = config.get('options:registration')
  return JSON.parse(configRegOption || 'false')
}

module.exports = function (passport) {
  const express = require('express')
  const router = express.Router()

  router.get('/login', (req, res) => {
    // Add Turnstile script if configured
    const siteKey = config.get('turnstile:site_key')
    if (siteKey) {
      res.locals.custom_java_script.push('https://challenges.cloudflare.com/turnstile/v0/api.js')
    }

    res.render('login', {
      login: config.get('login') || { default: true },
      allow_create_new_accounts: isRegistrationAllowed(),
      title: 'Login  | TimeOff',
      url_to_the_site_root: get_url_to_site_root_for_anonymous_session(req),
      contact_email_address: get_contact_email_address_for_anonymous_session(
        req
      ),
      show_public_banner: env_var.SHOW_PUBLIC_BANNER === 'true',
      public_banner_message: env_var.PUBLIC_BANNER_MESSAGE,
      public_message_bg: env_var.PUBLIC_MESSAGE_BG,
      public_message_font: env_var.PUBLIC_MESSAGE_FONT,
      turnstile_site_key: siteKey
    })
  })

  router.get(
    '/auth/google',
    passport.authenticate('google', { scope: ['email'] })
  )

  router.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      // Successful authentication, redirect home.
      res.redirect('/')
    }
  )

  router.post('/login', async (req, res, next) => {
    // Verify Turnstile token if configured
    const siteKey = config.get('turnstile:site_key')
    if (siteKey) {
      const turnstileToken = req.body['cf-turnstile-response']
      if (!turnstileToken) {
        safeFlashError(req, 'Please complete the security check')
        return res.redirect_with_session('/login')
      }

      const verificationResult = await verifyTurnstileToken(
        turnstileToken,
        req.ip
      )

      if (!verificationResult.success) {
        console.error('Turnstile verification failed:', verificationResult.error)
        safeFlashError(req, 'Security check failed. Please try again.')
        return res.redirect_with_session('/login')
      }
    }

    passport.authenticate('local', (err, user) => {
      if (err) {
        return next(err)
      }

      if (!user) {
        safeFlashError(req, 'Incorrect credentials')
        return res.redirect_with_session('/login')
      }

      req.logIn(user, err => {
        if (err) {
          return next(err)
        }

        safeFlashMessage(req, 'Welcome back ' + user.name + '!')
        return res.redirect_with_session('/')
      })
    })(req, res, next)
  })

  router.get('/logout', (req, res, next) => {
    // Maybe this check is redundant but to be on safe side lets do it
    if (!req.user) {
      return res.redirect_with_session(303, '/')
    }

    req.logout(function (err) {
      if (err) {
        return next(err)
      }
      return res.redirect_with_session(res.locals.url_to_the_site_root)
    })
  })

  router.get('/register', (req, res) => {
    // Initialize allow_reg based on the environment variable or configuration setting
    const allow_reg = isRegistrationAllowed()

    if (!allow_reg) {
      return res.redirect_with_session(res.locals.url_to_the_site_root)
    }

    console.log('Allowing new registrations: ' + allow_reg)

    // There is no need to register new accounts when user alreeady login
    if (req.user) {
      return res.redirect_with_session(303, '/')
    }

    // map country codes to country names
    const countryNameList = config.get('countries')

    if (allow_reg) {
      // Add Turnstile script if configured
      const siteKey = config.get('turnstile:site_key')
      if (siteKey) {
        res.locals.custom_java_script.push('https://challenges.cloudflare.com/turnstile/v0/api.js')
      }

      res.render('register', {
        url_to_the_site_root: get_url_to_site_root_for_anonymous_session(req),
        countries: countryNameList,
        timezones_available: moment_tz.tz.names(),
        title: 'Register new company | TimeOff',
        turnstile_site_key: siteKey
      })
    }
  })

  router.post('/register', async (req, res) => {
    // There is no need to register new accounts when user already login
    // (just to prevent people to mess around)
    if (req.user) {
      return res.redirect_with_session(303, '/')
    }

    // Verify Turnstile token if configured
    const siteKey = config.get('turnstile:site_key')
    if (siteKey) {
      const turnstileToken = req.body['cf-turnstile-response']
      if (!turnstileToken) {
        safeFlashError(req, 'Please complete the security check')
        return res.redirect_with_session('/register/')
      }

      const verificationResult = await verifyTurnstileToken(
        turnstileToken,
        req.ip
      )

      if (!verificationResult.success) {
        console.error('Turnstile verification failed:', verificationResult.error)
        safeFlashError(req, 'Security check failed. Please try again.')
        return res.redirect_with_session('/register/')
      }
    }

    // TODO at some point we need to unified form validation code
    // and make it reusable

    const email = req.body.email
    if (!email) {
      safeFlashError(req, 'Email was not provided')
    } else if (!validator.isEmail(email)) {
      safeFlashError(req, 'Email address is invalid')
    }

    const name = req.body.name

    const slack_username = req.body.slack_username || ''
    /* Slack username is not mandatory.
    if (!slack_username) {
      safeFlashError(req, 'Slack username was not specified')
    }
    */

    if (!name) {
      safeFlashError(req, 'Name was not specified')
    }

    const lastname = req.body.lastname
    if (!lastname) {
      safeFlashError(req, 'Last name was not specified')
    }

    const company_name = req.body.company_name

    const password = req.body.password
    if (!password) {
      safeFlashError(req, 'Password could not be blank')
    } else if (password !== req.body.password_confirmed) {
      safeFlashError(req, 'Confirmed password does not match initial one')
    } else if (
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      safeFlashError(
        req,
        'Password must be between ' +
        PASSWORD_MIN_LENGTH +
        ' and ' +
        PASSWORD_MAX_LENGTH +
        ' characters long'
      )
    } else if (!validator.matches(password, PASSWORD_REGEX)) {
      safeFlashError(
        req,
        'Password must be between 12-128 characters long with no spaces. All other characters are allowed.'
      )
    } else if (isCommonPassword(password)) {
      safeFlashError(
        req,
        'This password is too common. Please choose a unique password.'
      )
    }

    const country_code = req.body.country
    if (!validator.matches(country_code, /^[a-z]{2}/i)) {
      safeFlashError(req, 'Incorrect country code')
    }

    const timezone = validator.trim(req.body.timezone)
    if (!moment_tz.tz.names().find(tz_str => tz_str === timezone)) {
      safeFlashError(req, 'Time zone is unknown')
    }

    // In case of validation error redirect back to registration form
    if (req.session.flash_has_errors()) {
      return res.redirect_with_session('/register/')
    }

    // Try to create new record of user
    console.log(
      'Registering new user',
      email,
      slack_username,
      name,
      lastname,
      company_name,
      country_code,
      timezone
    )
    req.app
      .get('db_model')
      .User.register_new_admin_user({
        email: email.toLowerCase(),
        slack_username: slack_username.toLowerCase(),
        password,
        name,
        lastname,
        company_name,
        country_code,
        timezone
      })
      // Send registration email
      .then(user => {
        console.log('Sending registration email to ' + user.email)

        const email = new EmailTransport()

        return (
          email
            .promise_registration_email({
              user
            })
            .then(() => Promise.resolve(user))
            // Fail silently for the user and track the error for the administrator.
            .catch(error => {
              console.error(
                'Failed to send registration email to ' +
                user.email +
                ' : ' +
                error,
                error.stack
              )
              return Promise.resolve(user)
            })
        )
      })
      .then(user => {
        console.log('Sending Slack notification to ' + user.email)

        const Slack = new SlackTransport()

        return (
          Slack.promise_registration_slack({
            user
          })
            .then(() => Promise.resolve(user))
            // Fail silently for the user and track the error for the administrator.
            .catch(error => {
              console.error(
                'Failed to send slack notification to ' +
                user.email +
                ' : ' +
                error,
                error.stack
              )
              return Promise.resolve(user)
            })
        )
      })
      .then(user => {
        console.log('Authenticated the newly created user ' + user.email)

        // Login newly created user
        req.logIn(user, err => {
          if (err) {
            console.error(err)
            return
          }

          safeFlashMessage(req, 'Registration is complete.')
          return res.redirect_with_session('/')
        })
      })
      .catch(error => {
        console.error(
          'An error occurred when trying to register new user ' +
          email +
          ' : ' +
          error,
          error.stack
        )

        safeFlashError(
          req,
          'Failed to register user please contact customer service.' +
          (error.show_to_user ? ' ' + error : '')
        )

        return res.redirect_with_session('/register/')
      })
  })

  router.get('/forgot-password/', (req, res) => {
    // Add Turnstile script if configured
    const siteKey = config.get('turnstile:site_key')
    if (siteKey) {
      res.locals.custom_java_script.push('https://challenges.cloudflare.com/turnstile/v0/api.js')
    }

    res.render('forgot_password', {
      url_to_the_site_root: get_url_to_site_root_for_anonymous_session(req),
      title: 'Forgotten password | TimeOff',
      turnstile_site_key: siteKey
    })
  })

  router.post('/forgot-password/', async (req, res) => {
    // Verify Turnstile token if configured
    const siteKey = config.get('turnstile:site_key')
    if (siteKey) {
      const turnstileToken = req.body['cf-turnstile-response']
      if (!turnstileToken) {
        safeFlashError(req, 'Please complete the security check')
        return res.redirect_with_session('./')
      }

      const verificationResult = await verifyTurnstileToken(
        turnstileToken,
        req.ip
      )

      if (!verificationResult.success) {
        console.error('Turnstile verification failed:', verificationResult.error)
        safeFlashError(req, 'Security check failed. Please try again.')
        return res.redirect_with_session('./')
      }
    }

    let email = req.body.email

    if (!email) {
      safeFlashError(req, 'Email was not provided')
    } else if (!validator.isEmail(email)) {
      safeFlashError(req, 'Email address is invalid')
    }

    // In case of validation error redirect back to forgot password form
    if (req.session.flash_has_errors()) {
      return res.redirect_with_session('./')
    }

    const success_msg = 'Please check your email box for further instructions'

    // Normalize email address: system operates only in low cased emails
    email = email.toLowerCase()

    req.app
      .get('db_model')
      .User.find_by_email(email)
      .then(user => {
        if (!user) {
          safeFlashMessage(req, success_msg)

          const error = new Error('')
          error.do_not_report = true
          throw error
        }

        return Promise.resolve(user)
      })
      .then(user => {
        const Slack = new SlackTransport()

        Slack.promise_forgot_password_slack({
          user
        })

        const Email = new EmailTransport()

        // Generate the reset token and then send the email
        return user.get_reset_password_token().then(token => {
          return user
            .getCompany()
            .then(company => {
              return Email.promise_rendered_email_template({
                template_name: 'forgot_password',
                context: {
                  user,
                  company,
                  token
                }
              })
            })
            .then(email_obj => {
              return Email.get_send_email()({
                from: config.get('email:from'),
                to: user.email,
                subject: email_obj.subject,
                html: email_obj.body
              }).then(send_results => {
                return user
                  .record_email_addressed_to_me(email_obj)
                  .then(() => Promise.resolve(send_results))
              })
            })
        })
      })
      .then(() => {
        safeFlashMessage(req, success_msg)
        return res.redirect_with_session('./')
      })
      .catch(error => {
        if (error.do_not_report) {
          return res.redirect_with_session('./')
        }

        console.error(
          'An error occurred while submittin forgot password form: ' + error,
          error.stack
        )
        safeFlashError(req, 'Failed to proceed with submitted data.')
        return res.redirect_with_session('./')
      })
  })

  router.get('/reset-password/', (req, res) => {
    const token = req.query.t

    if (!token) {
      safeFlashError(req, 'Invalid or missing reset password link.')
      return res.redirect_with_session('/forgot-password/')
    }

    req.app
      .get('db_model')
      .User.get_user_by_reset_password_token(token)
      .then(user => {
        if (!user) {
          safeFlashError(
            req,
            'Unknown reset password link, please submit request again'
          )
          return res.redirect_with_session('/forgot-password/')
        }

        // Add Turnstile script if configured
        const siteKey = config.get('turnstile:site_key')
        if (siteKey) {
          res.locals.custom_java_script.push('https://challenges.cloudflare.com/turnstile/v0/api.js')
        }

        res.render('reset_password', {
          url_to_the_site_root: get_url_to_site_root_for_anonymous_session(req),
          token,
          title: 'Reset password | TimeOff',
          turnstile_site_key: siteKey
        })
      })
      .catch(err => {
        console.error('Reset password error:', err)
        safeFlashError(req, 'Something went wrong. Please try again later')
        return res.redirect_with_session('/forgot-password/')
      })
  })

  // Password requirements following NIST guidelines
  const PASSWORD_MIN_LENGTH = 12
  const PASSWORD_MAX_LENGTH = 128
  const PASSWORD_REGEX = /^[^\s]{12,128}$/
  // Not using complexity rules per NIST SP 800-63B guidelines
  // Instead focusing on length and basic character restrictions

  router.post('/reset-password/', async (req, res) => {
    const token = req.body.t
    const password = req.body.password
    const confirm_password = req.body.confirm_password

    // Verify Turnstile token if configured
    const siteKey = config.get('turnstile:site_key')
    if (siteKey) {
      const turnstileToken = req.body['cf-turnstile-response']
      if (!turnstileToken) {
        safeFlashError(req, 'Please complete the security check')
        return res.redirect_with_session('/reset-password/?t=' + token)
      }

      const verificationResult = await verifyTurnstileToken(
        turnstileToken,
        req.ip
      )

      if (!verificationResult.success) {
        console.error('Turnstile verification failed:', verificationResult.error)
        safeFlashError(req, 'Security check failed. Please try again.')
        return res.redirect_with_session('/reset-password/?t=' + token)
      }
    }

    // check if match
    if (password !== confirm_password) {
      safeFlashError(req, 'Confirmed password does not match password')
      return res.redirect_with_session('/reset-password/?t=' + token)
    }

    // Check password length
    if (
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      safeFlashError(
        req,
        'Password must be between ' +
        PASSWORD_MIN_LENGTH +
        ' and ' +
        PASSWORD_MAX_LENGTH +
        ' characters long'
      )
      return res.redirect_with_session('/reset-password/?t=' + token)
    }

    // Check for basic character restrictions (no whitespace)
    if (!validator.matches(password, PASSWORD_REGEX)) {
      console.log('Password validation failed')
      safeFlashError(
        req,
        'Password must be between 12-128 characters long with no spaces. All other characters are allowed.'
      )
      return res.redirect_with_session('/reset-password/?t=' + token)
    }

    // Check against common passwords
    if (isCommonPassword(password)) {
      safeFlashError(
        req,
        'This password is too common. Please choose a unique password.'
      )
      return res.redirect_with_session('/reset-password/?t=' + token)
    }

    req.app
      .get('db_model')
      .User.get_user_by_reset_password_token(token)
      .then(user => {
        if (!user) {
          safeFlashError(
            req,
            'Unknown reset password link, please submit request again'
          )
          return res.redirect_with_session('/forgot-password/')
        }

        return Promise.resolve(user)
      })
      .then(user => {
        if (!user) {
          safeFlashError(req, 'Invalid or expired reset token.')
          return res.redirect_with_session('/forgot-password/')
        }

        user.password = req.app.get('db_model').User.hashify_password(password)
        // Clear the reset token and expiration
        user.reset_password_token = null
        user.reset_password_expires = null
        return user.save()
      })
      .then(user => {
        const Slack = new SlackTransport()

        Slack.promise_reset_password_slack({
          user
        })

        const Email = new EmailTransport()

        return Email.promise_reset_password_email({
          user
        })
      })
      .then(() => {
        safeFlashMessage(req, 'Please use new password to login into system')
        return res.redirect_with_session('/login/')
      })
      .catch(err => {
        console.error('Reset password error:', err)
        safeFlashError(req, 'Something went wrong. Please try again later')
        return res.redirect_with_session('/forgot-password/')
      })
  })

  router.post('/import-company/', upload.single('company_dump'), (req, res) =>
    Promise.resolve()
      .then(() => {
        console.log('req.file', req.file)

        if (req.file.size === 0) {
          throw new Error('No dump file to restore from was provided')
        }

        if (req.file.path && !req.file.buffer) {
          // disk storage
          return fs.readFileAsync(req.file.path, 'utf8')
        }

        // memory storage
        return req.file.buffer.toString()
      })
      .then(dump_json => Promise.resolve(JSON.parse(dump_json)))
      .then(raw_company_obj =>
        req.app.get('db_model').Company.restore_from_dump({
          dump_json: raw_company_obj
        })
      )
      .then(company => {
        safeFlashMessage(req, 'Company ' + company.name + ' was restored')
        res.redirect_with_session('/import-company/')
      })
      .catch(error => {
        safeFlashError(
          req,
          'Failed to import company, due to error: ' + error,
          error.stack
        )
        res.redirect_with_session('/import-company/')
      })
  )

  router.get('/import-company/', (req, res) => {
    res.render('import_company', {
      url_to_the_site_root: get_url_to_site_root_for_anonymous_session(req),
      title: 'Import company | TimeOff'
    })
  })

  return router
}
