// Interface language. The sheet music itself keeps its own 한/영 choice; this is only the
// words around it: buttons, hints, headings, print labels.
import { useEffect, useState } from 'preact/hooks'
import { getPrefs, setPrefs, subscribe } from './store'

export type Lang = 'ko' | 'en'

const STR = {
  // home
  'home.title': { ko: '새찬송가', en: 'Band Hymnal' },
  'home.subtitle': { ko: '찬양팀 악보', en: 'Korean-English Hymnal' },
  'lang.other': { ko: 'English', en: '한국어' },
  'lang.switch': { ko: '화면을 영어로 보기', en: 'Show the app in Korean' },
  'setlist': { ko: '콘티', en: 'Set list' },
  'search.label.number': { ko: '장 번호', en: 'Hymn number' },
  'search.label.title': { ko: '제목이나 첫 줄로 검색', en: 'Search by title or first line' },
  'search.hint.number': { ko: '장 번호', en: 'Hymn number' },
  'search.hint.old': { ko: '통일찬송가 번호', en: 'Old hymnal number' },
  'search.hint.title': { ko: '제목 또는 가사 첫 줄, ㅈㅇㅊㅈ', en: 'Title or first line' },
  'search.by': { ko: '검색 방법', en: 'Search by' },
  'search.mode.new': { ko: '새찬송가 번호', en: 'New number' },
  'search.mode.old': { ko: '통일 번호', en: 'Old number' },
  'search.mode.title': { ko: '제목', en: 'Title' },
  'results.none': { ko: '맞는 찬송이 없습니다.', en: 'No hymn matches that.' },
  'loading': { ko: '불러오는 중…', en: 'Loading…' },
  'edit': { ko: '편집', en: 'Edit' },
  'recent': { ko: '최근 본 찬송', en: 'Recent' },
  'home.hint': {
    ko: '장 번호를 입력하면 악보가 바로 열립니다. 원하는 키로 옮기고, 가사는 한글, 영어, 또는 함께 볼 수 있습니다.',
    en: 'Type a hymn number and the music opens. Pick any key, and show the words in Korean, English, or both.',
  },
  'about.link': { ko: '안내, 출처와 저작권', en: 'About, sources and copyright' },
  'noscore': { ko: '악보 준비 중', en: 'No score yet' },
  // hymn page
  'back': { ko: '검색으로', en: 'Back to search' },
  'search': { ko: '검색', en: 'Search' },
  'gated.title': { ko: '이 찬송의 악보는 아직 실리지 않았습니다.', en: "This hymn's music is not on the site yet." },
  'gated.ko': {
    ko: '한국인이 짓거나 작곡한 찬송으로 저작권이 남아 있어, 한국찬송가공회의 허락이 있을 때까지 악보를 싣지 않습니다.',
    en: 'It was written by a Korean author whose work is still under copyright, so its music stays off the site unless 한국찬송가공회 gives permission.',
  },
  'gated.other': {
    ko: '가사나 곡의 저작권을 확인하는 중이라 악보를 아직 싣지 않았습니다.',
    en: 'Its words or music may still be under copyright, so it stays off the site until that is checked.',
  },
  'key': { ko: '키', en: 'Key' },
  'key.from': { ko: '원조', en: 'from' },
  'lyrics': { ko: '가사', en: 'Lyrics' },
  'mode.both': { ko: '한/영', en: 'KO/EN' },
  'mode.ko': { ko: '한', en: 'KO' },
  'mode.en': { ko: '영', en: 'EN' },
  'mode.both.title': { ko: '한글과 영어', en: 'Korean and English' },
  'mode.ko.title': { ko: '한글만', en: 'Korean only' },
  'mode.en.title': { ko: '영어만', en: 'English only' },
  'size': { ko: '크기', en: 'Size' },
  'smaller': { ko: '작게', en: 'Smaller music' },
  'larger': { ko: '크게', en: 'Larger music' },
  'set.add': { ko: '콘티에 추가', en: 'Add to set' },
  'set.in': { ko: '콘티에 있음', en: 'In set list' },
  'set.add.short': { ko: '콘티', en: 'Set' },
  'set.in.short': { ko: '추가됨', en: 'In set' },
  'set.add.aria': { ko: '콘티에 추가', en: 'Add to set list' },
  'set.in.aria': { ko: '콘티에 있음. 누르면 뺍니다', en: 'In set list. Tap to remove' },
  'chords': { ko: '코드', en: 'Chords' },
  'chords.hide': { ko: '코드 숨기기', en: 'Hide chord letters' },
  'chords.show': { ko: '코드 보기', en: 'Show chord letters' },
  'print': { ko: '인쇄', en: 'Print' },
  'dark': { ko: '어두운 화면', en: 'Dark pages for the stage' },
  'light': { ko: '밝은 화면', en: 'Light pages' },
  'noenglish': {
    ko: '이 찬송은 아직 영어 가사가 없어 가사 없이 악보만 보입니다.',
    en: 'English words are not available for this hymn yet, so the music shows without words.',
  },
  'draw.error': { ko: '악보를 그리지 못했습니다.', en: 'Sorry, this hymn could not be drawn.' },
  'loading.music': { ko: '악보 불러오는 중…', en: 'Loading music…' },
  'en.words': { ko: '영어 가사', en: 'English words' },
  'en.words.note': {
    ko: '영어 가사가 아직 음표에 맞지 않아 여기에 따로 보입니다.',
    en: 'The English does not fit this setting note for note yet, so it is shown here instead.',
  },
  'pager': { ko: '다른 찬송', en: 'Other hymns' },
  'pager.back': { ko: '콘티로', en: 'Back to set list' },
  'foot.origkey': { ko: '원조', en: 'Original key' },
  'unknown': { ko: '미상', en: 'unknown' },
  'report': { ko: '이 찬송의 오류 알리기', en: 'Report a mistake in this hymn' },
  'print.preparing': { ko: '인쇄 준비 중…', en: 'Preparing pages for printing…' },
  'print.ready': { ko: '인쇄 준비가 되었습니다.', en: 'Pages are ready.' },
  'close': { ko: '닫기', en: 'Close' },
  // key sheet
  'key.title': { ko: '조옮김', en: 'Key' },
  'key.choose': { ko: '조 선택', en: 'Choose a key' },
  'keys': { ko: '조', en: 'Keys' },
  'original': { ko: '원조', en: 'Original' },
  'halfsteps': { ko: '반음', en: 'Half steps' },
  'halfstep.down': { ko: '반음 내리기', en: 'Down a half step' },
  'halfstep.up': { ko: '반음 올리기', en: 'Up a half step' },
  'halfstep': { ko: '반음', en: 'Half step' },
  'back.original': { ko: '원조로', en: 'Back to original' },
  'octave': { ko: '옥타브', en: 'Octave' },
  'lower': { ko: '낮게', en: 'Lower' },
  'bestfit': { ko: '알맞게', en: 'Best fit' },
  'higher': { ko: '높게', en: 'Higher' },
  'melody.top': { ko: '멜로디 최고음', en: 'Melody top note' },
  // set list
  'use.list': { ko: '이 콘티 쓰기', en: 'Use this list' },
  'keep.mine': { ko: '내 콘티 유지', en: 'Keep mine' },
  'add.placeholder': { ko: '추가할 장 번호', en: 'Add hymn number' },
  'add': { ko: '추가', en: 'Add' },
  'link.copied': { ko: '링크를 복사했습니다. 단톡방에 붙여 넣으세요.', en: 'Link copied. Paste it in your group chat.' },
  'none.music': { ko: '이 찬송들은 아직 악보가 없습니다.', en: 'None of these hymns have music on the site yet.' },
  'nothing.print': { ko: '인쇄할 찬송이 없습니다.', en: 'Nothing to print yet.' },
  'empty.set': {
    ko: '아직 비어 있습니다. 위에 번호를 넣거나, 찬송 화면에서 "콘티에 추가"를 누르세요.',
    en: 'No hymns yet. Add numbers above, or tap "Add to set" on any hymn.',
  },
  'key.original.short': { ko: ' (원조)', en: ', original' },
  'words': { ko: '가사', en: 'Words' },
  'words.both': { ko: '한/영', en: 'Both' },
  'words.ko': { ko: '한글', en: 'Korean' },
  'words.en': { ko: '영어', en: 'English' },
  'print.all': { ko: '전체 인쇄', en: 'Print all' },
  'preparing': { ko: '준비 중…', en: 'Preparing…' },
  'share.list': { ko: '콘티 공유', en: 'Share list' },
  'paper': { ko: '용지', en: 'Paper size' },
  'clear.list': { ko: '콘티 비우기', en: 'Clear list' },
  'clear.confirm': { ko: '콘티를 모두 지울까요?', en: 'Clear the whole set list?' },
  // about
  'about': { ko: '안내', en: 'About' },
  'offline.unsupported': { ko: '이 브라우저는 오프라인 저장을 지원하지 않습니다.', en: 'This browser cannot save hymns for offline use.' },
  'offline.saved': { ko: '모든 찬송이 이 기기에 저장되었습니다.', en: 'All hymns are saved on this device.' },
  'offline.done': { ko: '모두 저장됨', en: 'All hymns saved' },
  // app
  'looking.up': { ko: '찾는 중…', en: 'Looking up…' },
  'update.ready': { ko: '새 버전이 있습니다.', en: 'A new version is ready.' },
  'reload': { ko: '새로 고침', en: 'Reload' },
  'notfound': { ko: '없는 페이지입니다.', en: 'That page does not exist.' },
  'go.search': { ko: '검색으로 가기', en: 'Go to search' },
  // print
  'print.words.ko': { ko: ', 한글 가사', en: ', Korean words' },
  'print.words.en': { ko: ', 영어 가사', en: ', English words' },
  'print.engraving': { ko: '악보: 깔끔이 CCM, CC BY 4.0.', en: 'Engraving: 깔끔이 CCM, CC BY 4.0.' },
} as const

export type Key = keyof typeof STR

/** Sentences with numbers in them. */
export const F = {
  startFrom: (l: Lang, n: number) => (l === 'ko' ? `${n}장부터 시작` : `Start from ${n}`),
  startPlaying: (l: Lang, n: number) => (l === 'ko' ? `${n}장부터 시작` : `Start playing from ${n}`),
  oldTag: (l: Lang, o: number) => (l === 'ko' ? `통 ${o}` : `old ${o}`),
  noHymn: (l: Lang, n: number | string) => (l === 'ko' ? `${n}장은 없습니다. 새찬송가는 645장까지입니다.` : `There is no hymn ${n}. The hymnal has 645 hymns.`),
  noHymnShort: (l: Lang, n: string) => (l === 'ko' ? `${n}장은 없습니다.` : `There is no hymn ${n}.`),
  already: (l: Lang, n: number) => (l === 'ko' ? `${n}장은 이미 콘티에 있습니다.` : `${n} is already in the list.`),
  pagerSet: (l: Lang, i: number, n: number) => (l === 'ko' ? `콘티 ${i}/${n}` : `Set list ${i} of ${n}`),
  footOld: (l: Lang, o: number) => (l === 'ko' ? `통일찬송가 ${o}장.` : `Old hymnal ${o}.`),
  printOld: (l: Lang, o: number) => (l === 'ko' ? `통일 ${o}장` : `Old hymnal ${o}`),
  shared: (l: Lang, n: number, list: string) =>
    l === 'ko' ? `공유받은 콘티에 ${n}곡이 있습니다: ${list}.` : `Someone shared a set list with ${n} hymn${n === 1 ? '' : 's'}: ${list}.`,
  notPrinted: (l: Lang, list: string) => (l === 'ko' ? `악보가 없어 인쇄하지 않은 찬송: ${list}.` : `Not printed because the music is not on the site: ${list}.`),
  printFailed: (l: Lang, m: string) => (l === 'ko' ? `인쇄에 실패했습니다: ${m}` : `Printing failed: ${m}`),
  remove: (l: Lang, n: number) => (l === 'ko' ? `${n}장 빼기` : `Remove ${n} from the list`),
  keyFor: (l: Lang, n: number) => (l === 'ko' ? `${n}장 키` : `Key for ${n}`),
  lyricsFor: (l: Lang, n: number) => (l === 'ko' ? `${n}장 가사` : `Lyrics for ${n}`),
  moveUp: (l: Lang, n: number) => (l === 'ko' ? `${n}장 위로` : `Move ${n} up`),
  moveDown: (l: Lang, n: number) => (l === 'ko' ? `${n}장 아래로` : `Move ${n} down`),
  oldMissing: (l: Lang, o: number) => (l === 'ko' ? `통일찬송가 ${o}장에 해당하는 찬송이 없습니다.` : `No hymn has 통일찬송가 number ${o}.`),
  saveAll: (l: Lang, n: number | string) => (l === 'ko' ? `찬송 ${n}곡 모두 저장` : `Save all ${n} hymns`),
  saving: (l: Lang, done: number, total: number) => (l === 'ko' ? `${done}/${total} 저장 중…` : `Saving ${done} of ${total}…`),
  savedSome: (l: Lang, ok: number, failed: number) =>
    l === 'ko' ? `${ok}곡 저장, ${failed}곡은 받지 못했습니다. 연결을 확인하고 다시 누르세요.` : `${ok} saved, ${failed} could not be downloaded. Check the connection and tap again.`,
  halfSteps: (l: Lang, half: number, up: boolean) =>
    l === 'ko' ? `반음 ${half}개 ${up ? '올려' : '내려'}` : `${up ? 'up' : 'down'} ${half} half step${half === 1 ? '' : 's'}`,
  printKey: (l: Lang, key: string, orig: string | null) =>
    orig ? (l === 'ko' ? `${key} (원조 ${orig})` : `Key ${key} (from ${orig})`) : (l === 'ko' ? `${key}` : `Key ${key}`),
  printPage: (l: Lang, p: number, n: number) => (l === 'ko' ? `${p}/${n}쪽` : `page ${p} of ${n}`),
}

/** Hymnal theme names (the 새찬송가 index headings) in English. */
const THEME_EN: Record<string, string> = {
  '인도와보호': 'Guidance and Protection', '회개와용서': 'Repentance and Forgiveness', '소명과충성': 'Calling and Faithfulness',
  '찬양': 'Praise', '성탄': 'Christmas', '제자의도리': 'Discipleship', '부르심과영접': 'Invitation and Acceptance',
  '은혜와사랑': 'Grace and Love', '미래와소망': 'Hope and the Future', '주와동행': 'Walking with the Lord',
  '예수그리스도': 'Jesus Christ', '고난': 'Passion', '천국': 'Heaven', '평안과위로': 'Peace and Comfort',
  '창조주': 'God the Creator', '부활': 'Easter', '분투와승리': 'Struggle and Victory', '성령강림': 'Pentecost',
  '경배와찬양': 'Worship and Praise', '세계선교': 'World Mission', '어린이': 'Children', '경배': 'Adoration',
  '시련과극복': 'Trials and Overcoming', '믿음과확신': 'Faith and Assurance', '성경': 'Scripture', '구주강림': 'Advent',
  '재림': 'Second Coming', '헌신과봉사': 'Dedication and Service', '기도와간구': 'Prayer', '감사절': 'Thanksgiving',
  '송영': 'Doxology', '주일': "The Lord's Day", '성찬': 'Communion', '성결한생활': 'Holy Living', '전도': 'Evangelism',
  '전도와교훈': 'Evangelism and Teaching', '아멘송': 'Amen', '예배마침': 'Closing', '아침과저녁': 'Morning and Evening',
  '생애': 'Life of Christ', '성도의교제': 'Fellowship of Believers', '신유의권능': 'Healing', '새해(송구영신)': 'New Year',
  '새해송구영신)': 'New Year', '가정': 'Home and Family', '청년': 'Youth', '나라사랑': 'Love of Country', '혼례': 'Wedding',
  '장례': 'Funeral', '봉헌': 'Offering', '주현': 'Epiphany', '종려주일': 'Palm Sunday', '하나님나라': 'Kingdom of God',
  '거룩한생활': 'Holy Living', '어버이': 'Parents', '입례송': 'Call to Worship', '기도송': 'Prayer Response',
  '세례(침례)': 'Baptism', '세례침례)': 'Baptism', '거듭남': 'New Birth', '자연과환경': 'Nature and Creation',
  '임직': 'Ordination', '헌당': 'Dedication of a Church', '추모': 'Remembrance', '섭리': 'Providence', '은사': 'Spiritual Gifts',
  '감사의생활': 'Thankful Living', '종교개혁기념일': 'Reformation Day', '헌금응답송': 'Offering Response',
  '축도송': 'Benediction', '강림': 'Advent', '회개와사죄': 'Repentance and Pardon', '화해와평화': 'Reconciliation and Peace',
  '주기도송': "The Lord's Prayer", '말씀응답송': 'Response to the Word',
}

/** A theme heading in the chosen language; the Korean form loses a stray bracket from the source. */
export function themeText(t: string, lang: Lang): string {
  if (lang === 'en') return THEME_EN[t] ?? THEME_EN[t.replace(/[()]/g, '')] ?? ''
  const fixed: Record<string, string> = { '새해송구영신)': '새해(송구영신)', '세례침례)': '세례(침례)' }
  return fixed[t] ?? t
}

/** The credit line is stored in English ("Words: ... Music: ..."); show it in the chosen language. */
export function creditText(cr: string, lang: Lang): string {
  // a few credits come from a Korean source ("R. S. 윌리스 편곡"); give English the "arr." it expects
  if (lang !== 'ko') return cr.replace(/\s*편곡\.?/g, ', arr.').replace(/\(출처 미상\)/g, '(source unknown)')
  return cr.replace(/\bWords:/g, '작사:').replace(/\bMusic:/g, '작곡:').replace(/\btr\. /g, '역: ').replace(/\barr\. /g, '편곡: ')
}

export function currentLang(): Lang {
  return getPrefs().lang ?? 'ko'
}

export function t(key: Key, lang: Lang = currentLang()): string {
  return STR[key][lang]
}

/** Re-renders the component when the language changes. */
export function useLang(): Lang {
  const [lang, set] = useState(currentLang())
  useEffect(() => subscribe(() => set(currentLang())), [])
  return lang
}

export function useT() {
  const lang = useLang()
  return { lang, t: (key: Key) => STR[key][lang] }
}

export function setLang(lang: Lang): void {
  setPrefs({ lang })
  document.documentElement.lang = lang
}

/** Hymn titles, the chosen language first: [primary, secondary]. */
export function titles(row: { k: string; e?: string }, lang: Lang): [string, string | undefined] {
  if (lang === 'en' && row.e) return [row.e, row.k]
  return [row.k, row.e]
}
