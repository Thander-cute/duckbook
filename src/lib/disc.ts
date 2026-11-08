// A person's DISC mix: how much of each type, as whole percentages. The largest is the main colour.
// Pure arithmetic, no imports beyond types.
import type { DiscMix, DiscType } from './schema.ts'

export type Segment = [DiscType, number]

const STEP = 5
const EXTRA = 10

/** Whole numbers that keep these shares' proportions and add up to exactly 100. */
function toHundred(items: Segment[]): Segment[] {
  const total = items.reduce((n, [, v]) => n + v, 0)
  if (!total) return []
  const exact = items.map(([k, v]) => ({ k, whole: Math.floor((v * 100) / total), rest: ((v * 100) / total) % 1 }))
  let left = 100 - exact.reduce((n, x) => n + x.whole, 0)
  for (const x of [...exact].sort((a, b) => b.rest - a.rest)) {
    if (left-- <= 0) break
    x.whole++
  }
  return exact.map((x): Segment => [x.k, x.whole])
}

/** The mix as bar segments, largest first; ties keep the order they were picked in. */
export function segments(mix: DiscMix): Segment[] {
  const items = Object.entries(mix) as Segment[]
  return toHundred(items).sort((a, b) => b[1] - a[1])
}

export const toMix = (items: Segment[]): DiscMix => Object.fromEntries(items) as DiscMix

/** An even share of the bar, the first pick taking any odd points. */
function even(keys: DiscType[]): DiscMix {
  const each = Math.floor(100 / keys.length)
  return toMix(keys.map((k, i): Segment => [k, i === 0 ? 100 - each * (keys.length - 1) : each]))
}

/**
 * Most people are a main colour and a second one: those two share the bar evenly. A further colour
 * keeps the shares already set and takes a little from the largest; when the largest two are level
 * it comes from the later one, so the main colour stays main.
 */
export function withType(mix: DiscMix, type: DiscType): DiscMix {
  const items = segments(mix)
  if (items.length < 2) return even([...(Object.keys(mix) as DiscType[]), type])
  let from = 0
  while (from + 1 < items.length && items[from + 1][1] === items[0][1]) from++
  const taken = Object.fromEntries(items) as DiscMix
  taken[items[from][0]] = items[from][1] - EXTRA
  return { ...taken, [type]: EXTRA }
}

/** Dropping a colour keeps the others in proportion; ones still evenly shared stay even, not 51 and 49. */
export function withoutType(mix: DiscMix, type: DiscType): DiscMix {
  const rest = (Object.entries(mix) as Segment[]).filter(([k]) => k !== type)
  const values = rest.map(([, v]) => v)
  if (rest.length && Math.max(...values) - Math.min(...values) <= 1) return even(rest.map(([k]) => k))
  return toMix(toHundred(rest))
}

/** Move the line after segment `i` to `at` percent along the bar, in steps, leaving each side at least one step. */
export function moveLine(items: Segment[], i: number, at: number): Segment[] {
  const before = items.slice(0, i).reduce((n, [, v]) => n + v, 0)
  const pair = items[i][1] + items[i + 1][1]
  if (pair < STEP * 2) return items
  const left = Math.min(pair - STEP, Math.max(STEP, Math.round(at / STEP) * STEP - before))
  const next = [...items]
  next[i] = [items[i][0], left]
  next[i + 1] = [items[i + 1][0], pair - left]
  return next
}

export const DISC_STEP = STEP
