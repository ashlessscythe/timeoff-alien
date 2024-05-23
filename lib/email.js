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
const nodemailer = require('nodemailer')
const smtpTransport = require('nodemailer-smtp-transport')
const model = require('./model/db')
const { getCommentsForLeave } = require('./model/comment')

function Email() {}

const send_email = config.get('send_email')
console.log('get_send_email: ', config.get('send_email'))

let smtpConfig = config.get('smtp')
if (config.get('email_smtp_auth') === 'false') {
  delete smtpConfig.auth
}

const transporter = nodemailer.createTransport(
  smtpTransport(smtpConfig)
)
console.log('SMTP Config:', smtpConfig)

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

    // Render inner part of email
    const renderedEmail = await handlebars.render(
      __dirname + '/../views/email/' + filename + '.hbs',
      context
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
        body: subject_and_body[1]
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

  // Send E-mail transactionnally
  return function(data) {
    return new Promise(function(resolve, reject) {
      transporter.sendMail(data, (err, info) => {
        if (err) {
          console.error('Error while sending mail', err)
          return reject(err)
        }
        resolve(info)
      })
    })
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
    .then(email_obj =>
      send_mail({
        from: config.get('smtp:from'),
        to: user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_result => bluebird.resolve(send_result))
        .finally(() => user.record_email_addressed_to_me(email_obj))
    )
}

Email.prototype.promise_add_new_user_email = function(args) {
  const self = this
  const company = args.company
  const admin_user = args.admin_user
  const new_user = args.new_user
  const send_mail = self.get_send_email()

  return self
    .promise_rendered_email_template({
      template_name: 'add_new_user',
      context: {
        new_user,
        admin_user,
        company,
        user: new_user
      }
    })
    .then(email_obj =>
      send_mail({
        from: config.get('smtp:from'),
        to: new_user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_result => bluebird.resolve(send_result))
        .finally(() => new_user.record_email_addressed_to_me(email_obj))
    )
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
      .then(email_obj =>
        send_mail({
          from: config.get('smtp:from'),
          to: leave.get('approver').email,
          subject: email_obj.subject,
          html: email_obj.body
        }).finally(() =>
          leave.get('approver').record_email_addressed_to_me(email_obj)
        )
      )

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
      .then(email_obj =>
        send_mail({
          from: config.get('smtp:from'),
          to: leave.get('user').email,
          subject: email_obj.subject,
          html: email_obj.body
        }).finally(() =>
          leave.get('user').record_email_addressed_to_me(email_obj)
        )
      )

  return getCommentsForLeave({ leave }).then(comments =>
    bluebird.join(
      promise_email_to_supervisor(comments),
      promise_email_to_requestor(comments),
      () => bluebird.resolve()
    )
  )
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
      .then(email_obj =>
        send_mail({
          from: config.get('smtp:from'),
          to: supervisor.email,
          subject: email_obj.subject,
          html: email_obj.body
        }).finally(() => supervisor.record_email_addressed_to_me(email_obj))
      )

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
      .then(email_obj =>
        send_mail({
          from: config.get('smtp:from'),
          to: leave.get('user').email,
          subject: email_obj.subject,
          html: email_obj.body
        }).finally(() =>
          leave.get('user').record_email_addressed_to_me(email_obj)
        )
      )

  return Promise.all([
    getCommentsForLeave({ leave }),
    leave.get('user').promise_allowance()
  ]).then(([comments, requesterAllowance]) =>
    bluebird.join(
      promise_email_to_requestor({ comments, requesterAllowance }),
      leave
        .get('user')
        .promise_supervisors()
        .map(supervisor =>
          promise_email_to_supervisor({ comments, requesterAllowance })(
            supervisor
          )
        ),
      () => bluebird.resolve()
    )
  )
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

      // Send the email
      await send_mail({
        from: config.get('smtp:from'),
        to: leave.get('approver').email,
        subject: email_obj.subject,
        html: email_obj.body
      })

      // Record the email
      await leave.get('approver').record_email_addressed_to_me(email_obj)
    } catch (error) {
      console.error('Error in promise_email_to_supervisor:', error)
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

      // Send the email
      await send_mail({
        from: config.get('smtp:from'),
        to: leave.get('user').email,
        subject: email_obj.subject,
        html: email_obj.body
      })

      // Record the email
      await leave.get('user').record_email_addressed_to_me(email_obj)
    } catch (error) {
      console.error('Error in promise_email_to_requestor:', error)
    }
  }

  return getCommentsForLeave({ leave }).then(comments =>
    bluebird.join(
      promise_email_to_supervisor(comments),
      promise_email_to_requestor(comments),
      () => bluebird.resolve()
    )
  )
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
    .then(email_obj =>
      send_mail({
        from: config.get('smtp:from'),
        to: user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_results => bluebird.resolve(send_results))
        .finally(() => user.record_email_addressed_to_me(email_obj))
    )
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
    .then(email_obj =>
      send_mail({
        from: config.get('smtp:from'),
        to: user.email,
        subject: email_obj.subject,
        html: email_obj.body
      })
        .then(send_results => bluebird.resolve(send_results))
        .finally(() => user.record_email_addressed_to_me(email_obj))
    )
}

Email.prototype.promise_leave_request_cancel_emails = function(args) {
  const self = this
  const leave = args.leave
  const send_mail = self.get_send_email()

  const promise_email_to_supervisor = comments =>
    self
      .promise_rendered_email_template({
        template_name: 'leave_request_cancel_to_supervisor',
        context: {
          leave,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('approver')
        }
      })
      .then(emailObj =>
        send_mail({
          from: config.get('smtp:from'),
          to: leave.get('approver').email,
          subject: emailObj.subject,
          html: emailObj.body
        }).finally(() =>
          leave.get('approver').record_email_addressed_to_me(emailObj)
        )
      )

  const promise_email_to_requestor = comments =>
    self
      .promise_rendered_email_template({
        template_name: 'leave_request_cancel_to_requestor',
        context: {
          leave,
          comments,
          approver: leave.get('approver'),
          requester: leave.get('user'),
          user: leave.get('user')
        }
      })
      .then(emailObj =>
        send_mail({
          from: config.get('smtp:from'),
          to: leave.get('user').email,
          subject: emailObj.subject,
          html: emailObj.body
        }).finally(() =>
          leave.get('user').record_email_addressed_to_me(emailObj)
        )
      )

  return getCommentsForLeave({ leave }).then(comments =>
    bluebird.join(
      promise_email_to_supervisor(comments),
      promise_email_to_requestor(comments),
      () => bluebird.resolve()
    )
  )
}

module.exports = Email
