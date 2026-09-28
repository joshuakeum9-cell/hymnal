import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useRoute, go } from './route'
import { SearchView } from './views/SearchView'
import { HymnView } from './views/HymnView'
import { SetListView } from './views/SetListView'
import { AboutView } from './views/AboutView'
import { loadIndex, rowForOld } from './data'
import { getPrefs, subscribe } from './store'
import { loadEngine, loadFonts } from './score'
import './styles.css'

function OldNumber({ o }: { o: number }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    loadIndex().then(() => {
      const r = rowForOld(o)
      if (r) go(`#/${r.n}`, true)
      else setMissing(true)
    })
  }, [o])
  return <main class="search-page"><p class="empty">{missing ? `No hymn has 통일찬송가 number ${o}.` : 'Looking up…'}</p></main>
}

function UpdateToast() {
  const [update, setUpdate] = useState<null | (() => void)>(null)
  useEffect(() => {
    if (import.meta.env.DEV) return
    import('virtual:pwa-register').then(({ registerSW }) => {
      const reload = registerSW({ onNeedRefresh: () => setUpdate(() => () => reload(true)) })
    }).catch(() => {})
  }, [])
  if (!update) return null
  return (
    <div class="toast" role="status">
      <span>A new version is ready.</span>
      <button class="btn primary" onClick={update}>Reload</button>
    </div>
  )
}

function App() {
  const route = useRoute()
  const [dark, setDark] = useState(getPrefs().dark)
  useEffect(() => subscribe(() => setDark(getPrefs().dark)), [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => {
    if (route.name !== 'hymn') document.title = '새찬송가 Band Hymnal'
  }, [route])
  useEffect(() => {
    // warm up the engine and fonts while the person is still typing
    const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 600))
    idle(() => { loadEngine(); loadFonts(); loadIndex() })
  }, [])

  let view
  switch (route.name) {
    case 'hymn': view = <HymnView key={route.n} n={route.n} params={route.params} />; break
    case 'old': view = <OldNumber o={route.o} />; break
    case 'set': view = <SetListView params={route.params} />; break
    case 'about': view = <AboutView />; break
    case 'notfound': view = <main class="search-page"><p class="empty">That page does not exist. <a href="#/">Go to search</a></p></main>; break
    default: view = <SearchView />
  }
  return <>{view}<UpdateToast /></>
}

render(<App />, document.getElementById('app')!)
