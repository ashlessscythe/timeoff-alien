import { describe, it, expect } from 'vitest'
import {
  getEffectiveAllowedLeaveTypeIds,
  isLeaveTypeAllowedForDepartment,
  filterLeaveTypesForBooking,
  parseExplicitLeaveTypeIds
} from '../../lib/route/leaveTypeRules.js'

describe('leaveTypeRules', () => {
  const allIds = [1, 2, 3]

  it('getEffectiveAllowedLeaveTypeIds returns all when explicit is empty', () => {
    expect(
      getEffectiveAllowedLeaveTypeIds({
        explicitIds: [],
        allCompanyLeaveTypeIds: allIds
      })
    ).toEqual([1, 2, 3])
  })

  it('getEffectiveAllowedLeaveTypeIds returns subset when explicit is set', () => {
    expect(
      getEffectiveAllowedLeaveTypeIds({
        explicitIds: [2, 99],
        allCompanyLeaveTypeIds: allIds
      })
    ).toEqual([2])
  })

  it('isLeaveTypeAllowedForDepartment respects explicit list', () => {
    expect(
      isLeaveTypeAllowedForDepartment({
        leaveTypeId: 2,
        explicitIds: [2],
        allCompanyLeaveTypeIds: allIds
      })
    ).toBe(true)
    expect(
      isLeaveTypeAllowedForDepartment({
        leaveTypeId: 1,
        explicitIds: [2],
        allCompanyLeaveTypeIds: allIds
      })
    ).toBe(false)
  })

  it('isLeaveTypeAllowedForDepartment allows any when explicit empty', () => {
    expect(
      isLeaveTypeAllowedForDepartment({
        leaveTypeId: 3,
        explicitIds: [],
        allCompanyLeaveTypeIds: allIds
      })
    ).toBe(true)
  })

  it('filterLeaveTypesForBooking applies dept then manager_only for self', () => {
    const types = [
      { id: 1, name: 'Holiday', manager_only: false },
      { id: 2, name: 'Sick', manager_only: false },
      { id: 3, name: 'Manager', manager_only: true }
    ]

    expect(
      filterLeaveTypesForBooking({
        leaveTypes: types,
        explicitIds: [1],
        isManagerOrAdmin: false,
        bookingForSelf: true
      }).map(t => t.id)
    ).toEqual([1])

    expect(
      filterLeaveTypesForBooking({
        leaveTypes: types,
        explicitIds: [1, 3],
        isManagerOrAdmin: true,
        bookingForSelf: true
      }).map(t => t.id)
    ).toEqual([1, 3])
  })

  it('filterLeaveTypesForBooking shows manager_only when booking for others', () => {
    const types = [
      { id: 1, name: 'Holiday', manager_only: false },
      { id: 3, name: 'Manager', manager_only: true }
    ]

    expect(
      filterLeaveTypesForBooking({
        leaveTypes: types,
        explicitIds: [],
        isManagerOrAdmin: true,
        bookingForSelf: false
      }).map(t => t.id)
    ).toEqual([1, 3])
  })

  it('parseExplicitLeaveTypeIds reads junction rows', () => {
    expect(
      parseExplicitLeaveTypeIds({
        department_leave_types: [{ leave_type_id: 5 }, { leave_type_id: 7 }]
      })
    ).toEqual([5, 7])
    expect(parseExplicitLeaveTypeIds({})).toEqual([])
  })
})
