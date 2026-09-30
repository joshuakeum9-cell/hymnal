// OpenSheetMusicDisplay wrapper: lazy engine load, serialized renders, SVG cache.
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import { filterLyrics, type LyricMode } from './music'

type Engine = typeof import('opensheetmusicdisplay')

let enginePromise: Promise<Engine> | null = null
export function loadEngine(): Promise<Engine> {
  enginePromise ??= import('opensheetmusicdisplay')
  return enginePromise
}

export const SCREEN_FONT = 'Hymnal Sans'
export const PRINT_FONT = 'Hymnal Serif'

let fontsReady: Promise<unknown> | null = null
export function loadFonts(): Promise<unknown> {
  fontsReady ??= Promise.all([
    document.fonts.load(`16px "${SCREEN_FONT}"`, '가A'),
    document.fonts.load(`bold 16px "${SCREEN_FONT}"`, '가A'),
  ]).catch(() => undefined)
  return fontsReady
}

export type RenderRequest = {
  cacheKey: string
  xml: string
  mode: LyricMode
  chords?: boolean
  delta: number        // semitones
  width: number        // CSS px of the score column
  zoom: number
  pageFormat?: 'Endless' | 'Letter_P' | 'A4_P'
  font?: string
  noCache?: boolean
}

export type SystemBox = { top: number; bottom: number; measures: number }
/** systems are in the SVG's viewBox units; viewWidth is the viewBox width */
export type RenderResult = { svg: string; ms: number; cached: boolean; systems: SystemBox[]; viewWidth: number }

const ENGINE_VERSION = 'osmd-2.1.3-r30'
const memory = new Map<string, string>()
const MEMORY_MAX = 30
const IDB_MAX = 80
const IDB_INDEX = 'hymnal.svg.keys'

function remember(key: string, svg: string): void {
  memory.delete(key)
  memory.set(key, svg)
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string)
}

async function persist(key: string, svg: string): Promise<void> {
  try {
    const keys: string[] = (await idbGet(IDB_INDEX)) ?? []
    const next = [key, ...keys.filter(k => k !== key)]
    const drop = next.splice(IDB_MAX)
    await idbSet(key, svg)
    await idbSet(IDB_INDEX, next)
    await Promise.all(drop.map(k => idbDel(k)))
  } catch {
    /* IndexedDB unavailable (private mode): memory cache still works */
  }
}

export async function cachedSvg(key: string): Promise<string | null> {
  const full = `${ENGINE_VERSION}|${key}`
  const m = memory.get(full)
  if (m) return m
  try {
    const v = await idbGet(full)
    if (typeof v === 'string') {
      remember(full, v)
      return v
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * OSMD sizes a measure by what is written in it, so a measure holding one whole note is drawn
 * far narrower than a measure of four quarter notes and its word runs into the barline.
 * Give every measure at least MIN_SHARE of the width per beat that the typical measure gets.
 * Returns true when some measure was widened (the caller renders again).
 */
const MIN_SHARE = 0.8
function evenMeasures(osmd: OpenSheetMusicDisplay): boolean {
  type M = { minimumStaffEntriesWidth: number; parentSourceMeasure: { Duration: { RealValue: number }; WidthFactor?: number; ImplicitMeasure?: boolean } }
  const list = (osmd.GraphicSheet as unknown as { MeasureList: (M | undefined)[][] }).MeasureList
  const rows = list.map(ms => ms.find(Boolean)).filter((m): m is M => !!m && !m.parentSourceMeasure.ImplicitMeasure)
  const perBeat = rows
    .map(m => m.minimumStaffEntriesWidth / ((m.parentSourceMeasure.WidthFactor ?? 1) * m.parentSourceMeasure.Duration.RealValue))
    .filter(x => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b)
  if (perBeat.length < 3) return false
  const typical = perBeat[Math.floor(perBeat.length / 2)]
  let changed = false
  for (const m of rows) {
    const src = m.parentSourceMeasure
    const factor = src.WidthFactor ?? 1
    const base = m.minimumStaffEntriesWidth / factor
    const want = typical * MIN_SHARE * src.Duration.RealValue
    if (base > 0 && base < want * 0.97) {
      const next = want / base
      if (Math.abs(next - factor) > 0.02) {
        src.WidthFactor = next
        changed = true
      }
    }
  }
  return changed
}

/**
 * OSMD does not size a bar for its chord letters, and stacks letters that would overlap one
 * above the other, which reads as two chords on one beat. Widen a bar whose letters touch.
 * The letters' real widths come from the drawn SVG (OSMD's own estimate runs small).
 * Returns true when some bar was widened (the caller renders again).
 */
function chordRoom(osmd: OpenSheetMusicDisplay, host: Element): boolean {
  const unit = 10 // SVG viewBox units per OSMD unit
  type Label = { left: number; right: number; measure: any }
  const drawn = new Map<string, DOMRect[]>()
  for (const t of Array.from(host.querySelectorAll('svg text')) as SVGTextElement[]) {
    const key = t.textContent?.trim() ?? ''
    if (!key || key.length > 12) continue
    const b = t.getBBox()
    if (b.width > 0) (drawn.get(key) ?? drawn.set(key, []).get(key)!).push(b)
  }
  let changed = false
  for (const page of osmd.GraphicSheet.MusicPages) {
    for (const sys of page.MusicSystems) {
      const labels: Label[] = []
      for (const stack of sys.GraphicalMeasures as any[]) {
        const measure = stack[0]
        if (!measure) continue
        for (const entry of measure.staffEntries ?? []) {
          for (const c of entry.graphicalChordContainers ?? []) {
            const label = c.GraphicalLabel
            const ps = label?.PositionAndShape
            if (!ps) continue
            const x = ps.AbsolutePosition.x, y = ps.AbsolutePosition.y
            let left = x + ps.BorderLeft, right = x + ps.BorderRight
            // the nearest drawn text with the same words gives the real width
            let best: DOMRect | undefined, bestD = 6 * unit
            for (const b of drawn.get(String(label.Label?.text ?? '').trim()) ?? []) {
              const d = Math.hypot(b.x + b.width / 2 - (left + right) / 2 * unit, b.y + b.height - y * unit)
              if (d < bestD) { bestD = d; best = b }
            }
            if (best) { left = best.x / unit; right = (best.x + best.width) / unit }
            labels.push({ left, right, measure })
          }
        }
      }
      labels.sort((a, b) => a.left - b.left)
      const stretch = new Map<any, number>() // one factor per bar: the largest its pairs need
      for (let i = 1; i < labels.length; i++) {
        const a = labels[i - 1], b = labels[i]
        const overlap = a.right + 0.8 - b.left // OSMD units; 0.8 keeps a small gap
        if (overlap <= 0) continue
        const src = a.measure.parentSourceMeasure
        // the letters sit on notes, and note spacing grows with the bar: stretch by the share
        // of their distance that is missing
        const factor = 1 + overlap / Math.max(b.left - a.left, 1)
        stretch.set(src, Math.max(stretch.get(src) ?? 1, factor))
      }
      for (const [src, factor] of stretch) {
        src.WidthFactor = (src.WidthFactor ?? 1) * factor
        changed = true
        if (import.meta.env.DEV) console.debug(`[hymnal:chords] bar ${src.MeasureNumber} widened x${factor.toFixed(2)} (labels ${labels.length})`)
      }
    }
  }
  return changed
}

/** Minimum (unstretched) width of every bar, by its index in the score. */
function minWidths(osmd: OpenSheetMusicDisplay): Map<number, number> {
  const out = new Map<number, number>()
  for (const ms of (osmd.GraphicSheet as any).MeasureList as any[][]) {
    const m = ms.find(Boolean)
    if (m) out.set(m.parentSourceMeasure.measureListIndex, m.minimumStaffEntriesWidth)
  }
  return out
}

/** Drawn width of every bar, by its index in the score. */
function barWidths(osmd: OpenSheetMusicDisplay): Map<number, number> {
  const out = new Map<number, number>()
  for (const page of osmd.GraphicSheet.MusicPages) {
    for (const sys of page.MusicSystems) {
      for (const stack of sys.GraphicalMeasures as any[]) {
        const m = stack[0]
        if (m) out.set(m.parentSourceMeasure.measureListIndex, m.PositionAndShape.Size.width)
      }
    }
  }
  return out
}

/**
 * Widen bars so each line divides its width among its bars as the reference layout does.
 * Every bar keeps at least the width it has now. Returns true when a bar changed.
 */
function matchWidths(osmd: OpenSheetMusicDisplay, ref: Map<number, number>): boolean {
  let changed = false
  const systems = osmd.GraphicSheet.MusicPages.flatMap(page => page.MusicSystems)
  for (const sys of systems) {
    {
      const bars = (sys.GraphicalMeasures as any[]).map(stack => stack[0]).filter(Boolean)
      const ratio = bars.map(m => m.PositionAndShape.Size.width / (ref.get(m.parentSourceMeasure.measureListIndex) ?? m.PositionAndShape.Size.width))
      // every line is stretched to the page width, so only the proportions matter
      const k = Math.max(...ratio)
      bars.forEach((m, i) => {
        const f = k / ratio[i]
        if (!(f > 1.01)) return
        const src = m.parentSourceMeasure
        src.WidthFactor = (src.WidthFactor ?? 1) * f
        changed = true
      })
    }
  }
  return changed
}

/**
 * Line breaks that share the bars evenly between the lines, as a printed hymnal sets them, keeping
 * the number of lines. Returns the bar indices that start the second and later lines, or null when
 * the current breaks are already even enough (the last line holds at least three quarters of an
 * average line).
 */
function balancedBreaks(osmd: OpenSheetMusicDisplay): Set<number> | null {
  const lines = osmd.GraphicSheet.MusicPages.flatMap(page => page.MusicSystems)
    .map(sys => (sys.GraphicalMeasures as any[]).map(stack => stack[0]).filter(Boolean))
  if (lines.length < 2) return null
  const counts = lines.map(l => l.length)
  const last = counts[counts.length - 1]
  const avg = (counts.reduce((a, b) => a + b, 0) - last) / (counts.length - 1)
  if (last >= avg * 0.75) return null
  const bars = lines.flat()
  const w = bars.map(m => m.minimumStaffEntriesWidth as number)
  const sums = lines.map(l => l.reduce((a: number, m: any) => a + m.minimumStaffEntriesWidth, 0))
  const cap = Math.max(...sums) * 1.001 // never fuller than the fullest line the engine chose
  const n = bars.length, S = lines.length
  const mean = w.reduce((a, b) => a + b, 0) / S
  const pre = [0]; for (const x of w) pre.push(pre[pre.length - 1] + x)
  // best[k][j]: least squared deviation from the mean for the first j bars in k lines
  const best = Array.from({ length: S + 1 }, () => new Array(n + 1).fill(Infinity))
  const cut = Array.from({ length: S + 1 }, () => new Array(n + 1).fill(-1))
  best[0][0] = 0
  for (let k = 1; k <= S; k++) {
    for (let j = k; j <= n; j++) {
      for (let i = k - 1; i < j; i++) {
        const line = pre[j] - pre[i]
        if (line > cap || best[k - 1][i] === Infinity) continue
        const c = best[k - 1][i] + (line - mean) ** 2
        if (c < best[k][j]) { best[k][j] = c; cut[k][j] = i }
      }
    }
  }
  if (best[S][n] === Infinity) return null
  const starts = new Set<number>()
  for (let k = S, j = n; k > 1; k--) { j = cut[k][j]; starts.add(bars[j].parentSourceMeasure.measureListIndex) }
  const now = new Set(lines.slice(1).map(l => l[0].parentSourceMeasure.measureListIndex))
  if ([...starts].every(i => now.has(i))) return null
  return starts
}

/** Break the lines before these bars (and nowhere else the source file asked for). */
function setBreaks(doc: Document, starts: Set<number>): void {
  for (const pr of Array.from(doc.getElementsByTagName('print'))) pr.removeAttribute('new-system')
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    Array.from(part.getElementsByTagName('measure')).forEach((m, i) => {
      if (!starts.has(i)) return
      const br = doc.createElement('print')
      br.setAttribute('new-system', 'yes')
      m.insertBefore(br, m.firstChild)
    })
  }
}

const SPACING_STEPS = [
  { elongation: 1.8, spread: 1 }, // tighter than the OSMD default of 2.5: more bars per line
  { elongation: 2.5, spread: 1 }, // OSMD defaults
  { elongation: 4, spread: 1 },
  { elongation: 4, spread: 1.3 },
  { elongation: 6, spread: 1.7 },
]

/**
 * Push overlapping words on the same lyric line apart, half each way, until every pair has a
 * small gap. Hyphens take part so they stay between their syllables. Words move by a few units
 * at most in practice; a word never moves more than its own width (or one and a half letter
 * heights for a short syllable) from where OSMD put it. Returns how many pairs still touch.
 */
export function separateLyrics(host: Element): number {
  type Item = { el: SVGTextElement | null; x: number; w: number; h: number; x0: number; word: boolean; wall?: boolean }
  // barlines (the tall connector lines of each system) are walls a word may not straddle
  const walls = (Array.from(host.querySelectorAll('svg .vf-connector rect')) as SVGRectElement[])
    .map(r => r.getBBox()).filter(b => b.width < 4 && b.height > 20)
  const rows = new Map<number, Item[]>()
  let unresolved = 0
  for (const t of Array.from(host.querySelectorAll('svg text')) as SVGTextElement[]) {
    const s = t.textContent?.trim() ?? ''
    if (!s || !t.hasAttribute('x')) continue
    const b = t.getBBox()
    if (!b.width) continue
    const key = Math.round(b.y)
    const row = rows.get(key) ?? []
    row.push({ el: t, x: b.x, w: b.width, h: b.height, x0: b.x, word: s !== '-' })
    rows.set(key, row)
  }
  for (const [y, row] of rows) {
    if (!row.some(i => i.el?.closest('.lyrics, .dash') || i.el?.classList.contains('lyrics'))) {
      // chord symbols and other text: only keep them apart, no walls
    } else {
      const mid = y + row[0].h / 2
      for (const b of walls) {
        if (b.y <= mid && mid <= b.y + b.height) row.push({ el: null, x: b.x, w: b.width, h: 0, x0: b.x, word: false, wall: true })
      }
    }
    if (row.length < 2) continue
    // order by centre, so a word under the first note of a measure stays right of its barline
    row.sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2))
    // OSMD sometimes draws two hyphens on top of each other; they read as one, so keep one
    for (let i = row.length - 1; i > 0; i--) {
      const a = row[i - 1], b = row[i]
      if (!a.word && !b.word && !a.wall && !b.wall && b.x < a.x + a.w) {
        b.el?.remove()
        row.splice(i, 1)
      }
    }
    const words = row.filter(i => i.word)
    const gap = Math.max(3, (words[0]?.w ?? 20) * 0.08)
    for (let pass = 0; pass < 40; pass++) {
      let moved = false
      for (let i = 1; i < row.length; i++) {
        const a = row[i - 1], b = row[i]
        if (a.wall && b.wall) continue
        const need = a.x + a.w + (a.word && b.word ? gap : a.wall || b.wall ? gap / 2 : 1) - b.x
        if (need > 0.5) {
          if (a.wall) b.x += need
          else if (b.wall) a.x -= need
          else {
            a.x -= need / 2
            b.x += need / 2
          }
          moved = true
        }
      }
      if (!moved) break
    }
    for (const it of row) {
      if (!it.el) continue
      const limit = Math.max(it.w, it.h * 1.5)
      const dx = Math.max(-limit, Math.min(limit, it.x - it.x0))
      it.x = it.x0 + dx
      if (Math.abs(dx) > 0.2) it.el.setAttribute('x', String(Number(it.el.getAttribute('x')) + dx))
    }
    row.sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1], b = row[i]
      const matters = (a.word && (b.word || b.wall)) || (b.word && (a.word || a.wall))
      if (matters && b.x < a.x + a.w - 1) unresolved++
    }
  }
  return unresolved
}

/** Number of places where two words on the same lyric line overlap (hyphens and extenders ignored). */
export function lyricCollisions(host: Element): number {
  const rows = new Map<number, DOMRect[]>()
  for (const t of Array.from(host.querySelectorAll('svg text'))) {
    const s = t.textContent?.trim() ?? ''
    if (!s || s === '-') continue
    const b = (t as SVGTextElement).getBBox()
    if (!b.width) continue
    const key = Math.round(b.y)
    const row = rows.get(key) ?? []
    row.push(b)
    rows.set(key, row)
  }
  let hits = 0
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i++) {
      if (row[i].x < row[i - 1].x + row[i - 1].width - 1) hits++
    }
  }
  return hits
}

class Renderer {
  private osmd: OpenSheetMusicDisplay | null = null
  private host: HTMLDivElement
  private queue: Promise<unknown> = Promise.resolve()
  private font: string
  private format: string
  private spacing: { mult: number; add: number } | undefined

  constructor(font: string, format: string) {
    this.font = font
    this.format = format
    this.host = document.createElement('div')
    this.host.setAttribute('aria-hidden', 'true')
    this.host.className = 'render-host'
    document.body.appendChild(this.host)
  }

  private async engine(): Promise<OpenSheetMusicDisplay> {
    if (this.osmd) return this.osmd
    const m = await loadEngine()
    await loadFonts()
    if (this.font !== SCREEN_FONT) await document.fonts.load(`16px "${this.font}"`, '가A').catch(() => undefined)
    const osmd = new m.OpenSheetMusicDisplay(this.host, {
      backend: 'svg',
      autoResize: false,
      autoBeam: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMeasureNumbers: false,
      drawMetronomeMarks: false,
      drawFingerings: false,
      followCursor: false,
      pageFormat: this.format,
      pageBackgroundColor: undefined,
      defaultFontFamily: this.font,
    })
    osmd.TransposeCalculator = new m.TransposeCalculator()
    const r = osmd.EngravingRules
    r.PageLeftMargin = 1.5
    r.PageRightMargin = 1.5
    r.PageTopMargin = 1
    r.PageBottomMargin = 2
    r.SystemLeftMargin = 0
    r.LyricsHeight = 2.2
    r.LyricsYOffsetToStaffHeight = 1.0
    r.BetweenStaffDistance = 3
    r.MinimumDistanceBetweenSystems = 3.5
    r.RenderSingleHorizontalStaffline = false
    r.LyricOverlapAllowedIntoNextMeasure = 0
    r.HorizontalBetweenLyricsDistance = 0.8
    r.LyricsXPaddingFactorForLongLyrics = 1.6
    r.LyricsXPaddingWidthThreshold = 1.1
    r.LyricsAlignmentStandard = m.TextAlignmentEnum.CenterBottom
    r.VerticalBetweenLyricsDistance = 0.4
    // room between a barline and the first and last notes, so a word centred under them stays in its measure
    r.MeasureLeftMargin = 1.8
    r.MeasureRightMargin = 0.8
    r.MinSkyBottomDistBetweenSystems = 3
    // like a printed hymnal, the last line runs the full width too (the bars are shared out evenly
    // between the lines first, so it is never one bar stretched across the page)
    r.StretchLastSystemLine = true
    r.LastSystemMaxScalingFactor = 10
    if (this.font === PRINT_FONT) {
      // paper: smaller words and chord letters, as the printed hymnal sets them, so a
      // lyric-heavy hymn fits three or four measures to a line instead of two
      r.LyricsHeight = 1.8
      r.ChordSymbolTextHeight = 1.7
      r.VerticalBetweenLyricsDistance = 0.3
    }
    this.osmd = osmd
    if (import.meta.env.DEV) (window as any)[`__osmd_${this.format}`] = osmd
    return osmd
  }

  /** Load the score and draw it, widening only where words would otherwise collide. */
  private async draw(osmd: OpenSheetMusicDisplay, doc: Document, req: RenderRequest, steps = SPACING_STEPS): Promise<{ elongation: number; spread: number }> {
    await osmd.load(doc as unknown as string)
    osmd.Sheet.Transpose = req.delta
    // chord letters are spelled when the graphic sheet is built (at load, with no transposition),
    // so rebuild it once the transposition is set; the notes themselves transpose at draw time
    if (req.delta) osmd.updateGraphic()
    osmd.zoom = req.zoom
    // OSMD widens a measure for its words only up to MaximumLyricsElongationFactor times its
    // normal width, and only pads to the right of a long word, so on a phone words can run
    // into each other. Draw with the defaults first; where words collide, draw again with
    // wider measures and then wider note spacing.
    const rules = osmd.EngravingRules
    this.spacing ??= { mult: rules.VoiceSpacingMultiplierVexflow, add: rules.VoiceSpacingAddendVexflow }
    let used = steps[0]
    for (const step of steps) {
      used = step
      rules.MaximumLyricsElongationFactor = step.elongation
      rules.VoiceSpacingMultiplierVexflow = this.spacing.mult * step.spread
      rules.VoiceSpacingAddendVexflow = this.spacing.add * step.spread
      osmd.render()
      if (evenMeasures(osmd)) osmd.render()
      for (let pass = 0; pass < 3 && chordRoom(osmd, this.host); pass++) osmd.render()
      // OSMD only pads to the right of a long word, so words can still touch; nudge them apart
      // along their line, and only when nudging cannot separate them all (a cramped bar of
      // wide words) draw the score wider
      const unresolved = separateLyrics(this.host)
      if (import.meta.env.DEV) {
        const widths = (osmd.GraphicSheet as any).MeasureList.slice(0, 6).map((ms: any[]) => Math.round(ms.find(Boolean)?.minimumStaffEntriesWidth ?? 0))
        console.debug(`[hymnal:spacing] elong ${step.elongation} spread ${step.spread}: ${unresolved} words still touching; widths ${JSON.stringify(widths)}`)
      }
      if (unresolved === 0) break
    }
    return used
  }

  /** Draw, then share the bars evenly between the lines if the last line came out short. */
  private async drawBalanced(osmd: OpenSheetMusicDisplay, doc: Document, req: RenderRequest): Promise<{ elongation: number; spread: number }> {
    osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = false
    let step = await this.draw(osmd, doc, req)
    const starts = balancedBreaks(osmd)
    if (starts) {
      setBreaks(doc, starts)
      osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = true
      step = await this.draw(osmd, doc, req)
    }
    return step
  }

  render(req: RenderRequest): Promise<RenderResult> {
    const run = async (): Promise<RenderResult> => {
      const full = `${ENGINE_VERSION}|${req.cacheKey}`
      const hit = req.noCache ? undefined : memory.get(full)
      if (hit) return { svg: hit, ms: 0, cached: true, systems: [], viewWidth: 0 }
      const t0 = performance.now()
      const osmd = await this.engine()
      this.host.style.width = `${Math.max(280, Math.round(req.width))}px`
      const doc = filterLyrics(req.xml, req.mode, req.chords ?? true)
      const rules = osmd.EngravingRules
      rules.NewSystemAtXMLNewSystemAttribute = false
      let layout: Map<number, number> | null = null
      let bothStep: { elongation: number; spread: number } | null = null
      let bothMin: Map<number, number> | null = null
      if (req.mode !== 'both') {
        // Korean-only and English-only keep the bars exactly where 한/영 puts them, so switching
        // the words never reflows or restretches the music: lay out 한/영 first, then break the
        // lines at the same bars
        bothStep = await this.drawBalanced(osmd, filterLyrics(req.xml, 'both', req.chords ?? true), req)
        const starts = new Set<number>()
        const bothWidths = barWidths(osmd)
        bothMin = minWidths(osmd)
        for (const page of osmd.GraphicSheet.MusicPages) {
          page.MusicSystems.forEach((sys, i) => {
            const first = (sys.GraphicalMeasures as any[])[0]?.[0]
            if (i > 0 && first) starts.add(first.parentSourceMeasure.measureListIndex)
          })
        }
        layout = bothWidths
        setBreaks(doc, starts)
        rules.NewSystemAtXMLNewSystemAttribute = true
      }
      let matched = false
      if (layout && bothStep) {
        // English words alone would make the engine widen bars that 한/영 fits by nudging words
        // apart, so every bar takes its width from 한/영. First keep this mode's own note spacing
        // and scale each bar to its 한/영 width; if words still touch, space the notes evenly
        // inside the same bars; only if that fails too does this mode get its own layout.
        for (const scaled of [true, false]) {
          await this.draw(osmd, doc, req, [scaled ? bothStep : { elongation: 1, spread: bothStep.spread }])
          if (scaled && bothMin) {
            for (const ms of (osmd.GraphicSheet as any).MeasureList as any[][]) {
              const m = ms.find(Boolean)
              const want = m && bothMin.get(m.parentSourceMeasure.measureListIndex)
              if (!m || !want || !(m.minimumStaffEntriesWidth > 0)) continue
              m.parentSourceMeasure.WidthFactor = (m.parentSourceMeasure.WidthFactor ?? 1) * want / m.minimumStaffEntriesWidth
            }
            osmd.render()
          }
          for (let pass = 0; pass < 3 && matchWidths(osmd, layout); pass++) osmd.render()
          if (separateLyrics(this.host) === 0) { matched = true; break }
        }
      }
      if (!matched) await this.drawBalanced(osmd, filterLyrics(req.xml, req.mode, req.chords ?? true), req)
      const svg = this.host.innerHTML
      const ms = Math.round(performance.now() - t0)
      const unit = 10 // OSMD draws 10 viewBox units per internal unit; zoom only changes the SVG's CSS size
      const systems: SystemBox[] = []
      for (const page of osmd.GraphicSheet.MusicPages) {
        for (const sys of page.MusicSystems) {
          const ps = sys.PositionAndShape
          const y = ps.AbsolutePosition.y
          systems.push({ top: (y + ps.BorderMarginTop) * unit, bottom: (y + ps.BorderMarginBottom) * unit, measures: sys.GraphicalMeasures.length })
        }
      }
      const svgEl = this.host.querySelector('svg')
      const vb = svgEl?.getAttribute('viewBox')?.split(/[ ,]+/).map(Number)
      const viewWidth = vb && vb.length === 4 ? vb[2] : Number(svgEl?.getAttribute('width') ?? 0) / req.zoom
      if (!req.noCache) {
        remember(full, svg)
        void persist(full, svg)
      }
      return { svg, ms, cached: false, systems, viewWidth }
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }
}

let screen: Renderer | null = null
let print: Renderer | null = null

export function screenRenderer(): Renderer {
  screen ??= new Renderer(SCREEN_FONT, 'Endless')
  return screen
}

/** Print renders one continuous score; print.ts cuts it into pages between systems. */
export function printRenderer(): Renderer {
  print ??= new Renderer(PRINT_FONT, 'Endless')
  return print
}
