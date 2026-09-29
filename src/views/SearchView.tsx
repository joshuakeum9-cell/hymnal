import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { loadIndex, search, type Row } from '../data'
import { getPrefs, setPrefs, subscribe } from '../store'
import { go, hymnHash } from '../route'
import { IconGlobe, IconList, KeyName } from '../icons'
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

  const results = useMemo(() => (rows ? search(rows, q, prefs.oldNumbers && !byTitle) : []), [rows, q, prefs.oldNumbers, byTitle])

  const open = (row: Row) => go(`#/${row.n}`)

  // Typing shows the matching hymn; it opens on a tap or Enter, never by itself.
  const onInput = (e: Event) => setQ((e.target as HTMLInputElement).value)

  const onSubmit = (e: Event) => {
    e.preventDefault()
    if (results[0]) open(results[0].row)
  }

  const recent = rows ? prefs.recent.slice(0, 8).map(n => rows.find(r => r.n === n)).filter(Boolean) as Row[] : []
  const first = prefs.setList[0]
  const hint = byTitle ? t('search.hint.title') : prefs.oldNumbers ? t('search.hint.old') : t('search.hint.number')

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
        <label class="visually-hidden" for="q">{byTitle ? t('search.label.title') : t('search.label.number')}</label>
        <div class={`search-field ${byTitle ? 'is-text' : 'is-number'}`}>
          <input
            id="q"
            ref={input}
            class={`search-input ${byTitle ? 'is-text' : 'is-number'}`}
            type="text"
            inputMode={byTitle ? 'text' : 'numeric'}
            pattern={byTitle ? undefined : '[0-9]*'}
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            value={q}
            onInput={onInput}
          />
          {q ? null : <span class="search-hint" aria-hidden="true">{hint}</span>}
        </div>
        <div class="search-modes" role="group" aria-label={t('search.by')}>
          <button type="button" class={!byTitle && !prefs.oldNumbers ? 'on' : ''} aria-pressed={!byTitle && !prefs.oldNumbers}
            onClick={() => { setByTitle(false); setPrefs({ oldNumbers: false }); setQ(''); input.current?.focus() }}>
            {t('search.mode.new')}
          </button>
          <button type="button" class={!byTitle && prefs.oldNumbers ? 'on' : ''} aria-pressed={!byTitle && prefs.oldNumbers}
            onClick={() => { setByTitle(false); setPrefs({ oldNumbers: true }); setQ(''); input.current?.focus() }}>
            {t('search.mode.old')}
          </button>
          <button type="button" class={byTitle ? 'on' : ''} aria-pressed={byTitle}
            onClick={() => { setByTitle(true); setQ(''); input.current?.focus() }}>
            {t('search.mode.title')}
          </button>
        </div>
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
                      <strong>{it.n}</strong>
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
              <span class="result-num">
                {r.n}
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
