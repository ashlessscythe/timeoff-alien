/*
 * For given email fetch user account info using provided driver
 * where an client side JS is used to trigger AJAX request to
 * server. Make sure that drivier has active admin session.
 *
 * */

'use strict'

// Function that is executed on the client,
// it relies on presence of jQuery and window.VPP_email
const func_to_inject = function() {
  const callback = arguments[arguments.length - 1]

  $.ajax({
    url: '/users/search/',
    type: 'post',
    data: {
      email: window.VPP_email
    },
    headers: {
      Accept: 'application/json'
    },
    dataType: 'json',
    success: function(data) {
      callback(data)
    }
  })
}

const user_info_func = async function(args) {
  const driver = args.driver
  const email = args.email

  if (!driver) {
    throw "'driver' was not passed into the user_info!"
  }

  if (!email) {
    throw "'email' was not passed into the user_info!"
  }

  // Inject email we are using to identify user into the tested page
  await driver.executeScript('window.VPP_email = "' + email + '";')

  // execute AJAX request on the client that fetchs user info by email
  const users = await driver.executeAsyncScript(func_to_inject)
  const user = users.length > 0 ? users[0] : {}

  return {
    driver,
    user
  }
}

module.exports = user_info_func
