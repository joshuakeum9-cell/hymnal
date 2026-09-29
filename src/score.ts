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

export type SystemBox = { top: number; bottom: number }
/** systems are in the SVG's viewBox units; viewWidth is the viewBox width */
export type RenderResult = { svg: string; ms: number; cached: boolean; systems: SystemBox[]; viewWidth: number }

const ENGINE_VERSION = 'osmd-2.1.3-r22'
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

const SPACING_STEPS = [
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
    this.osmd = osmd
    if (import.meta.env.DEV) (window as any)[`__osmd_${this.format}`] = osmd
    return osmd
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
      for (const step of SPACING_STEPS) {
        rules.MaximumLyricsElongationFactor = step.elongation
        rules.VoiceSpacingMultiplierVexflow = this.spacing.mult * step.spread
        rules.VoiceSpacingAddendVexflow = this.spacing.add * step.spread
        osmd.render()
        if (evenMeasures(osmd)) osmd.render()
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
      const svg = this.host.innerHTML
      const ms = Math.round(performance.now() - t0)
      const unit = 10 // OSMD draws 10 viewBox units per internal unit; zoom only changes the SVG's CSS size
      const systems: SystemBox[] = []
      for (const page of osmd.GraphicSheet.MusicPages) {
        for (const sys of page.MusicSystems) {
          const ps = sys.PositionAndShape
          const y = ps.AbsolutePosition.y
          systems.push({ top: (y + ps.BorderMarginTop) * unit, bottom: (y + ps.BorderMarginBottom) * unit })
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
