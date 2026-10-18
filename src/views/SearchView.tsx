import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadIndex, search, type Row } from '../data'
import { getPrefs, setPrefs, subscribe } from '../store'
import { go, goBack, hymnHash } from '../route'
import { IconBack, IconGlobe, IconList, KeyName } from '../icons'
import { F, setLang, titles, useT } from '../i18n'

function usePrefs() {
  const [p, set] = useState(getPrefs())
  useEffect(() => subscribe(() => set(getPrefs())), [])
  return p
}

export function SearchView() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [byTitle, setByTitle] = useState(false)
  const prefs = usePrefs()
  const { t, lang } = useT()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadIndex().then(setRows)
  }, [])

  useEffect(() => {
    // focus on desktop and tablets; on phones the keyboard would cover the recent list
    if (window.matchMedia('(min-width: 700px)').matches) input.current?.focus()
  }, [byTitle])

  // the title box searches titles even for a typed number ("23편" or a year in a title)
  const results = useMemo(() => (rows ? search(rows, q, prefs.oldNumbers && !byTitle, byTitle) : []), [rows, q, prefs.oldNumbers, byTitle])

  const open = (row: Row) => go(`#/${row.n}`)

  // Typing shows the matching hymn; it opens on a tap or Enter, never by itself.
  const onInput = (e: Event) => setQ((e.target as HTMLInputElement).value)

  const onSubmit = (e: Event) => {
    e.preventDefault()
    if (results[0]) open(results[0].row)
  }

  const recent = rows ? prefs.recent.slice(0, 8).map(n => rows.find(r => r.n === n)).filter(Boolean) as Row[] : []
  const first = prefs.setList[0]

  return (
    <main class="search-page">
      <header class="search-top">
        <button class="lang-btn" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} aria-label={t('lang.switch')} title={t('lang.switch')}>
          <IconGlobe size={20} />
          <span>{t('lang.other')}</span>
        </button>
        <h1 class="brand">
          <span class="brand-ko">{t('home.title')}</span>
          <span class="brand-en">{t('home.subtitle')}</span>
        </h1>
        <a class="setlist-link" href="#/set">
          <IconList size={20} />
          <span>{t('setlist')}{prefs.setList.length ? ` (${prefs.setList.length})` : ''}</span>
        </a>
      </header>

      <form class="search-form" onSubmit={onSubmit} role="search">
        {/* two boxes, always both on screen: a number pad for hymn numbers, a full keyboard for titles */}
        <label class="visually-hidden" for="q">{t('search.label.number')}</label>
        <div class="search-field is-number">
          <input
            id="q"
            ref={input}
            class="search-input is-number"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            value={byTitle ? '' : q}
            onInput={e => { setByTitle(false); onInput(e) }}
          />
          {q && !byTitle ? null : <span class="search-hint" aria-hidden="true">{prefs.oldNumbers ? t('search.hint.old') : t('search.hint.number')}</span>}
        </div>
        <div class="search-modes" role="group" aria-label={t('search.by')}>
          <button type="button" class={!prefs.oldNumbers ? 'on' : ''} aria-pressed={!prefs.oldNumbers}
            onClick={() => { setByTitle(false); setPrefs({ oldNumbers: false }); setQ(''); input.current?.focus() }}>
            {t('search.mode.new')}
          </button>
          <button type="button" class={prefs.oldNumbers ? 'on' : ''} aria-pressed={prefs.oldNumbers}
            onClick={() => { setByTitle(false); setPrefs({ oldNumbers: true }); setQ(''); input.current?.focus() }}>
            {t('search.mode.old')}
          </button>
        </div>
        <label class="visually-hidden" for="qt">{t('search.label.title')}</label>
        <div class="search-field is-text">
          <input
            id="qt"
            class="search-input is-text search-title"
            type="search"
            inputMode="text"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            value={byTitle ? q : ''}
            onInput={e => { setByTitle(true); onInput(e) }}
          />
          {q && byTitle ? null : <span class="search-hint" aria-hidden="true">{t('search.hint.title')}</span>}
        </div>
        {/* with two boxes, Enter only submits a form that has a submit button */}
        <button type="submit" class="visually-hidden" tabIndex={-1}>{t('search.by')}</button>
      </form>

      {q.trim() ? (
        <ResultList items={results.map(r => r.row)} showOld={results[0]?.via === 'old'} empty={rows ? t('results.none') : t('loading')} />
      ) : (
        <>
          {prefs.setList.length > 0 && rows && (
            <section class="home-section">
              <div class="section-row">
                <h2 class="section-title">{t('setlist')}</h2>
                <a class="small" href="#/set">{t('edit')}</a>
              </div>
              <div class="set-strip">
                {prefs.setList.map(it => {
                  const r = rows.find(x => x.n === it.n)
                  return (
                    <a key={it.n} class="set-chip" href={hymnHash(it.n, { key: it.key, lyrics: it.mode && it.mode !== 'both' ? it.mode : undefined, s: '1' })}>
                      <strong>{r?.p ? t('praise') : it.n}</strong>
                      <span>{r ? titles(r, lang)[0] : ''}</span>
                      {it.key ? <em><KeyName tonic={it.key} minor={r?.m === 1} /></em> : null}
                    </a>
                  )
                })}
              </div>
              {first ? (
                <a class="btn primary start-btn" href={hymnHash(first.n, { key: first.key, lyrics: first.mode && first.mode !== 'both' ? first.mode : undefined, s: '1' })}>
                  {F.startFrom(lang, first.n)}
                </a>
              ) : null}
            </section>
          )}
          {recent.length > 0 && (
            <section class="home-section">
              <h2 class="section-title">{t('recent')}</h2>
              <ResultList items={recent} />
            </section>
          )}
          {recent.length === 0 && (
            <section class="home-section hint">
              <p>{t('home.hint')}</p>
            </section>
          )}
          {rows?.some(r => r.p) ? (
            <section class="home-section">
              <a class="btn praise-link" href="#/praise">{t('praise.all')} ({rows.filter(r => r.p).length})</a>
            </section>
          ) : null}
        </>
      )}

      <footer class="page-foot">
        <a href="#/about">{t('about.link')}</a>
      </footer>
    </main>
  )
}

export function ResultList({ items, showOld = false, empty }: { items: Row[]; showOld?: boolean; empty?: string }) {
  const { t, lang } = useT()
  if (!items.length) return <p class="empty">{empty}</p>
  return (
    <ul class="results">
      {items.map(r => {
        const [primary, secondary] = titles(r, lang)
        return (
          <li key={r.n}>
            <a class={`result ${r.f ? '' : 'is-gated'}`} href={`#/${r.n}`}>
              <span class={`result-num${r.p ? ' is-praise' : ''}`}>
                {r.p ? t('praise') : r.n}
                {showOld && r.o ? <small>{F.oldTag(lang, r.o)}</small> : null}
              </span>
              <span class="result-titles">
                <span class="result-ko">{primary}</span>
                {secondary ? <span class="result-en">{secondary}</span> : null}
              </span>
              {!r.f ? <span class="result-tag">{t('noscore')}</span> : null}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** Every praise song, by title: they have no numbers to look up. */
export function PraiseView() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const { t, lang } = useT()
  useEffect(() => { loadIndex().then(setRows) }, [])
  const items = rows
    ? rows.filter(r => r.p).sort((a, b) => titles(a, lang)[0].localeCompare(titles(b, lang)[0], lang))
    : []
  return (
    <main class="set-page">
      <header class="hymn-head">
        <button class="icon-btn back" onClick={() => goBack('#/')} aria-label={t('back')}><IconBack /></button>
        <div class="hymn-title"><span class="hymn-names"><span class="hymn-ko">{t('praise.title')}</span></span></div>
        <span />
      </header>
      <ResultList items={items} empty={rows ? t('results.none') : t('loading')} />
    </main>
  )
}
