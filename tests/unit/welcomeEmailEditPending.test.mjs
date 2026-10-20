import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', '..')

/**
 * Welcome emails should mention editing pending leave requests
 * (feature from PR #39: "feat: edit pending leave requests").
 */
describe('welcome email mentions edit pending leave requests', () => {
  it('add_new_user welcome template mentions editing pending leave requests', () => {
    const src = fs.readFileSync(
      path.join(root, 'views/email/add_new_user.hbs'),
      'utf8'
    )
    expect(src).toMatch(/edit pending leave requests/i)
  })

  it('registration_complete template mentions editing pending leave requests', () => {
    const src = fs.readFileSync(
      path.join(root, 'views/email/registration_complete.hbs'),
      'utf8'
    )
    expect(src).toMatch(/edit pending leave requests/i)
  })
})
