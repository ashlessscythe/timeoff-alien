/*
 * Middleware that checks if current session has a user and user is either an admin or a manager.
 *
 * In case of failure - redirects to the route.
 *
 * */
'use strict'

module.exports = function(req, res, next) {
  // User should be logged in to view these pages
  if (!req.user) {
    return res.redirect_with_session(303, '/')
  }

  // Only Admin or Manager users allowed to access these pages
  if (!req.user.is_admin() && !req.user.is_manager()) {
    return res.redirect_with_session(303, '/')
  }

  next()
}
