import { useState } from 'preact/hooks'
import { unlockBand } from '../data'
import { useT } from '../i18n'

/** Band password box on a held-back hymn. The key is kept on this device, then the app reloads. */
export function BandUnlock() {
  const { t } = useT()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!pw.trim() || busy) return
    setBusy(true)
    setWrong(false)
    const ok = await unlockBand(pw).catch(() => false)
    if (ok) location.reload()
    else {
      setBusy(false)
      setWrong(true)
    }
  }

  return (
    <form class="band-form" onSubmit={submit}>
      <p>{t('band.hint')}</p>
      <label class="band-row">
        <span class="visually-hidden">{t('band.password')}</span>
        <input class="band-input" type="password" value={pw} placeholder={t('band.password')} autocomplete="off"
          autocapitalize="off" spellcheck={false} onInput={e => setPw((e.target as HTMLInputElement).value)} />
        <button class="btn primary" type="submit" disabled={busy || !pw.trim()}>{busy ? t('band.checking') : t('band.open')}</button>
      </label>
      {wrong ? <p class="band-wrong" role="alert">{t('band.wrong')}</p> : null}
    </form>
  )
}
