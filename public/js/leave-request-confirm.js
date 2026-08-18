document.addEventListener('DOMContentLoaded', function () {
  var modal = document.getElementById('confirm_leave_action_modal')
  if (!modal) {
    return
  }

  var titleEl = document.getElementById('confirmLeaveActionModalLabel')
  var bodyEl = document.getElementById('confirm_leave_action_body')
  var submitBtn = document.getElementById('confirm_leave_action_submit')
  var pendingForm = null

  function actionCopy(isRevoke) {
    if (isRevoke) {
      return {
        title: 'Revoke this leave request?',
        body:
          'This asks to take back an approved request. If it is not auto-approved, your supervisor still needs to confirm. Requests in a closed payroll week can only be revoked by an administrator.',
        confirm: 'Confirm revoke'
      }
    }
    return {
      title: 'Cancel this leave request?',
      body:
        'This pending request will be canceled immediately. To book time off again, create a new request.',
      confirm: 'Confirm cancel'
    }
  }

  document.addEventListener('submit', function (event) {
    var form = event.target
    if (
      !form.classList.contains('leave-cancel-form') &&
      !form.classList.contains('leave-revoke-form')
    ) {
      return
    }
    if (form.getAttribute('data-confirmed') === '1') {
      return
    }

    event.preventDefault()
    pendingForm = form
    var copy = actionCopy(form.classList.contains('leave-revoke-form'))
    if (titleEl) {
      titleEl.textContent = copy.title
    }
    if (bodyEl) {
      bodyEl.textContent = copy.body
    }
    if (submitBtn) {
      submitBtn.textContent = copy.confirm
      submitBtn.disabled = false
    }
    if (window.jQuery) {
      window.jQuery(modal).modal('show')
    }
  })

  if (submitBtn) {
    submitBtn.addEventListener('click', function () {
      if (!pendingForm || submitBtn.disabled) {
        return
      }
      submitBtn.disabled = true
      pendingForm.setAttribute('data-confirmed', '1')
      if (window.jQuery) {
        window.jQuery(modal).modal('hide')
      }
      pendingForm.submit()
    })
  }
})
