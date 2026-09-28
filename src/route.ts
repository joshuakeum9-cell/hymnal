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
    history.replaceState(null, '', target)
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
