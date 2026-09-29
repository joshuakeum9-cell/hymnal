import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadHymn, loadIndex, prefetch, rowFor, type Hymn, type Row } from '../data'
import { chipFor, isKeyName, keyLabel, melodyTop, originalTonic, pitchClass, semitoneDelta, type Direction, type LyricMode } from '../music'
import { cachedSvg, screenRenderer } from '../score'
import { getPrefs, pushRecent, setPrefs, subscribe } from '../store'
import { go, goBack, hymnHash } from '../route'
import { KeySheet } from './KeySheet'
import { printHymns, printNow } from '../print'
import { KeyName, IconBack, IconCheck, IconClose, IconListAdd, IconMoon, IconNext, IconPrint, IconSun, IconZoomIn, IconZoomOut } from '../icons'
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
  useEffect(() => {
    const on = () => setVh(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const chords = prefs.chords !== false
  const zoom = Math.round(baseZoom(width, vh > 0 ? vh : 0) * prefs.zoom * 100) / 100
  useEffect(() => {
    if (!hymn || !row?.f || width < 100) return
    const my = ++token.current
    const cacheKey = `${n}|${row.f}|${delta}|${mode}|${chords}|${width}|${zoom}|screen`
    let cancelled = false
    setError(null)
    ;(async () => {
      const hit = await cachedSvg(cacheKey)
      if (cancelled || my !== token.current) return
      if (hit) {
        setSvg(hit)
        setBusy(false)
        return
      }
      setBusy(true)
      try {
        const res = await screenRenderer().render({ cacheKey, xml: hymn.xml, mode, chords, delta, width, zoom })
        if (my === token.current) {
          setSvg(res.svg)
          setError(null)
          if (!res.cached) console.info(`[hymnal] ${n} rendered in ${res.ms} ms (key ${key}, ${mode}, ${width}px)`)
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
  }, [hymn, row?.f, delta, mode, chords, width, zoom])

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

  const inSetList = prefs.setList.some(i => i.n === n)
  const toggleSet = () => {
    if (inSetList) setPrefs({ setList: prefs.setList.filter(i => i.n !== n) })
    else setPrefs({ setList: [...prefs.setList, { n, key: pitchClass(key) === pitchClass(origTonic) ? undefined : key, mode }] })
  }

  const doPrint = async () => {
    if (!hymn || !row) return
    setPrinting(true)
    try {
      const r = await printHymns([{ row, hymn, delta, mode, chords, keyName: keyLabel(key, minor), origName: keyLabel(origTonic, minor) }], prefs.paper)
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
    <Shell n={n} row={row ?? null} onBack={() => goBack()} dark={prefs.dark}>
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
            <div class="segmented" role="group" aria-label={t('lyrics')}>
              {MODES.map(m => (
                <button key={m.id} class={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} title={t(m.title)} aria-label={t(m.title)} onClick={() => setMode(m.id)}>
                  {t(m.label)}
                </button>
              ))}
            </div>
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
        {prevHash ? <a class="pager-link" href={prevHash}><IconBack size={18} /><span>{inSet ? prevItem!.n : n - 1}</span></a> : <span />}
        {inSet ? <a class="pager-mid" href="#/set">{setIdx >= 0 ? F.pagerSet(lang, setIdx + 1, prefs.setList.length) : t('pager.back')}</a> : <span />}
        {nextHash ? <a class="pager-link next" href={nextHash}><span>{inSet ? nextItem!.n : n + 1}</span><IconNext size={18} /></a> : <span />}
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

function Shell({ n, row, onBack, children, dark }: { n: number; row: Row | null; onBack: () => void; children: any; dark?: boolean }) {
  const { t, lang } = useT()
  const [primary, secondary] = row ? titles(row, lang) : ['', undefined]
  return (
    <main class={`hymn-page ${dark ? 'page-dark' : ''}`}>
      <header class="hymn-head">
        <button class="icon-btn back" onClick={onBack} aria-label={t('back')}><IconBack /></button>
        <div class="hymn-title">
          <span class="hymn-num">{n}</span>
          <span class="hymn-names">
            <span class="hymn-ko">{primary}</span>
            {secondary ? <span class="hymn-en">{secondary}</span> : null}
          </span>
        </div>
        <a class="icon-btn" href="#/" aria-label={t('search')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg></a>
      </header>
      {children}
    </main>
  )
}
