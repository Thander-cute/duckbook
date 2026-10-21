/** A slightly irregular filled blot, like a circle colored in with a pen. Stable per seed. */
export function InkDot({ seed }: { seed: string }) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h % 1000) / 1000)
  const n = 9
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const r = 7.2 + rand() * 1.8
    return [10 + Math.cos(a) * r, 10 + Math.sin(a) * r]
  })
  // Smooth closed curve through the points (Catmull-Rom → cubic Bézier).
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return (
    <svg className="ink-dot" viewBox="0 0 20 20" aria-hidden>
      <path d={d} />
    </svg>
  )
}
