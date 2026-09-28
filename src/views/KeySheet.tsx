import { useEffect, useRef } from 'preact/hooks'
import { MAJOR_KEYS, MINOR_KEYS, midiName, pitchClass, type Direction } from '../music'
import { IconClose, IconMinus, IconPlus, KeyName } from '../icons'

type Props = {
  original: string          // original tonic, spelled from the chip list
  minor: boolean
  current: string           // selected chip
  delta: number             // semitones applied
  dir: Direction
  top: number | null        // melody top note (MIDI) in the original key
  onPick: (key: string) => void
  onDir: (dir: Direction) => void
  onClose: () => void
}

export function KeySheet({ original, minor, current, delta, dir, top, onPick, onDir, onClose }: Props) {
  const keys = minor ? MINOR_KEYS : MAJOR_KEYS
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !panel.current) return
      // keep keyboard focus inside the dialog
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    panel.current?.querySelector<HTMLButtonElement>('.key-chip.on')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.() // back to the Key button
    }
  }, [])

  const step = (s: number) => {
    const i = keys.findIndex(k => pitchClass(k) === pitchClass(current))
    onPick(keys[(i + s + 12) % 12])
  }

  const moved = delta !== 0
  const half = Math.abs(delta)
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Choose a key" ref={panel} onClick={e => e.stopPropagation()}>
        <div class="sheet-head">
          <h2>Key <span class="muted">조옮김</span></h2>
          <button class="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        <div class="key-grid" role="listbox" aria-label="Keys">
          {keys.map(k => {
            const isOrig = pitchClass(k) === pitchClass(original)
            const on = pitchClass(k) === pitchClass(current)
            return (
              <button
                key={k}
                role="option"
                aria-selected={on}
                class={`key-chip ${on ? 'on' : ''} ${isOrig ? 'orig' : ''}`}
                onClick={() => onPick(k)}
              >
                <span class="key-name"><KeyName tonic={k} minor={minor} /></span>
                {isOrig ? <span class="key-orig">Original</span> : null}
              </button>
            )
          })}
        </div>

        <div class="key-row">
          <div class="stepper" role="group" aria-label="Half steps">
            <button class="btn" onClick={() => step(-1)} aria-label="Down a half step"><IconMinus size={18} /></button>
            <span class="stepper-label">Half step</span>
            <button class="btn" onClick={() => step(1)} aria-label="Up a half step"><IconPlus size={18} /></button>
          </div>
          <button class="btn" disabled={!moved} onClick={() => onPick(original)}>Back to original</button>
        </div>

        {moved ? (
          <div class="key-row">
            <div class="segmented" role="group" aria-label="Octave">
              {(['down', 'auto', 'up'] as Direction[]).map(d => (
                <button key={d} class={dir === d ? 'on' : ''} aria-pressed={dir === d} onClick={() => onDir(d)}>
                  {d === 'down' ? 'Lower' : d === 'up' ? 'Higher' : 'Best fit'}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p class="key-summary">
          {moved
            ? <>From <KeyName tonic={original} minor={minor} /> {delta > 0 ? 'up' : 'down'} {half} half step{half === 1 ? '' : 's'} to <KeyName tonic={current} minor={minor} />.</>
            : <>Original key, <KeyName tonic={original} minor={minor} />.</>}
          {top != null ? <> Melody top note {midiName(top)}{moved ? <> → {midiName(top + delta)}</> : null}.</> : null}
        </p>
      </div>
    </div>
  )
}
