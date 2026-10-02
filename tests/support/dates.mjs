/**
 * Date helpers for integration tests.
 * Prefer weekdays within a single calendar year so bookings are not rejected
 * as inter-year leaves and deducted-day counts stay stable across weekends.
 */

const UTC_DOW = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
}

/** Date-only ISO (UTC), N calendar days from today. */
export function addDaysIso(n) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function addCalendarDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function isUtcWeekday(d) {
  const day = d.getUTCDay()
  return day !== 0 && day !== 6
}

/** Next named weekday on/after `from` + `minAheadDays` (UTC). */
export function nextUtcWeekdayIso(from, dayName, minAheadDays = 7) {
  const target = UTC_DOW[dayName]
  if (target === undefined) {
    throw new Error(`nextUtcWeekdayIso: unknown day ${dayName}`)
  }
  const d = new Date(from)
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + minAheadDays)
  for (let i = 0; i < 21; i++) {
    if (d.getUTCDay() === target) return d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  throw new Error(`nextUtcWeekdayIso: no ${dayName}`)
}

/**
 * Next `count` Mon–Fri dates, each at least `minAheadDays` from today,
 * all in the same calendar year. If the year would roll over, shift into
 * early next year instead of spanning Dec→Jan.
 */
export function nextNWeekdaysIso(count, minAheadDays = 14) {
  if (count < 1) throw new Error('nextNWeekdaysIso: count must be >= 1')
  const start = new Date()
  start.setUTCHours(12, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() + minAheadDays)

  const tryCollect = from => {
    const dates = []
    const d = new Date(from)
    d.setUTCHours(12, 0, 0, 0)
    const year = d.getUTCFullYear()
    for (let i = 0; i < 60 && dates.length < count; i++) {
      if (d.getUTCFullYear() !== year) break
      if (isUtcWeekday(d)) dates.push(d.toISOString().slice(0, 10))
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return dates.length === count ? dates : null
  }

  let dates = tryCollect(start)
  if (!dates) {
    const nextYearStart = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 5, 12))
    dates = tryCollect(nextYearStart)
  }
  if (!dates) {
    throw new Error(`nextNWeekdaysIso: could not find ${count} weekdays in one year`)
  }
  return dates
}

/**
 * Inclusive calendar range of `spanDays` days, entirely in one year,
 * starting at least `minAheadDays` from today. Used for long bookings that
 * must not trip the inter-year leave validator.
 */
export function sameYearRangeIso({ minAheadDays = 14, spanDays = 20 } = {}) {
  const now = new Date()
  now.setUTCHours(12, 0, 0, 0)

  const build = start => {
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + spanDays)
    if (end.getUTCFullYear() !== start.getUTCFullYear()) return null
    return {
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
      year: String(start.getUTCFullYear())
    }
  }

  let start = new Date(now)
  start.setUTCDate(start.getUTCDate() + minAheadDays)
  let range = build(start)
  if (range) return range

  // Not enough days left this year — place the window in early next year.
  start = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 12, 12))
  range = build(start)
  if (range) return range

  throw new Error('sameYearRangeIso: could not place range in one calendar year')
}

/** A single future weekday ISO date (same helper used by quarter-hour tests). */
export function futureWeekdayIso(minAheadDays = 14) {
  return nextNWeekdaysIso(1, minAheadDays)[0]
}
