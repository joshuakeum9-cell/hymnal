import { useEffect, useState } from 'preact/hooks'
import { loadHymn, loadIndex, rowFor, type Row } from '../data'
import { MAJOR_KEYS, MINOR_KEYS, chipFor, keyLabel, melodyTop, originalTonic, pitchClass, semitoneDelta, type LyricMode } from '../music'
import { decodeSet, encodeSet, getPrefs, setPrefs, subscribe, type SetItem } from '../store'
import { go, hymnHash } from '../route'
import { printHymns, type PrintItem } from '../print'
import { IconBack, IconDown, IconPrint, IconShare, IconTrash, IconUp, KeyName } from '../icons'

function usePrefs() {
  const [p, set] = useState(getPrefs())
  useEffect(() => subscribe(() => set(getPrefs())), [])
  return p
}

const MODE_LABEL: Record<LyricMode, string> = { both: '한/영', ko: '한글', en: 'English' }

export function SetListView({ params }: { params: URLSearchParams }) {
  const prefs = usePrefs()
  const [ready, setReady] = useState(false)
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const shared = params.get('h')

  useEffect(() => { loadIndex().then(() => setReady(true)) }, [])

  // opening a shared link offers to replace the list
  const incoming = shared ? decodeSet(shared) : null
  const list = prefs.setList

  const save = (items: SetItem[]) => setPrefs({ setList: items })
  const move = (i: number, d: number) => {
    const next = [...list]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    save(next)
  }
  const update = (i: number, patch: Partial<SetItem>) => save(list.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  const addNumber = (e: Event) => {
    e.preventDefault()
    const n = Number(add)
    if (!rowFor(n)) { setMsg(`There is no hymn ${add}.`); return }
    if (list.some(i => i.n === n)) { setMsg(`${n} is already in the list.`); return }
    save([...list, { n }])
    setAdd('')
    setMsg('')
  }

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/set?h=${encodeSet(list)}`
    try {
      if (navigator.share) await navigator.share({ title: 'Set list', url })
      else {
        await navigator.clipboard.writeText(url)
        setMsg('Link copied. Paste it in your group chat.')
      }
    } catch { /* cancelled */ }
  }

  const printAll = async () => {
    setBusy(true)
    setMsg('')
    try {
      const items: PrintItem[] = []
      for (const it of list) {
        const row = rowFor(it.n)
        if (!row?.f) continue
        const hymn = await loadHymn(row)
        const minor = row.m === 1
        const orig = chipFor(originalTonic(row.fi ?? 0, minor), minor)
        const key = it.key ?? orig
        const top = melodyTop(new DOMParser().parseFromString(hymn.xml, 'application/xml'))
        items.push({ row, hymn, delta: semitoneDelta(orig, key, top), mode: it.mode ?? 'both', keyName: keyLabel(key, minor), origName: keyLabel(orig, minor) })
      }
      if (!items.length) setMsg('Nothing to print yet.')
      else await printHymns(items, prefs.paper)
    } catch (e) {
      setMsg(`Printing failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class="set-page">
      <header class="hymn-head">
        <button class="icon-btn back" onClick={() => go('#/')} aria-label="Back to search"><IconBack /></button>
        <div class="hymn-title"><span class="hymn-names"><span class="hymn-ko">Set list</span><span class="hymn-en">이번 주 찬송</span></span></div>
        <span />
      </header>

      {incoming && ready && encodeSet(incoming) !== encodeSet(list) ? (
        <div class="notice">
          <p>Someone shared a set list with {incoming.length} hymn{incoming.length === 1 ? '' : 's'}: {incoming.map(i => i.n).join(', ')}.</p>
          <div class="row-actions">
            <button class="btn primary" onClick={() => { save(incoming); go('#/set', true) }}>Use this list</button>
            <button class="btn" onClick={() => go('#/set', true)}>Keep mine</button>
          </div>
        </div>
      ) : null}

      {list.length ? (
        <a class="btn primary big start-btn" href={hymnHash(list[0].n, { key: list[0].key, lyrics: list[0].mode && list[0].mode !== 'both' ? list[0].mode : undefined, s: '1' })}>
          Start playing from {list[0].n}
        </a>
      ) : null}

      <form class="set-add" onSubmit={addNumber}>
        <input class="set-add-input" type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" placeholder="Add hymn number" value={add}
          onInput={e => setAdd((e.target as HTMLInputElement).value)} aria-label="Add hymn number" />
        <button class="btn primary" type="submit" disabled={!add.trim()}>Add</button>
      </form>
      {msg ? <p class="inline-note" role="status">{msg}</p> : null}

      {!list.length ? (
        <p class="empty">No hymns yet. Add numbers above, or tap "Set list" on any hymn.</p>
      ) : (
        <ol class="set-items">
          {list.map((it, i) => {
            const row: Row | undefined = ready ? rowFor(it.n) : undefined
            const minor = row?.m === 1
            const orig = row ? chipFor(originalTonic(row.fi ?? 0, minor), minor) : 'C'
            const keys = minor ? MINOR_KEYS : MAJOR_KEYS
            const current = it.key ?? orig
            return (
              <li key={it.n} class="set-item">
                <div class="set-item-top">
                  <span class="set-pos" aria-hidden="true">{i + 1}</span>
                  <a class="set-item-main" href={hymnHash(it.n, { key: it.key, lyrics: it.mode && it.mode !== 'both' ? it.mode : undefined, s: '1' })}>
                    <span class="result-num">{it.n}</span>
                    <span class="result-titles">
                      <span class="result-ko">{row?.k ?? ''}</span>
                      {row?.e ? <span class="result-en">{row.e}</span> : null}
                      {row && !row.f ? <span class="result-tag">No score yet</span> : null}
                    </span>
                  </a>
                  <button class="icon-btn" aria-label={`Remove ${it.n} from the list`} onClick={() => save(list.filter((_, j) => j !== i))}><IconTrash size={18} /></button>
                </div>
                <div class="set-item-controls">
                  <label class="select-wrap">
                    <span class="select-label">Key{pitchClass(current) === pitchClass(orig) ? ', original' : <>, from <KeyName tonic={orig} minor={minor} /></>}</span>
                    <select value={chipFor(current, minor)} onChange={e => {
                      const k = (e.target as HTMLSelectElement).value
                      update(i, { key: pitchClass(k) === pitchClass(orig) ? undefined : k })
                    }} disabled={!row?.f} aria-label={`Key for ${it.n}`}>
                      {keys.map(k => <option key={k} value={k}>{keyLabel(k, minor)}{pitchClass(k) === pitchClass(orig) ? ' *' : ''}</option>)}
                    </select>
                  </label>
                  <label class="select-wrap">
                    <span class="select-label">Words</span>
                    <select value={it.mode ?? 'both'} onChange={e => update(i, { mode: (e.target as HTMLSelectElement).value as LyricMode })} aria-label={`Lyrics for ${it.n}`}>
                      {(['both', 'ko', 'en'] as LyricMode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                    </select>
                  </label>
                  <span class="set-move">
                    <button class="icon-btn" aria-label={`Move ${it.n} up`} disabled={i === 0} onClick={() => move(i, -1)}><IconUp size={18} /></button>
                    <button class="icon-btn" aria-label={`Move ${it.n} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><IconDown size={18} /></button>
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {list.length ? (
        <div class="set-actions">
          <button class="btn primary big" onClick={printAll} disabled={busy}><IconPrint size={20} /><span>{busy ? 'Preparing…' : 'Print all'}</span></button>
          <button class="btn big" onClick={share}><IconShare size={20} /><span>Share list</span></button>
          <div class="segmented paper" role="group" aria-label="Paper size">
            {(['letter', 'a4'] as const).map(p => (
              <button key={p} class={prefs.paper === p ? 'on' : ''} aria-pressed={prefs.paper === p} onClick={() => setPrefs({ paper: p })}>{p === 'letter' ? 'Letter' : 'A4'}</button>
            ))}
          </div>
          <button class="btn subtle" onClick={() => { if (confirm('Clear the whole set list?')) save([]) }}>Clear list</button>
        </div>
      ) : null}
    </main>
  )
}
