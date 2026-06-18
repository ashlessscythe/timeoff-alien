import { expect } from 'vitest'

/** Parse compact ("6d") or verbose ("6 days") day strings from rendered HTML. */
export function parseFormattedDays(text) {
  const t = String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!t || t === '—' || t === '-') return 0

  let m = t.match(/(-?\d+(?:\.\d+)?)\s*d(?:ays?)?\b/i)
  if (m) return Number(m[1])

  m = t.match(/(-?\d+(?:\.\d+)?)\s+days?\b/i)
  if (m) return Number(m[1])

  throw new Error(`Could not parse days from "${text}"`)
}

export function parseUsersCsvRow(csvText, email) {
  const lines = csvText.trim().split('\n')
  const header = lines[0].split(',').map(s => s.replace(/^"|"$/g, ''))
  const idx = Object.fromEntries(header.map((k, i) => [k, i]))
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map(s => s.replace(/^"|"$/g, ''))
    if ((cols[idx.email] || '').toLowerCase() === email.toLowerCase()) {
      const num = key => {
        const v = cols[idx[key]]
        return v === '' || v == null ? null : Number(v)
      }
      return {
        remaining_allowance: num('remaining_allowance'),
        remaining_personal: num('remaining_personal'),
        remaining_vacation: num('remaining_vacation'),
        days_used: num('days_used'),
        nominal_allowance: num('nominal_allowance'),
        nominal_personal: num('nominal_personal'),
        manual_adjustment: num('manual_adjustment'),
        personal_adjustment: num('personal_adjustment'),
        carried_over_allowance: num('carried_over_allowance')
      }
    }
  }
  throw new Error(`CSV row not found for ${email}`)
}

export function parseCalendarBigNumbers(html) {
  const vacation = parseCalendarBigNumber(html, 'data-tom-days-available-in-allowance')
  const personalSpanRe = new RegExp(
    'data-tom-days-available-in-allowance[\\s\\S]*?<\\/span>' +
      '\\s*<span class="slash"[\\s\\S]*?<\\/span>' +
      '\\s*<span class="big-number[^"]*"[^>]*>\\s*([\\s\\S]*?)\\s*<\\/span>',
    'i'
  )
  const personalSpan = html.match(personalSpanRe)
  if (!personalSpan) throw new Error('Could not locate personal big-number span on calendar')
  const pd = personalSpan[1].match(/(-)?\s*(\d+(?:\.\d+)?)d/i)
  if (!pd) throw new Error('Could not parse personal days from calendar')
  const personal = (pd[1] ? -1 : 1) * Number(pd[2])
  return { vacation, personal }
}

export function parseCalendarBigNumber(html, marker) {
  const re = new RegExp(
    `<span[^>]*${marker}[^>]*>\\s*([\\s\\S]*?)\\s*<\\/span>`,
    'i'
  )
  const m = html.match(re)
  if (!m) throw new Error(`Could not find calendar marker ${marker}`)
  const chunk = m[1]
  const dm = chunk.match(/(-)?\s*(\d+(?:\.\d+)?)d/i)
  if (!dm) throw new Error(`Could not parse days from ${marker} chunk`)
  const sign = dm[1] ? -1 : 1
  const days = Number(dm[2])
  const hm = chunk.match(/(\d+(?:\.\d+)?)h/i)
  const hours = hm ? Number(hm[1]) : 0
  return sign * (days + hours / 8)
}

export function parseAbsencesProgress(html) {
  const usedMatch = html.match(/([0-9]+(?:\.[0-9]+)?)\s+days\s+used\s+so\s+far/i)
  const remMatch = html.match(/([0-9]+(?:\.[0-9]+)?)\s+days\s+remaining/i)
  if (!usedMatch || !remMatch) {
    throw new Error('Could not parse used/remaining from absences progress bar')
  }
  return {
    used: Number(usedMatch[1]),
    remaining: Number(remMatch[1])
  }
}

export function parseAbsencesAvailable(html) {
  const m = html.match(
    /user-allowance-negative[^>]*>([^<]+)<\/span>\s+out of\s+([^<]+)\s+in allowance/i
  )
  if (m) {
    return {
      available: parseFormattedDays(m[1]),
      total: parseFormattedDays(m[2])
    }
  }
  const m2 = html.match(/>([^<]+)<\/span>\s+out of\s+([^<]+)\s+in allowance/i)
  if (!m2) throw new Error('Could not parse available/total from absences page')
  return {
    available: parseFormattedDays(m2[1]),
    total: parseFormattedDays(m2[2])
  }
}

export function parseAbsencesBreakdownTaken(html) {
  const m = html.match(
    /Used or requested so far[\s\S]*?float-end[^>]*>([^<]+)</i
  )
  if (!m) throw new Error('Could not parse "Used or requested so far" from absences')
  const raw = m[1].trim()
  if (raw === '-') return 0
  return parseFormattedDays(raw)
}

export function parseUsersListRow(html, userId) {
  const rowRe = new RegExp(
    `<tr[^>]*data-vpp-user-row="${userId}"[\\s\\S]*?<\\/tr>`,
    'i'
  )
  const rowMatch = html.match(rowRe)
  if (!rowMatch) throw new Error(`Users list row not found for user ${userId}`)
  const row = rowMatch[0]
  const remMatch = row.match(/vpp-days-remaining[^>]*>([^<]+)/i)
  const usedMatch = row.match(/vpp-days-used[^>]*>([^<]+)/i)
  if (!remMatch || !usedMatch) {
    throw new Error(`Could not parse allowance columns for user ${userId}`)
  }
  return {
    remaining: parseFormattedDays(remMatch[1]),
    days_used: parseFormattedDays(usedMatch[1])
  }
}

/** Admin/manager detailed popup: `[6d reg, 1d pers] out of 10d total.` */
export function parseSummaryPopup(html) {
  if (!/Available:/i.test(html)) return null
  const m = html.match(
    /Available:<\/strong>\s*\[([^\]]+)\]\s*out of\s*([^.<]+(?:\.[^.<]+)?)/i
  )
  if (!m) throw new Error('Could not parse summary popup Available block')
  const bracket = m[1]
  const regM = bracket.match(/([\d.]+)\s*d(?:ays?)?\s*reg/i)
  const perM =
    bracket.match(/([\d.]+)\s*d(?:ays?)?\s*pers/i) ||
    bracket.match(/0\s+days\s*pers/i)
  const totalRaw = m[2].trim()
  const totalM = totalRaw.match(/([\d.]+)\s*d(?:ays?)?/i) || totalRaw.match(/([\d.]+)\s+days?/i)
  if (!regM || !totalM) throw new Error(`Could not parse summary bracket: ${bracket}`)
  return {
    regular: Number(regM[1]),
    personal: perM ? (perM[0].startsWith('0') ? 0 : Number(perM[1])) : 0,
    total: Number(totalM[1])
  }
}

/**
 * Cross-surface invariants for the vacation/personal split model.
 * @param {object} b
 * @param {{ poolTotal?: number, allowPendingSplit?: boolean }} opts
 */
export function assertBalanceInvariants(b, opts = {}) {
  const { poolTotal, allowPendingSplit = false } = opts

  expect(b.remaining_allowance).toBeCloseTo(
    b.remaining_vacation + b.remaining_personal,
    5
  )
  expect(b.calendar_vacation).toBeCloseTo(b.remaining_vacation, 5)
  expect(b.calendar_personal).toBeCloseTo(b.remaining_personal, 5)

  if (b.summary) {
    expect(b.summary.regular).toBeCloseTo(b.remaining_vacation, 5)
    expect(b.summary.personal).toBeCloseTo(b.remaining_personal, 5)
    if (poolTotal != null) expect(b.summary.total).toBeCloseTo(poolTotal, 5)
  }

  if (b.users_list) {
    expect(b.users_list.remaining).toBeCloseTo(b.remaining_allowance, 5)
    expect(b.users_list.days_used).toBeCloseTo(b.days_used_csv, 5)
  }

  if (b.absences) {
    expect(b.absences.available).toBeCloseTo(b.remaining_allowance, 5)
    if (allowPendingSplit) {
      expect(b.absences.used).toBeCloseTo(b.days_used_with_pending, 5)
      expect(b.absences.remaining).toBeCloseTo(b.remaining_allowance, 5)
    } else {
      expect(b.absences.used).toBeCloseTo(b.days_used_with_pending, 5)
      expect(b.absences.remaining).toBeCloseTo(b.remaining_allowance, 5)
      expect(b.days_used_csv).toBeCloseTo(b.days_used_with_pending, 5)
    }
  }

  if (poolTotal != null && !allowPendingSplit) {
    expect(b.remaining_allowance + b.days_used_csv).toBeCloseTo(poolTotal, 5)
  }
}

/**
 * Fetch balance numbers from every user-visible surface (via admin/viewer agent).
 */
export async function collectBalanceSnapshots(viewerAgent, {
  userId,
  email,
  year,
  selfCalendarAgent = null
}) {
  const yearQ = `year=${year}`
  const calendarAgent = selfCalendarAgent || viewerAgent

  const [csvRes, usersRes, editCalRes, absRes, summaryRes, selfCalRes] =
    await Promise.all([
      viewerAgent.get('/users/?as-csv=1').redirects(0),
      viewerAgent.get('/users/').redirects(5),
      viewerAgent
        .get(`/users/edit/${userId}/calendar/?${yearQ}`)
        .redirects(5),
      viewerAgent
        .get(`/users/edit/${userId}/absences/?${yearQ}`)
        .redirects(5),
      viewerAgent.get(`/users/summary/${userId}/`).redirects(5),
      calendarAgent.get(`/calendar/?${yearQ}`).redirects(5)
    ])

  expect(csvRes.status).toBe(200)
  expect(usersRes.status).toBe(200)
  expect(editCalRes.status).toBe(200)
  expect(absRes.status).toBe(200)
  expect(summaryRes.status).toBe(200)
  expect(selfCalRes.status).toBe(200)

  const csv = parseUsersCsvRow(csvRes.text, email)
  const usersList = parseUsersListRow(usersRes.text, userId)
  const editCalendar = parseCalendarBigNumbers(editCalRes.text)
  const selfCalendar = parseCalendarBigNumbers(selfCalRes.text)
  const absencesProgress = parseAbsencesProgress(absRes.text)
  const absencesAvailable = parseAbsencesAvailable(absRes.text)
  const breakdownTaken = parseAbsencesBreakdownTaken(absRes.text)
  const summary = parseSummaryPopup(summaryRes.text)

  expect(editCalendar).toEqual(selfCalendar)

  return {
    csv,
    users_list: usersList,
    edit_calendar: editCalendar,
    self_calendar: selfCalendar,
    absences: {
      ...absencesProgress,
      available: absencesAvailable.available,
      total: absencesAvailable.total,
      breakdown_taken: breakdownTaken
    },
    summary,
    remaining_allowance: csv.remaining_allowance,
    remaining_personal: csv.remaining_personal,
    remaining_vacation: csv.remaining_vacation,
    days_used_csv: csv.days_used,
    days_used_with_pending: breakdownTaken,
    calendar_vacation: selfCalendar.vacation,
    calendar_personal: selfCalendar.personal
  }
}
