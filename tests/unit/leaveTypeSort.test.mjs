import { describe, expect, it } from 'vitest'
import { sortLeaveTypes } from '../../lib/util/leaveTypeSort.js'

describe('sortLeaveTypes', () => {
  const types = [
    { id: 1, name: 'Alpha', sort_order: 0 },
    { id: 2, name: 'Mango', sort_order: 0 },
    { id: 3, name: 'Zulu', sort_order: 0 }
  ]

  it('sorts name descending by default', () => {
    const sorted = sortLeaveTypes(types, {})
    expect(sorted.map(t => t.name)).toEqual(['Zulu', 'Mango', 'Alpha'])
  })

  it('sorts name ascending when company uses name_asc', () => {
    const sorted = sortLeaveTypes(types, { leave_types_sort: 'name_asc' })
    expect(sorted.map(t => t.name)).toEqual(['Alpha', 'Mango', 'Zulu'])
  })

  it('places pinned types before name sort', () => {
    const withPin = types.map(t =>
      t.id === 2 ? { ...t, sort_order: 1 } : t
    )
    const sorted = sortLeaveTypes(withPin, { leave_types_sort: 'name_desc' })
    expect(sorted.map(t => t.name)).toEqual(['Mango', 'Zulu', 'Alpha'])
  })
})
