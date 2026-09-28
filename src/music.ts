// Key math and lyric filtering. Pure functions, no rendering.

export type LyricMode = 'both' | 'ko' | 'en'

const MAJOR_BY_FIFTHS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const MINOR_BY_FIFTHS = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']

const PC: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}

/** The 12 choices shown in the key picker, one per pitch class. */
export const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
// OSMD spells the minor key a tritone above C as D-sharp minor, so the chip says D# to match the page
export const MINOR_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']

export function originalTonic(fifths: number, minor: boolean): string {
  const f = Math.max(-7, Math.min(7, fifths))
  return (minor ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[f + 7]
}

export function pitchClass(name: string): number {
  return PC[name] ?? 0
}

export function isKeyName(name: string | undefined | null): name is string {
  return !!name && name in PC
}

/** Pretty key label: "Ab" -> "A♭", minor adds "m". */
export function keyLabel(tonic: string, minor = false): string {
  return tonic.replace('b', '♭').replace('#', '♯') + (minor ? 'm' : '')
}

/** The same pitch class spelled from our chip list, so the picker can mark the original. */
export function chipFor(tonic: string, minor: boolean): string {
  const pc = pitchClass(tonic)
  return (minor ? MINOR_KEYS : MAJOR_KEYS).find(k => pitchClass(k) === pc) ?? tonic
}

export type Direction = 'auto' | 'up' | 'down'

/**
 * Semitones to move from one tonic to another.
 * 'auto' picks whichever octave keeps the melody's top note closest to D5/E♭5,
 * a comfortable top for a congregation.
 */
export function semitoneDelta(from: string, to: string, topMidi: number | null, dir: Direction = 'auto'): number {
  const up = (pitchClass(to) - pitchClass(from) + 12) % 12
  if (up === 0) return 0
  const down = up - 12
  if (dir === 'up') return up
  if (dir === 'down') return down
  if (topMidi == null) return up <= 5 ? up : down
  const target = 74.5
  const du = Math.abs(topMidi + up - target)
  const dd = Math.abs(topMidi + down - target)
  return du < dd ? up : down
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Highest melody pitch (MIDI) in voice 1 of staff 1. */
export function melodyTop(doc: Document): number | null {
  let top: number | null = null
  for (const note of Array.from(doc.getElementsByTagName('note'))) {
    if (note.getElementsByTagName('rest').length) continue
    const voice = note.getElementsByTagName('voice')[0]?.textContent
    if (voice !== '1') continue
    const p = note.getElementsByTagName('pitch')[0]
    if (!p) continue
    const step = p.getElementsByTagName('step')[0]?.textContent ?? 'C'
    const alter = Number(p.getElementsByTagName('alter')[0]?.textContent ?? 0)
    const octave = Number(p.getElementsByTagName('octave')[0]?.textContent ?? 4)
    const midi = (octave + 1) * 12 + STEP_PC[step] + alter
    if (top == null || midi > top) top = midi
  }
  return top
}

const NAMES_SHARP = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
export function midiName(m: number): string {
  return NAMES_SHARP[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace'

function lyricLang(lyric: Element): string {
  const text = lyric.getElementsByTagName('text')[0]
  const lang = text?.getAttributeNS(XML_NS, 'lang') || text?.getAttribute('xml:lang')
  if (lang) return lang
  return Number(lyric.getAttribute('number') ?? 1) % 2 === 1 ? 'ko' : 'en'
}

/** Parse the MusicXML and keep only the lyric lines for the chosen mode, renumbered 1..n. */
export function filterLyrics(xml: string, mode: LyricMode): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read this hymn file')
  const lyrics = Array.from(doc.getElementsByTagName('lyric'))
  if (mode !== 'both') {
    for (const l of lyrics) if (lyricLang(l) !== mode) l.parentNode?.removeChild(l)
  }
  const kept = Array.from(doc.getElementsByTagName('lyric'))
  // Like the printed Korean-English hymnal: every Korean verse first, then every English verse
  // (the file interleaves them: Korean verse k is line 2k-1, English verse k is line 2k).
  const langOf = new Map<number, number>()
  for (const l of kept) langOf.set(Number(l.getAttribute('number') ?? 1), lyricLang(l) === 'ko' ? 0 : 1)
  const numbers = Array.from(langOf.keys()).sort((a, b) => (langOf.get(a)! - langOf.get(b)!) || a - b)
  const map = new Map(numbers.map((n, i) => [n, String(i + 1)]))
  for (const l of kept) l.setAttribute('number', map.get(Number(l.getAttribute('number') ?? 1)) ?? '1')
  for (const ll of Array.from(doc.getElementsByTagName('lyric-language'))) ll.parentNode?.removeChild(ll)
  return doc
}

export function countLyricLines(doc: Document): number {
  const s = new Set<string>()
  for (const l of Array.from(doc.getElementsByTagName('lyric'))) s.add(l.getAttribute('number') ?? '1')
  return s.size
}
