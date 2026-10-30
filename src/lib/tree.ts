// A page as a set of leaves, the unit sync merges, and the three-way merge built on them.
// Objects and lists become markers; list items with an id (or a photo hash) are addressed by it,
// so two devices adding tasks never collide. Shared by the browser and the server: no imports.

export type Seg = string | number | { id: string }
export type Path = Seg[]

export const OBJ = { $: 'obj' } as const
export const DEL = { $: 'del' } as const
export type Marker = { $: 'obj' } | { $: 'del' } | { $: 'arr'; n: number } | { $: 'keyed' }
export type LeafValue = string | number | boolean | null | string[] | Marker

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isMarker = (v: unknown): v is Marker => isObj(v) && typeof v.$ === 'string'
export const isDel = (v: unknown) => isMarker(v) && v.$ === 'del'

export const pathKey = (p: Path) => JSON.stringify(p)
export const parsePath = (s: string) => JSON.parse(s) as Path

const TEXT = new Set(['theme', 'notes', 'text', 'goal', 'selfCare', 'checkin', 'success', 'lesson', 'future', 'more', 'grateful', 'sentence', 'name'])

/** Free text merged character by character; every other value is last-writer-wins. */
export function isTextPath(p: Path): boolean {
  const last = p[p.length - 1]
  if (typeof last !== 'string') return false
  return TEXT.has(last) || p[p.length - 2] === 'cells'
}

const itemId = (v: unknown): string | null => (isObj(v) ? (typeof v.id === 'string' ? v.id : typeof v.full === 'string' ? v.full : null) : null)

export function flatten(value: unknown, path: Path = [], out = new Map<string, LeafValue>()) {
  if (Array.isArray(value)) {
    const ids = value.map(itemId)
    if (value.length && ids.every((x) => x !== null)) {
      out.set(pathKey(path), { $: 'keyed' })
      out.set(pathKey([...path, '@order']), ids as string[])
      value.forEach((v, i) => flatten(v, [...path, { id: ids[i]! }], out))
    } else {
      out.set(pathKey(path), { $: 'arr', n: value.length })
      value.forEach((v, i) => flatten(v, [...path, i], out))
    }
  } else if (isObj(value)) {
    out.set(pathKey(path), OBJ)
    for (const [k, v] of Object.entries(value)) if (v !== undefined) flatten(v, [...path, k], out)
  } else out.set(pathKey(path), value as LeafValue)
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Leaves to write so `before` becomes `after`. Removed subtrees get one tombstone at their top. */
export function diff(before: Map<string, LeafValue>, after: Map<string, LeafValue>): Map<string, LeafValue> {
  const out = new Map<string, LeafValue>()
  for (const [k, v] of after) if (!before.has(k) || !same(before.get(k), v)) out.set(k, v)
  const removed = [...before.keys()].filter((k) => !after.has(k))
  const gone = new Set(removed)
  for (const k of removed) {
    const p = parsePath(k)
    let covered = false
    for (let i = p.length - 1; i >= 0 && !covered; i--) covered = gone.has(pathKey(p.slice(0, i)))
    if (!covered) out.set(k, DEL)
  }
  return out
}

interface Node { leaf?: { value: LeafValue; ts: string }; kids: Map<string, { seg: Seg; node: Node }> }

/** Build a page back from its leaves. `undefined` when the page itself is absent or deleted. */
export function unflatten(leaves: Iterable<{ path: Path; value: LeafValue; ts: string }>): unknown {
  const root: Node = { kids: new Map() }
  for (const l of leaves) {
    let n = root
    for (const seg of l.path) {
      const k = JSON.stringify(seg)
      if (!n.kids.has(k)) n.kids.set(k, { seg, node: { kids: new Map() } })
      n = n.kids.get(k)!.node
    }
    n.leaf = { value: l.value, ts: l.ts }
  }
  return build(root)
}

function build(n: Node): unknown {
  const v = n.leaf?.value
  if (v === undefined || isDel(v)) return undefined
  if (!isMarker(v)) return v
  const kids = [...n.kids.values()]
  if (v.$ === 'obj') {
    const o: Record<string, unknown> = {}
    for (const { seg, node } of kids) {
      if (typeof seg !== 'string') continue
      const x = build(node)
      if (x !== undefined) o[seg] = x
    }
    return o
  }
  // A list emptied on one device while another added to it still shows the added items.
  if (v.$ === 'arr' && !kids.some((k) => typeof k.seg === 'object')) {
    const a: unknown[] = []
    for (const { seg, node } of kids) {
      if (typeof seg !== 'number' || seg >= v.n) continue
      const x = build(node)
      if (x !== undefined) a[seg] = x
    }
    return Array.from({ length: v.n }, (_, i) => a[i]).filter((x) => x !== undefined)
  }
  // Keyed list: the stored order first, then items another device added, oldest first.
  const items = new Map<string, { value: unknown; ts: string }>()
  for (const { seg, node } of kids) {
    if (typeof seg !== 'object') continue
    const x = build(node)
    if (x !== undefined) items.set(seg.id, { value: x, ts: node.leaf!.ts })
  }
  const orderNode = n.kids.get(JSON.stringify('@order'))?.node.leaf?.value
  const order = Array.isArray(orderNode) ? orderNode.filter((id, i, all) => items.has(id) && all.indexOf(id) === i) : []
  const rest = [...items.keys()].filter((id) => !order.includes(id)).sort((a, b) => items.get(a)!.ts.localeCompare(items.get(b)!.ts) || a.localeCompare(b))
  return [...order, ...rest].map((id) => items.get(id)!.value)
}

// ───────── three-way merge: put the edits from `base` to `mine` on top of `current`, which moved on meanwhile ─────────

/** Merge two edits of one text. Edits in different places both apply; overlapping ones keep both versions. */
export function merge3(base: string, mine: string, theirs: string): string {
  if (mine === base || mine === theirs) return theirs
  if (theirs === base) return mine
  const region = (s: string) => {
    let a = 0
    while (a < base.length && a < s.length && base[a] === s[a]) a++
    let b = 0
    while (b < base.length - a && b < s.length - a && base[base.length - 1 - b] === s[s.length - 1 - b]) b++
    return { start: a, end: base.length - b, text: s.slice(a, s.length - b) }
  }
  const m = region(mine)
  const t = region(theirs)
  if (m.end <= t.start) return base.slice(0, m.start) + m.text + base.slice(m.end, t.start) + t.text + base.slice(t.end)
  if (t.end <= m.start) return base.slice(0, t.start) + t.text + base.slice(t.end, m.start) + m.text + base.slice(m.end)
  const start = Math.min(m.start, t.start)
  const end = Math.max(m.end, t.end)
  const seg = (s: string) => s.slice(start, s.length - (base.length - end))
  return base.slice(0, start) + seg(theirs) + seg(mine) + base.slice(end)
}

export function rebaseDoc(base: unknown, mine: unknown, current: unknown): unknown {
  const b = flatten(base)
  const m = flatten(mine)
  const c = flatten(current)
  const out = new Map(c)
  for (const [k, v] of m) {
    if (b.has(k) && JSON.stringify(b.get(k)) === JSON.stringify(v)) continue
    const bv = b.get(k)
    const cv = out.get(k)
    if (typeof v === 'string' && typeof bv === 'string' && typeof cv === 'string' && isTextPath(parsePath(k))) out.set(k, merge3(bv, v, cv))
    else out.set(k, v)
  }
  for (const k of b.keys()) if (!m.has(k)) out.set(k, DEL)
  // Lists keep the current order with my new items appended; an item I removed stays removed.
  for (const [k, v] of m) {
    if (!Array.isArray(v)) continue
    const removed = new Set((b.get(k) as string[] | undefined)?.filter((id) => !v.includes(id)) ?? [])
    const cur = ((c.get(k) as string[] | undefined) ?? []).filter((id) => !removed.has(id))
    out.set(k, [...cur, ...v.filter((id) => !cur.includes(id))])
  }
  return unflatten([...out].filter(([, v]) => !isDel(v)).map(([k, value]) => ({ path: parsePath(k), value: value as LeafValue, ts: '' })))
}
