/**
 * SPEC §10: en-US date formatting, e.g. 09/20/2026.
 *
 * Dates are stored as plain 'YYYY-MM-DD' strings with no timezone, so they are
 * split by hand rather than passed through Date, which would shift the day for
 * anyone west of UTC.
 */
export function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function formatDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!match) return ''
  const [, year, month, day] = match
  return `${month}/${day}/${year}`
}
