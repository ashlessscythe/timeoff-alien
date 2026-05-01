import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const formCheckboxBool = require('../../lib/util/formCheckboxBool.js')

describe('formCheckboxBool', () => {
  it('treats common truthy strings as true', () => {
    expect(formCheckboxBool('on')).toBe(true)
    expect(formCheckboxBool('true')).toBe(true)
    expect(formCheckboxBool('1')).toBe(true)
    expect(formCheckboxBool('yes')).toBe(true)
  })

  it('treats off/false/empty as false', () => {
    expect(formCheckboxBool('off')).toBe(false)
    expect(formCheckboxBool('false')).toBe(false)
    expect(formCheckboxBool('0')).toBe(false)
    expect(formCheckboxBool('no')).toBe(false)
    expect(formCheckboxBool('')).toBe(false)
    expect(formCheckboxBool(undefined)).toBe(false)
    expect(formCheckboxBool(null)).toBe(false)
  })

  it('passes through booleans', () => {
    expect(formCheckboxBool(true)).toBe(true)
    expect(formCheckboxBool(false)).toBe(false)
  })
})
