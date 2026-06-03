'use strict'

/*
 * Pure helpers for department-scoped leave type visibility.
 *
 * Empty explicitIds means no junction rows were saved for the department,
 * which is treated as "all company leave types are allowed".
 */

function getEffectiveAllowedLeaveTypeIds(args) {
  const explicitIds = (args && args.explicitIds) || []
  const allCompanyLeaveTypeIds = (args && args.allCompanyLeaveTypeIds) || []

  if (!explicitIds.length) {
    return allCompanyLeaveTypeIds.slice()
  }

  const allowed = new Set(allCompanyLeaveTypeIds.map(id => Number(id)))
  return explicitIds
    .map(id => Number(id))
    .filter(id => allowed.has(id))
}

function isLeaveTypeAllowedForDepartment(args) {
  const leaveTypeId = Number(args && args.leaveTypeId)
  const effectiveIds = getEffectiveAllowedLeaveTypeIds({
    explicitIds: (args && args.explicitIds) || [],
    allCompanyLeaveTypeIds: (args && args.allCompanyLeaveTypeIds) || []
  })

  return effectiveIds.some(id => id === leaveTypeId)
}

function filterLeaveTypesForBooking(args) {
  const leaveTypes = (args && args.leaveTypes) || []
  const explicitIds = (args && args.explicitIds) || []
  const allCompanyLeaveTypeIds = leaveTypes.map(lt => Number(lt.id))
  const isManagerOrAdmin = !!(args && args.isManagerOrAdmin)
  const bookingForSelf = args && args.bookingForSelf !== false

  const effectiveIds = new Set(
    getEffectiveAllowedLeaveTypeIds({
      explicitIds,
      allCompanyLeaveTypeIds
    })
  )

  return leaveTypes.filter(leaveType => {
    if (!effectiveIds.has(Number(leaveType.id))) {
      return false
    }

    if (bookingForSelf && !isManagerOrAdmin && leaveType.manager_only) {
      return false
    }

    return true
  })
}

function parseExplicitLeaveTypeIds(department) {
  if (!department || !department.department_leave_types) {
    return []
  }

  return department.department_leave_types.map(row => Number(row.leave_type_id))
}

module.exports = {
  getEffectiveAllowedLeaveTypeIds,
  isLeaveTypeAllowedForDepartment,
  filterLeaveTypesForBooking,
  parseExplicitLeaveTypeIds
}
