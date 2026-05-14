'use strict'

const express = require('express')
const crypto = require('crypto')
const validator = require('validator')
const moment = require('moment')
const router = express.Router()
const { User } = require('../model/sessionUser')
const { getAuditCaptureForUser } = require('../model/audit')
const EmailTransport = require('../email')
const config = require('../config')

const EMAIL_CHANGE_TOKEN_BYTES = 8
const EMAIL_CHANGE_EXPIRY_HOURS = 24
const SESSION_EMAIL_JUST_UPDATED = 'me_email_just_updated'

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

router.all(/.*/, (req, res, next) => {
  if (!req.user) {
    return res.redirect_with_session(303, '/')
  }
  next()
})

router.get('/', (req, res) => {
  const emailJustUpdated = !!req.session[SESSION_EMAIL_JUST_UPDATED]
  if (emailJustUpdated) {
    delete req.session[SESSION_EMAIL_JUST_UPDATED]
  }
  res.render('me/index', {
    title: 'My profile | TimeOff',
    email_just_updated: emailJustUpdated
  })
})

router.post('/email/cancel', async (req, res) => {
  if (req.user.company && req.user.company.ldap_auth_enabled) {
    return res.redirect_with_session('/me/')
  }
  try {
    await req.user.update({
      pending_email: null,
      email_change_token: null,
      email_change_expires: null
    })
    req.session.flash_message('Pending email change was cancelled.')
  } catch (err) {
    console.error('POST /me/email/cancel failed', err)
    req.session.flash_error('Could not cancel. Please try again.')
  }
  return res.redirect_with_session('/me/')
})

router.post('/email', async (req, res) => {
  if (req.user.company && req.user.company.ldap_auth_enabled) {
    req.session.flash_error(
      'Email cannot be changed here while your company uses LDAP sign-in.'
    )
    return res.redirect_with_session('/me/')
  }

  const raw = validator.trim(
    String(req.body.email_address || req.body.email || '')
  )
  if (!raw || !validator.isEmail(raw)) {
    req.session.flash_error('Please enter a valid email address.')
    return res.redirect_with_session('/me/')
  }

  const newEmail = raw.toLowerCase()
  const currentEmail =
    (req.user.email && String(req.user.email).toLowerCase()) || ''
  if (newEmail === currentEmail) {
    req.session.flash_message('Email is unchanged.')
    return res.redirect_with_session('/me/')
  }

  try {
    const existing = await User.find_by_email(newEmail)
    if (existing && existing.id !== req.user.id) {
      req.session.flash_error('That email address is already in use.')
      return res.redirect_with_session('/me/')
    }

    const verificationCode = crypto
      .randomBytes(EMAIL_CHANGE_TOKEN_BYTES)
      .toString('hex')
    const expiresAt = moment()
      .add(EMAIL_CHANGE_EXPIRY_HOURS, 'hours')
      .toDate()

    await req.user.update({
      pending_email: newEmail,
      email_change_token: verificationCode,
      email_change_expires: expiresAt
    })

    const company = await req.user.getCompany()
    const Email = new EmailTransport()
    const emailObj = await Email.promise_rendered_email_template({
      template_name: 'verify_email_change',
      context: {
        user: req.user,
        company,
        pending_email: newEmail,
        verification_code: verificationCode
      }
    })

    await Email.get_send_email()({
      from: config.get('email:from'),
      to: newEmail,
      subject: emailObj.subject,
      html: emailObj.body
    })

    await req.user.record_email_addressed_to_me(emailObj, {
      recipientEmail: newEmail
    })

    req.session.flash_message(
      `We sent a verification code to ${newEmail}. Enter it below to confirm your new email.`
    )
  } catch (err) {
    console.error('POST /me/email failed', err)
    try {
      await req.user.update({
        pending_email: null,
        email_change_token: null,
        email_change_expires: null
      })
    } catch (clearErr) {
      console.error('Failed to clear pending email after error', clearErr)
    }
    req.session.flash_error(
      'Could not send verification email. Check the address and try again.'
    )
  }

  return res.redirect_with_session('/me/')
})

router.post('/email/confirm', async (req, res) => {
  if (req.user.company && req.user.company.ldap_auth_enabled) {
    req.session.flash_error(
      'Email cannot be changed here while your company uses LDAP sign-in.'
    )
    return res.redirect_with_session('/me/')
  }

  const submitted = validator
    .trim(String(req.body.verification_code || ''))
    .toLowerCase()
  const pending = req.user.pending_email
    ? String(req.user.pending_email).toLowerCase()
    : ''
  const expected = req.user.email_change_token
    ? String(req.user.email_change_token).toLowerCase()
    : ''
  const expires = req.user.email_change_expires

  if (!pending || !expected || !expires) {
    req.session.flash_error('There is no pending email change to confirm.')
    return res.redirect_with_session('/me/')
  }

  if (moment.utc(expires).isBefore(moment.utc())) {
    await req.user.update({
      pending_email: null,
      email_change_token: null,
      email_change_expires: null
    })
    req.session.flash_error('That verification code has expired. Request a new email change.')
    return res.redirect_with_session('/me/')
  }

  if (!timingSafeEqualStrings(submitted, expected)) {
    req.session.flash_error('Invalid verification code. Try again.')
    return res.redirect_with_session('/me/')
  }

  try {
    const existing = await User.find_by_email(pending)
    if (existing && existing.id !== req.user.id) {
      await req.user.update({
        pending_email: null,
        email_change_token: null,
        email_change_expires: null
      })
      req.session.flash_error(
        'That email address is no longer available. Request a new change.'
      )
      return res.redirect_with_session('/me/')
    }

    const forUserPlain = req.user.get({ plain: true })
    const captureAuditTrail = getAuditCaptureForUser({
      byUser: req.user,
      forUser: forUserPlain,
      newAttributes: { email: pending }
    })

    await req.user.update({
      email: pending,
      pending_email: null,
      email_change_token: null,
      email_change_expires: null
    })
    await captureAuditTrail()

    req.session.flash_message('Your email address was updated.')
    req.session[SESSION_EMAIL_JUST_UPDATED] = true
  } catch (err) {
    console.error('POST /me/email/confirm failed', err)
    req.session.flash_error('Could not confirm email. Please try again.')
  }

  return res.redirect_with_session('/me/')
})

module.exports = router
