/** The duck head logo, drawn with a slightly rough crayon edge. */
export function DuckMark({ size = 120 }: { size?: number }) {
  return (
    <svg className="duck-mark" width={size} height={(size * 100) / 120} viewBox="0 0 120 100" aria-hidden>
      <defs>
        <filter id="crayon" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="2.6" />
        </filter>
      </defs>
      <g filter="url(#crayon)">
        <path
          d="M41 92 C40 74 41 54 45 38 C50 18 64 8 78 8 C96 8 108 22 108 44 C108 62 107 78 108 92 C86 94 62 94 41 92 Z"
          fill="#f3d27a"
          stroke="#f8e3a6"
          strokeWidth="1.6"
        />
        <path d="M14 51 C14 43 22 40 38 40 C52 40 62 42 63 50 C64 59 54 63 38 63 C22 63 14 60 14 51 Z" fill="#f6a03f" />
        <path d="M13 52.5 C28 54.5 48 54 63 51.5" fill="none" stroke="#f07a14" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <ellipse cx="62" cy="35.5" rx="3.4" ry="3.8" transform="rotate(-8 62 35.5)" fill="#6e4b3b" />
      <ellipse cx="76.5" cy="39" rx="3.4" ry="3.9" transform="rotate(-14 76.5 39)" fill="#6e4b3b" />
    </svg>
  )
}
