// What a calendar day is remembered for: Vietnamese holidays, birthdays from Contacts, and days the
// person added. Worked out on read; nothing here is stored.
import { toLunar, type LunarDate } from './lunar'
import { useStore, type Contact, type Occasion } from './store'

export type OccasionKind = 'holiday' | 'birthday' | 'custom'
/** `short` is what fits in a Month cell; `label` is the full wording. */
export interface DayOccasion { kind: OccasionKind; label: string; short?: string; id?: string }

const SOLAR: [number, number, string][] = [
  [1, 1, 'Tết Dương lịch'],
  [14, 2, 'Valentine'],
  [8, 3, 'Quốc tế Phụ nữ'],
  [30, 4, 'Giải phóng miền Nam'],
  [1, 5, 'Quốc tế Lao động'],
  [1, 6, 'Quốc tế Thiếu nhi'],
  [2, 9, 'Quốc khánh'],
  [20, 10, 'Phụ nữ Việt Nam'],
  [20, 11, 'Nhà giáo Việt Nam'],
  [24, 12, 'Đêm Giáng sinh'],
  [25, 12, 'Giáng sinh'],
]

const LUNAR: [number, number, string][] = [
  [1, 1, 'Tết Nguyên đán'],
  [2, 1, 'Mùng 2 Tết'],
  [3, 1, 'Mùng 3 Tết'],
  [15, 1, 'Rằm tháng Giêng'],
  [3, 3, 'Tết Hàn thực'],
  [10, 3, 'Giỗ Tổ Hùng Vương'],
  [15, 4, 'Phật đản'],
  [5, 5, 'Tết Đoan ngọ'],
  [15, 7, 'Vu Lan'],
  [15, 8, 'Trung thu'],
  [23, 12, 'Ông Công Ông Táo'],
]

const lunarCache = new Map<string, LunarDate>()
export function lunarOf(key: string): LunarDate {
  let l = lunarCache.get(key)
  if (!l) {
    const [y, m, d] = key.split('-').map(Number)
    l = toLunar(d, m, y)
    lunarCache.set(key, l)
  }
  return l
}

const nextKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(y, m - 1, d + 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** The last day of a lunar month, so a "30th" falls on the 29th in a short month. */
const lastOfLunarMonth = (key: string) => lunarOf(nextKey(key)).day === 1

/** Whether a yearly day lands on this calendar day. Solar 29 Feb shows on 28 Feb in other years; lunar days ignore leap months. */
function falls(key: string, day: number, month: number, lunar: boolean) {
  if (lunar) {
    const l = lunarOf(key)
    if (l.leap || l.month !== month) return false
    return l.day === day || (day === 30 && l.day === 29 && lastOfLunarMonth(key))
  }
  const m = Number(key.slice(5, 7))
  const d = Number(key.slice(8))
  if (m !== month) return false
  if (d === day) return true
  return day === 29 && month === 2 && d === 28 && nextKey(key).slice(5) === '03-01'
}

/** Age turned on this day, when the birth year is known. */
function turns(key: string, c: Contact) {
  if (c.year === null) return null
  const n = Number(key.slice(0, 4)) - c.year
  return n > 0 ? n : null
}

export function occasionsOn(key: string, opts: { holidays: boolean; people: Contact[] | null; days: Occasion[] }): DayOccasion[] {
  const out: DayOccasion[] = []
  if (opts.holidays) {
    for (const [d, m, label] of SOLAR) if (falls(key, d, m, false)) out.push({ kind: 'holiday', label })
    for (const [d, m, label] of LUNAR) if (falls(key, d, m, true)) out.push({ kind: 'holiday', label })
    const l = lunarOf(key)
    if (l.month === 12 && !l.leap && lastOfLunarMonth(key)) out.push({ kind: 'holiday', label: 'Giao thừa' })
  }
  for (const o of opts.days) if (falls(key, o.day, o.month, false)) out.push({ kind: 'custom', label: o.name.trim() || 'A day to remember', id: o.id })
  for (const c of opts.people ?? []) {
    if (c.day === null || c.month === null || !falls(key, c.day, c.month, false)) continue
    const name = c.name.trim() || 'Someone'
    const age = turns(key, c)
    out.push({ kind: 'birthday', label: age ? `${name} turns ${age}` : `${name}’s birthday`, short: name, id: c.id })
  }
  return out
}

/** Looks up a day's occasions with the current add-on settings: one switch for holidays and own days, one for Contacts. */
export function useOccasionsOf() {
  const holidays = useStore((s) => s.settings.modules.holidays)
  const contactsOn = useStore((s) => s.settings.modules.contacts)
  const people = useStore((s) => s.contacts.people)
  const days = useStore((s) => s.occasions.days)
  return (key: string) => occasionsOn(key, { holidays, people: contactsOn ? people : null, days: holidays ? days : [] })
}
