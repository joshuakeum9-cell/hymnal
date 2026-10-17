import { useState } from 'preact/hooks'
import { unlockSite } from '../data'

/** Shown before anything else on a locked build, until the site password is entered on this device. */
export function SiteLockView({ onOpen }: { onOpen: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!pw.trim() || busy) return
    setBusy(true)
    setWrong(false)
    if (await unlockSite(pw).catch(() => false)) onOpen()
    else {
      setBusy(false)
      setWrong(true)
    }
  }

  return (
    <main class="lang-page">
      <form class="lang-card" onSubmit={submit}>
        <h1 class="lang-brand">
          <span class="lang-brand-ko">새찬송가</span>
          <span class="lang-brand-en">Band Hymnal</span>
        </h1>
        <label class="lang-ask" for="site-pw">
          <span lang="ko">비밀번호를 입력하세요</span>
          <span lang="en">Enter the password</span>
        </label>
        <div class="lock-row">
          <input id="site-pw" class="lock-input" type="password" value={pw} autocomplete="current-password"
            autocapitalize="off" spellcheck={false} autofocus onInput={e => setPw((e.target as HTMLInputElement).value)} />
          <button class="btn primary big" type="submit" disabled={busy || !pw.trim()}>
            {busy ? '…' : <><span lang="ko">열기</span> / <span lang="en">Open</span></>}
          </button>
        </div>
        {wrong ? (
          <p class="lock-wrong" role="alert">
            <span lang="ko">비밀번호가 맞지 않습니다.</span> <span lang="en">That password is not right.</span>
          </p>
        ) : null}
      </form>
    </main>
  )
}
