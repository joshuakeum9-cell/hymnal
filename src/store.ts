// Small per-device preferences kept in localStorage. Every access is guarded:
// private browsing and cleared site data must never break the page.
import type { LyricMode } from './music'

export type SetItem = { n: number; key?: string; mode?: LyricMode }

export type Prefs = {
  mode: LyricMode
  zoom: number        // 1 = default size
  dark: boolean
  oldNumbers: boolean // search box expects 통일찬송가 numbers
  paper: 'letter' | 'a4'
  recent: number[]
  setList: SetItem[]
  keys: Record<string, string> // last key used per hymn
}

const DEFAULTS: Prefs = {
  mode: 'both', zoom: 1, dark: false, oldNumbers: false, paper: 'letter',
  recent: [], setList: [], keys: {},
}

const KEY = 'hymnal.prefs.v1'

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

let prefs = read()
const listeners = new Set<() => void>()

export function getPrefs(): Prefs {
  return prefs
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  listeners.forEach(fn => fn())
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function pushRecent(n: number): void {
  const recent = [n, ...prefs.recent.filter(x => x !== n)].slice(0, 12)
  setPrefs({ recent })
}

export function encodeSet(items: SetItem[]): string {
  return items.map(i => [i.n, i.key ?? '', i.mode ? { both: 'b', ko: 'k', en: 'e' }[i.mode] : ''].join(':').replace(/:+$/, '')).join(',')
}

export function decodeSet(s: string): SetItem[] {
  const modes: Record<string, LyricMode> = { b: 'both', k: 'ko', e: 'en' }
  return s.split(',').map(part => {
    const [n, key, m] = part.split(':')
    const item: SetItem = { n: Number(n) }
    if (key) item.key = key
    if (m && modes[m]) item.mode = modes[m]
    return item
  }).filter(i => Number.isFinite(i.n) && i.n > 0)
}
