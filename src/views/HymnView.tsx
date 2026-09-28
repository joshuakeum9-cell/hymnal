import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadHymn, loadIndex, prefetch, rowFor, type Hymn, type Row } from '../data'
import { chipFor, keyLabel, melodyTop, originalTonic, pitchClass, semitoneDelta, type Direction, type LyricMode } from '../music'
import { cachedSvg, screenRenderer } from '../score'
import { getPrefs, pushRecent, setPrefs, subscribe } from '../store'
import { go, goBack, hymnHash } from '../route'
import { KeySheet } from './KeySheet'
import { printHymns } from '../print'
import { KeyName, IconBack, IconCheck, IconListAdd, IconMoon, IconNext, IconPrint, IconSun, IconZoomIn, IconZoomOut } from '../icons'

const MODES: { id: LyricMode; label: string; title: string }[] = [
  { id: 'both', label: '한/영', title: 'Korean and English' },
  { id: 'ko', label: '한', title: 'Korean only' },
  { id: 'en', label: '영', title: 'English only' },
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
  const [row, setRow] = useState<Row | null | undefined>(rowFor(n))
  const [hymn, setHymn] = useState<Hymn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const scoreRef = useRef<HTMLDivElement>(null)
  const width = useWidth(scoreRef)
  const token = useRef(0)

  const inSet = params.get('s') === '1'
  const mode = (params.get('lyrics') as LyricMode) || prefs.mode
  const dir = (params.get('dir') as Direction) || 'auto'

  useEffect(() => {
    let alive = true
    setHymn(null)
    setError(null)
    setSvg('')
    loadIndex().then(() => {
      if (!alive) return
      const r = rowFor(n) ?? null
      setRow(r)
      if (!r) return
      pushRecent(n)
      document.title = `${n} ${r.k}`
      if (!r.f) return
      loadHymn(r).then(h => alive && setHymn(h)).catch(e => alive && setError(String(e.message ?? e)))
    })
    window.scrollTo(0, 0)
    return () => { alive = false }
  }, [n])

  const minor = row?.m === 1
  const origTonic = row ? chipFor(originalTonic(row.fi ?? 0, minor), minor) : 'C'
  const key = params.get('key') || (row ? prefs.keys[String(n)] : undefined) || origTonic
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

  const pickKey = (k: string) => {
    const same = pitchClass(k) === pitchClass(origTonic)
    const keys = { ...prefs.keys }
    if (same) delete keys[String(n)]
    else keys[String(n)] = k
    setPrefs({ keys })
    setParams({ key: same ? undefined : k, dir: undefined })
  }

  const setMode = (m: LyricMode) => {
    setPrefs({ mode: m })
    setParams({ lyrics: m === 'both' ? undefined : m })
  }

  // render
  const [vh, setVh] = useState(window.innerHeight)
  useEffect(() => {
    const on = () => setVh(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const zoom = Math.round(baseZoom(width, vh > 0 ? vh : 0) * prefs.zoom * 100) / 100
  useEffect(() => {
    if (!hymn || !row?.f || width < 100) return
    const my = ++token.current
    const cacheKey = `${n}|${row.f}|${delta}|${mode}|${width}|${zoom}|screen`
    let cancelled = false
    ;(async () => {
      const hit = await cachedSvg(cacheKey)
      if (cancelled || my !== token.current) return
      if (hit) {
        setSvg(hit)
        return
      }
      setBusy(true)
      try {
        const res = await screenRenderer().render({ cacheKey, xml: hymn.xml, mode, delta, width, zoom })
        if (my === token.current) {
          setSvg(res.svg)
          if (!res.cached) console.info(`[hymnal] ${n} rendered in ${res.ms} ms (key ${key}, ${mode}, ${width}px)`)
        }
      } catch (e) {
        if (my === token.current) setError(String((e as Error).message ?? e))
      } finally {
        if (my === token.current) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [hymn, row?.f, delta, mode, width, zoom])

  // neighbours
  const setIdx = inSet ? prefs.setList.findIndex(i => i.n === n) : -1
  const prevItem = inSet && setIdx > 0 ? prefs.setList[setIdx - 1] : null
  const nextItem = inSet && setIdx >= 0 && setIdx < prefs.setList.length - 1 ? prefs.setList[setIdx + 1] : null
  const prevHash = inSet
    ? prevItem && hymnHash(prevItem.n, { key: prevItem.key, lyrics: prevItem.mode === 'both' ? undefined : prevItem.mode, s: '1' })
    : n > 1 ? `#/${n - 1}` : null
  const nextHash = inSet
    ? nextItem && hymnHash(nextItem.n, { key: nextItem.key, lyrics: nextItem.mode === 'both' ? undefined : nextItem.mode, s: '1' })
    : n < 645 ? `#/${n + 1}` : null

  useEffect(() => {
    if (!svg) return
    const ns = inSet ? [prevItem?.n, nextItem?.n] : [n - 1, n + 1]
    prefetch(ns.filter((x): x is number => !!x).map(x => rowFor(x)))
  }, [svg])

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

  // keep the screen awake while a hymn is open (iPad on a music stand)
  useEffect(() => {
    let lock: any = null
    const request = async () => {
      try { lock = await (navigator as any).wakeLock?.request('screen') } catch { /* not allowed */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible') request() }
    request()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.().catch?.(() => {})
    }
  }, [])

  const inSetList = prefs.setList.some(i => i.n === n)
  const toggleSet = () => {
    if (inSetList) setPrefs({ setList: prefs.setList.filter(i => i.n !== n) })
    else setPrefs({ setList: [...prefs.setList, { n, key: pitchClass(key) === pitchClass(origTonic) ? undefined : key, mode }] })
  }

  const doPrint = async () => {
    if (!hymn || !row) return
    setPrinting(true)
    try {
      await printHymns([{ row, hymn, delta, mode, keyName: keyLabel(key, minor), origName: keyLabel(origTonic, minor) }], prefs.paper)
    } finally {
      setPrinting(false)
    }
  }

  if (row === null) {
    return (
      <Shell n={n} row={null} onBack={() => go('#/')}>
        <div class="notice"><p>There is no hymn {n}. The 새찬송가 has 645 hymns.</p></div>
      </Shell>
    )
  }

  const showEnText = hymn && hymn.enMode === 2 && mode !== 'ko' && hymn.en.length > 0
  const noEnglish = hymn && mode === 'en' && hymn.enMode === 0

  return (
    <Shell n={n} row={row ?? null} onBack={() => goBack()} dark={prefs.dark}>
      {row && !row.f ? (
        <div class="notice">
          <p><strong>This hymn's music is not on the site yet.</strong></p>
          <p>
            {row.g === 1
              ? 'It was written by a Korean author whose work is still under copyright, so its music stays off the site unless 한국찬송가공회 gives permission.'
              : 'Its words or music may still be under copyright, so it stays off the site until that is checked.'}
          </p>
          <p class="muted">저작권 확인 중인 찬송이라 악보를 아직 싣지 않았습니다.</p>
        </div>
      ) : (
        <>
          <div class="toolbar" role="toolbar" aria-label="Hymn controls">
            <button class="btn key-btn" onClick={() => setSheetOpen(true)} disabled={!hymn} aria-haspopup="dialog">
              <span class="key-btn-label">Key</span>
              <strong><KeyName tonic={key} minor={minor} /></strong>
              {delta !== 0 ? <span class="key-btn-orig">from <KeyName tonic={origTonic} minor={minor} /></span> : null}
            </button>
            <div class="segmented" role="group" aria-label="Lyrics">
              {MODES.map(m => (
                <button key={m.id} class={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} title={m.title} aria-label={m.title} onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            <div class="tool-group" role="group" aria-label="Size">
              <button class="icon-btn" aria-label="Smaller music" title="Smaller" disabled={prefs.zoom <= 0.6} onClick={() => setPrefs({ zoom: Math.max(0.6, Math.round((prefs.zoom - 0.1) * 10) / 10) })}><IconZoomOut /></button>
              <button class="icon-btn" aria-label="Larger music" title="Larger" disabled={prefs.zoom >= 1.8} onClick={() => setPrefs({ zoom: Math.min(1.8, Math.round((prefs.zoom + 0.1) * 10) / 10) })}><IconZoomIn /></button>
            </div>
            <div class="tool-group tool-end">
              <button class={`btn set-btn ${inSetList ? 'on' : ''}`} onClick={toggleSet} aria-pressed={inSetList}
                aria-label={inSetList ? 'In set list. Tap to remove' : 'Add to set list'} title={inSetList ? 'Remove from set list' : 'Add to set list'}>
                {inSetList ? <IconCheck size={18} /> : <IconListAdd size={20} />}
                <span class="set-btn-long">{inSetList ? 'In set list' : 'Add to set'}</span>
                <span class="set-btn-short" aria-hidden="true">{inSetList ? 'In set' : 'Set'}</span>
              </button>
              <button class="icon-btn" aria-label="Print" onClick={doPrint} disabled={!hymn || printing}><IconPrint /></button>
              <button class="icon-btn" aria-label={prefs.dark ? 'Light pages' : 'Dark pages for the stage'} onClick={() => setPrefs({ dark: !prefs.dark })}>
                {prefs.dark ? <IconSun /> : <IconMoon />}
              </button>
            </div>
          </div>

          {noEnglish ? <p class="inline-note">English words are not available for this hymn yet, so the music shows without words.</p> : null}

          <div class={`score ${busy ? 'is-busy' : ''} ${prefs.dark ? 'is-dark' : ''}`} ref={scoreRef} aria-busy={busy}>
            {error ? (
              <div class="notice"><p>Sorry, this hymn could not be drawn. {error}</p></div>
            ) : svg ? (
              <div class="score-svg" role="img" aria-label={`Music for hymn ${n} in ${keyLabel(key, minor)}`} dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div class="score-loading"><span class="spinner" aria-hidden="true" /> Loading music…</div>
            )}
          </div>

          {showEnText ? (
            <section class="lyric-text" lang="en">
              <h2 class="section-title">English words</h2>
              <p class="muted small">The English does not fit this setting note for note yet, so it is shown here instead.</p>
              {hymn!.en.map((v, i) => (
                <p key={i} class="verse"><span class="verse-num">{i + 1}</span>{v.split('\n').map((l, j) => <span key={j} class="verse-line">{l}</span>)}</p>
              ))}
            </section>
          ) : null}
        </>
      )}

      <nav class="pager" aria-label="Other hymns">
        {prevHash ? <a class="pager-link" href={prevHash}><IconBack size={18} /><span>{inSet ? prevItem!.n : n - 1}</span></a> : <span />}
        {inSet ? <a class="pager-mid" href="#/set">Set list {setIdx + 1} of {prefs.setList.length}</a> : <span />}
        {nextHash ? <a class="pager-link next" href={nextHash}><span>{inSet ? nextItem!.n : n + 1}</span><IconNext size={18} /></a> : <span />}
      </nav>

      {row ? (
        <footer class="hymn-foot">
          <p>
            {row.o ? <>통일찬송가 {row.o}장. </> : null}
            {row.t ? <>{row.t}. </> : null}
            Original key {row.f ? <KeyName tonic={origTonic} minor={minor} /> : (row.kt || 'unknown')}{row.ts ? `, ${row.ts}` : ''}.
          </p>
          {hymn?.cr ? <p class="muted small">{hymn.cr}</p> : null}
          <p class="small">
            <a href={`${REPO}/issues/new?title=${encodeURIComponent(`Hymn ${n}: `)}&body=${encodeURIComponent(`Hymn ${n} ${row.k}\nKey: ${key}, lyrics: ${mode}\n\nWhat is wrong:\n`)}`} target="_blank" rel="noopener">
              Report a mistake in this hymn
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
      {printing ? <div class="toast" role="status">Preparing pages for printing…</div> : null}
    </Shell>
  )
}

function Shell({ n, row, onBack, children, dark }: { n: number; row: Row | null; onBack: () => void; children: any; dark?: boolean }) {
  return (
    <main class={`hymn-page ${dark ? 'page-dark' : ''}`}>
      <header class="hymn-head">
        <button class="icon-btn back" onClick={onBack} aria-label="Back to search"><IconBack /></button>
        <div class="hymn-title">
          <span class="hymn-num">{n}</span>
          <span class="hymn-names">
            <span class="hymn-ko">{row?.k ?? ''}</span>
            {row?.e ? <span class="hymn-en">{row.e}</span> : null}
          </span>
        </div>
        <a class="icon-btn" href="#/" aria-label="Search"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg></a>
      </header>
      {children}
    </main>
  )
}
