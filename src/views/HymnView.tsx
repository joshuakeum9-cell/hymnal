import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadHymn, loadIndex, neighbour, prefetch, rowFor, type Hymn, type Row } from '../data'
import { chipFor, isKeyName, keyLabel, melodyTop, originalTonic, pitchClass, semitoneDelta, type Direction, type LyricMode } from '../music'
import { cachedSvg, lineStarts, screenRenderer, systemCount } from '../score'
import { getPrefs, pushRecent, setPrefs, subscribe } from '../store'
import { go, hymnHash } from '../route'
import { KeySheet } from './KeySheet'
import { printHymns, printNow } from '../print'
import { KeyName, IconBack, IconCheck, IconClose, IconExpand, IconListAdd, IconMoon, IconNext, IconPrint, IconSun, IconZoomIn, IconZoomOut } from '../icons'
import { F, creditText, themeText, titles, useT, type Key as TKey } from '../i18n'

const MODES: { id: LyricMode; label: TKey; title: TKey }[] = [
  { id: 'both', label: 'mode.both', title: 'mode.both.title' },
  { id: 'ko', label: 'mode.ko', title: 'mode.ko.title' },
  { id: 'en', label: 'mode.en', title: 'mode.en.title' },
]

const REPO = 'https://github.com/joshuakeum9-cell/hymnal'

function usePrefs() {
  const [p, set] = useState(getPrefs())
  useEffect(() => subscribe(() => set(getPrefs())), [])
  return p
}

/** Width of the score column, rounded so tiny resizes do not re-render. */
function useWidth(el: { current: HTMLElement | null }): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!el.current) return
    const measure = () => {
      const raw = el.current?.clientWidth ?? 0
      setW(Math.floor(raw / 24) * 24)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el.current)
    return () => ro.disconnect()
  }, [el.current])
  return w
}

const MAX_FIT_LINES = 4 // the one-screen view: treble and bass pairs per page, as the printed hymnal sets them

type Draw = (width: number, zoom: number, mode?: LyricMode, text?: number, breaks?: number[]) => Promise<string | null>

/** Draws one hymn (or takes it from the cache): the screen view, the one-screen view and the
 *  one-screen prefetch all use this, so a page prefetched is found under the same cache key. */
function makeDraw(o: { n: number; f: string; xml: string; delta: number; chords: boolean; plain?: boolean; mode: LyricMode;
  stopped: () => boolean; onDrawing?: () => void }): Draw {
  return async (w, z, m = o.mode, text = 1, breaks) => {
    const cacheKey = `${o.n}|${o.f}|${o.delta}|${m}|${o.chords}${o.plain ? '|plain' : ''}|${w}|${z}|screen${text !== 1 ? `|text${text}` : ''}${breaks ? `|lines${breaks.join(',')}` : ''}`
    const hit = await cachedSvg(cacheKey)
    if (o.stopped()) return null
    if (hit) return hit
    o.onDrawing?.()
    const res = await screenRenderer().render({ cacheKey, xml: o.xml, mode: m, chords: o.chords, plain: o.plain, delta: o.delta, width: w, zoom: z, text, breaks })
    if (!res.cached) console.info(`[hymnal] ${o.n} rendered in ${res.ms} ms (${m}, ${w}px)`)
    return o.stopped() ? null : res.svg
  }
}

/**
 * The one-screen view: choose how many lines of music the page has, lay it out, return the drawing.
 *
 * The line count is chosen from this lyric mode's own layout. One layout at 1000px gives
 * that page's size and line count; bars are shared evenly between lines, so a page of L lines is
 * about S0/L times as wide and L/S0 times as tall. Every L is tried on paper, the scale that fits the
 * screen worked out for each, and the fewest lines whose music is within 5% of the largest win. A
 * phone held upright may take as many lines as it likes; a tablet, or a phone turned sideways, at
 * most four, like the printed hymnal page. The chosen width is checked by laying the page out and
 * widened a little if a line too many came out.
 */
async function drawOneScreen(draw: Draw, mode: LyricMode, vw: number, vh: number): Promise<string | null> {
  const probe = await draw(1000, 1, mode)
  if (!probe) return null
  const s0 = Math.max(1, systemCount(probe))
  const p = svgSize(probe)
  const room = fitMusicHeight(vw, vh)
  const upright = vh > vw * 1.15 && vw < 600 // a phone held upright; tablets keep four lines either way
  const most = upright ? Math.max(12, s0 * 2) : MAX_FIT_LINES
  const scaleFor = (lines: number) => Math.min(vw / ((p.w * s0) / lines), room / ((p.h * lines) / s0))
  let lines = 1
  for (let l = 2; l <= most; l++) if (scaleFor(l) > scaleFor(lines)) lines = l
  const start = Math.max(500, Math.round((1000 * s0) / lines / 50) * 50)
  // each lyric mode is laid out on its own words (Korean alone is narrower than both), so the page
  // is found from this mode's own layout
  const page = await narrowestWithin(draw, mode, start, lines, vw, room, start === 1000 ? probe : null)
  if (!page) return null
  const grown = await growText(draw, mode, page, vw, room, upright ? Infinity : MAX_FIT_LINES)
  return fillWidth(draw, mode, grown, vw, room)
}

/**
 * A page limited by the screen's height is scaled down to fit and leaves bands of screen on its left
 * and right. Lines of music stretch to the width they are drawn at, so draw the same page wider, as
 * wide as the screen's shape allows at this height: the same lines, now from edge to edge. Kept only
 * when it has the same number of lines (a wider page that pulls a bar up a line is shorter, and is
 * kept only if its music comes out larger).
 */
async function fillWidth(draw: Draw, mode: LyricMode, page: { svg: string; w: number; text: number }, vw: number,
  room: number): Promise<string> {
  const s = svgSize(page.svg)
  const scale = Math.min(vw / s.w, room / s.h)
  const starts = lineStarts(page.svg)
  if (s.w * scale >= vw * 0.98 || !starts) return page.svg // it fills the width already
  // the same lines, drawn as wide as the screen's shape allows at this height
  const wide = Math.round((page.w * (vw / (s.w * scale))) / 10) * 10
  const at = await draw(wide, 1, mode, page.text, starts)
  return at && systemCount(at) === systemCount(page.svg) ? at : page.svg
}

/**
 * A page limited by the screen's width leaves height unused below it (620 on a phone): spend it on
 * larger words and chord letters, drawn at the same width (so the music keeps its size), as large as
 * still fits. Wide words may move a bar to a new line (620 in English: 9 lines instead of 7 at 1.28
 * times the size); that is fine while the page fits, as every word and chord letter is larger. A few
 * layouts find the size: try what the spare height suggests, then halve the gap.
 */
async function growText(draw: Draw, mode: LyricMode, page: { svg: string; w: number }, vw: number, room: number,
  maxLines: number): Promise<{ svg: string; w: number; text: number }> {
  // A larger size moves bars to new lines in jumps, so a page often comes out a little taller than
  // the screen; the view then shrinks the whole page to fit. What the eye gets is the text size
  // times that shrink: choose the size where that is largest, as long as the music itself shrinks by
  // no more than MIN_SHRINK allows
  const heightOf = (svg: string) => { const s = svgSize(svg); return (s.h * vw) / s.w }
  const spare = room / heightOf(page.svg) // above 1: the page is shorter than the screen by this factor
  if (spare < 1.06) return { ...page, text: 1 } // the page already fills the screen
  let best = page.svg, bestText = 1, bestF = 1
  // a search between the usual size (fine) and the largest allowed: a size that costs the music too
  // much sends it smaller, one with room left sends it larger, and the best seen is kept
  let lo = 1, hi = MAX_TEXT
  let f = Math.min(MAX_TEXT, spare)
  for (let step = 0; step < 4 && hi - lo > 0.04; step++) {
    f = Math.round(f * 100) / 100
    const at = await draw(page.w, 1, mode, f)
    if (!at) break
    const shrink = Math.min(1, room / heightOf(at))
    if (import.meta.env.DEV) console.debug(`[hymnal:fit] text x${f}: ${systemCount(at)} lines, shrink ${shrink.toFixed(3)}, seen x${(f * shrink).toFixed(3)}`)
    if (shrink >= MIN_SHRINK && systemCount(at) <= maxLines) { // (a tablet keeps its four-line page)
      if (f * shrink > bestText) { best = at; bestText = f * shrink; bestF = f }
      if (shrink < 1) break // it fills the screen
      lo = f
    } else hi = f
    f = (lo + hi) / 2
  }
  return { svg: best, w: page.w, text: bestF }
}
const MAX_TEXT = 1.8 // words and chord letters at most this many times their usual size
const MIN_SHRINK = 0.85 // larger words may cost the music at most 15% of its size

/**
 * The narrowest page of at most `lines` lines near width `start`: widen until it has no more lines
 * than that, then halve the gap to the last width that had too many. A page limited by the screen's
 * width is largest when it is narrowest; one limited by its height gains nothing, so it is kept.
 */
async function narrowestWithin(draw: Draw, mode: LyricMode, start: number, lines: number, vw: number, room: number,
  first: string | null): Promise<{ svg: string; w: number } | null> {
  let out = first ?? (await draw(start, 1, mode))
  if (!out) return null
  let lo = 0, hi = start
  for (let tries = 0; systemCount(out) > lines && tries < 6 && hi < 8000; tries++) {
    lo = hi
    hi = Math.round((hi * Math.max(systemCount(out) / lines, 1.06)) / 50) * 50
    const wider = await draw(hi, 1, mode)
    if (!wider) return null
    if (import.meta.env.DEV) console.debug(`[hymnal:fit] ${mode} at ${hi}px: ${systemCount(wider)} lines (want ${lines})`)
    out = wider
  }
  if (systemCount(out) > lines) return { svg: out, w: hi }
  // never narrow into more lines than this page already has, and keep a narrower page only when
  // its music comes out larger on this screen
  lines = Math.min(lines, systemCount(out))
  const scaleOf = (svg: string) => { const s = svgSize(svg); return Math.min(vw / s.w, room / s.h) }
  const widthBound = (svg: string) => { const s = svgSize(svg); return vw / s.w < room / s.h }
  if (!lo) {
    if (!widthBound(out)) return { svg: out, w: hi }
    lo = Math.max(450, Math.round((hi * 0.8) / 50) * 50) // try up to a fifth narrower
  }
  let best = { svg: out, w: hi }
  for (let step = 0; step < 4 && hi - lo > 50; step++) {
    const mid = Math.round((lo + hi) / 2 / 50) * 50
    if (mid <= lo || mid >= hi) break
    const at = await draw(mid, 1, mode)
    if (!at) return best
    if (systemCount(at) <= lines) {
      hi = mid
      if (scaleOf(at) > scaleOf(best.svg)) best = { svg: at, w: mid }
    } else lo = mid
  }
  return best
}

/** The phone's own reported room for its camera or status bar (CSS safe-area-inset-top), in px. */
function safeTop(): number {
  try {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden'
    document.body.appendChild(probe)
    const h = probe.offsetHeight
    probe.remove()
    return h
  } catch {
    return 0
  }
}

/** Height of the title strip across the top of the one-screen view, as on a printed hymnal page,
 *  with room above it for a camera cut-out (what the phone reports, plus a little for phones that
 *  report none) */
function fitHeadHeight(vw: number): number {
  return (vw < 600 ? 58 : 78) + FIT_TOP_GAP + safeTop()
}
const FIT_TOP_GAP = 16

/** Room the music has in the one-screen view: below the title, above the buttons' strip. */
function fitMusicHeight(vw: number, vh: number): number {
  return vh - fitHeadHeight(vw) - 52
}

/** The drawn size of an OSMD SVG, from its viewBox (or its width and height). */
function svgSize(svg: string): { w: number; h: number } {
  const head = svg.slice(0, svg.indexOf('>', svg.indexOf('<svg')) + 1)
  const vb = head.match(/viewBox="([\d.\s,-]+)"/)
  if (vb) {
    const [, , w, h] = vb[1].split(/[\s,]+/).map(Number)
    if (w > 0 && h > 0) return { w, h }
  }
  const w = Number(head.match(/\swidth="([\d.]+)/)?.[1] ?? 1000)
  const h = Number(head.match(/\sheight="([\d.]+)/)?.[1] ?? 1000)
  return { w, h }
}

/** Staff size for the column width: about two measures a line on a phone, four on an iPad. */
export function baseZoom(width: number, height = 0): number {
  const lo = 480, hi = 960
  let z = width <= lo ? 0.56 : width >= hi ? 1.0 : 0.56 + ((width - lo) / (hi - lo)) * 0.44
  // landscape phones and tablets: show more lines of music per screen
  if (height && width > height * 1.1) z *= 0.84
  return z
}

export function HymnView({ n, params }: { n: number; params: URLSearchParams }) {
  const prefs = usePrefs()
  const { t, lang } = useT()
  const [row, setRow] = useState<Row | null | undefined>(rowFor(n))
  const [hymn, setHymn] = useState<Hymn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printReady, setPrintReady] = useState(false)
  const scoreRef = useRef<HTMLDivElement>(null)
  const width = useWidth(scoreRef)
  const token = useRef(0)

  const inSet = params.get('s') === '1'
  const setItem = inSet ? prefs.setList.find(i => i.n === n) : undefined
  // In set mode the set list entry decides key and words, so screen, swipe and print agree.
  const mode = (params.get('lyrics') as LyricMode) || (setItem ? setItem.mode ?? 'both' : prefs.mode)
  const dir = (params.get('dir') as Direction) || 'auto'

  useEffect(() => {
    let alive = true
    setHymn(null)
    setError(null)
    setSheetOpen(false)
    setPrintReady(false)
    // the one-screen view turns pages like a book: the page stays up (dimmed while the next one is
    // drawn, which the prefetch below usually makes instant) instead of dropping back to "loading"
    if (!getPrefs().fit) setSvg('')
    loadIndex().then(() => {
      if (!alive) return
      const r = rowFor(n) ?? null
      setRow(r)
      if (!r) return
      pushRecent(n)
      document.title = r.p ? r.k : `${n} ${r.k}`
      if (!r.f) return
      loadHymn(r).then(h => alive && setHymn(h)).catch(e => alive && setError(String(e.message ?? e)))
    })
    window.scrollTo(0, 0)
    return () => { alive = false }
  }, [n])

  const minor = row?.m === 1
  const origTonic = row ? chipFor(originalTonic(row.fi ?? 0, minor), minor) : 'C'
  const key = (isKeyName(params.get('key')) ? params.get('key') : null) || setItem?.key || origTonic
  const top = useMemo(() => (hymn ? melodyTop(new DOMParser().parseFromString(hymn.xml, 'application/xml')) : null), [hymn])
  const delta = semitoneDelta(origTonic, key, top, dir)

  const setParams = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = {
      key: params.get('key') ?? undefined,
      lyrics: params.get('lyrics') ?? undefined,
      dir: params.get('dir') ?? undefined,
      s: params.get('s') ?? undefined,
      ...patch,
    }
    if (next.key && pitchClass(next.key) === pitchClass(origTonic)) next.key = undefined
    if (next.dir === 'auto') next.dir = undefined
    go(hymnHash(n, next), true)
  }

  const updateSetItem = (patch: Partial<{ key: string | undefined; mode: LyricMode }>) => {
    setPrefs({ setList: prefs.setList.map(i => (i.n === n ? { ...i, ...patch } : i)) })
  }

  const pickKey = (k: string) => {
    const same = pitchClass(k) === pitchClass(origTonic)
    if (setItem) updateSetItem({ key: same ? undefined : k })
    setParams({ key: same ? undefined : k, dir: undefined })
  }

  const setMode = (m: LyricMode) => {
    if (setItem) updateSetItem({ mode: m })
    else setPrefs({ mode: m })
    setParams({ lyrics: m === 'both' ? undefined : m })
  }

  // render
  const [vh, setVh] = useState(window.innerHeight)
  const [vw, setVw] = useState(window.innerWidth)
  useEffect(() => {
    const on = () => { setVh(window.innerHeight); setVw(window.innerWidth) }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const chords = prefs.chords !== false
  const plain = !!prefs.plainChords
  const fit = !!prefs.fit
  const zoom = Math.round(baseZoom(width, vh > 0 ? vh : 0) * prefs.zoom * 100) / 100
  useEffect(() => {
    if (!hymn || !row?.f || width < 100) return
    const my = ++token.current
    let cancelled = false
    setError(null)
    const draw = makeDraw({ n, f: row.f, xml: hymn.xml, delta, chords, plain, mode,
      stopped: () => cancelled || my !== token.current, onDrawing: () => setBusy(true) })
    ;(async () => {
      try {
        let out: string | null
        if (fit) {
          out = await drawOneScreen(draw, mode, vw, vh)
        } else {
          out = await draw(width, zoom)
        }
        if (out && my === token.current) {
          setSvg(out)
          setError(null)
        }
      } catch (e) {
        if (my === token.current) setError(String((e as Error).message ?? e))
      } finally {
        if (my === token.current) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
      setBusy(false)
    }
  }, [hymn, row?.f, delta, mode, chords, plain, width, zoom, fit, fit ? vw : 0, fit ? vh : 0])

  // the one-screen view uses the whole screen where the device allows it (not iPhone Safari,
  // where it fills the window instead); Escape leaves it
  const setFit = (on: boolean) => {
    setPrefs({ fit: on })
    try {
      if (on) document.documentElement.requestFullscreen?.().catch(() => {})
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    } catch { /* no fullscreen API */ }
  }
  useEffect(() => {
    if (!fit) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFit(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fit])
  const fitSize = (() => {
    if (!fit || !svg) return null
    const s = svgSize(svg)
    const scale = Math.min(vw / s.w, fitMusicHeight(vw, vh) / s.h)
    return { w: Math.floor(s.w * scale), h: Math.floor(s.h * scale) }
  })()

  // neighbours
  const setIdx = inSet ? prefs.setList.findIndex(i => i.n === n) : -1
  const prevItem = inSet && setIdx > 0 ? prefs.setList[setIdx - 1] : null
  const nextItem = inSet && setIdx >= 0 && setIdx < prefs.setList.length - 1 ? prefs.setList[setIdx + 1] : null
  const prevHash = inSet
    ? prevItem && hymnHash(prevItem.n, { key: prevItem.key, lyrics: prevItem.mode === 'both' ? undefined : prevItem.mode, s: '1' })
    : neighbour(n, -1) ? `#/${n - 1}` : null
  const nextHash = inSet
    ? nextItem && hymnHash(nextItem.n, { key: nextItem.key, lyrics: nextItem.mode === 'both' ? undefined : nextItem.mode, s: '1' })
    : neighbour(n, 1) ? `#/${n + 1}` : null

  useEffect(() => {
    if (!svg) return
    const ns = inSet ? [prevItem?.n, nextItem?.n] : [n - 1, n + 1]
    prefetch(ns.filter((x): x is number => !!x).map(x => rowFor(x)))
  }, [svg])

  // the one-screen view lays out the next hymn (then the previous one) while this one is on screen,
  // with the key and words that page will have, so turning the page is instant
  useEffect(() => {
    if (!fit || !svg || busy) return
    let stop = false
    const pages = inSet
      ? [nextItem, prevItem].filter(Boolean).map(i => ({ n: i!.n, key: i!.key, mode: (i!.mode ?? 'both') as LyricMode }))
      : [neighbour(n, 1), neighbour(n, -1)].filter((x): x is number => x !== null).map(x => ({ n: x, key: undefined as string | undefined, mode: prefs.mode }))
    const t = window.setTimeout(async () => {
      for (const pg of pages) {
        if (stop) return
        const r = rowFor(pg.n)
        if (!r?.f) continue
        try {
          const h = await loadHymn(r)
          if (stop) return
          const m2 = r.m === 1
          const orig = chipFor(originalTonic(r.fi ?? 0, m2), m2)
          const top2 = melodyTop(new DOMParser().parseFromString(h.xml, 'application/xml'))
          const d = semitoneDelta(orig, pg.key || orig, top2, 'auto')
          await drawOneScreen(makeDraw({ n: pg.n, f: r.f, xml: h.xml, delta: d, chords, plain, mode: pg.mode, stopped: () => stop }), pg.mode, vw, vh)
        } catch { /* a page that cannot be prefetched is drawn when it is opened */ }
      }
    }, 400)
    return () => { stop = true; window.clearTimeout(t) }
  }, [fit, svg, busy, n, chords, plain, vw, vh])

  // the scrolling view, once this hymn is on screen and the phone is idle, lays out this hymn's
  // one-screen page (so the full-screen button opens it at once) and then the next and previous
  // hymns as they will appear (so the arrows turn to them at once)
  useEffect(() => {
    if (fit || !svg || busy || !hymn || !row?.f) return
    let stop = false
    const t = window.setTimeout(async () => {
      try {
        await drawOneScreen(makeDraw({ n, f: row.f!, xml: hymn.xml, delta, chords, plain, mode, stopped: () => stop }), mode, vw, vh)
        const pages = inSet
          ? [nextItem, prevItem].filter(Boolean).map(i => ({ n: i!.n, key: i!.key, mode: (i!.mode ?? 'both') as LyricMode }))
          : [neighbour(n, 1), neighbour(n, -1)].filter((x): x is number => x !== null).map(x => ({ n: x, key: undefined as string | undefined, mode }))
        for (const pg of pages) {
          if (stop) return
          const r = rowFor(pg.n)
          if (!r?.f) continue
          const h = await loadHymn(r)
          if (stop) return
          const m2 = r.m === 1
          const orig = chipFor(originalTonic(r.fi ?? 0, m2), m2)
          const top2 = melodyTop(new DOMParser().parseFromString(h.xml, 'application/xml'))
          const d = semitoneDelta(orig, pg.key || orig, top2, 'auto')
          await makeDraw({ n: pg.n, f: r.f, xml: h.xml, delta: d, chords, plain, mode: pg.mode, stopped: () => stop })(width, zoom)
        }
      } catch { /* prefetching is only a head start; the page is drawn when it is opened */ }
    }, 800)
    return () => { stop = true; window.clearTimeout(t) }
  }, [fit, svg, busy, n, chords, plain, mode, delta, width, zoom, vw, vh])

  // arrow keys and page-turn pedals that send arrows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' && nextHash) go(nextHash)
      if (e.key === 'ArrowLeft' && prevHash) go(prevHash)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prevHash, nextHash, sheetOpen])

  // swipe left or right on the music to move through the set list (iPad on a music stand)
  useEffect(() => {
    const el = scoreRef.current
    if (!el) return
    let x0 = 0, y0 = 0, t0 = 0
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now()
    }
    const end = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const dx = t.clientX - x0, dy = t.clientY - y0
      if (Date.now() - t0 > 600 || Math.abs(dx) < 90 || Math.abs(dy) > Math.abs(dx) * 0.5) return
      if (dx < 0 && nextHash) go(nextHash)
      if (dx > 0 && prevHash) go(prevHash)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end, { passive: true })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchend', end)
    }
  }, [prevHash, nextHash])

  // keep the screen awake while a hymn is open (iPad on a music stand)
  useEffect(() => {
    let lock: any = null
    let alive = true
    const request = async () => {
      try {
        const l = await (navigator as any).wakeLock?.request('screen')
        if (alive) lock = l
        else l?.release?.().catch?.(() => {})
      } catch { /* not allowed */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible') request() }
    request()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.().catch?.(() => {})
    }
  }, [])

  // a praise song has no number: the pager names it instead (short, the page is narrow)
  const pagerLabel = (m: number) => {
    const r = rowFor(m)
    if (!r?.p) return String(m)
    const name = titles(r, lang)[0]
    return name.length > 10 ? `${name.slice(0, 9)}…` : name
  }

  const inSetList = prefs.setList.some(i => i.n === n)
  const toggleSet = () => {
    if (inSetList) setPrefs({ setList: prefs.setList.filter(i => i.n !== n) })
    else setPrefs({ setList: [...prefs.setList, { n, key: pitchClass(key) === pitchClass(origTonic) ? undefined : key, mode }] })
  }

  const doPrint = async () => {
    if (!hymn || !row) return
    setPrinting(true)
    try {
      const r = await printHymns([{ row, hymn, delta, mode, chords, plain, keyName: keyLabel(key, minor), origName: keyLabel(origTonic, minor) }], prefs.paper)
      setPrintReady(r === 'tap')
    } finally {
      setPrinting(false)
    }
  }

  if (row === null) {
    return (
      <Shell n={n} row={null} onBack={() => go('#/')}>
        <div class="notice"><p>{F.noHymn(lang, n)}</p></div>
      </Shell>
    )
  }

  const showEnText = hymn && hymn.enMode === 2 && mode !== 'ko' && hymn.en.length > 0
  const noEnglish = hymn && mode === 'en' && hymn.enMode === 0

  return (
    <Shell n={n} row={row ?? null} onBack={() => go(inSet ? '#/set' : '#/')} dark={prefs.dark}>
      {row && !row.f ? (
        <div class="notice">
          <p><strong>{t('gated.title')}</strong></p>
          <p>{row.g === 1 ? t('gated.ko') : t('gated.other')}</p>
        </div>
      ) : (
        <>
          <div class="toolbar" role="toolbar">
            <button class="btn key-btn" onClick={() => setSheetOpen(true)} disabled={!hymn} aria-haspopup="dialog">
              <span class="key-btn-label">{t('key')}</span>
              <strong><KeyName tonic={key} minor={minor} /></strong>
              {delta !== 0 ? <span class="key-btn-orig">{t('key.from')} <KeyName tonic={origTonic} minor={minor} /></span> : null}
            </button>
            {row?.p ? null : (
              <div class="segmented" role="group" aria-label={t('lyrics')}>
                {MODES.map(m => (
                  <button key={m.id} class={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} title={t(m.title)} aria-label={t(m.title)} onClick={() => setMode(m.id)}>
                    {t(m.label)}
                  </button>
                ))}
              </div>
            )}
            <div class="tool-group" role="group" aria-label={t('size')}>
              <button class="icon-btn" aria-label={t('smaller')} title={t('smaller')} disabled={prefs.zoom <= 0.6} onClick={() => setPrefs({ zoom: Math.max(0.6, Math.round((prefs.zoom - 0.1) * 10) / 10) })}><IconZoomOut /></button>
              <button class="icon-btn" aria-label={t('larger')} title={t('larger')} disabled={prefs.zoom >= 1.8} onClick={() => setPrefs({ zoom: Math.min(1.8, Math.round((prefs.zoom + 0.1) * 10) / 10) })}><IconZoomIn /></button>
            </div>
            <div class="tool-group tool-end">
              <button class={`btn set-btn ${inSetList ? 'on' : ''}`} onClick={toggleSet} aria-pressed={inSetList}
                aria-label={inSetList ? t('set.in.aria') : t('set.add.aria')} title={inSetList ? t('set.in.aria') : t('set.add.aria')}>
                {inSetList ? <IconCheck size={18} /> : <IconListAdd size={20} />}
                <span class="set-btn-long">{inSetList ? t('set.in') : t('set.add')}</span>
                <span class="set-btn-short" aria-hidden="true">{inSetList ? t('set.in.short') : t('set.add.short')}</span>
              </button>
              <button class={`btn chords-btn ${chords ? 'on' : ''}`} aria-pressed={chords} onClick={() => setPrefs({ chords: !chords })}
                title={chords ? t('chords.hide') : t('chords.show')}>
                {t('chords')}
              </button>
              {row?.p && chords ? (
                <div class="segmented chord-style" role="group" aria-label={t('chords.style')}>
                  <button class={plain ? 'on' : ''} aria-pressed={plain} title={t('chords.book.title')} onClick={() => setPrefs({ plainChords: true })}>{t('chords.book')}</button>
                  <button class={plain ? '' : 'on'} aria-pressed={!plain} title={t('chords.rich.title')} onClick={() => setPrefs({ plainChords: false })}>{t('chords.rich')}</button>
                </div>
              ) : null}
              <button class="icon-btn" aria-label={t('fit')} title={t('fit')} onClick={() => setFit(true)} disabled={!hymn}><IconExpand /></button>
              <button class="icon-btn" aria-label={t('print')} title={t('print')} onClick={doPrint} disabled={!hymn || printing}><IconPrint /></button>
              <button class="icon-btn" aria-label={prefs.dark ? t('light') : t('dark')} title={prefs.dark ? t('light') : t('dark')} onClick={() => setPrefs({ dark: !prefs.dark })}>
                {prefs.dark ? <IconSun /> : <IconMoon />}
              </button>
            </div>
          </div>

          {noEnglish ? <p class="inline-note">{t('noenglish')}</p> : null}

          <div class={`score ${busy ? 'is-busy' : ''} ${prefs.dark ? 'is-dark' : ''}`} ref={scoreRef} aria-busy={busy}>
            {error ? (
              <div class="notice"><p>{t('draw.error')} {error}</p></div>
            ) : svg && fitSize ? (
              <div class="fit-view">
                <FitHead n={n} row={row ?? null} keyName={<KeyName tonic={key} minor={minor} />} height={fitHeadHeight(vw)} />
                <div class="score-svg fit-svg" style={{ width: `${fitSize.w}px`, height: `${fitSize.h}px` }} role="img"
                  aria-label={`Music for hymn ${n} in ${keyLabel(key, minor)}`} dangerouslySetInnerHTML={{ __html: svg }} />
                <div class="fit-controls">
                  {prevHash ? <a class="icon-btn" href={prevHash} aria-label={t('pager')}><IconBack /></a> : null}
                  {nextHash ? <a class="icon-btn" href={nextHash} aria-label={t('pager')}><IconNext /></a> : null}
                  <button class="icon-btn" onClick={() => setFit(false)} aria-label={t('fit.exit')} title={t('fit.exit')}><IconClose /></button>
                </div>
              </div>
            ) : svg ? (
              <div class="score-svg" role="img" aria-label={`Music for hymn ${n} in ${keyLabel(key, minor)}`} dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div class="score-loading"><span class="spinner" aria-hidden="true" /> {t('loading.music')}</div>
            )}
          </div>

          {showEnText ? (
            <section class="lyric-text" lang="en">
              <h2 class="section-title">{t('en.words')}</h2>
              <p class="muted small">{t('en.words.note')}</p>
              {hymn!.en.map((v, i) => (
                <p key={i} class="verse"><span class="verse-num">{i + 1}</span>{v.split('\n').map((l, j) => <span key={j} class="verse-line">{l}</span>)}</p>
              ))}
            </section>
          ) : null}
        </>
      )}

      <nav class="pager" aria-label={t('pager')}>
        {prevHash ? <a class="pager-link" href={prevHash}><IconBack size={18} /><span>{pagerLabel(inSet ? prevItem!.n : n - 1)}</span></a> : <span />}
        {inSet ? <a class="pager-mid" href="#/set">{setIdx >= 0 ? F.pagerSet(lang, setIdx + 1, prefs.setList.length) : t('pager.back')}</a> : <span />}
        {nextHash ? <a class="pager-link next" href={nextHash}><span>{pagerLabel(inSet ? nextItem!.n : n + 1)}</span><IconNext size={18} /></a> : <span />}
      </nav>

      {row ? (
        <footer class="hymn-foot">
          <p>
            {row.o ? <>{F.footOld(lang, row.o)} </> : null}
            {row.t && themeText(row.t, lang) ? <>{themeText(row.t, lang)}. </> : null}
            {t('foot.origkey')} {row.f ? <KeyName tonic={origTonic} minor={minor} /> : (row.kt || t('unknown'))}{row.ts ? `, ${row.ts}` : ''}.
          </p>
          {hymn?.cr ? <p class="muted small">{creditText(hymn.cr, lang)}</p> : null}
          <p class="small">
            <a href={`${REPO}/issues/new?title=${encodeURIComponent(`Hymn ${n}: `)}&body=${encodeURIComponent(`Hymn ${n} ${row.k}\nKey: ${key}, lyrics: ${mode}\n\nWhat is wrong:\n`)}`} class="report-link" target="_blank" rel="noopener">
              {t('report')}
            </a>
          </p>
        </footer>
      ) : null}

      {sheetOpen && hymn ? (
        <KeySheet
          original={origTonic}
          minor={minor}
          current={chipFor(key, minor)}
          delta={delta}
          dir={dir}
          top={top}
          onPick={pickKey}
          onDir={d => setParams({ dir: d === 'auto' ? undefined : d })}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
      {printing ? <div class="toast" role="status">{t('print.preparing')}</div> : null}
      {printReady && !printing ? (
        <div class="toast" role="status">
          <span>{t('print.ready')}</span>
          <button class="btn primary" onClick={() => { setPrintReady(false); printNow() }}>{t('print')}</button>
          <button class="icon-btn" aria-label={t('close')} onClick={() => setPrintReady(false)}><IconClose size={18} /></button>
        </div>
      ) : null}
    </Shell>
  )
}

/** The one-screen view's title strip, laid out like the printed hymnal page: the key on the left, the
 *  title in the middle (the other language under it), the number large on the right. */
function FitHead({ n, row, keyName, height }: { n: number; row: Row | null; keyName: any; height: number }) {
  const { t, lang } = useT()
  const [primary, secondary] = row ? titles(row, lang) : ['', undefined]
  return (
    <header class="fit-head" style={{ height: `${height}px` }}>
      <div class="fit-head-side">
        <span class="fit-key">{t('key')} {keyName}</span>
      </div>
      <div class="fit-head-title">
        <span class="fit-title">{primary}</span>
        {secondary ? <span class="fit-subtitle">{secondary}</span> : null}
      </div>
      <div class="fit-num">{row?.p ? '' : n}</div>
    </header>
  )
}

function Shell({ n, row, onBack, children, dark }: { n: number; row: Row | null; onBack: () => void; children: any; dark?: boolean }) {
  const { t, lang } = useT()
  const [primary, secondary] = row ? titles(row, lang) : ['', undefined]
  return (
    <main class={`hymn-page ${dark ? 'page-dark' : ''}`}>
      {/* laid out like the printed hymnal page: the title in the middle, the number large on the right */}
      <header class="hymn-head">
        <button class="icon-btn back" onClick={onBack} aria-label={t('back')}><IconBack /></button>
        <div class="hymn-title">
          <span class="hymn-names">
            <span class="hymn-ko">{primary}</span>
            {secondary ? <span class="hymn-en">{secondary}</span> : null}
          </span>
        </div>
        <span class="hymn-num">{row?.p ? '' : n}</span>
        <a class="icon-btn" href="#/" aria-label={t('search')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg></a>
      </header>
      {children}
    </main>
  )
}
