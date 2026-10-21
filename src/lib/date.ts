// Dates are stored as local "YYYY-MM-DD" keys; months as "YYYY-MM".

export const pad = (n: number) => String(n).padStart(2, '0')

export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const fromKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export const todayKey = () => toKey(new Date())

export const monthKeyOf = (key: string) => key.slice(0, 7)

export const addDays = (key: string, n: number) => {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

export const addMonths = (key: string, n: number) => {
  const d = fromKey(key)
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), last))
  return toKey(target)
}

/** Monday of the week containing `key`. */
export const weekStart = (key: string) => {
  const d = fromKey(key)
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return toKey(d)
}

/** 0 = Monday … 6 = Sunday */
export const weekdayIndex = (key: string) => (fromKey(key).getDay() + 6) % 7

export const weekDays = (mondayKey: string) => Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i))

export const isoWeek = (key: string) => {
  const d = fromKey(key)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

/** Calendar rows (Mon-first) covering the month; days outside the month are null. */
export const monthGrid = (monthKey: string): (string | null)[][] => {
  const [y, m] = monthKey.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const days = new Date(y, m, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let i = 1; i <= days; i++) cells.push(`${monthKey}-${pad(i)}`)
  while (cells.length % 7) cells.push(null)
  const rows = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

export const daysInMonth = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const WEEKDAYS_MIN = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su']

export const fmtShort = (key: string) => {
  const d = fromKey(key)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

export const fmtLong = (key: string) => {
  const d = fromKey(key)
  return `${WEEKDAYS[weekdayIndex(key)]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export const fmtMonth = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}
