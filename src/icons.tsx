// Small line icons, drawn inline so they follow the text colour.
type P = { size?: number }
const base = (size = 22) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  'stroke-width': 1.8, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const, 'aria-hidden': true,
})

export const IconBack = ({ size }: P) => <svg {...base(size)}><path d="M15 5l-7 7 7 7" /></svg>
export const IconNext = ({ size }: P) => <svg {...base(size)}><path d="M9 5l7 7-7 7" /></svg>
export const IconSearch = ({ size }: P) => <svg {...base(size)}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
export const IconPrint = ({ size }: P) => <svg {...base(size)}><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 14h10v6H7z" /></svg>
export const IconPlus = ({ size }: P) => <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
export const IconMinus = ({ size }: P) => <svg {...base(size)}><path d="M5 12h14" /></svg>
export const IconList = ({ size }: P) => <svg {...base(size)}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></svg>
export const IconMoon = ({ size }: P) => <svg {...base(size)}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
export const IconSun = ({ size }: P) => <svg {...base(size)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
export const IconClose = ({ size }: P) => <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const IconUp = ({ size }: P) => <svg {...base(size)}><path d="M6 15l6-6 6 6" /></svg>
export const IconDown = ({ size }: P) => <svg {...base(size)}><path d="M6 9l6 6 6-6" /></svg>
export const IconShare = ({ size }: P) => <svg {...base(size)}><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" /></svg>
export const IconCheck = ({ size }: P) => <svg {...base(size)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
export const IconTrash = ({ size }: P) => <svg {...base(size)}><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
export const IconZoomIn = ({ size }: P) => <svg {...base(size)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5l5 5M10.5 7.5v6M7.5 10.5h6" /></svg>
export const IconZoomOut = ({ size }: P) => <svg {...base(size)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5l5 5M7.5 10.5h6" /></svg>
export const IconListAdd = ({ size }: P) => <svg {...base(size)}><path d="M4 6h11M4 12h11M4 18h7M18 14v7M14.5 17.5h7" /></svg>

/** A key name with a tight accidental: "Ab" -> A♭ without the wide gap of the CJK font's glyph. */
export function KeyName({ tonic, minor = false }: { tonic: string; minor?: boolean }) {
  const letter = tonic.charAt(0)
  const acc = tonic.includes('b') ? '♭' : tonic.includes('#') ? '♯' : ''
  return (
    <span class="keyname">
      {letter}
      {acc ? <span class="acc">{acc}</span> : null}
      {minor ? 'm' : null}
    </span>
  )
}
export const IconGlobe = ({ size }: P) => <svg {...base(size)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" /></svg>
