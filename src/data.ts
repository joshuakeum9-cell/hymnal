// Search index and hymn file loading.

export type Row = {
  n: number          // 새찬송가 number
  o: number | null   // 통일찬송가 number
  k: string          // Korean title
  e: string          // English title
  c: string          // Korean initial consonants of the title, for ㅈㅇㅊㅈ search
  t: string          // section / theme
  f: string | null   // hymn file, null when gated
  g?: 1 | 2          // gated: 1 Korean-authored, 2 other copyright question
  fi?: number        // key signature fifths
  m?: 0 | 1          // minor
  v?: number         // verse count
  en?: 0 | 1 | 2     // English: 0 none, 1 under the notes, 2 as text below
  ts?: string        // time signature from the key table
  kt?: string        // key from the key table (shown for gated hymns)
  p?: 1              // a praise song (CCM): no hymnal number; n is 1000 + its place in the praise list
}

/** Praise songs carry n = 1000 + k so routes, set lists and caches work unchanged; the number is never shown. */
export const isPraise = (n: number) => n > 1000

/** The neighbour of n in its own book (hymns 1-645, praise songs 1001-...), or null at either end. */
export function neighbour(n: number, d: 1 | -1): number | null {
  const m = n + d
  return rowFor(m) && isPraise(m) === isPraise(n) ? m : null
}

export type Hymn = { n: number; xml: string; ko: string[]; en: string[]; enMode: 0 | 1 | 2; cr?: string }

let indexPromise: Promise<Row[]> | null = null
let byNumber: Map<number, Row> | null = null
let byOld: Map<number, Row> | null = null
let allRows: Row[] = []

/** The index once loadIndex() has finished (empty before). */
export function rowsNow(): Row[] {
  return allRows
}

export function loadIndex(): Promise<Row[]> {
  indexPromise ??= import('./generated/index.json').then(m => {
    const rows = m.default as Row[]
    allRows = rows
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

// Site password: a locked build ships every hymn sealed (compressed, then AES-GCM). The password
// is asked once; the derived key stays on this device.
type LockParams = { salt: string; iter: number; check: string }
const LOCK_STORE = 'hymnal.lock.v1'
let lockParams: LockParams | null = null
let siteKey: CryptoKey | null = null
let lockState: Promise<boolean> | null = null

const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function openSealed(box: Uint8Array, key = siteKey!): Promise<string> {
  const packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.slice(0, 12) }, key, box.slice(12))
  return new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'))).text()
}

async function keyFits(key: CryptoKey): Promise<boolean> {
  return openSealed(fromB64(lockParams!.check), key).then(() => true, () => false)
}

/** Resolves true while this device still needs the site password. */
export function needsPassword(): Promise<boolean> {
  lockState ??= (async () => {
    lockParams = (await import('./generated/lock.json')).default as LockParams | null
    if (!lockParams) return false
    let saved: string | null = null
    try { saved = localStorage.getItem(LOCK_STORE) } catch { /* storage blocked */ }
    if (saved) {
      try {
        const key = await crypto.subtle.importKey('raw', fromB64(saved), 'AES-GCM', false, ['decrypt'])
        if (await keyFits(key)) { siteKey = key; return false }
      } catch { /* a key from an older password */ }
    }
    return true
  })()
  return lockState
}

/** Returns false for a wrong password. On success the key is kept on this device. */
export async function unlockSite(password: string): Promise<boolean> {
  if (!lockParams) return true
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(password.trim()), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(lockParams.salt), iterations: lockParams.iter }, base, 256)
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt'])
  if (!(await keyFits(key))) return false
  try { localStorage.setItem(LOCK_STORE, btoa(String.fromCharCode(...new Uint8Array(bits)))) } catch { /* this visit only */ }
  siteKey = key
  return true
}

export const siteLocked = (): boolean => !!lockParams

/** Forget the password on this device. */
export function lockSite(): void {
  try { localStorage.removeItem(LOCK_STORE) } catch { /* nothing kept */ }
  location.reload()
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
    if (!siteKey) return r.json() as Promise<Hymn>
    return JSON.parse(await openSealed(new Uint8Array(await r.arrayBuffer()))) as Hymn
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
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
// a final consonant that, while typing, may still become the next syllable's first one (같 on the way to 가톨)
const JONG_TO_CHO: Record<number, number> = { 1: 0, 4: 2, 7: 3, 8: 5, 16: 6, 17: 7, 19: 9, 21: 11, 22: 12, 23: 14, 24: 15, 25: 16, 26: 17, 27: 18 }

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s,.!?'’"“”()\-]/g, '')
}

function syllable(ch: string | undefined) {
  if (!ch) return null
  const c = ch.charCodeAt(0) - 0xac00
  return c >= 0 && c < 11172 ? { cho: Math.floor(c / 588), jung: Math.floor((c % 588) / 28), jong: c % 28 } : null
}

/** Whether the last typed character can still become the title's character there: a lone
 *  consonant (주님ㄱ for 주님과), a syllable not finished yet (가 for 같), or a final consonant that
 *  will move on to the next syllable (같 for 가톨). */
function lastMatches(q: string, h: string | undefined, next: string | undefined): boolean {
  if (!h) return false
  if (q === h) return true
  const sh = syllable(h)
  if (!sh) return false
  const ci = CHO.indexOf(q)
  if (ci >= 0) return sh.cho === ci
  const sq = syllable(q)
  if (!sq || sq.cho !== sh.cho || sq.jung !== sh.jung) return false
  if (sq.jong === 0) return true
  const sn = syllable(next)
  return sh.jong === 0 && !!sn && JONG_TO_CHO[sq.jong] === sn.cho
}

/** Where the typed text starts in the title, its last character allowed to be still in the typing (-1: nowhere). */
function findTyped(hay: string, q: string): number {
  const head = q.slice(0, -1), last = q.slice(-1)
  for (let i = hay.indexOf(head); i >= 0 && i + q.length <= hay.length; i = hay.indexOf(head, i + 1)) {
    if (lastMatches(last, hay[i + head.length], hay[i + head.length + 1])) return i
  }
  return -1
}

export type SearchResult = { row: Row; via: 'number' | 'old' | 'title' }

/** titleOnly: the title box, where even digits are searched as words. */
export function search(rows: Row[], query: string, oldNumbers: boolean, titleOnly = false): SearchResult[] {
  const q = query.trim()
  if (!q) return []
  const oldPrefix = titleOnly ? null : /^(통|t|o)\s*(\d+)$/i.exec(q)
  if (oldPrefix || (!titleOnly && /^\d+$/.test(q) && oldNumbers)) {
    const num = Number(oldPrefix ? oldPrefix[2] : q)
    const exact = rows.filter(r => r.o === num).map(row => ({ row, via: 'old' as const }))
    const more = rows
      .filter(r => r.o != null && r.o !== num && String(r.o).startsWith(String(num)))
      .sort((a, b) => (a.o as number) - (b.o as number))
      .slice(0, 12)
      .map(row => ({ row, via: 'old' as const }))
    return [...exact, ...more]
  }
  if (!titleOnly && /^\d+$/.test(q)) {
    const num = Number(q)
    const hymns = rows.filter(r => !r.p)
    const exact = hymns.filter(r => r.n === num)
    const more = hymns.filter(r => r.n !== num && String(r.n).startsWith(q)).slice(0, 12)
    return [...exact, ...more].map(row => ({ row, via: 'number' as const }))
  }
  const nq = norm(q)
  if (CHOSEONG.test(nq)) {
    return rows.filter(r => r.c.includes(nq)).slice(0, 60).map(row => ({ row, via: 'title' as const }))
  }
  // ranked by how well the title matches, hymns and praise songs alike: the title starting with the
  // typed words, then the words inside it (earlier first), then the section name; a short title
  // before a long one. Never by number, which put every praise song (1001...) after 40 hymns
  const scored: { row: Row; s: number; at: number; len: number }[] = []
  for (const r of rows) {
    const k = norm(r.k), e = norm(r.e)
    const ik = findTyped(k, nq), ie = findTyped(e, nq)
    const at = ik >= 0 && ie >= 0 ? Math.min(ik, ie) : Math.max(ik, ie)
    let s = -1
    if (at === 0) s = 0
    else if (at > 0) s = 1
    else if (findTyped(norm(r.t), nq) >= 0) s = 2
    if (s >= 0) scored.push({ row: r, s, at: Math.max(at, 0), len: Math.min(k.length || 99, e.length || 99) })
  }
  scored.sort((a, b) => a.s - b.s || a.at - b.at || a.len - b.len || a.row.n - b.row.n)
  return scored.slice(0, 60).map(x => ({ row: x.row, via: 'title' as const }))
}

