'use strict'

const Joi = require('joi')

// Updated schema definition for Joi v17 compatibility
const schema_throw_user_error = Joi.alternatives().try(
  Joi.object({
    system_error: Joi.string().required(),
    user_error: Joi.string().required()
  }),
  Joi.string()
)

function throw_user_error(args) {
  try {
    // Use Joi.attempt instead of Joi.validate for Joi v17 compatibility
    Joi.attempt(args, schema_throw_user_error)
  } catch (error) {
    // Tricky case here as we failed to raise exception, so log all data we have
    // and still raise generic exception
    console.log('throw_user_error got invalid parameters: ' + error.message)
    console.dir(args)
    throw new Error('Failed to throw user errors')
  }

  let system_error_message, user_error_message

  // Special case when user is lazy and specified generic error message to be
  // used for system and customer level
  if (typeof args === 'string') {
    system_error_message = user_error_message = args
  } else {
    system_error_message = args.system_error
    user_error_message = args.user_error
  }

  const exception = new Error(system_error_message)

  if (user_error_message) {
    exception.user_error_message = user_error_message
  }

  exception.tom_error = true

  throw exception
}

function extract_system_error_message(error) {
  if (!error) {
    return null
  }

  return error
}

function extract_user_error_message(error) {
  if (!error) {
    return null
  }

  if (typeof error === 'string') {
    return error
  }

  if (error.user_error_message) {
    return error.user_error_message
  }

  return 'N/A'
}

module.exports = {
  throw_user_error,
  extract_user_error_message,
  extract_system_error_message,

  throwUserError: throw_user_error,
  extractUserErrorMessage: extract_user_error_message,
  extractSystemErrorMessage: extract_system_error_message
}
