'use strict'

/*
 * Pure helpers for validating that a leave fits into an employee's
 * remaining allowance. Extracted from `sessionUser.js` so they can be
 * unit-tested without Prisma or the surrounding session machinery.
 *
 * The two pools are:
 *
 *   - personal: department.personal + personal_adjustment, used by
 *     leave types where `use_personal=true`.
 *   - regular:  total annual allowance MINUS the personal carve-out,
 *     used by leave types where `use_allowance=true && !use_personal`.
 *
 * `leave_type.limit` (when > 0) is enforced for ANY leave type as the
 * maximum number of deducted days a single employee can take of that
 * leave type per year. Limit is enforced for both allowance-pool and
 * non-allowance (e.g. Sick) leave types.
 *
 * All public helpers are pure functions: they return the verdict
 * instead of throwing, so callers can decide how to surface the error.
 */

const ROUND = value => Math.round(value * 10) / 10

const formatDays = value => {
  const n = Number(value)
  if (Number.isNaN(n)) return '0'
  return ROUND(n).toString()
}

/**
 * Evaluate whether the supplied leave fits into the given allowance/limit.
 *
 * @param {Object} args
 * @param {Object} args.allowance - UserAllowance instance (or compatible
 *   shape exposing `total_personal_available` and `remaining_regular_allowance`).
 * @param {Object} args.leaveType - leave_type record with `use_allowance`,
 *   `use_personal`, `limit`, and (for nicer errors) `name`.
 * @param {number} args.deductedDays - number of days this leave will deduct.
 * @param {number} [args.daysTakenForLeaveType=0] - days already taken of
 *   this leave_type in the current year, EXCLUDING this leave. Used for
 *   limit enforcement.
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function evaluateLeaveAgainstAllowance(args) {
  const allowance = args && args.allowance
  const leaveType = args && args.leaveType
  const deductedDays = Number(args && args.deductedDays) || 0
  const daysTakenForLeaveType = Number(args && args.daysTakenForLeaveType) || 0

  if (!leaveType) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Leave type is required to validate allowance'
    }
  }

  const leaveTypeName = leaveType.name ? `"${leaveType.name}"` : 'this leave type'

  // 1. Per-leave-type limit (applies whether or not the leave uses allowance).
  if (leaveType.limit && leaveType.limit > 0) {
    const remainingForType = leaveType.limit - daysTakenForLeaveType
    if (deductedDays - remainingForType > 1e-9) {
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message:
          `Requested absence exceeds the annual limit for ${leaveTypeName} ` +
          `(limit ${formatDays(leaveType.limit)} day(s), ` +
          `${formatDays(Math.max(0, remainingForType))} remaining, ` +
          `requested ${formatDays(deductedDays)})`
      }
    }
  }

  // 2. Pool routing: personal vs regular.
  if (leaveType.use_personal) {
    const personalRemaining = allowance ? allowance.total_personal_available : 0
    if (deductedDays - personalRemaining > 1e-9) {
      return {
        ok: false,
        code: 'PERSONAL_EXHAUSTED',
        message:
          `Requested absence exceeds remaining personal allowance ` +
          `(${formatDays(personalRemaining)} day(s) remaining, ` +
          `requested ${formatDays(deductedDays)})`
      }
    }
    return { ok: true }
  }

  if (leaveType.use_allowance) {
    const regularRemaining = allowance ? allowance.remaining_regular_allowance : 0
    if (deductedDays - regularRemaining > 1e-9) {
      return {
        ok: false,
        code: 'REGULAR_EXHAUSTED',
        message:
          `Requested absence exceeds remaining vacation allowance ` +
          `(${formatDays(regularRemaining)} day(s) remaining, ` +
          `requested ${formatDays(deductedDays)})`
      }
    }
    return { ok: true }
  }

  // Leave type does not consume any allowance pool; only the limit gate above
  // can reject it.
  return { ok: true }
}

/**
 * Specialised helper for limit-only checks (e.g. Sick Leave with
 * `use_allowance=false, limit=10`). Equivalent to calling
 * `evaluateLeaveAgainstAllowance` with a no-op allowance object, but
 * cheaper for callers that already have the leave type and taken-days
 * counter in hand.
 */
function evaluateLeaveAgainstLimit(args) {
  const leaveType = args && args.leaveType
  const deductedDays = Number(args && args.deductedDays) || 0
  const daysTakenForLeaveType = Number(args && args.daysTakenForLeaveType) || 0

  if (!leaveType) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Leave type is required to validate limit'
    }
  }

  if (!leaveType.limit || leaveType.limit <= 0) return { ok: true }

  const remainingForType = leaveType.limit - daysTakenForLeaveType
  if (deductedDays - remainingForType > 1e-9) {
    const leaveTypeName = leaveType.name ? `"${leaveType.name}"` : 'this leave type'
    return {
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message:
        `Requested absence exceeds the annual limit for ${leaveTypeName} ` +
        `(limit ${formatDays(leaveType.limit)} day(s), ` +
        `${formatDays(Math.max(0, remainingForType))} remaining, ` +
        `requested ${formatDays(deductedDays)})`
    }
  }

  return { ok: true }
}

module.exports = {
  evaluateLeaveAgainstAllowance,
  evaluateLeaveAgainstLimit
}
