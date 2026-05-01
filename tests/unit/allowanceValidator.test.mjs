import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  evaluateLeaveAgainstAllowance,
  evaluateLeaveAgainstLimit
} = require('../../lib/model/allowance_validator.js')

const makeAllowance = ({ regular = 0, personal = 0 } = {}) => ({
  remaining_regular_allowance: regular,
  total_personal_available: personal
})

describe('evaluateLeaveAgainstAllowance', () => {
  it('rejects when leaveType is missing', () => {
    const verdict = evaluateLeaveAgainstAllowance({
      allowance: makeAllowance(),
      deductedDays: 1
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('INVALID_INPUT')
  })

  describe('regular pool', () => {
    const leaveType = {
      name: 'Holiday',
      use_allowance: true,
      use_personal: false,
      limit: 0
    }

    it('accepts when deducted days fit into the regular pool', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 5, personal: 5 }),
        leaveType,
        deductedDays: 3
      })
      expect(verdict.ok).toBe(true)
    })

    it('accepts at exact pool boundary', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 3, personal: 0 }),
        leaveType,
        deductedDays: 3
      })
      expect(verdict.ok).toBe(true)
    })

    it('rejects when regular pool is exhausted', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 2, personal: 5 }),
        leaveType,
        deductedDays: 3
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('REGULAR_EXHAUSTED')
      expect(verdict.message).toMatch(/vacation allowance/i)
      expect(verdict.message).toMatch(/2/)
    })

    it('rejects regular leave even when total (regular+personal) would cover it', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 0, personal: 5 }),
        leaveType,
        deductedDays: 1
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('REGULAR_EXHAUSTED')
    })
  })

  describe('personal pool', () => {
    const leaveType = {
      name: 'Personal',
      use_allowance: true,
      use_personal: true,
      limit: 0
    }

    it('accepts when fits into the personal pool', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 0, personal: 5 }),
        leaveType,
        deductedDays: 5
      })
      expect(verdict.ok).toBe(true)
    })

    it('rejects when personal pool is exhausted', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 20, personal: 0 }),
        leaveType,
        deductedDays: 1
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('PERSONAL_EXHAUSTED')
      expect(verdict.message).toMatch(/personal allowance/i)
    })

    it('does not fall back to the regular pool', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 100, personal: 1 }),
        leaveType,
        deductedDays: 2
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('PERSONAL_EXHAUSTED')
    })
  })

  describe('limit gate', () => {
    it('rejects when leave_type.limit is exceeded for an allowance type', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 50, personal: 0 }),
        leaveType: {
          name: 'Conference',
          use_allowance: true,
          use_personal: false,
          limit: 5
        },
        deductedDays: 4,
        daysTakenForLeaveType: 2
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('LIMIT_EXCEEDED')
      expect(verdict.message).toMatch(/limit/i)
    })

    it('accepts at exact limit boundary', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 50, personal: 0 }),
        leaveType: {
          name: 'Conference',
          use_allowance: true,
          use_personal: false,
          limit: 5
        },
        deductedDays: 3,
        daysTakenForLeaveType: 2
      })
      expect(verdict.ok).toBe(true)
    })

    it('limit gate fires before pool gate', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 0, personal: 0 }),
        leaveType: {
          name: 'Conference',
          use_allowance: true,
          use_personal: false,
          limit: 5
        },
        deductedDays: 6,
        daysTakenForLeaveType: 0
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('LIMIT_EXCEEDED')
    })

    it('treats limit=0 as no limit', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 50, personal: 0 }),
        leaveType: {
          use_allowance: true,
          use_personal: false,
          limit: 0
        },
        deductedDays: 50,
        daysTakenForLeaveType: 0
      })
      expect(verdict.ok).toBe(true)
    })
  })

  describe('non-allowance leave types', () => {
    it('accepts unlimited non-allowance leave', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance({ regular: 0, personal: 0 }),
        leaveType: {
          name: 'Sick',
          use_allowance: false,
          use_personal: false,
          limit: 0
        },
        deductedDays: 30
      })
      expect(verdict.ok).toBe(true)
    })

    it('still enforces limit on non-allowance leave', () => {
      const verdict = evaluateLeaveAgainstAllowance({
        allowance: makeAllowance(),
        leaveType: {
          name: 'Sick',
          use_allowance: false,
          use_personal: false,
          limit: 10
        },
        deductedDays: 4,
        daysTakenForLeaveType: 7
      })
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe('LIMIT_EXCEEDED')
    })
  })

  it('handles fractional deducted days (half day, hourly)', () => {
    const leaveType = {
      use_allowance: true,
      use_personal: false,
      limit: 0
    }

    const halfDay = evaluateLeaveAgainstAllowance({
      allowance: makeAllowance({ regular: 0.5 }),
      leaveType,
      deductedDays: 0.5
    })
    expect(halfDay.ok).toBe(true)

    const tooMuch = evaluateLeaveAgainstAllowance({
      allowance: makeAllowance({ regular: 0.4 }),
      leaveType,
      deductedDays: 0.5
    })
    expect(tooMuch.ok).toBe(false)
    expect(tooMuch.code).toBe('REGULAR_EXHAUSTED')
  })
})

describe('evaluateLeaveAgainstLimit', () => {
  it('passes when no limit is set', () => {
    const verdict = evaluateLeaveAgainstLimit({
      leaveType: { limit: 0 },
      deductedDays: 100
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects when total taken would exceed the limit', () => {
    const verdict = evaluateLeaveAgainstLimit({
      leaveType: { name: 'Sick', limit: 10 },
      deductedDays: 4,
      daysTakenForLeaveType: 7
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('LIMIT_EXCEEDED')
  })

  it('accepts at exact limit boundary', () => {
    const verdict = evaluateLeaveAgainstLimit({
      leaveType: { name: 'Sick', limit: 10 },
      deductedDays: 3,
      daysTakenForLeaveType: 7
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects without leaveType', () => {
    const verdict = evaluateLeaveAgainstLimit({
      deductedDays: 1
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('INVALID_INPUT')
  })
})
