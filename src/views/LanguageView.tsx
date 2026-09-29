import { setLang, type Lang } from '../i18n'

/** Shown once, before anything else, until a language is chosen. */
export function LanguageView() {
  const pick = (l: Lang) => setLang(l)
  return (
    <main class="lang-page">
      <div class="lang-card">
        <h1 class="lang-brand">
          <span class="lang-brand-ko">새찬송가</span>
          <span class="lang-brand-en">Band Hymnal</span>
        </h1>
        <p class="lang-ask">
          <span lang="ko">언어를 선택하세요</span>
          <span lang="en">Choose your language</span>
        </p>
        <div class="lang-choices">
          <button class="btn primary big lang-choice" lang="ko" onClick={() => pick('ko')}>한국어</button>
          <button class="btn primary big lang-choice" lang="en" onClick={() => pick('en')}>English</button>
        </div>
        <p class="lang-note muted small">
          <span lang="ko">나중에 홈 화면 왼쪽 위에서 바꿀 수 있습니다.</span>
          <span lang="en">You can change it later at the top left of the home screen.</span>
        </p>
      </div>
    </main>
  )
}
