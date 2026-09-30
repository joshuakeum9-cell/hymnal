import { useEffect, useRef, useState } from 'preact/hooks'
import { loadHymn, loadIndex, rowFor, rowForOld, type Row } from '../data'
import { MAJOR_KEYS, MINOR_KEYS, chipFor, isKeyName, keyLabel, melodyTop, originalTonic, pitchClass, semitoneDelta, type LyricMode } from '../music'
import { decodeSet, encodeSet, getPrefs, setPrefs, subscribe, type SetItem } from '../store'
import { go, hymnHash } from '../route'
import { printHymns, printNow, type PrintItem } from '../print'
import { IconBack, IconDown, IconGrip, IconPrint, IconShare, IconTrash, IconUp, KeyName } from '../icons'
import { F, titles, useT } from '../i18n'

function usePrefs() {
  const [p, set] = useState(getPrefs())
  useEffect(() => subscribe(() => set(getPrefs())), [])
  return p
}

/** Drop numbers that are not hymns, duplicates, and key names we do not know. */
function cleanSet(items: SetItem[]): SetItem[] {
  const seen = new Set<number>()
  const out: SetItem[] = []
  for (const it of items) {
    if (!Number.isInteger(it.n) || !rowFor(it.n) || seen.has(it.n)) continue
    seen.add(it.n)
    out.push({ n: it.n, key: isKeyName(it.key) ? it.key : undefined, mode: it.mode })
  }
  return out
}

export function SetListView({ params }: { params: URLSearchParams }) {
  const prefs = usePrefs()
  const { t, lang } = useT()
  const [ready, setReady] = useState(false)
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [printReady, setPrintReady] = useState(false)
  const shared = params.get('h')

  useEffect(() => { loadIndex().then(() => setReady(true)) }, [])

  // opening a shared link offers to replace the list
  const incoming = shared && ready ? cleanSet(decodeSet(shared)) : null
  const list = prefs.setList

  const save = (items: SetItem[]) => setPrefs({ setList: items })
  const move = (i: number, d: number) => {
    const next = [...list]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    save(next)
  }
  // Drag to reorder: press the grip and slide. The dragged item follows the finger and trades
  // places with a neighbour once it passes the neighbour's middle; the arrows still work too.
  const [drag, setDrag] = useState<{ n: number; dy: number } | null>(null)
  const dragState = useRef<{ n: number; startY: number } | null>(null)
  const listNow = useRef(list)
  listNow.current = list
  const itemEl = (n: number) => document.querySelector(`.set-item[data-n="${n}"]`) as HTMLElement | null
  const onGripDown = (e: PointerEvent, n: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    dragState.current = { n, startY: e.clientY }
    setDrag({ n, dy: 0 })
  }
  const onGripMove = (e: PointerEvent) => {
    const d = dragState.current
    if (!d) return
    // near the top or bottom of the screen, scroll so a long list can be reordered end to end
    const edge = 72
    const step = e.clientY > window.innerHeight - edge ? 10 : e.clientY < edge ? -10 : 0
    if (step) { const before = window.scrollY; window.scrollBy(0, step); d.startY -= window.scrollY - before }
    let dy = e.clientY - d.startY
    const cur = listNow.current
    const i = cur.findIndex(it => it.n === d.n)
    const swap = (j: number) => {
      const other = itemEl(cur[j].n)
      const h = other ? other.getBoundingClientRect().height : 0
      if (!h || Math.abs(dy) < h / 2) return false
      const next = [...cur]
      const [x] = next.splice(i, 1)
      next.splice(j, 0, x)
      listNow.current = next
      save(next)
      const shift = j > i ? h : -h
      d.startY += shift
      dy -= shift
      return true
    }
    if (dy > 0 && i < cur.length - 1) swap(i + 1)
    else if (dy < 0 && i > 0) swap(i - 1)
    setDrag({ n: d.n, dy })
  }
  const onGripUp = () => { dragState.current = null; setDrag(null) }

  const update = (i: number, patch: Partial<SetItem>) => save(list.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  // the number typed in the add box, read as a 새찬송가 or a 통일찬송가 number (shared with the home search)
  const oldMode = prefs.oldNumbers
  const typed = add.trim()
  const addRow: Row | undefined = ready && /^\d+$/.test(typed) ? (oldMode ? rowForOld(Number(typed)) : rowFor(Number(typed))) : undefined

  const addNumber = (e: Event) => {
    e.preventDefault()
    if (!/^\d+$/.test(typed)) { setMsg(F.noHymnShort(lang, add)); return }
    if (!addRow) { setMsg(oldMode ? F.oldMissing(lang, Number(typed)) : F.noHymnShort(lang, typed)); return }
    const n = addRow.n
    if (list.some(i => i.n === n)) { setMsg(F.already(lang, n)); return }
    save([...list, { n }])
    setAdd('')
    setMsg('')
  }

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/set?h=${encodeSet(list)}`
    try {
      if (navigator.share) await navigator.share({ title: t('setlist'), url })
      else {
        await navigator.clipboard.writeText(url)
        setMsg(t('link.copied'))
      }
    } catch { /* cancelled */ }
  }

  const printAll = async () => {
    setBusy(true)
    setMsg('')
    try {
      await loadIndex()
      const items: PrintItem[] = []
      const skipped: number[] = []
      for (const it of list) {
        const row = rowFor(it.n)
        if (!row?.f) {
          skipped.push(it.n)
          continue
        }
        const hymn = await loadHymn(row)
        const minor = row.m === 1
        const orig = chipFor(originalTonic(row.fi ?? 0, minor), minor)
        const key = it.key ?? orig
        const top = melodyTop(new DOMParser().parseFromString(hymn.xml, 'application/xml'))
        items.push({ row, hymn, delta: semitoneDelta(orig, key, top), mode: it.mode ?? 'both', chords: prefs.chords !== false, keyName: keyLabel(key, minor), origName: keyLabel(orig, minor) })
      }
      if (skipped.length) setMsg(F.notPrinted(lang, skipped.join(', ')))
      if (!items.length) setMsg(skipped.length ? t('none.music') : t('nothing.print'))
      else setPrintReady((await printHymns(items, prefs.paper)) === 'tap')
    } catch (e) {
      setMsg(F.printFailed(lang, (e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const wordsLabel: Record<LyricMode, string> = { both: t('words.both'), ko: t('words.ko'), en: t('words.en') }

  return (
    <main class="set-page">
      <header class="hymn-head">
        <button class="icon-btn back" onClick={() => go('#/')} aria-label={t('back')}><IconBack /></button>
        <div class="hymn-title"><span class="hymn-names"><span class="hymn-ko">{t('setlist')}</span></span></div>
        <span />
      </header>

      {incoming && ready && encodeSet(incoming) !== encodeSet(list) ? (
        <div class="notice">
          <p>{F.shared(lang, incoming.length, incoming.map(i => i.n).join(', '))}</p>
          <div class="row-actions">
            <button class="btn primary" onClick={() => { save(incoming); go('#/set', true) }}>{t('use.list')}</button>
            <button class="btn" onClick={() => go('#/set', true)}>{t('keep.mine')}</button>
          </div>
        </div>
      ) : null}

      {list.length ? (
        <a class="btn primary big start-btn" href={hymnHash(list[0].n, { key: list[0].key, lyrics: list[0].mode && list[0].mode !== 'both' ? list[0].mode : undefined, s: '1' })}>
          {F.startPlaying(lang, list[0].n)}
        </a>
      ) : null}

      <div class="search-modes set-add-modes" role="group" aria-label={t('add.by')}>
        <button type="button" class={!oldMode ? 'on' : ''} aria-pressed={!oldMode} onClick={() => { setPrefs({ oldNumbers: false }); setMsg('') }}>{t('search.mode.new')}</button>
        <button type="button" class={oldMode ? 'on' : ''} aria-pressed={oldMode} onClick={() => { setPrefs({ oldNumbers: true }); setMsg('') }}>{t('search.mode.old')}</button>
      </div>
      <form class="set-add" onSubmit={addNumber}>
        <input class="set-add-input" type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" placeholder={oldMode ? t('add.placeholder.old') : t('add.placeholder')} value={add}
          onInput={e => { setAdd((e.target as HTMLInputElement).value); setMsg('') }} aria-label={oldMode ? t('add.placeholder.old') : t('add.placeholder')} />
        <button class="btn primary" type="submit" disabled={!typed}>{t('add')}</button>
      </form>
      {msg ? <p class="inline-note" role="status">{msg}</p>
        : addRow ? <p class="inline-note add-preview" aria-live="polite">{F.addPreview(lang, addRow.n, titles(addRow, lang)[0], oldMode ? Number(typed) : undefined)}</p>
        : null}

      {!list.length ? (
        <p class="empty">{t('empty.set')}</p>
      ) : (
        <ol class={`set-items${drag ? ' is-dragging' : ''}`}>
          {list.map((it, i) => {
            const row: Row | undefined = ready ? rowFor(it.n) : undefined
            const minor = row?.m === 1
            const orig = row ? chipFor(originalTonic(row.fi ?? 0, minor), minor) : 'C'
            const keys = minor ? MINOR_KEYS : MAJOR_KEYS
            const current = it.key ?? orig
            const [primary, secondary] = row ? titles(row, lang) : ['', undefined]
            return (
              <li key={it.n} data-n={it.n} class={`set-item${drag?.n === it.n ? ' dragging' : ''}`}
                style={drag?.n === it.n ? { transform: `translateY(${drag.dy}px)` } : undefined}>
                <div class="set-item-top">
                  <span class="set-grip" role="button" aria-label={`${t('drag')}, ${it.n}`} title={t('drag')}
                    onPointerDown={e => onGripDown(e as unknown as PointerEvent, it.n)}
                    onPointerMove={e => onGripMove(e as unknown as PointerEvent)}
                    onPointerUp={onGripUp} onPointerCancel={onGripUp}><IconGrip size={20} /></span>
                  <span class="set-pos" aria-hidden="true">{i + 1}</span>
                  <a class="set-item-main" href={hymnHash(it.n, { key: it.key, lyrics: it.mode && it.mode !== 'both' ? it.mode : undefined, s: '1' })}>
                    <span class="result-num">{it.n}</span>
                    <span class="result-titles">
                      <span class="result-ko">{primary}</span>
                      {secondary ? <span class="result-en">{secondary}</span> : null}
                      {row && !row.f ? <span class="result-tag">{t('noscore')}</span> : null}
                    </span>
                  </a>
                  <button class="icon-btn" aria-label={F.remove(lang, it.n)} onClick={() => save(list.filter((_, j) => j !== i))}><IconTrash size={18} /></button>
                </div>
                <div class="set-item-controls">
                  <label class="select-wrap">
                    <span class="select-label">
                      {t('key')}
                      {pitchClass(current) === pitchClass(orig)
                        ? t('key.original.short')
                        : (lang === 'ko' ? <> (원조 <KeyName tonic={orig} minor={minor} />)</> : <>, from <KeyName tonic={orig} minor={minor} /></>)}
                    </span>
                    {row && !row.f ? (
                      <select value="x" disabled aria-label={F.keyFor(lang, it.n)}>
                        <option value="x">{row.kt ? keyLabel(row.kt, minor) : t('unknown')}</option>
                      </select>
                    ) : (
                      <select value={chipFor(current, minor)} onChange={e => {
                        const k = (e.target as HTMLSelectElement).value
                        update(i, { key: pitchClass(k) === pitchClass(orig) ? undefined : k })
                      }} disabled={!row?.f} aria-label={F.keyFor(lang, it.n)}>
                        {keys.map(k => <option key={k} value={k}>{keyLabel(k, minor)}{pitchClass(k) === pitchClass(orig) ? ' *' : ''}</option>)}
                      </select>
                    )}
                  </label>
                  <label class="select-wrap">
                    <span class="select-label">{t('words')}</span>
                    <select value={it.mode ?? 'both'} onChange={e => update(i, { mode: (e.target as HTMLSelectElement).value as LyricMode })} aria-label={F.lyricsFor(lang, it.n)}>
                      {(['both', 'ko', 'en'] as LyricMode[]).map(m => <option key={m} value={m}>{wordsLabel[m]}</option>)}
                    </select>
                  </label>
                  <span class="set-move">
                    <button class="icon-btn" aria-label={F.moveUp(lang, it.n)} disabled={i === 0} onClick={() => move(i, -1)}><IconUp size={18} /></button>
                    <button class="icon-btn" aria-label={F.moveDown(lang, it.n)} disabled={i === list.length - 1} onClick={() => move(i, 1)}><IconDown size={18} /></button>
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {list.length ? (
        <div class="set-actions">
          <button class="btn primary big" onClick={printAll} disabled={busy}><IconPrint size={20} /><span>{busy ? t('preparing') : t('print.all')}</span></button>
          <button class="btn big" onClick={share}><IconShare size={20} /><span>{t('share.list')}</span></button>
          <div class="segmented paper" role="group" aria-label={t('paper')}>
            {(['letter', 'a4'] as const).map(p => (
              <button key={p} class={prefs.paper === p ? 'on' : ''} aria-pressed={prefs.paper === p} onClick={() => setPrefs({ paper: p })}>{p === 'letter' ? 'Letter' : 'A4'}</button>
            ))}
          </div>
          <button class="btn subtle" onClick={() => { if (confirm(t('clear.confirm'))) save([]) }}>{t('clear.list')}</button>
        </div>
      ) : null}
      {printReady && !busy ? (
        <div class="toast" role="status">
          <span>{t('print.ready')}</span>
          <button class="btn primary" onClick={() => { setPrintReady(false); printNow() }}>{t('print')}</button>
        </div>
      ) : null}
    </main>
  )
}
