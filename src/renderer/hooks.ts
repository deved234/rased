import { useCallback, useEffect, useRef, useState } from 'react'
import { rased } from './api.js'
import { currentRoute } from './router.js'
import type { Route } from './router.js'
import { defaultSettings, type AppSettings, type PageResult, type FilterDefinition, type SourceHealth } from '@shared/types.js'
import { defaultFilterDefinition } from '@shared/types.js'

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => currentRoute())
  useEffect(() => {
    const onChange = (): void => setRoute(currentRoute())
    window.addEventListener('rased-route', onChange)
    return () => window.removeEventListener('rased-route', onChange)
  }, [])
  return route
}

export function useSettings(epoch = 0): [AppSettings, (patch: Partial<AppSettings>) => Promise<void>, boolean] {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings())
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    let received = false
    void rased.getSettings().then((s) => {
      if (alive && !received) {
        setSettings(s)
        setReady(true)
      }
    }).catch(() => { /* bootstrap surfaces failures; an incoming update can recover this hook */ })
    const off = rased.onSettingsChanged((s) => {
      received = true
      if (alive) { setSettings(s); setReady(true) }
    })
    return () => {
      alive = false
      off()
    }
  }, [epoch])
  const patch = useCallback(async (p: Partial<AppSettings>) => {
    const next = await rased.updateSettings(p)
    setSettings(next)
  }, [])
  return [settings, patch, ready]
}

export function applyUiPrefs(settings: AppSettings): void {
  const root = document.documentElement
  root.lang = settings.language
  root.dir = settings.language === 'ar' ? 'rtl' : 'ltr'
  root.dataset['theme'] = settings.ui.theme
  root.dataset['density'] = settings.ui.density
  root.dataset['textscale'] = String(settings.ui.textScale)
  root.dataset['sidebar'] = settings.ui.sidebarCollapsed ? 'collapsed' : 'expanded'
}

export function useHealth(enabled: boolean): SourceHealth | null {
  const [health, setHealth] = useState<SourceHealth | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void rased.getHealth().then((h) => alive && setHealth(h)).catch(() => {})
    const off = rased.onHealthChanged((h) => alive && setHealth(h))
    return () => {
      alive = false
      off()
    }
  }, [enabled])
  return health
}

export function useKhamsatHealth(enabled: boolean): SourceHealth | null {
  const [health, setHealth] = useState<SourceHealth | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void rased.getKhamsatHealth().then((h) => alive && setHealth(h)).catch(() => {})
    const off = rased.onKhamsatHealthChanged((h) => alive && setHealth(h))
    return () => { alive = false; off() }
  }, [enabled])
  return health
}

export function useNafezlyHealth(enabled: boolean): SourceHealth | null {
  const [health, setHealth] = useState<SourceHealth | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void rased.getNafezlyHealth().then((h) => alive && setHealth(h)).catch(() => {})
    const off = rased.onNafezlyHealthChanged((h) => alive && setHealth(h))
    return () => { alive = false; off() }
  }, [enabled])
  return health
}

/** Ticking clock for countdowns/time-ago labels; no data refetch. */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs)
    return () => clearInterval(id)
  }, [stepMs])
  return now
}

export interface PageState {
  result: PageResult
  loading: boolean
  error: boolean
  /** bump to force reload */
  epoch: number
  reload: () => void
}

/**
 * Generation-guarded page fetcher: a stale response never overwrites a newer
 * filter's result. Caller owns limit/offset (scroll preservation).
 */
export function useProjectsPage(def: FilterDefinition, limit: number, offset: number, active: boolean): PageState {
  const [result, setResult] = useState<PageResult>({ rows: [], total: 0, unread: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const gen = useRef(0)
  const key = JSON.stringify(def)
  useEffect(() => {
    if (!active) return
    const my = ++gen.current
    setLoading(true)
    const parsed = JSON.parse(key) as FilterDefinition
    void rased.queryProjectsPage(parsed, limit, offset).then((r) => {
      if (gen.current !== my) return // stale: a newer query already started
      setResult(r)
      setLoading(false)
      setError(false)
    }).catch(() => { if(gen.current===my){setLoading(false);setError(true)} })
    return () => { gen.current++ }
  }, [key, limit, offset, active, epoch])
  const reload = useCallback(() => setEpoch((e) => e + 1), [])
  return { result, loading, error, epoch, reload }
}

export function emptyFilterDef(): FilterDefinition {
  return defaultFilterDefinition()
}
