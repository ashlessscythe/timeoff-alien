'use strict'

/**
 * Parse HTML checkbox / form values where unchecked is absent and "off" must be false.
 * (validator.toBoolean('off') is true in validator v13.)
 */
function formCheckboxBool(val) {
  if (val === true || val === false) return val
  if (val == null || val === '') return false
  const s = String(val).trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(s)) return false
  if (['1', 'true', 'on', 'yes'].includes(s)) return true
  return false
}

module.exports = formCheckboxBool
