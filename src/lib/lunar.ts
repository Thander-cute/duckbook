// Vietnamese lunar calendar (Hồ Ngọc Đức's method, UTC+7). Pure arithmetic, no imports.

const TZ = 7
const PI = Math.PI
const INT = Math.floor

function jdFromDate(dd: number, mm: number, yy: number) {
  const a = INT((14 - mm) / 12)
  const y = yy + 4800 - a
  const m = mm + 12 * a - 3
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083
  return jd
}

function jdToDate(jd: number): [number, number, number] {
  let b: number, c: number
  if (jd > 2299160) {
    const a = jd + 32044
    b = INT((4 * a + 3) / 146097)
    c = a - INT((b * 146097) / 4)
  } else {
    b = 0
    c = jd + 32082
  }
  const d = INT((4 * c + 3) / 1461)
  const e = c - INT((1461 * d) / 4)
  const m = INT((5 * e + 2) / 153)
  return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)]
}

function newMoon(k: number) {
  const T = k / 1236.85
  const T2 = T * T
  const T3 = T2 * T
  const dr = PI / 180
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr)
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M)
  C1 -= 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr)
  C1 -= 0.0004 * Math.sin(dr * 3 * Mpr)
  C1 += 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr))
  C1 -= 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M))
  C1 -= 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr))
  C1 += 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M))
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2
  return jd1 + C1 - deltat
}

function sunLongitude(jdn: number) {
  const T = (jdn - 2451545.0) / 36525
  const T2 = T * T
  const dr = PI / 180
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M)
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M)
  let L = (L0 + DL) * dr
  L = L - PI * 2 * INT(L / (PI * 2))
  return L
}

const sunSector = (day: number) => INT((sunLongitude(day - 0.5 - TZ / 24) / PI) * 6)
const newMoonDay = (k: number) => INT(newMoon(k) + 0.5 + TZ / 24)

function lunarMonth11(yy: number) {
  const k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853)
  const nm = newMoonDay(k)
  return sunSector(nm) >= 9 ? newMoonDay(k - 1) : nm
}

function leapMonthOffset(a11: number) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5)
  let last = 0
  let i = 1
  let arc = sunSector(newMoonDay(k + i))
  do {
    last = arc
    i++
    arc = sunSector(newMoonDay(k + i))
  } while (arc !== last && i < 14)
  return i - 1
}

export interface LunarDate { day: number; month: number; year: number; leap: boolean }

export function toLunar(dd: number, mm: number, yy: number): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy)
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853)
  let monthStart = newMoonDay(k + 1)
  if (monthStart > dayNumber) monthStart = newMoonDay(k)
  let a11 = lunarMonth11(yy)
  let b11 = a11
  let year: number
  if (a11 >= monthStart) {
    year = yy
    a11 = lunarMonth11(yy - 1)
  } else {
    year = yy + 1
    b11 = lunarMonth11(yy + 1)
  }
  const day = dayNumber - monthStart + 1
  const diff = INT((monthStart - a11) / 29)
  let leap = false
  let month = diff + 11
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11)
    if (diff >= leapDiff) {
      month = diff + 10
      if (diff === leapDiff) leap = true
    }
  }
  if (month > 12) month -= 12
  if (month >= 11 && diff < 4) year -= 1
  return { day, month, year, leap }
}

/** The solar date [day, month, year] of a lunar date, or null if that leap month does not exist. */
export function fromLunar(day: number, month: number, year: number, leap = false): [number, number, number] | null {
  let a11: number, b11: number
  if (month < 11) {
    a11 = lunarMonth11(year - 1)
    b11 = lunarMonth11(year)
  } else {
    a11 = lunarMonth11(year)
    b11 = lunarMonth11(year + 1)
  }
  let off = month - 11
  if (off < 0) off += 12
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11)
    let leapMonth = leapOff - 2
    if (leapMonth < 0) leapMonth += 12
    if (leap && month !== leapMonth) return null
    if (leap || off >= leapOff) off += 1
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853)
  return jdToDate(newMoonDay(k + off) + day - 1)
}
