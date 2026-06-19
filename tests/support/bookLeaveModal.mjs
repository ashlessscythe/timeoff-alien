import { expect } from 'vitest'

/** Parse `<option>` entries from the book-leave modal leave type `<select>`. */
export function parseBookLeaveModalLeaveTypeOptions(html) {
  const options = []
  const selectMatch = html.match(
    /<select[^>]*id="leave_type"[^>]*>([\s\S]*?)<\/select>/i
  )
  if (!selectMatch) return options

  const optionRe = /<option[^>]*value=(?:")?(\d+)(?:")?[^>]*>([^<]*)</gi
  let match
  while ((match = optionRe.exec(selectMatch[1])) !== null) {
    if (match[1] && !match[0].includes('disabled')) {
      options.push({ id: Number(match[1]), name: match[2].trim() })
    }
  }
  return options
}

export function expectBookLeaveModalIncludesLeaveTypes(html, expectedNames) {
  const names = parseBookLeaveModalLeaveTypeOptions(html).map(option => option.name)
  for (const expectedName of expectedNames) {
    expect(names).toContain(expectedName)
  }
  expect(names.length).toBeGreaterThan(0)
}
