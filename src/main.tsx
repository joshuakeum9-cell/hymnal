import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useRoute, go } from './route'
import { SearchView } from './views/SearchView'
import { HymnView } from './views/HymnView'
import { SetListView } from './views/SetListView'
import { AboutView } from './views/AboutView'
import { LanguageView } from './views/LanguageView'
import { loadIndex, rowForOld } from './data'
import { getPrefs, subscribe } from './store'
import { loadEngine, loadFonts } from './score'
import { F, useLang, useT } from './i18n'
import './styles.css'

function OldNumber({ o }: { o: number }) {
  const [missing, setMissing] = useState(false)
  const { t, lang } = useT()
  useEffect(() => {
    loadIndex().then(() => {
      const r = rowForOld(o)
      if (r) go(`#/${r.n}`, true)
      else setMissing(true)
    })
  }, [o])
  return <main class="search-page"><p class="empty">{missing ? F.oldMissing(lang, o) : t('looking.up')}</p></main>
}

function UpdateToast() {
  const [update, setUpdate] = useState<null | (() => void)>(null)
  const { t } = useT()
  useEffect(() => {
    if (import.meta.env.DEV) return
    import('virtual:pwa-register').then(({ registerSW }) => {
      const reload = registerSW({ onNeedRefresh: () => setUpdate(() => () => reload(true)) })
    }).catch(() => {})
  }, [])
  if (!update) return null
  return (
    <div class="toast" role="status">
      <span>{t('update.ready')}</span>
      <button class="btn primary" onClick={update}>{t('reload')}</button>
    </div>
  )
}

function App() {
  const route = useRoute()
  const [dark, setDark] = useState(getPrefs().dark)
  const [chosen, setChosen] = useState(!!getPrefs().lang)
  const lang = useLang()
  const { t } = useT()
  useEffect(() => subscribe(() => { setDark(getPrefs().dark); setChosen(!!getPrefs().lang) }), [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => {
    if (route.name !== 'hymn') document.title = lang === 'ko' ? '새찬송가' : 'Band Hymnal'
  }, [route, lang])
  useEffect(() => {
    // warm up the engine and fonts while the person is still typing
    const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 600))
    idle(() => { loadEngine(); loadFonts(); loadIndex() })
  }, [])

  // the first visit asks for a language; the route (a shared link, say) is kept for afterwards
  if (!chosen) return <LanguageView />

  let view
  switch (route.name) {
    case 'hymn': view = <HymnView key={route.n} n={route.n} params={route.params} />; break
    case 'old': view = <OldNumber o={route.o} />; break
    case 'set': view = <SetListView params={route.params} />; break
    case 'about': view = <AboutView />; break
    case 'notfound': view = <main class="search-page"><p class="empty">{t('notfound')} <a href="#/">{t('go.search')}</a></p></main>; break
    default: view = <SearchView />
  }
  return <>{view}<UpdateToast /></>
}

render(<App />, document.getElementById('app')!)
