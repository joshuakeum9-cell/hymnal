// Search index and hymn file loading.

export type Row = {
  n: number          // 새찬송가 number
  o: number | null   // 통일찬송가 number
  k: string          // Korean title
  e: string          // English title
  c: string          // Korean initial consonants of the title, for ㅈㅇㅊㅈ search
  t: string          // section / theme
  f: string | null   // hymn file, null when gated (set to b once the band password is entered)
  b?: string         // band copy of a gated hymn, encrypted
  g?: 1 | 2          // gated: 1 Korean-authored, 2 other copyright question
  fi?: number        // key signature fifths
  m?: 0 | 1          // minor
  v?: number         // verse count
  en?: 0 | 1 | 2     // English: 0 none, 1 under the notes, 2 as text below
  ts?: string        // time signature from the key table
  kt?: string        // key from the key table (shown for gated hymns)
}

export type Hymn = { n: number; xml: string; ko: string[]; en: string[]; enMode: 0 | 1 | 2; cr?: string }

let indexPromise: Promise<Row[]> | null = null
let byNumber: Map<number, Row> | null = null
let byOld: Map<number, Row> | null = null

export function loadIndex(): Promise<Row[]> {
  indexPromise ??= restoreBand().then(() => import('./generated/index.json')).then(m => {
    const rows = m.default as Row[]
    if (bandKey) for (const r of rows) if (r.b) r.f = r.b
    byNumber = new Map(rows.map(r => [r.n, r]))
    byOld = new Map(rows.filter(r => r.o).map(r => [r.o as number, r]))
    return rows
  })
  return indexPromise
}

export function rowFor(n: number): Row | undefined {
  return byNumber?.get(n)
}

export function rowForOld(o: number): Row | undefined {
  return byOld?.get(o)
}

// Band copy: gated hymns ship encrypted; the band password unlocks them on this device.
type BandParams = { salt: string; iter: number; check: string }
const BAND_STORE = 'hymnal.band.v1'
let bandParams: BandParams | null = null
let bandKey: CryptoKey | null = null

export const bandAvailable = (): boolean => !!bandParams
export const bandUnlocked = (): boolean => !!bandKey

async function restoreBand(): Promise<void> {
  bandParams = (await import('./generated/band.json')).default as BandParams | null
  let saved: string | null = null
  try { saved = localStorage.getItem(BAND_STORE) } catch { /* storage blocked */ }
  if (!bandParams || !saved || !crypto?.subtle) return
  try {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(saved), c => c.charCodeAt(0)), 'AES-GCM', false, ['decrypt'])
    if (await checkKey(key)) bandKey = key
  } catch { /* stale key from an older password */ }
}

async function checkKey(key: CryptoKey): Promise<boolean> {
  const box = Uint8Array.from(atob(bandParams!.check), c => c.charCodeAt(0))
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.slice(0, 12) }, key, box.slice(12))
    return true
  } catch {
    return false
  }
}

/** Returns false for a wrong password. On success the key is kept on this device. */
export async function unlockBand(password: string): Promise<boolean> {
  if (!bandParams || !crypto?.subtle) return false
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(password.trim()), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(bandParams.salt), iterations: bandParams.iter }, base, 256)
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt'])
  if (!(await checkKey(key))) return false
  try { localStorage.setItem(BAND_STORE, btoa(String.fromCharCode(...new Uint8Array(bits)))) } catch { /* kept for this visit only */ }
  bandKey = key
  return true
}

export function lockBand(): void {
  try { localStorage.removeItem(BAND_STORE) } catch { /* nothing kept */ }
}

const hymnCache = new Map<string, Promise<Hymn>>()
const HYMN_CACHE_MAX = 24 // parsed hymns kept in memory; the service worker keeps the files

export function hymnUrl(row: Row): string {
  return `${import.meta.env.BASE_URL}hymns/${row.f}`
}

export function loadHymn(row: Row): Promise<Hymn> {
  if (!row.f) return Promise.reject(new Error('gated'))
  const url = hymnUrl(row)
  let p = hymnCache.get(url)
  if (p) {
    hymnCache.delete(url)
    hymnCache.set(url, p) // most recently used last
    return p
  }
  p = fetch(url).then(async r => {
    if (!r.ok) throw new Error(`Could not load hymn ${row.n} (${r.status})`)
    if (row.f !== row.b) return r.json() as Promise<Hymn>
    const box = new Uint8Array(await r.arrayBuffer())
    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.slice(0, 12) }, bandKey!, box.slice(12))
    return JSON.parse(new TextDecoder().decode(body)) as Hymn
  })
  p.catch(() => hymnCache.delete(url))
  hymnCache.set(url, p)
  while (hymnCache.size > HYMN_CACHE_MAX) hymnCache.delete(hymnCache.keys().next().value as string)
  return p
}

/** Fetch neighbours quietly so the next tap is instant. */
export function prefetch(rows: (Row | undefined)[]): void {
  const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 400))
  idle(() => rows.forEach(r => r?.f && loadHymn(r).catch(() => {})))
}

const CHOSEONG = /^[ㄱ-ㅎ]+$/

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s,.!?'’"“”()\-]/g, '')
}

export type SearchResult = { row: Row; via: 'number' | 'old' | 'title' }

export function search(rows: Row[], query: string, oldNumbers: boolean): SearchResult[] {
  const q = query.trim()
  if (!q) return []
  const oldPrefix = /^(통|t|o)\s*(\d+)$/i.exec(q)
  if (oldPrefix || (/^\d+$/.test(q) && oldNumbers)) {
    const num = Number(oldPrefix ? oldPrefix[2] : q)
    const exact = rows.filter(r => r.o === num).map(row => ({ row, via: 'old' as const }))
    const more = rows
      .filter(r => r.o != null && r.o !== num && String(r.o).startsWith(String(num)))
      .sort((a, b) => (a.o as number) - (b.o as number))
      .slice(0, 12)
      .map(row => ({ row, via: 'old' as const }))
    return [...exact, ...more]
  }
  if (/^\d+$/.test(q)) {
    const num = Number(q)
    const exact = rows.filter(r => r.n === num)
    const more = rows.filter(r => r.n !== num && String(r.n).startsWith(q)).slice(0, 12)
    return [...exact, ...more].map(row => ({ row, via: 'number' as const }))
  }
  const nq = norm(q)
  if (CHOSEONG.test(nq)) {
    return rows.filter(r => r.c.includes(nq)).slice(0, 40).map(row => ({ row, via: 'title' as const }))
  }
  const scored: { row: Row; s: number }[] = []
  for (const r of rows) {
    const k = norm(r.k), e = norm(r.e)
    let s = -1
    if (k.startsWith(nq) || e.startsWith(nq)) s = 0
    else if (k.includes(nq) || e.includes(nq)) s = 1
    else if (norm(r.t).includes(nq)) s = 2
    if (s >= 0) scored.push({ row: r, s })
  }
  scored.sort((a, b) => a.s - b.s || a.row.n - b.row.n)
  return scored.slice(0, 40).map(x => ({ row: x.row, via: 'title' as const }))
}

