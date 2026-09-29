// Printing: render each hymn with the serif print font, then cut the tall score into
// Letter or A4 pages between systems, so no line of music is split across pages.
import type { Hymn, Row } from './data'
import type { LyricMode } from './music'
import { printRenderer, type SystemBox } from './score'
import { F, creditText, currentLang, t } from './i18n'

export type PrintItem = { row: Row; hymn: Hymn; delta: number; mode: LyricMode; keyName: string; origName: string; chords?: boolean }

const PAPER = {
  // printable area at 96 CSS px per inch with 0.5 inch margins
  letter: { w: 720, h: 960, css: 'letter' },
  a4: { w: 698, h: 1026, css: 'A4' },
}
const HEADER_H = 78
const FOOTER_H = 34 // room for a two-line credit on the last page
const PRINT_ZOOM = 0.57

function root(): HTMLElement {
  let el = document.getElementById('print-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'print-root'
    document.body.appendChild(el)
  }
  return el
}

function pageStyle(paper: 'letter' | 'a4'): void {
  let st = document.getElementById('print-page-style') as HTMLStyleElement | null
  if (!st) {
    st = document.createElement('style')
    st.id = 'print-page-style'
    document.head.appendChild(st)
  }
  st.textContent = `@page { size: ${PAPER[paper].css} portrait; margin: 0.5in; }`
}

/** Group systems into pages; cuts fall halfway between systems so markings between them stay whole. */
function paginate(systems: SystemBox[], firstAvail: number, avail: number, total: number): [number, number][] {
  if (!systems.length) return [[0, total]]
  const cutAfter = (i: number): number =>
    i + 1 < systems.length ? Math.max(systems[i].bottom, (systems[i].bottom + systems[i + 1].top) / 2) : Math.min(total, systems[i].bottom + 12)
  const pages: [number, number][] = []
  let start = 0
  let cap = firstAvail
  let i = 0
  while (i < systems.length) {
    let end = i
    while (end + 1 < systems.length && cutAfter(end + 1) - start <= cap) end++
    const stop = cutAfter(end)
    pages.push([start, stop])
    start = stop
    cap = avail
    i = end + 1
  }
  return pages
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export async function printHymns(items: PrintItem[], paper: 'letter' | 'a4'): Promise<'printed' | 'tap'> {
  const box = root()
  box.innerHTML = ''
  pageStyle(paper)
  const P = PAPER[paper]
  const renderer = printRenderer()
  for (const it of items) {
    const draw = async (zoom: number) => {
      const res = await renderer.render({
        cacheKey: `print|${it.row.n}|${it.row.f}|${it.delta}|${it.mode}|${it.chords !== false}|${paper}|${zoom}`,
        xml: it.hymn.xml, mode: it.mode, chords: it.chords !== false, delta: it.delta, width: P.w, zoom, noCache: true,
      })
      const tpl = document.createElement('template')
      tpl.innerHTML = res.svg
      const svg = tpl.content.querySelector('svg')
      if (!svg) return null
      const vbW = res.viewWidth || P.w
      const scale = P.w / vbW // CSS px per viewBox unit
      const vb = svg.getAttribute('viewBox')?.split(/[ ,]+/).map(Number)
      const totalH = vb && vb.length === 4 ? vb[3] : (res.systems.at(-1)?.bottom ?? 0) + 20
      const firstAvail = (P.h - HEADER_H - FOOTER_H) / scale
      const pages = paginate(res.systems, firstAvail, (P.h - FOOTER_H) / scale, totalH)
      return { svg, vbW, scale, totalH, pages, over: totalH / firstAvail, zoom, systems: res.systems }
    }
    let d = await draw(PRINT_ZOOM)
    if (!d) continue
    // a hymn that just spills onto a second page is drawn a little smaller so it fits one
    // sheet (more measures per line, as the printed hymnal does); a long hymn keeps its size
    if ((d.pages.length > 1 && d.over <= 1.35) || d.pages.length >= 3) {
      const smaller = await draw(PRINT_ZOOM * 0.88)
      if (smaller && smaller.pages.length < d.pages.length) d = smaller
    }
    // a last line holding a single measure looks like a mistake; a little smaller usually lets
    // it join the line above without adding a page
    const alone = (x: NonNullable<typeof d>) => x.systems.length >= 2 && x.systems[x.systems.length - 1].measures === 1
    if (alone(d)) {
      for (const f of [0.94, 0.88]) {
        const s = await draw(d.zoom * f)
        if (s && !alone(s) && s.pages.length <= d.pages.length) { d = s; break }
      }
    }
    if (import.meta.env.DEV) console.debug(`[hymnal:print] ${it.row.n} zoom ${d.zoom.toFixed(3)} pages ${d.pages.length} systems ${d.systems.map(x => x.measures).join('+')}`)
    const { svg, vbW, scale, pages } = d
    const lang = currentLang()
    const keyText = F.printKey(lang, it.keyName, it.delta ? it.origName : null)
    const modeText = it.mode === 'both' ? '' : it.mode === 'ko' ? t('print.words.ko', lang) : t('print.words.en', lang)
    pages.forEach(([y0, y1], p) => {
      const page = document.createElement('section')
      page.className = 'print-page'
      page.style.width = `${P.w}px` // paper width, so a narrow phone screen cannot squeeze the header
      if (p === 0) {
        page.innerHTML = `<header class="print-head">
          <div class="print-num">${it.row.n}</div>
          <div class="print-titles"><div class="print-ko">${esc(it.row.k)}</div>${it.row.e ? `<div class="print-en">${esc(it.row.e)}</div>` : ''}</div>
          <div class="print-key">${esc(keyText + modeText)}${it.row.o ? `<br>${esc(F.printOld(lang, it.row.o))}` : ''}</div>
        </header>`
      }
      const clone = svg.cloneNode(true) as SVGSVGElement
      const h = y1 - y0
      clone.setAttribute('viewBox', `0 ${y0} ${vbW} ${h}`)
      clone.setAttribute('width', String(P.w))
      clone.setAttribute('height', String(h * scale))
      clone.removeAttribute('id')
      // a single line of music taller than the page is shrunk to fit rather than cut off
      const room = P.h - FOOTER_H - (p === 0 ? HEADER_H : 0)
      const fit = Math.min(1, room / (h * scale))
      clone.style.cssText = `width:${P.w * fit}px;height:${h * scale * fit}px;display:block;margin:0 auto`
      page.appendChild(clone)
      const foot = document.createElement('footer')
      foot.className = 'print-foot'
      foot.textContent = pages.length > 1 ? `${it.row.n} ${it.row.k}, ${F.printPage(lang, p + 1, pages.length)}` : `${it.row.n} ${it.row.k}`
      if (p === pages.length - 1) {
        foot.textContent += `. ${creditText(it.hymn.cr ?? '', lang)} ${t('print.engraving', lang)}`
      }
      page.appendChild(foot)
      box.appendChild(page)
    })
    if (it.hymn.enMode === 2 && it.mode !== 'ko' && it.hymn.en.length) {
      const page = document.createElement('section')
      page.className = 'print-page print-text'
      page.style.width = `${P.w}px`
      page.innerHTML = `<h2>${it.row.n} ${esc(it.row.e || it.row.k)}, ${t('en.words', lang)}</h2>` +
        it.hymn.en.map((v, i) => `<p><b>${i + 1}.</b> ${esc(v).replace(/\n/g, '<br>')}</p>`).join('')
      box.appendChild(page)
    }
  }
  await document.fonts.ready
  // The pages stay in the hidden print area until the next print, which clears them first.
  // iPhone and iPad Safari may refuse a print that does not come straight from a tap, so there
  // the caller shows a Print button that calls printNow().
  if (needsTapToPrint()) return 'tap'
  window.print()
  return 'printed'
}

export function needsTapToPrint(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

export function printNow(): void {
  window.print()
}
