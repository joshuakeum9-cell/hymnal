import { useEffect, useState } from 'preact/hooks'
import { hymnUrl, loadIndex, type Row } from '../data'
import { go } from '../route'
import { IconBack } from '../icons'

const REPO = 'https://github.com/joshuakeum9-cell/hymnal'

export function AboutView() {
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => { loadIndex().then(setRows) }, [])
  const published = rows.filter(r => r.f)
  const gatedKo = rows.filter(r => r.g === 1).length
  const gatedOther = rows.filter(r => r.g === 2).length

  const downloadAll = async () => {
    if (!('caches' in window)) {
      setNote('This browser cannot save hymns for offline use.')
      return
    }
    const list = published
    setProgress({ done: 0, total: list.length })
    setNote('')
    let done = 0
    let failed = 0
    const cache = await caches.open('hymns') // the same cache the service worker reads from
    const queue = [...list]
    const worker = async () => {
      while (queue.length) {
        const r = queue.shift()!
        try {
          const url = new URL(hymnUrl(r), location.href).href
          if (!(await cache.match(url))) {
            const res = await fetch(url, { cache: 'no-cache' })
            if (!res.ok) throw new Error(String(res.status))
            await cache.put(url, res)
          }
        } catch {
          failed++
        }
        done++
        setProgress({ done, total: list.length })
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    try { await navigator.storage?.persist?.() } catch { /* optional */ }
    setNote(failed
      ? `${list.length - failed} saved, ${failed} could not be downloaded. Check the connection and tap again.`
      : 'All hymns are saved on this device.')
    if (failed) setProgress(null)
  }

  return (
    <main class="about-page">
      <header class="hymn-head">
        <button class="icon-btn back" onClick={() => go('#/')} aria-label="Back to search"><IconBack /></button>
        <div class="hymn-title"><span class="hymn-names"><span class="hymn-ko">About</span><span class="hymn-en">사용 안내와 출처</span></span></div>
        <span />
      </header>

      <article class="prose">
        <h2>How to use it</h2>
        <ul>
          <li><strong>Find a hymn.</strong> Type its number. Three-digit numbers open by themselves. Switch to 통일 to type an old hymnal number, or to 제목 to search titles, including initial consonants like ㅈㅇㅊㅈ.</li>
          <li><strong>Change the key.</strong> Tap Key and pick any of the 12 keys. Best fit keeps the melody in a comfortable range; Lower and Higher let you choose the octave.</li>
          <li><strong>Choose the words.</strong> 한/영 shows each Korean line with its English line under it, like the bilingual hymnal. 한 is Korean only, 영 is English only.</li>
          <li><strong>Print for the band.</strong> Print on a hymn prints that hymn in the key you chose. The set list prints the whole week in order.</li>
          <li><strong>On an iPad or phone.</strong> In Safari tap Share, then Add to Home Screen. The app then opens full screen and keeps the music you have viewed for offline use. On an iPhone or iPad the Home Screen app keeps its own storage, so save hymns for offline use from inside that app.</li>
        </ul>

        <h2>Use it offline</h2>
        <p>Save every available hymn on this device so the site works in the sanctuary without Wi-Fi. It downloads about 2 MB and takes about 40 MB of space.</p>
        <button class="btn primary" onClick={downloadAll} disabled={!published.length || (progress != null && progress.done < progress.total)}>
          {progress == null ? `Save all ${published.length || ''} hymns` : progress.done < progress.total ? `Saving ${progress.done} of ${progress.total}…` : 'All hymns saved'}
        </button>
        {note ? <p class="muted small">{note}</p> : null}

        <h2>Which hymnal</h2>
        <p>Numbers follow the 새찬송가 (21세기 찬송가, 한국찬송가공회, 2006), 645 hymns, the numbering used in the Korean-English bilingual hymnals and Bibles. Every hymn also carries its 통일찬송가 (1983) number, so 찬양하라 복되신 구세주 예수 is 31 here and 46 in the old book.</p>

        <h2>What is on the site</h2>
        <p>{published.length} hymns have music. {gatedKo} hymns by Korean authors and {gatedOther} more recent hymns are listed but have no music yet, because their words or music may still be under copyright. They will be added if the rights holders give permission.</p>
        <p>The notes and Korean words come from the MuseScore transcriptions by 깔끔이 CCM (<a href="https://ccm4u.tistory.com/" target="_blank" rel="noopener">ccm4u.tistory.com</a>), shared under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. We converted them to MusicXML and fixed a few known typos. English words are the original public-domain hymn texts, lined up with the notes by a script and checked by hand over time, so a syllable may occasionally sit on the wrong note. Titles and old numbers come from the hymnEngKorean project, keys from praisenworship.biblia66.com, credits from bibletoppt.com.</p>

        <h2>Copyright and takedown</h2>
        <p>This is a free tool for one church's band, not a publication. Most tunes and English texts are in the public domain. The Korean translations belong to their rights holders; if you hold rights to anything here and want it removed, open an issue at <a href={`${REPO}/issues`} target="_blank" rel="noopener">github.com/joshuakeum9-cell/hymnal</a> and it will be taken down promptly.</p>

        <h2>Found a mistake?</h2>
        <p>Every hymn page has a "Report a mistake" link at the bottom. Say which verse and which word, and it will be fixed.</p>
      </article>
    </main>
  )
}
