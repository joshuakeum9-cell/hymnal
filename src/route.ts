// Hash routing: GitHub Pages returns a real 404 for unknown paths, so all state lives after '#'.
import { useEffect, useState } from 'preact/hooks'

export type Route =
  | { name: 'search' }
  | { name: 'hymn'; n: number; params: URLSearchParams }
  | { name: 'old'; o: number }
  | { name: 'set'; params: URLSearchParams }
  | { name: 'about' }
  | { name: 'notfound' }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = h.split('?')
  const params = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'search' }
  if (parts[0] === 'about') return { name: 'about' }
  if (parts[0] === 'set') return { name: 'set', params }
  if (parts[0] === 'old' && /^\d+$/.test(parts[1] ?? '')) return { name: 'old', o: Number(parts[1]) }
  if (/^\d+$/.test(parts[0])) return { name: 'hymn', n: Number(parts[0]), params }
  return { name: 'notfound' }
}

// Each history entry carries its depth inside the app, so Back never leaves the site when a
// shared link was opened directly (depth 0), and still behaves normally after in-app navigation.
let depth: number = typeof history.state?.d === 'number' ? history.state.d : 0
if (typeof history.state?.d !== 'number') history.replaceState({ d: depth }, '')
window.addEventListener('hashchange', () => {
  const d = history.state?.d
  if (typeof d === 'number') {
    depth = d // back, forward, or an in-place update
  } else {
    depth += 1 // a new page opened by a link
    history.replaceState({ d: depth }, '')
  }
})

export function goBack(fallback = '#/'): void {
  if (depth > 0) history.back()
  else go(fallback, true)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(hash: string, replace = false): void {
  const target = hash.startsWith('#') ? hash : `#${hash}`
  if (replace) {
    history.replaceState({ d: depth }, '', target)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = target
  }
}

export function hymnHash(n: number, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v)
  const s = q.toString()
  return `#/${n}${s ? `?${s}` : ''}`
}
