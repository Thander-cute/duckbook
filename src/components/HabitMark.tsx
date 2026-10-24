import { InkDot } from "./InkDot";
import { useHabitMark } from "../lib/habitMark";

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => (
    (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0),
    (h % 1000) / 1000
  );
}

/** A habit's day: blank, or marked done in the style chosen in Settings (ink dot, hatched box, tick). */
export function HabitMark({ on, seed }: { on: boolean; seed: string }) {
  const style = useHabitMark();
  if (style === "hatch") {
    if (!on) return <span className="pomo-ring is-box" />;
    const r = rng(seed);
    // Pen strokes from bottom-left to top-right, a little uneven, filling the whole box.
    const d = Array.from({ length: 8 }, (_, i) => {
      const k = -12 + i * 4.4 + r() * 0.8;
      return `M${(2 + k).toFixed(1)},${(18 + r() * 0.8).toFixed(1)} L${(18 + k).toFixed(1)},${(2 - r() * 0.8).toFixed(1)}`;
    }).join(" ");
    return (
      <svg className="ink-dot habit-hatch" viewBox="0 0 20 20" aria-hidden>
        <clipPath id={`hb-${seed}`}>
          <rect x="1.5" y="1.5" width="17" height="17" rx="3" />
        </clipPath>
        <rect x="1.5" y="1.5" width="17" height="17" rx="3" />
        <path d={d} clipPath={`url(#hb-${seed})`} />
      </svg>
    );
  }
  if (style === "tick") {
    if (!on) return <span className="pomo-ring" />;
    const r = rng(seed);
    const j = () => (r() - 0.5) * 1.2;
    return (
      <svg className="ink-dot habit-tick" viewBox="0 0 20 20" aria-hidden>
        <path
          d={`M${3.5 + j()},${10.5 + j()} Q${6 + j()},${12.5} ${8 + j()},${16 + j()} Q${11},${8.5 + j()} ${17.5 + j()},${3.5 + j()}`}
        />
      </svg>
    );
  }
  return on ? <InkDot seed={seed} /> : <span className="pomo-ring" />;
}
