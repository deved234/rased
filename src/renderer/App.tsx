import React from 'react'
import { Titlebar } from './components/Titlebar.js'
import { ScreenBoundary } from './components/ScreenBoundary.js'
import { rased } from './api.js'
import { defaultFilterDefinition } from '@shared/types.js'
import { STRINGS } from './i18n.js'
import { applyUiPrefs, useHashRoute, useHealth, useKhamsatHealth, useNafezlyHealth, useSettings } from './hooks.js'
import { go, navigateHash, requestAction, type Route } from './router.js'
import { playBeep } from './sound.js'
import { Sidebar, Statusbar, Topbar, togglePause } from './components/shell.js'
import { ProjectsView, emptyMemory, type ListMemory } from './views/ProjectsView.js'
import { SavedFiltersView } from './views/SavedFiltersView.js'
import { ProjectDetailView } from './views/ProjectDetailView.js'
import { ProposalView } from './views/ProposalView.js'
import { SplashView } from './views/SplashView.js'
import { CompactView } from './views/CompactView.js'
const SettingsView = React.lazy(() => import('./views/SettingsView.js').then(module => ({ default: module.SettingsView })))
import { useUpdates, UpdateBanner } from './views/UpdatesView.js'

type Boot = 'loading' | 'slow' | 'error' | 'welcome' | 'ready'

export function App(): React.ReactElement {
  const updateState = useUpdates()
  const route = useHashRoute()
  const [bootEpoch, setBootEpoch] = React.useState(0)
  const [settings, patchSettings, settingsReady] = useSettings(bootEpoch)
  const [boot, setBoot] = React.useState<Boot>('loading')
  const [bootError, setBootError] = React.useState<string | null>(null)
  const [bootStage, setBootStage] = React.useState<'settings' | 'database' | 'ready'>('settings')
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [unread, setUnread] = React.useState(0)
  const [savedCount, setSavedCount] = React.useState(0)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const sessionStart = React.useRef(Date.now())
  const memoryRef = React.useRef<Partial<Record<'projects' | 'saved', ListMemory>>>({})
  const restoredSearch = React.useRef(false)
  const returnRoute = React.useRef<Route>({ name: 'projects' })
  const lastListRoute = React.useRef<Route>({ name: 'projects' })
  if (route.name === 'projects' || route.name === 'saved') lastListRoute.current = route
  if (route.name !== 'project' && route.name !== 'proposal') returnRoute.current = lastListRoute.current
  const lang = settings.language
  const t = STRINGS[lang]
  const health = useHealth(boot === 'ready')
  const khamsatHealth = useKhamsatHealth(boot === 'ready')
  const nafezlyHealth = useNafezlyHealth(boot === 'ready')

  // bootstrap: settings + local list (RSS runs independently in main)
  React.useEffect(() => {
    let alive = true
    let presentationTimer: ReturnType<typeof setTimeout> | undefined
    const started = performance.now()
    setBoot('loading')
    setBootStage('settings')
    setBootError(null)
    const slow = setTimeout(() => alive && setBoot((b) => (b === 'loading' ? 'slow' : b)), 8000)
    void (async () => {
      try {
        const s = await rased.getSettings()
        if (!alive) return
        setBootStage('database')
        // local list proves the DB is readable; failures surface honestly
        await rased.queryProjectsPage({ ...defaultFilterDefinition(), search: '' }, 1, 0)
        if (!alive) return
        void s
        // A short presentation interval makes the launch visible, without
        // delaying the collector or pretending to measure network progress.
        if (location.hash === '#/compact') { setBoot('ready'); return }
        presentationTimer = setTimeout(() => {
          if (!alive) return
          setBootStage('ready')
          setBoot('welcome')
        }, Math.max(0, 600 - (performance.now() - started)))
      } catch (err) {
        if (!alive) return
        setBootError(err instanceof Error ? err.message : String(err))
        setBoot('error')
      } finally {
        clearTimeout(slow)
      }
    })()
    return () => {
      alive = false
      clearTimeout(slow)
      clearTimeout(presentationTimer)
    }
  }, [bootEpoch])

  React.useEffect(() => {
    if (boot !== 'welcome') return
    const timer = setTimeout(() => setBoot('ready'), 800)
    return () => clearTimeout(timer)
  }, [boot])

  React.useEffect(() => {
    if (settingsReady) applyUiPrefs(settings)
    if (settingsReady && !restoredSearch.current) {
      restoredSearch.current = true
      setSearchInput(settings.displayQuery.search)
      setSearch(settings.displayQuery.search)
    }
  }, [settings, settingsReady])

  // search debounce
  React.useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  // sidebar counts
  const refreshCounts = React.useCallback(() => {
    void rased.getProjectCount({}).then((c) => setUnread(c.unread))
    void rased.queryProjectsPage({ ...defaultFilterDefinition(), scope: 'saved' }, 0, 0).then((r) => setSavedCount(r.total))
  }, [])
  React.useEffect(() => {
    if (boot !== 'ready') return
    refreshCounts()
    const off = rased.onProjectsChanged(() => refreshCounts())
    return off
  }, [boot, refreshCounts])

  // tray + compact navigation events
  React.useEffect(() => {
    if (route.name === 'compact') return
    return rased.onPlayBeep(playBeep)
  }, [route.name])

  React.useEffect(() => {
    return rased.onRequestClose((e) => requestAction(() => { void rased.confirmClose(e.quit) }))
  }, [])
  React.useEffect(() => rased.onRequestUpdateInstall(() => requestAction(() => { void rased.confirmUpdateInstall() })), [])

  React.useEffect(() => {
    const offS = rased.onOpenSettings(() => go({ name: 'settings', section: null }))
    const offN = rased.onNavigate((e) => {
      navigateHash(e.hash)
    })
    return () => {
      offS()
      offN()
    }
  }, [])

  // global Ctrl+K (never inside editable fields)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        if (target.matches('input, textarea, select, [contenteditable]')) return
        e.preventDefault()
        if (route.name !== 'projects' && route.name !== 'saved') go({ name: 'projects' })
        requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.select() })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.name])

  if (boot !== 'ready') {
    return <div className="desktop-shell"><Titlebar lang={lang} /><SplashView lang={lang} phase={boot === 'welcome' ? 'ready' : boot} stage={bootStage} error={bootError} onContinue={() => setBoot('ready')} onRetry={() => setBootEpoch((e) => e + 1)} /></div>
  }

  // Compact follower window: standalone view, never inside the main shell.
  if (route.name === 'compact') {
    return <div className="desktop-shell"><Titlebar lang={lang} /><CompactView /></div>
  }

  const memory: ListMemory =
    memoryRef.current[route.name === 'saved' ? 'saved' : 'projects'] ?? { ...emptyMemory(settings.displayFilter), def: settings.displayQuery }
  const onMemory = (m: ListMemory): void => {
    memoryRef.current[route.name === 'saved' ? 'saved' : 'projects'] = m
  }

  const title =
    route.name === 'saved' ? t.navSaved : route.name === 'filters' ? t.navFilters : route.name === 'settings' ? t.navSettings : route.name === 'project' ? t.projectDetails : route.name === 'proposal' ? (lang === 'ar' ? 'مساعد العروض' : 'Proposal Assistant') : t.allProjects

  const pause = (source: 'mostaql' | 'khamsat' | 'nafezly'): void => {
    void togglePause(source, source === 'mostaql' ? health : source === 'khamsat' ? khamsatHealth : nafezlyHealth)
  }
  const refresh = (): void => {
    void rased.refresh()
  }

  return (
    <div className="desktop-shell"><Titlebar lang={lang} /><div className="app">
      <Sidebar
        lang={lang}
        route={route}
        unread={unread}
        savedCount={savedCount}
        collapsed={settings.ui.sidebarCollapsed}
        onToggleCollapse={() => void patchSettings({ ui: { ...settings.ui, sidebarCollapsed: !settings.ui.sidebarCollapsed } })}
      />
      <div className="main">
        <UpdateBanner lang={lang} state={updateState} />
        <Topbar
          lang={lang}
          title={title}
          health={health}
          khamsatHealth={khamsatHealth}
          khamsatEnabled={settings.khamsatEnabled}
          nafezlyHealth={nafezlyHealth}
          nafezlyEnabled={settings.nafezlyEnabled}
          showSearch={route.name === 'projects' || route.name === 'saved'}
          search={searchInput}
          onSearch={setSearchInput}
          searchRef={searchRef}
          onTogglePause={pause}
          onRefresh={refresh}
        />
        {route.name === 'proposal' ? (
          <ProposalView key={route.id} lang={lang} projectId={route.id} />
        ) : route.name === 'project' ? (
          <ProjectDetailView key={route.id} lang={lang} projectId={route.id} onBack={() => go(returnRoute.current)} />
        ) : route.name === 'saved' ? (
          <ProjectsView key="saved"
            lang={lang}
            settings={settings}
            patchSettings={patchSettings}
            health={health}
            khamsatHealth={khamsatHealth}
            nafezlyHealth={nafezlyHealth}
            search={search}
            onSearch={(value) => { setSearchInput(value); setSearch(value) }}
            memory={memory}
            onMemory={onMemory}
            sessionStart={sessionStart.current}
            scope="saved"
          />
        ) : route.name === 'filters' ? (
          <SavedFiltersView
            lang={lang}
            notifyFilter={settings.notifyFilter}
            linked={settings.linkDisplayAndNotifyFilters}
            onToggleLink={(v) => void patchSettings({ linkDisplayAndNotifyFilters: v })}
            onApply={(def) => {
              memoryRef.current.projects = { ...emptyMemory(settings.displayFilter), def }
              setSearchInput(def.search)
              setSearch(def.search)
              void patchSettings({ displayQuery: def })
              go({ name: 'projects' })
            }}
          />
        ) : route.name === 'settings' ? (
          <ScreenBoundary ar={lang === 'ar'}><React.Suspense fallback={<div className="detail-wrap" role="status">{lang === 'ar' ? 'جارٍ فتح الإعدادات…' : 'Opening settings…'}</div>}><SettingsView
            lang={lang}
            settings={settings}
            health={health}
            khamsatHealth={khamsatHealth}
            nafezlyHealth={nafezlyHealth}
            patchSettings={patchSettings}
            section={route.section}
            onSection={(s) => go({ name: 'settings', section: s })}
          /></React.Suspense></ScreenBoundary>
        ) : (
          <ProjectsView key="projects"
            lang={lang}
            settings={settings}
            patchSettings={patchSettings}
            health={health}
            khamsatHealth={khamsatHealth}
            nafezlyHealth={nafezlyHealth}
            search={search}
            onSearch={(value) => { setSearchInput(value); setSearch(value) }}
            memory={memory}
            onMemory={onMemory}
            sessionStart={sessionStart.current}
            scope="all"
          />
        )}
        <Statusbar lang={lang} health={health} khamsatHealth={khamsatHealth} nafezlyHealth={nafezlyHealth} settings={settings} />
      </div>
    </div></div>
  )
}
