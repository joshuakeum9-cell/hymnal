import { useEffect, useState } from 'preact/hooks'
import { hymnUrl, loadIndex, type Row } from '../data'
import { go } from '../route'
import { IconBack } from '../icons'
import { F, useT } from '../i18n'

const REPO = 'https://github.com/joshuakeum9-cell/hymnal'

export function AboutView() {
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState('')
  const { t, lang } = useT()

  useEffect(() => { loadIndex().then(setRows) }, [])
  const published = rows.filter(r => r.f)
  const gatedKo = rows.filter(r => r.g === 1).length
  const gatedOther = rows.filter(r => r.g === 2).length

  const downloadAll = async () => {
    if (!('caches' in window)) {
      setNote(t('offline.unsupported'))
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
    setNote(failed ? F.savedSome(lang, list.length - failed, failed) : t('offline.saved'))
    if (failed) setProgress(null)
  }

  const saveButton = (
    <button class="btn primary" onClick={downloadAll} disabled={!published.length || (progress != null && progress.done < progress.total)}>
      {progress == null ? F.saveAll(lang, published.length || '') : progress.done < progress.total ? F.saving(lang, progress.done, progress.total) : t('offline.done')}
    </button>
  )
  const ccm = <a href="https://ccm4u.tistory.com/" target="_blank" rel="noopener">ccm4u.tistory.com</a>
  const cc = <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>
  const issues = <a href={`${REPO}/issues`} target="_blank" rel="noopener">github.com/joshuakeum9-cell/hymnal</a>

  return (
    <main class="about-page">
      <header class="hymn-head">
        <button class="icon-btn back" onClick={() => go('#/')} aria-label={t('back')}><IconBack /></button>
        <div class="hymn-title"><span class="hymn-names"><span class="hymn-ko">{t('about')}</span></span></div>
        <span />
      </header>

      {lang === 'ko' ? (
        <article class="prose" lang="ko">
          <h2>사용법</h2>
          <ul>
            <li><strong>찬송 찾기.</strong> 장 번호를 입력합니다. 세 자리 번호는 바로 열립니다. 통일 번호로 바꾸면 옛 찬송가 번호로, 제목으로 바꾸면 제목이나 첫 줄로 찾을 수 있고 ㅈㅇㅊㅈ처럼 초성만 넣어도 됩니다.</li>
            <li><strong>키 바꾸기.</strong> 키를 누르고 12개 조 가운데 고릅니다. 알맞게는 멜로디를 부르기 편한 음역에 두고, 낮게와 높게로 옥타브를 정할 수 있습니다.</li>
            <li><strong>가사 고르기.</strong> 한/영은 한글 절을 모두 보인 다음 영어 절을 보입니다. 한영 찬송가 책과 같은 배치입니다. 한은 한글만, 영은 영어만 보입니다.</li>
            <li><strong>코드.</strong> 악보 위의 코드는 사성부 화음에서 읽어 낸 것이며, 키를 바꾸면 함께 바뀝니다. 코드 단추로 숨길 수 있습니다.</li>
            <li><strong>인쇄.</strong> 찬송 화면의 인쇄는 고른 키로 그 찬송을 인쇄합니다. 콘티에서는 한 주 찬송을 순서대로 한 번에 인쇄합니다.</li>
            <li><strong>아이패드와 휴대폰.</strong> 사파리에서 공유를 누르고 홈 화면에 추가를 고르세요. 그러면 전체 화면으로 열리고, 본 악보는 오프라인에서도 열립니다. 아이폰과 아이패드에서는 홈 화면 앱이 저장 공간을 따로 쓰므로, 오프라인 저장은 그 앱 안에서 하세요.</li>
          </ul>

          <h2>오프라인 사용</h2>
          <p>모든 찬송을 이 기기에 저장해 두면 와이파이가 없는 예배당에서도 씁니다. 내려받는 양은 약 2 MB, 차지하는 공간은 약 40 MB입니다.</p>
          {saveButton}
          {note ? <p class="muted small">{note}</p> : null}

          <h2>어느 찬송가인가</h2>
          <p>번호는 새찬송가(21세기 찬송가, 한국찬송가공회, 2006) 645장을 따릅니다. 한영 찬송가와 성경 찬송가 합본이 쓰는 번호입니다. 모든 찬송에 통일찬송가(1983) 번호도 함께 있어서, 찬양하라 복되신 구세주 예수는 여기서 31장, 옛 책에서는 46장입니다.</p>

          <h2>실린 것</h2>
          <p>{published.length}곡에 악보가 있습니다. 한국인이 지은 {gatedKo}곡과 비교적 최근 찬송 {gatedOther}곡은 가사나 곡의 저작권이 남아 있을 수 있어 목록에만 있고 악보는 아직 없습니다. 저작권자의 허락을 받으면 추가합니다.</p>
          <p>음표와 한글 가사는 깔끔이 CCM({ccm})의 뮤즈스코어 사보를 {cc} 조건으로 가져와 MusicXML로 바꾸고 알려진 오타 몇 곳을 고친 것입니다. 영어 가사는 저작권이 만료된 원문으로, 한영 찬송가에 실린 표기를 따르며, 음표에 맞추는 일은 프로그램이 한 뒤 손으로 고쳐 가고 있어 가끔 음절이 다른 음표에 놓일 수 있습니다. 제목과 통일 번호는 hymnEngKorean, 조는 praisenworship.biblia66.com, 작사 작곡 정보는 bibletoppt.com에서 가져왔습니다.</p>

          <h2>저작권과 삭제 요청</h2>
          <p>한 교회 찬양팀을 위한 무료 도구이며 출판물이 아닙니다. 곡과 영어 가사는 대부분 저작권이 만료되었습니다. 한글 번역 가사의 권리는 권리자에게 있습니다. 여기 실린 것의 권리자로서 삭제를 원하시면 {issues}에 이슈를 남겨 주세요. 바로 내리겠습니다.</p>

          <h2>오류를 찾으셨나요?</h2>
          <p>모든 찬송 화면 아래에 "이 찬송의 오류 알리기" 링크가 있습니다. 몇 절 어느 낱말인지 적어 주시면 고치겠습니다.</p>
        </article>
      ) : (
        <article class="prose" lang="en">
          <h2>How to use it</h2>
          <ul>
            <li><strong>Find a hymn.</strong> Type its number. Three-digit numbers open by themselves. Switch to Old number to type a number from the older hymnal, or to Title to search titles and first lines, including Korean initial consonants like ㅈㅇㅊㅈ.</li>
            <li><strong>Change the key.</strong> Tap Key and pick any of the 12 keys. Best fit keeps the melody in a comfortable range; Lower and Higher let you choose the octave.</li>
            <li><strong>Choose the words.</strong> KO/EN shows all the Korean verses, then all the English verses, like the printed Korean-English hymnal. KO is Korean only, EN is English only.</li>
            <li><strong>Chords.</strong> The letters above the music are read from the four-part harmony and change with the key. The Chords button hides them.</li>
            <li><strong>Print for the band.</strong> Print on a hymn prints that hymn in the key you chose. The set list prints the whole week in order.</li>
            <li><strong>On an iPad or phone.</strong> In Safari tap Share, then Add to Home Screen. The app then opens full screen and keeps the music you have viewed for offline use. On an iPhone or iPad the Home Screen app keeps its own storage, so save hymns for offline use from inside that app.</li>
          </ul>

          <h2>Use it offline</h2>
          <p>Save every available hymn on this device so the site works in the sanctuary without Wi-Fi. It downloads about 2 MB and takes about 40 MB of space.</p>
          {saveButton}
          {note ? <p class="muted small">{note}</p> : null}

          <h2>Which hymnal</h2>
          <p>Numbers follow the 새찬송가 (21세기 찬송가, 한국찬송가공회, 2006), 645 hymns, the numbering used in the Korean-English bilingual hymnals and Bibles. Every hymn also carries its 통일찬송가 (1983) number, so Praise Him, Praise Him is 31 here and 46 in the old book.</p>

          <h2>What is on the site</h2>
          <p>{published.length} hymns have music. {gatedKo} hymns by Korean authors and {gatedOther} more recent hymns are listed but have no music yet, because their words or music may still be under copyright. They will be added if the rights holders give permission.</p>
          <p>The notes and Korean words come from the MuseScore transcriptions by 깔끔이 CCM ({ccm}), shared under {cc}. We converted them to MusicXML and fixed a few known typos. The English words are the original public-domain texts as the Korean-English hymnal prints them, lined up with the notes by a script and checked by hand over time, so a syllable may occasionally sit on the wrong note. Titles and old numbers come from the hymnEngKorean project, keys from praisenworship.biblia66.com, credits from bibletoppt.com.</p>

          <h2>Copyright and takedown</h2>
          <p>This is a free tool for one church's band, not a publication. Most tunes and English texts are in the public domain. The Korean translations belong to their rights holders; if you hold rights to anything here and want it removed, open an issue at {issues} and it will be taken down promptly.</p>

          <h2>Found a mistake?</h2>
          <p>Every hymn page has a "Report a mistake" link at the bottom. Say which verse and which word, and it will be fixed.</p>
        </article>
      )}
    </main>
  )
}
