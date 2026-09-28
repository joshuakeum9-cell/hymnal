import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { isFinalNumber, loadIndex, search, type Row } from '../data'
import { getPrefs, setPrefs, subscribe } from '../store'
import { go } from '../route'
import { IconList } from '../icons'

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

  const onInput = (e: Event) => {
    const v = (e.target as HTMLInputElement).value
    setQ(v)
    const t = v.trim()
    if (byTitle || !rows) return
    if (!prefs.oldNumbers && isFinalNumber(t) && rows.some(r => r.n === Number(t))) go(`#/${Number(t)}`)
    if (prefs.oldNumbers && isFinalNumber(t, 558)) {
      const r = rows.find(x => x.o === Number(t))
      if (r) go(`#/${r.n}`)
    }
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    if (results[0]) open(results[0].row)
  }

  const recent = rows ? prefs.recent.map(n => rows.find(r => r.n === n)).filter(Boolean) as Row[] : []

  return (
    <main class="search-page">
      <header class="search-top">
        <h1 class="brand">
          <span class="brand-ko">새찬송가</span>
          <span class="brand-en">Band Hymnal</span>
        </h1>
        <a class="setlist-link" href="#/set">
          <IconList size={20} />
          <span>Set list{prefs.setList.length ? ` (${prefs.setList.length})` : ''}</span>
        </a>
      </header>

      <form class="search-form" onSubmit={onSubmit} role="search">
        <label class="visually-hidden" for="q">{byTitle ? 'Search by title or first line' : 'Hymn number'}</label>
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
          placeholder={byTitle ? '제목 또는 가사 첫 줄, ㅈㅇㅊㅈ' : prefs.oldNumbers ? '통일찬송가 번호' : '장 번호'}
          value={q}
          onInput={onInput}
        />
        <div class="search-modes" role="group" aria-label="Search by">
          <button type="button" class={!byTitle && !prefs.oldNumbers ? 'on' : ''} aria-pressed={!byTitle && !prefs.oldNumbers}
            onClick={() => { setByTitle(false); setPrefs({ oldNumbers: false }); setQ(''); input.current?.focus() }}>
            새찬송가 번호
          </button>
          <button type="button" class={!byTitle && prefs.oldNumbers ? 'on' : ''} aria-pressed={!byTitle && prefs.oldNumbers}
            onClick={() => { setByTitle(false); setPrefs({ oldNumbers: true }); setQ(''); input.current?.focus() }}>
            통일 번호
          </button>
          <button type="button" class={byTitle ? 'on' : ''} aria-pressed={byTitle}
            onClick={() => { setByTitle(true); setQ(''); input.current?.focus() }}>
            제목 Title
          </button>
        </div>
      </form>

      {q.trim() ? (
        <ResultList items={results.map(r => r.row)} showOld={results[0]?.via === 'old'} empty={rows ? 'No hymn matches that.' : 'Loading…'} />
      ) : (
        <>
          {recent.length > 0 && (
            <section class="home-section">
              <h2 class="section-title">Recent</h2>
              <ResultList items={recent} />
            </section>
          )}
          {recent.length === 0 && (
            <section class="home-section hint">
              <p>Type a hymn number and the music opens. Pick any key, and show the words in Korean, English, or both.</p>
              <p class="hint-ko">장 번호를 입력하면 악보가 바로 열립니다. 원하는 키로 옮기고, 가사는 한글, 영어, 또는 함께 볼 수 있습니다.</p>
            </section>
          )}
        </>
      )}

      <footer class="page-foot">
        <a href="#/about">About, sources and copyright</a>
      </footer>
    </main>
  )
}

export function ResultList({ items, showOld = false, empty }: { items: Row[]; showOld?: boolean; empty?: string }) {
  if (!items.length) return <p class="empty">{empty}</p>
  return (
    <ul class="results">
      {items.map(r => (
        <li key={r.n}>
          <a class={`result ${r.f ? '' : 'is-gated'}`} href={`#/${r.n}`}>
            <span class="result-num">
              {r.n}
              {showOld && r.o ? <small>통 {r.o}</small> : null}
            </span>
            <span class="result-titles">
              <span class="result-ko">{r.k}</span>
              {r.e ? <span class="result-en">{r.e}</span> : null}
            </span>
            {!r.f ? <span class="result-tag">No score yet</span> : null}
          </a>
        </li>
      ))}
    </ul>
  )
}
