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

const ENGINE_VERSION = 'osmd-2.1.3-r11'
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

class Renderer {
  private osmd: OpenSheetMusicDisplay | null = null
  private host: HTMLDivElement
  private queue: Promise<unknown> = Promise.resolve()
  private font: string
  private format: string

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
      const doc = filterLyrics(req.xml, req.mode)
      await osmd.load(doc as unknown as string)
      osmd.Sheet.Transpose = req.delta
      osmd.zoom = req.zoom
      osmd.render()
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
