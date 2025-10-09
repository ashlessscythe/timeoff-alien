'use strict'

const bluebird = require('bluebird')
const _hbs = require('handlebars')
const {
  allowInsecurePrototypeAccess
} = require('@handlebars/allow-prototype-access')

const handlebars = require('express-handlebars').create({
  partialsDir: __dirname + '/../views/partials/',
  extname: '.hbs',
  helpers: require('./view/helpers')(),
  handlebars: allowInsecurePrototypeAccess(_hbs),
  runtimeOptions: {
    allowedProtoProperties: {
      full_name: true,
      name: true,
      get_leave_type_name: true,
      get_start_leave_day: true,
      get_end_leave_day: true,
      get_end_leave_day: true,
      ldap_auth_enabled: true,
      get_reset_password_token: true
    },
    allowedProtoMethods: {
      full_name: true,
      name: true,
      get_leave_type_name: true,
      get_start_leave_day: true,
      get_end_leave_day: true,
      get_end_leave_day: true,
      ldap_auth_enabled: true,
      get_reset_password_token: true
    }
  }
})

const config = require('./config')
const { Resend } = require('resend')
const nodemailer = require('nodemailer')
const model = require('./model/db')
const { getCommentsForLeave } = require('./model/comment')
const RateLimiter = require('./rate-limiter')

// Initialize rate limiter for Resend (1 request per second with max queue size)
const resendRateLimiter = new RateLimiter(1, { maxQueueSize: 100 })

function Email() {}

const send_email = config.get('send_email')
console.log('get_send_email: ', config.get('send_email'))

// Initialize email transport
let emailTransport

// Initialize the Resend transport if API key is available
function initializeResendTransport() {
  if (process.env.RESEND_API_KEY) {
    console.log('Using Resend for email delivery')
    emailTransport = {
      type: 'resend',
      client: new Resend(process.env.RESEND_API_KEY)
    }
    return true
  }
  return false
}

// Initialize the SMTP transport
function initializeSmtpTransport() {
  console.log('Using SMTP for email delivery')
  const smtpConfig = config.get('email:smtp')

  const transportConfig = {
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465, // true for port 465, false for other ports
    auth: smtpConfig.auth.required
      ? {
          user: smtpConfig.auth.user,
          pass: smtpConfig.auth.pass
        }
      : undefined,
    tls: {
      rejectUnauthorized: false // Allows self-signed certificates
    },
    // Add connection timeout settings
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000, // 10 seconds
    socketTimeout: 10000, // 10 seconds
    debug: true, // Enable debug logging
    logger: true // Enable logger
  }

  console.log(`smtp_config: ${JSON.stringify(smtpConfig)}`)
  emailTransport = {
    type: 'smtp',
    client: nodemailer.createTransport(transportConfig)
  }
  return true
}

// Initialize the email transport
function initializeEmailTransport() {
  // If Resend API key is available and PREFER_RESEND is set to true, use Resend
  if (process.env.RESEND_API_KEY) {
    return initializeResendTransport()
  } else {
    // Otherwise use SMTP
    return initializeSmtpTransport()
  }
}

// Initialize the email transport immediately
initializeEmailTransport()

// This is a little helper that ensure that data in context are in a shape
// suitable for usage in templates
//
function _promise_to_unfold_context(context) {
  if (context.user) {
    return context.user.reload_with_session_details()
  } else {
    return bluebird.resolve(1)
  }
}

// Resolves with ready to use email and its subject.
// There is two staged rendering process (due to limitation
// of hadlebar layout mechanism):
//  * render inner part of template
//  * place the innerpart ingo ready to use HTML wrapper

Email.prototype.promise_rendered_email_template = async function(args) {
  try {
    const filename = args.template_name
    const context = args.context || {}

    // Prepare context to be passed into first rendering stage
    const unfoldedContext = await _promise_to_unfold_context(context)
    // console.log('unfoldedContext:', unfoldedContext);

    // Add branding variables to context
    const contextWithBranding = {
      ...context,
      header_title: process.env.HEADER_TITLE || 'TimeOff.Management',
      branding_url: process.env.BRANDING_URL || 'https://timeoff.management'
    }

    // Debug: Log the context being passed to email template
    console.log('Email template context:', {
      header_title: contextWithBranding.header_title,
      branding_url: contextWithBranding.branding_url,
      template_name: filename
    })

    // Render inner part of email
    const renderedEmail = await handlebars.render(
      __dirname + '/../views/email/' + filename + '.hbs',
      contextWithBranding
    )
    // console.log('renderedEmail:', renderedEmail);

    // Extract subject from email
    const subject_and_body = renderedEmail.split(/\r?\n=====\r?\n/)
    console.log('subject_and_body:', subject_and_body)

    // Render ready to use email: wrap the content with fancy HTML boilerplate
    const final_email = await handlebars.render(
      __dirname + '/../views/email/wrapper.hbs',
      {
        subject: subject_and_body[0],
        body: subject_and_body[1],
        header_title: process.env.HEADER_TITLE || 'TimeOff.Management',
        branding_url: process.env.BRANDING_URL || 'https://timeoff.management'
      }
    )
    // console.log('final_email:', final_email);

    return {
      subject: subject_and_body[0],
      body: final_email
    }
  } catch (error) {
    console.error('Error in promise_rendered_email_template:', error)
  }
}

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let retries = 0

  while (retries < maxRetries) {
    try {
      return await fn()
    } catch (error) {
      retries++
      if (retries >= maxRetries) {
        throw error
      }

      const delay = initialDelay * Math.pow(2, retries - 1)
      console.log(
        `Retry ${retries}/${maxRetries} after ${delay}ms due to error:`,
        error.message
      )
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

// Return function that support same interface as sendMail but promisified.
// If current configuration does not allow sending emails, it return empty function
//
Email.prototype.get_send_email = function() {
  // Check if current installation is set to send emails
  if (send_email == 'false') {
    return function() {
      console.debug('Pretend to send email: ' + JSON.stringify(arguments))
      return bluebird.resolve()
    }
  }

  // Send E-mail using configured transport
  return async function(data) {
    try {
      // Make sure email transport is initialized
      if (!emailTransport) {
        console.log('Email transport not initialized yet, initializing...')
        initializeEmailTransport()
        if (!emailTransport) {
          throw new Error('Email transport initialization failed')
        }
      }

      // Try to send the email with the current transport
      try {
        if (emailTransport.type === 'resend') {
          // Use the same from address configuration for both SMTP and Resend
          const fromAddress = config.get('email:smtp:from') || data.from
          console.log('Using from address for Resend:', fromAddress)

          // Wrap Resend email sending in rate limiter
          const { data: emailData, error } = await resendRateLimiter.add(() =>
            emailTransport.client.emails.send({
              from: fromAddress,
              to: data.to,
              subject: data.subject,
              html: data.html
            })
          )

          if (error) {
            console.error('Error while sending mail with Resend:', error)
            throw error
          }

          return emailData
        } else {
          // Add timeout for SMTP operations
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('SMTP operation timed out after 15 seconds'))
            }, 15000) // 15 second timeout
          })

          // Retry the email sending with backoff
          const sendWithRetry = () => {
            return new Promise((resolve, reject) => {
              emailTransport.client.sendMail(data, (err, info) => {
                if (err) {
                  console.error('Error while sending mail with SMTP:', err)
                  return reject(err)
                }
                resolve(info)
              })
            })
          }

          // Try to send the email with retries
          try {
            // Race between the timeout and the send operation with retries
            return await Promise.race([
              retryWithBackoff(sendWithRetry, 2, 1000),
              timeoutPromise
            ])
          } catch (error) {
            console.error(
              'Failed to send email with SMTP after retries:',
              error
            )

            // If Resend is available as a fallback, try that
            if (process.env.RESEND_API_KEY) {
              console.log('SMTP failed, trying Resend API as fallback')
              try {
                // Initialize Resend client
                const resendClient = new Resend(process.env.RESEND_API_KEY)
                const fromAddress = config.get('email:smtp:from') || data.from

                // Send with Resend
                const { data: emailData, error } = await resendRateLimiter.add(
                  () =>
                    resendClient.emails.send({
                      from: fromAddress,
                      to: data.to,
                      subject: data.subject,
                      html: data.html
                    })
                )

                if (error) {
                  console.error('Resend fallback also failed:', error)
                  throw error
                }

                console.log('Successfully sent email using Resend fallback')
                return emailData
              } catch (resendError) {
                console.error('Resend fallback also failed:', resendError)
                throw error // Throw the original SMTP error
              }
            } else {
              // No fallback available
              throw error
            }
          }
        }
      } catch (error) {
        console.error('All email sending methods failed:', error)
        throw error
      }
    } catch (err) {
      console.error('Error while sending mail:', err)
      throw err
    }
  }
}

// Send registration complete email for provided user
//
Email.prototype.promise_registration_email = function(args) {
  const self = this
  const user = args.user
  const send_mail = self.get_send_email()

  return self
    .promise_rendered_email_template({
      template_name: 'registration_complete',
      context: { user }
    })
    .then(email_obj => {
      // Always record the email in the database, even if sending fails
      user.record_email_addressed_to_me(email_obj)

      return send_mail({
        from: config.get('email:smtp:from'),
        to: user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_result => bluebird.resolve(send_result))
        .catch(error => {
          console.error('Failed to send registration email:', error)
          return bluebird.resolve() // Prevent app crash but resolve the promise
        })
    })
    .catch(error => {
      console.error('Error in promise_registration_email:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_add_new_user_email = function(args) {
  const self = this
  const company = args.company
  const admin_user = args.admin_user
  const new_user = args.new_user
  const send_mail = self.get_send_email()

  return new_user
    .get_reset_password_token()
    .then(token =>
      self.promise_rendered_email_template({
        template_name: 'add_new_user',
        context: {
          new_user,
          admin_user,
          company,
          user: new_user,
          token
        }
      })
    )
    .then(email_obj => {
      // Always record the email in the database, even if sending fails
      new_user.record_email_addressed_to_me(email_obj)

      return send_mail({
        from: config.get('email:from'),
        to: new_user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_result => bluebird.resolve(send_result))
        .catch(error => {
          console.error('Failed to send add new user email:', error)
          return bluebird.resolve() // Prevent app crash but resolve the promise
        })
    })
    .catch(error => {
      console.error('Error in promise_add_new_user_email:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_leave_request_revoke_emails = function(args) {
  const self = this
  const leave = args.leave
  const send_mail = self.get_send_email()

  let template_name_to_supervisor = 'leave_request_revoke_to_supervisor'
  let template_name_to_requestor = 'leave_request_revoke_to_requestor'

  if (
    model.Leave.does_skip_approval(leave.get('user'), leave.get('leave_type'))
  ) {
    template_name_to_supervisor =
      'leave_request_revoke_to_supervisor_autoapprove'
    template_name_to_requestor = 'leave_request_revoke_to_requestor_autoapprove'
  }

  const promise_email_to_supervisor = comments =>
    self
      .promise_rendered_email_template({
        template_name: template_name_to_supervisor,
        context: {
          leave,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('approver')
        }
      })
      .then(email_obj => {
        // Always record the email in the database, even if sending fails
        leave.get('approver').record_email_addressed_to_me(email_obj)

        return send_mail({
          from: config.get('email:smtp:from'),
          to: leave.get('approver').email,
          subject: email_obj.subject,
          html: email_obj.body
        }).catch(error => {
          console.error('Failed to send revoke email to supervisor:', error)
          return bluebird.resolve() // Prevent app crash
        })
      })
      .catch(error => {
        console.error('Error preparing revoke email to supervisor:', error)
        return bluebird.resolve() // Prevent app crash
      })

  const promise_email_to_requestor = comments =>
    self
      .promise_rendered_email_template({
        template_name: template_name_to_requestor,
        context: {
          leave,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('user')
        }
      })
      .then(email_obj => {
        // Always record the email in the database, even if sending fails
        leave.get('user').record_email_addressed_to_me(email_obj)

        return send_mail({
          from: config.get('email:from'),
          to: leave.get('user').email,
          subject: email_obj.subject,
          html: email_obj.body
        }).catch(error => {
          console.error('Failed to send revoke email to requestor:', error)
          return bluebird.resolve() // Prevent app crash
        })
      })
      .catch(error => {
        console.error('Error preparing revoke email to requestor:', error)
        return bluebird.resolve() // Prevent app crash
      })

  return getCommentsForLeave({ leave })
    .then(comments =>
      bluebird.join(
        promise_email_to_supervisor(comments),
        promise_email_to_requestor(comments),
        () => bluebird.resolve()
      )
    )
    .catch(error => {
      console.error('Error in promise_leave_request_revoke_emails:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_leave_request_emails = function(args) {
  const self = this
  const leave = args.leave
  const send_mail = self.get_send_email()

  let template_name_to_supervisor = 'leave_request_to_supervisor'
  let template_name_to_requestor = 'leave_request_to_requestor'

  if (leave.is_auto_approve()) {
    template_name_to_supervisor = 'leave_request_to_supervisor_autoapprove'
    template_name_to_requestor = 'leave_request_to_requestor_autoapprove'
  }

  const promise_email_to_supervisor = ({
    comments,
    requesterAllowance
  }) => supervisor =>
    self
      .promise_rendered_email_template({
        template_name: template_name_to_supervisor,
        context: {
          leave,
          comments,
          approver: supervisor,
          requester: leave.get('user'),
          user: supervisor,
          requesterAllowance
        }
      })
      .then(email_obj => {
        // Always record the email in the database, even if sending fails
        supervisor.record_email_addressed_to_me(email_obj)

        return send_mail({
          from: config.get('email:from'),
          to: supervisor.email,
          subject: email_obj.subject,
          html: email_obj.body
        }).catch(error => {
          console.error(
            'Failed to send leave request email to supervisor:',
            error
          )
          return bluebird.resolve() // Prevent app crash
        })
      })
      .catch(error => {
        console.error(
          'Error preparing leave request email to supervisor:',
          error
        )
        return bluebird.resolve() // Prevent app crash
      })

  const promise_email_to_requestor = ({ comments, requesterAllowance }) =>
    self
      .promise_rendered_email_template({
        template_name: template_name_to_requestor,
        context: {
          leave,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('approver'),
          requesterAllowance
        }
      })
      .then(email_obj => {
        // Always record the email in the database, even if sending fails
        leave.get('user').record_email_addressed_to_me(email_obj)

        return send_mail({
          from: config.get('email:from'),
          to: leave.get('user').email,
          subject: email_obj.subject,
          html: email_obj.body
        }).catch(error => {
          console.error(
            'Failed to send leave request email to requestor:',
            error
          )
          return bluebird.resolve() // Prevent app crash
        })
      })
      .catch(error => {
        console.error(
          'Error preparing leave request email to requestor:',
          error
        )
        return bluebird.resolve() // Prevent app crash
      })

  return Promise.all([
    getCommentsForLeave({ leave }),
    leave.get('user').promise_allowance()
  ])
    .then(([comments, requesterAllowance]) =>
      bluebird.join(
        promise_email_to_requestor({ comments, requesterAllowance }),
        leave
          .get('user')
          .promise_supervisors()
          .then(supervisors => {
            // Ensure supervisors is an array
            if (!Array.isArray(supervisors)) {
              console.log(
                'Warning: promise_supervisors did not return an array:',
                supervisors
              )
              return Promise.resolve([])
            }

            return Promise.all(
              supervisors.map(supervisor =>
                promise_email_to_supervisor({ comments, requesterAllowance })(
                  supervisor
                )
              )
            )
          }),
        () => bluebird.resolve()
      )
    )
    .catch(error => {
      console.error('Error in promise_leave_request_emails:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_leave_request_decision_emails = function(args) {
  const self = this
  const leave = args.leave
  const action = args.action
  const was_pended_revoke = args.was_pended_revoke
  const send_mail = self.get_send_email()

  const promise_email_to_supervisor = async comments => {
    try {
      // Render the email template
      const email_obj = await self.promise_rendered_email_template({
        template_name: 'leave_request_decision_to_supervisor',
        context: {
          leave,
          action,
          was_pended_revoke,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('approver')
        }
      })

      console.log('email_obj', email_obj) // Debugging line

      // Always record the email in the database, even if sending fails
      await leave.get('approver').record_email_addressed_to_me(email_obj)

      // Send the email
      await send_mail({
        from: config.get('email:from'),
        to: leave.get('approver').email,
        subject: email_obj.subject,
        html: email_obj.body
      }).catch(error => {
        console.error('Failed to send decision email to supervisor:', error)
        // Don't rethrow - prevent app crash
      })
    } catch (error) {
      console.error('Error in promise_email_to_supervisor:', error)
      // Don't rethrow the error - prevent app crash
    }
  }

  const promise_email_to_requestor = async comments => {
    try {
      // Render the email template
      const email_obj = await self.promise_rendered_email_template({
        template_name: 'leave_request_decision_to_requestor',
        context: {
          leave,
          action,
          was_pended_revoke,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('user')
        }
      })

      console.log('email_obj', email_obj) // Debugging line

      // Always record the email in the database, even if sending fails
      await leave.get('user').record_email_addressed_to_me(email_obj)

      // Send the email
      await send_mail({
        from: config.get('email:from'),
        to: leave.get('user').email,
        subject: email_obj.subject,
        html: email_obj.body
      }).catch(error => {
        console.error('Failed to send decision email to requestor:', error)
        // Don't rethrow - prevent app crash
      })
    } catch (error) {
      console.error('Error in promise_email_to_requestor:', error)
      // Don't rethrow the error - prevent app crash
    }
  }

  return getCommentsForLeave({ leave })
    .then(comments =>
      bluebird.join(
        promise_email_to_supervisor(comments),
        promise_email_to_requestor(comments),
        () => bluebird.resolve()
      )
    )
    .catch(error => {
      console.error('Error in promise_leave_request_decision_emails:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_forgot_password_email = function(args) {
  const self = this
  const user = args.user
  const send_mail = self.get_send_email()

  return user
    .getCompany()
    .then(company =>
      self.promise_rendered_email_template({
        template_name: 'forgot_password',
        context: {
          user,
          company
        }
      })
    )
    .then(email_obj => {
      // Always record the email in the database, even if sending fails
      user.record_email_addressed_to_me(email_obj)

      return send_mail({
        from: config.get('email:from'),
        to: user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_results => bluebird.resolve(send_results))
        .catch(error => {
          console.error('Failed to send forgot password email:', error)
          return bluebird.resolve() // Prevent app crash
        })
    })
    .catch(error => {
      console.error('Error in promise_forgot_password_email:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_reset_password_email = function(args) {
  const self = this
  const user = args.user
  const send_mail = self.get_send_email()

  return self
    .promise_rendered_email_template({
      template_name: 'reset_password',
      context: {
        user
      }
    })
    .then(email_obj => {
      // Always record the email in the database, even if sending fails
      user.record_email_addressed_to_me(email_obj)

      return send_mail({
        from: config.get('email:from'),
        to: user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_results => bluebird.resolve(send_results))
        .catch(error => {
          console.error('Failed to send reset password email:', error)
          return bluebird.resolve() // Prevent app crash
        })
    })
    .catch(error => {
      console.error('Error in promise_reset_password_email:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

Email.prototype.promise_leave_request_cancel_emails = function(args) {
  const self = this
  const leave = args.leave
  const send_mail = self.get_send_email()

  // For cancellations, we only need to notify the requestor
  const promise_email_to_requestor = comments =>
    self
      .promise_rendered_email_template({
        template_name: 'leave_request_cancel_to_requestor',
        context: {
          leave,
          comments,
          requester: leave.get('user'),
          user: leave.get('user')
        }
      })
      .then(emailObj => {
        // Always record the email in the database, even if sending fails
        leave.get('user').record_email_addressed_to_me(emailObj)

        return send_mail({
          from: config.get('email:from'),
          to: leave.get('user').email,
          subject: emailObj.subject,
          html: emailObj.body
        }).catch(error => {
          console.error('Failed to send cancel email to requestor:', error)
          return bluebird.resolve() // Prevent app crash
        })
      })
      .catch(error => {
        console.error('Error preparing cancel email to requestor:', error)
        return bluebird.resolve() // Prevent app crash
      })

  return getCommentsForLeave({ leave })
    .then(comments =>
      promise_email_to_requestor(comments).then(() => bluebird.resolve())
    )
    .catch(error => {
      console.error('Error in promise_leave_request_cancel_emails:', error)
      return bluebird.resolve() // Prevent app crash
    })
}

module.exports = Email
