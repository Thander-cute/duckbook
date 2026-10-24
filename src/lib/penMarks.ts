// Hand-written marks for the habit circles, drawn as filled outlines so the line swells and
// thins like ink from a pen. Coordinates are in a 20×20 box with the printed circle at its centre.
type Pt = [number, number]

export function rng(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h % 1000) / 1000)
}

const qbez = (a: Pt, c: Pt, b: Pt, n: number): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const u = 1 - t
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]
  })

function outline(pts: Pt[], width: (t: number) => number) {
  const L: Pt[] = []
  const R: Pt[] = []
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = -(b[1] - a[1]) / len
    const ny = (b[0] - a[0]) / len
    const w = width(i / (pts.length - 1)) / 2
    L.push([p[0] + nx * w, p[1] + ny * w])
    R.push([p[0] - nx * w, p[1] - ny * w])
  })
  const f = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`
  return `M${L.map(f).join(' L')} L${R.reverse().map(f).join(' L')} Z`
}

/** A quick check: a short dip, then a long flick that runs a little past the ring. */
export function tickPath(seed: string) {
  const r = rng(seed)
  const j = (s: number) => (r() - 0.5) * s
  const a: Pt = [4.4 + j(1), 9.4 + j(1.2)]
  const b: Pt = [8.3 + j(0.8), 14.8 + j(0.6)]
  const c: Pt = [19 + j(1.2), 1.8 + j(1.4)]
  const down = qbez(a, [6 + j(0.6), 12.8], b, 10)
  const up = qbez(b, [11.2 + j(1), 7.4 + j(1)], c, 20)
  const pts = [...down, ...up.slice(1)]
  const k = down.length / pts.length
  // Light touch-down, heaviest at the bottom turn, lifting off to a fine tail.
  return outline(pts, (t) => (t < k ? 0.9 + (t / k) * 1.5 : 2.4 - ((t - k) / (1 - k)) ** 0.8 * 2))
}

/** The circle shaded with separate pen lines, one stroke each, even in weight but never quite straight or equal. Drawn as a stroke. */
export function hatchPath(seed: string) {
  const r = rng(seed)
  const n = 6
  const base = -0.85 + (r() - 0.5) * 0.2
  const R = 8.3
  const f = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    const ang = base + (r() - 0.5) * 0.12
    const d: Pt = [Math.cos(ang), Math.sin(ang)]
    const perp: Pt = [-d[1], d[0]]
    const off = -R * 0.78 + (i / (n - 1)) * R * 1.56 + (r() - 0.5) * 0.5
    const half = Math.sqrt(Math.max(R * R - off * off, 3))
    const at = (k: number, wob: number): Pt => [10 + perp[0] * (off + wob) + d[0] * k, 10 + perp[1] * (off + wob) + d[1] * k]
    const from = -half * (0.84 + r() * 0.2)
    const to = half * (0.86 + r() * 0.2)
    const c1 = at(from + (to - from) / 3, (r() - 0.5) * 0.9)
    const c2 = at(from + ((to - from) * 2) / 3, (r() - 0.5) * 0.9)
    lines.push(`M${f(at(from, 0))} C${f(c1)} ${f(c2)} ${f(at(to, (r() - 0.5) * 0.4))}`)
  }
  return lines.join(' ')
}
