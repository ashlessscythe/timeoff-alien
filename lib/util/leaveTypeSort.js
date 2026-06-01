'use strict'

const { sorter } = require('./index')

const LEAVE_TYPES_SORT_ASC = 'name_asc'
const LEAVE_TYPES_SORT_DESC = 'name_desc'

const VALID_LEAVE_TYPES_SORT = new Set([
  LEAVE_TYPES_SORT_ASC,
  LEAVE_TYPES_SORT_DESC
])

function normalizeLeaveTypesSort(value) {
  if (value === LEAVE_TYPES_SORT_ASC) {
    return LEAVE_TYPES_SORT_ASC
  }
  return LEAVE_TYPES_SORT_DESC
}

function sortLeaveTypes(leaveTypes, company) {
  const list = leaveTypes || []
  const mode = normalizeLeaveTypesSort(
    company && company.leave_types_sort
  )

  return [...list].sort((a, b) => {
    const sortOrderA = a.sort_order || 0
    const sortOrderB = b.sort_order || 0
    if (sortOrderB !== sortOrderA) {
      return sortOrderB - sortOrderA
    }

    if (mode === LEAVE_TYPES_SORT_ASC) {
      return sorter(a.name, b.name)
    }

    return sorter(b.name, a.name)
  })
}

module.exports = {
  LEAVE_TYPES_SORT_ASC,
  LEAVE_TYPES_SORT_DESC,
  VALID_LEAVE_TYPES_SORT,
  normalizeLeaveTypesSort,
  sortLeaveTypes
}
