// Printing: render each hymn with the serif print font, then cut the tall score into
// Letter or A4 pages between systems, so no line of music is split across pages.
import type { Hymn, Row } from './data'
import type { LyricMode } from './music'
import { printRenderer, type SystemBox } from './score'

export type PrintItem = { row: Row; hymn: Hymn; delta: number; mode: LyricMode; keyName: string; origName: string }

const PAPER = {
  // printable area at 96 CSS px per inch with 0.5 inch margins
  letter: { w: 720, h: 960, css: 'letter' },
  a4: { w: 698, h: 1026, css: 'A4' },
}
const HEADER_H = 78
const FOOTER_H = 22
const PRINT_ZOOM = 0.6

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

function paginate(systems: SystemBox[], firstAvail: number, avail: number): [number, number][] {
  const pages: [number, number][] = []
  let start = 0
  let cap = firstAvail
  let i = 0
  const gap = 8
  while (i < systems.length) {
    const top = Math.max(0, systems[i].top - gap)
    let end = i
    while (end + 1 < systems.length && systems[end + 1].bottom + gap - top <= cap) end++
    const bottom = systems[end].bottom + gap
    pages.push([i === 0 ? Math.min(start, top) : top, bottom])
    i = end + 1
    start = bottom
    cap = avail
  }
  return pages
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export async function printHymns(items: PrintItem[], paper: 'letter' | 'a4'): Promise<void> {
  const box = root()
  box.innerHTML = ''
  pageStyle(paper)
  const P = PAPER[paper]
  const renderer = printRenderer()
  for (const it of items) {
    const res = await renderer.render({
      cacheKey: `print|${it.row.n}|${it.row.f}|${it.delta}|${it.mode}|${paper}`,
      xml: it.hymn.xml, mode: it.mode, delta: it.delta, width: P.w, zoom: PRINT_ZOOM, noCache: true,
    })
    const tpl = document.createElement('template')
    tpl.innerHTML = res.svg
    const svg = tpl.content.querySelector('svg')
    if (!svg) continue
    const vbW = res.viewWidth || P.w
    const scale = P.w / vbW // CSS px per viewBox unit
    const pages = paginate(res.systems, (P.h - HEADER_H - FOOTER_H) / scale, (P.h - FOOTER_H) / scale)
    const keyText = it.delta ? `Key ${it.keyName} (from ${it.origName})` : `Key ${it.keyName}`
    const modeText = it.mode === 'both' ? '' : it.mode === 'ko' ? ', Korean words' : ', English words'
    pages.forEach(([y0, y1], p) => {
      const page = document.createElement('section')
      page.className = 'print-page'
      if (p === 0) {
        page.innerHTML = `<header class="print-head">
          <div class="print-num">${it.row.n}</div>
          <div class="print-titles"><div class="print-ko">${esc(it.row.k)}</div>${it.row.e ? `<div class="print-en">${esc(it.row.e)}</div>` : ''}</div>
          <div class="print-key">${esc(keyText + modeText)}${it.row.o ? `<br>통일 ${it.row.o}장` : ''}</div>
        </header>`
      }
      const clone = svg.cloneNode(true) as SVGSVGElement
      const h = y1 - y0
      clone.setAttribute('viewBox', `0 ${y0} ${vbW} ${h}`)
      clone.setAttribute('width', String(P.w))
      clone.setAttribute('height', String(h * scale))
      clone.removeAttribute('id')
      clone.style.cssText = `width:${P.w}px;height:${h * scale}px;display:block`
      page.appendChild(clone)
      const foot = document.createElement('footer')
      foot.className = 'print-foot'
      foot.textContent = pages.length > 1 ? `${it.row.n} ${it.row.k}, page ${p + 1} of ${pages.length}` : `${it.row.n} ${it.row.k}`
      if (p === pages.length - 1) {
        foot.textContent += `. ${it.hymn.cr ?? ''} Engraving: 깔끔이 CCM, CC BY 4.0.`
      }
      page.appendChild(foot)
      box.appendChild(page)
    })
    if (it.hymn.enMode === 2 && it.mode !== 'ko' && it.hymn.en.length) {
      const page = document.createElement('section')
      page.className = 'print-page print-text'
      page.innerHTML = `<h2>${it.row.n} ${esc(it.row.e || it.row.k)}, English words</h2>` +
        it.hymn.en.map((v, i) => `<p><b>${i + 1}.</b> ${esc(v).replace(/\n/g, '<br>')}</p>`).join('')
      box.appendChild(page)
    }
  }
  await document.fonts.ready
  const cleanup = () => {
    box.innerHTML = ''
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
