import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  parseAllowedIncrements,
  getRequestedIncrement,
  isIncrementAllowed,
  DEFAULT_ALLOWED_INCREMENTS
} = require('../../lib/route/incrementRules.js')

describe('parseAllowedIncrements', () => {
  it('returns the parsed JSON array for a department', () => {
    const result = parseAllowedIncrements({
      id: 1,
      allowed_increments: '["full_day","hourly"]'
    })
    expect(result).toEqual(['full_day', 'hourly'])
  })

  it('falls back to defaults when allowed_increments is missing', () => {
    expect(parseAllowedIncrements(null)).toEqual(DEFAULT_ALLOWED_INCREMENTS)
    expect(parseAllowedIncrements({})).toEqual(DEFAULT_ALLOWED_INCREMENTS)
  })

  it('falls back to defaults when JSON is malformed', () => {
    const result = parseAllowedIncrements({
      id: 7,
      allowed_increments: 'not-json'
    })
    expect(result).toEqual(DEFAULT_ALLOWED_INCREMENTS)
  })

  it('falls back to defaults when array is empty', () => {
    const result = parseAllowedIncrements({
      id: 7,
      allowed_increments: '[]'
    })
    expect(result).toEqual(DEFAULT_ALLOWED_INCREMENTS)
  })

  it('returns a fresh array (mutation safe)', () => {
    const a = parseAllowedIncrements(null)
    const b = parseAllowedIncrements(null)
    expect(a).not.toBe(b)
  })
})

describe('getRequestedIncrement', () => {
  it('maps the modern increment_type values', () => {
    expect(getRequestedIncrement({ incrementType: 'day' })).toBe('full_day')
    expect(getRequestedIncrement({ incrementType: 'halfday' })).toBe('half_day')
    expect(getRequestedIncrement({ incrementType: 'hr' })).toBe('hourly')
    expect(getRequestedIncrement({ incrementType: 'min' })).toBe('quarter_hr')
  })

  it('returns null for unknown increment_type', () => {
    expect(getRequestedIncrement({ incrementType: 'wat' })).toBeNull()
  })

  it('infers half_day from legacy from_date_part values', () => {
    expect(getRequestedIncrement({ fromDatePart: '2' })).toBe('half_day')
    expect(getRequestedIncrement({ fromDatePart: '3' })).toBe('half_day')
  })

  it('infers quarter_hr from time fields and 15/30 minute value', () => {
    expect(
      getRequestedIncrement({
        timeStart: '09:00:00',
        timeEnd: '09:15:00',
        incrementValue: '15'
      })
    ).toBe('quarter_hr')
    expect(
      getRequestedIncrement({
        timeStart: '09:00:00',
        timeEnd: '09:30:00',
        incrementValue: '30'
      })
    ).toBe('quarter_hr')
  })

  it('infers hourly when time fields present and no quarter-hour value', () => {
    expect(
      getRequestedIncrement({
        timeStart: '09:00:00',
        timeEnd: '11:00:00',
        incrementValue: '2'
      })
    ).toBe('hourly')
  })

  it('defaults to full_day with no hints', () => {
    expect(getRequestedIncrement({})).toBe('full_day')
    expect(getRequestedIncrement({ fromDatePart: '1' })).toBe('full_day')
  })
})

describe('isIncrementAllowed', () => {
  it('returns false for an unknown requested increment', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: null,
        departmentAllowedIncrements: ['full_day']
      })
    ).toBe(false)
  })

  it('returns false when department does not allow the increment', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: 'half_day',
        departmentAllowedIncrements: ['full_day'],
        leaveTypeAllowsNonDefault: true
      })
    ).toBe(false)
  })

  it('allows full_day / half_day regardless of leave-type non-default flag', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: 'full_day',
        departmentAllowedIncrements: ['full_day', 'half_day'],
        leaveTypeAllowsNonDefault: false
      })
    ).toBe(true)

    expect(
      isIncrementAllowed({
        requestedIncrement: 'half_day',
        departmentAllowedIncrements: ['full_day', 'half_day'],
        leaveTypeAllowsNonDefault: false
      })
    ).toBe(true)
  })

  it('rejects hourly when department allows only default increments even if leave type opts in', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: 'hourly',
        departmentAllowedIncrements: ['full_day', 'half_day'],
        leaveTypeAllowsNonDefault: true
      })
    ).toBe(false)
  })

  it('rejects hourly when department allows it but leave type does not opt in', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: 'hourly',
        departmentAllowedIncrements: ['full_day', 'half_day', 'hourly'],
        leaveTypeAllowsNonDefault: false
      })
    ).toBe(false)
  })

  it('accepts hourly when both department and leave type allow it', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: 'hourly',
        departmentAllowedIncrements: ['full_day', 'half_day', 'hourly'],
        leaveTypeAllowsNonDefault: true
      })
    ).toBe(true)
  })

  it('quarter_hr follows the same intersection rule as hourly', () => {
    expect(
      isIncrementAllowed({
        requestedIncrement: 'quarter_hr',
        departmentAllowedIncrements: ['full_day', 'half_day', 'quarter_hr'],
        leaveTypeAllowsNonDefault: false
      })
    ).toBe(false)

    expect(
      isIncrementAllowed({
        requestedIncrement: 'quarter_hr',
        departmentAllowedIncrements: ['full_day', 'half_day', 'quarter_hr'],
        leaveTypeAllowsNonDefault: true
      })
    ).toBe(true)
  })
})
