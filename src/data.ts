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
}

export type Hymn = { n: number; xml: string; ko: string[]; en: string[]; enMode: 0 | 1 | 2; cr?: string }

let indexPromise: Promise<Row[]> | null = null
let byNumber: Map<number, Row> | null = null
let byOld: Map<number, Row> | null = null

export function loadIndex(): Promise<Row[]> {
  indexPromise ??= import('./generated/index.json').then(m => {
    const rows = m.default as Row[]
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
  p = fetch(url).then(r => {
    if (!r.ok) throw new Error(`Could not load hymn ${row.n} (${r.status})`)
    return r.json() as Promise<Hymn>
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

/** A typed number that cannot grow into another valid number opens straight away. */
export function isFinalNumber(q: string, max = 645): boolean {
  if (!/^\d+$/.test(q)) return false
  const n = Number(q)
  if (n < 1 || n > max) return false
  return n * 10 > max
}
