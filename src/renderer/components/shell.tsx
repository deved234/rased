import React from 'react'
import { rased } from '../api.js'
import { STRINGS, type Lang } from '../i18n.js'
import type { AppSettings, SourceHealth } from '@shared/types.js'
import { Icon } from './Icon.js'
import { IconBtn, useDialogFocus } from './ui.js'
import { go, type Route } from '../router.js'
import { countdownTo, fullDate, timeAgo } from '../format.js'
import { useNow } from '../hooks.js'
import { overallSourceState, type OverallSourceState } from '@shared/sourceStatus.js'
import logo from '../assets/logo.svg'

export function dotClass(h: SourceHealth | null): string {
  if (!h) return ''
  if (h.state === 'watching') return 'ok'
  if (h.state === 'paused' || h.state === 'backing-off') return 'warn'
  if (h.state === 'initializing') return ''
  return 'bad'
}

export function statusText(h: Pick<SourceHealth, 'state'> | null, lang: Lang): string {
  const t = STRINGS[lang]
  if (!h) return t.statusInitializing
  switch (h.state) {
    case 'watching': return t.statusWatching
    case 'paused': return t.statusPaused
    case 'backing-off': return t.statusBackingOff
    case 'offline': return t.statusOffline
    case 'needs-review': return t.statusNeedsReview
    case 'error': return t.statusError
    default: return t.statusInitializing
  }
}

export function overallText(state: OverallSourceState, lang: Lang): string {
  if (state === 'partial') return STRINGS[lang].statusPartial
  return statusText({ state }, lang)
}

export function overallDot(state: OverallSourceState): string {
  if (state === 'watching') return 'ok'
  if (state === 'partial' || state === 'paused' || state === 'backing-off') return 'warn'
  if (state === 'initializing') return ''
  return 'bad'
}

export function Sidebar({
  lang,
  route,
  unread,
  savedCount,
  collapsed,
  onToggleCollapse
}: {
  lang: Lang
  route: Route
  unread: number
  savedCount: number
  collapsed: boolean
  onToggleCollapse: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const item = (r: Route, icon: Parameters<typeof Icon>[0]['name'], label: string, badge?: number, active?: boolean): React.ReactElement => (
    <button className={active ? 'nav-btn active' : 'nav-btn'} onClick={() => go(r)} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={18} />
      <span className="txt">{label}</span>
      {badge !== undefined && badge > 0 && <span className="count num">{badge}</span>}
    </button>
  )
  return (
    <aside className="sidebar" aria-label={t.appName}>
      <div className="brand">
        <img src={logo} alt="RASED" />
        <div className="brand-text">
          <div className="brand-name">{lang === 'ar' ? t.appName : 'RASED'}</div>
          <div className="brand-sub">{t.tagline}</div>
        </div>
      </div>
      {item({ name: 'projects' }, 'briefcase', t.navProjects, unread, route.name === 'projects')}
      {item({ name: 'saved' }, 'bookmark', t.navSaved, savedCount, route.name === 'saved')}
      {item({ name: 'filters' }, 'filter', t.navFilters, undefined, route.name === 'filters')}
      <div className="side-spacer" />
      <div className="side-foot">
        {item({ name: 'settings', section: null }, 'gear', t.navSettings, undefined, route.name === 'settings')}
        <button
          className="nav-btn"
          onClick={onToggleCollapse}
          title={collapsed ? t.expandSidebar : t.collapseSidebar}
          aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
          aria-expanded={!collapsed}
        >
          <Icon name="collapse" size={18} />
          <span className="txt">{collapsed ? t.expandSidebar : t.collapseSidebar}</span>
        </button>
      </div>
    </aside>
  )
}

export function HealthPopover({
  lang,
  health,
  khamsatHealth,
  khamsatEnabled,
  nafezlyHealth,
  nafezlyEnabled,
  onTogglePause,
  onRefresh,
  onClose
}: {
  lang: Lang
  health: SourceHealth | null
  khamsatHealth: SourceHealth | null
  khamsatEnabled: boolean
  nafezlyHealth: SourceHealth | null
  nafezlyEnabled: boolean
  onTogglePause: (source: 'mostaql' | 'khamsat' | 'nafezly') => void
  onRefresh: () => void
  onClose: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  useNow(1000)
  const panelRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef)
  React.useEffect(() => {
    const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  const state = overallSourceState([health, ...(khamsatEnabled ? [khamsatHealth] : []), ...(nafezlyEnabled ? [nafezlyHealth] : [])])
  const refreshDisabled = [health, ...(khamsatEnabled ? [khamsatHealth] : []), ...(nafezlyEnabled ? [nafezlyHealth] : [])].every(value => !value || value.paused || value.state === 'backing-off')
  const sources: { id: 'mostaql' | 'khamsat' | 'nafezly'; name: string; value: SourceHealth | null }[] = [
    { id: 'mostaql', name: t.sourceMostaql, value: health },
    ...(khamsatEnabled ? [{ id: 'khamsat' as const, name: t.sourceKhamsat, value: khamsatHealth }] : []),
    ...(nafezlyEnabled ? [{ id: 'nafezly' as const, name: t.sourceNafezly, value: nafezlyHealth }] : [])
  ]
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={panelRef} className="popover" role="dialog" aria-modal="true" aria-label={t.healthDetails}>
        <div className="meta">
          <span className={`dot ${overallDot(state)}`} />
          <strong>{overallText(state, lang)}</strong>
        </div>
        {sources.map(({ id, name, value }) => <div className="health-source" key={id}>
          <div className="meta"><span className={`dot ${dotClass(value)}`} /><strong>{name}</strong><span>{statusText(value, lang)}</span></div>
          <div className="faint small">{t.lastSuccessAt}: {value?.lastSuccessAt ? timeAgo(value.lastSuccessAt, lang) : t.unknownTime}</div>
          <div className="faint small">{t.nextCheck}: {value?.nextAttemptAt ? countdownTo(value.nextAttemptAt, lang) : '…'}</div>
          {value?.lastError && <div className="faint small">{t.lastErrorLabel}: <span dir="auto">{value.lastError}</span></div>}
          {value?.lastSuccessAt && <div className="faint small num">{fullDate(value.lastSuccessAt, lang)}</div>}
          <button className="btn sm" disabled={!value} onClick={() => onTogglePause(id)}>{value?.paused ? t.resume : t.pause} {name}</button>
        </div>)}
        <div className="row-actions">
          <button className="btn sm" disabled={refreshDisabled} onClick={onRefresh}>
            {t.refreshNow}
          </button>
        </div>
      </div>
    </>
  )
}

export function Topbar({
  lang,
  title,
  health,
  khamsatHealth,
  khamsatEnabled,
  nafezlyHealth,
  nafezlyEnabled,
  showSearch,
  search,
  onSearch,
  searchRef,
  onTogglePause,
  onRefresh
}: {
  lang: Lang
  title: string
  health: SourceHealth | null
  khamsatHealth: SourceHealth | null
  khamsatEnabled: boolean
  nafezlyHealth: SourceHealth | null
  nafezlyEnabled: boolean
  showSearch: boolean
  search: string
  onSearch: (v: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  onTogglePause: (source: 'mostaql' | 'khamsat' | 'nafezly') => void
  onRefresh: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const [pop, setPop] = React.useState(false)
  const sourcePill = (source: 'mostaql' | 'khamsat' | 'nafezly', name: string, value: SourceHealth | null, enabled = true): React.ReactElement => (
    <div className="source-pill" key={source}>
      <button className="source-health-btn" onClick={() => setPop((v) => !v)} aria-haspopup="dialog" aria-expanded={pop} aria-label={`${name}: ${enabled ? statusText(value, lang) : t.statusDisabled}`}>
        <span className={`dot ${enabled ? dotClass(value) : ''}`} aria-hidden="true" />
        <span>{name}</span><span className="source-status-label">: {enabled ? statusText(value, lang) : t.statusDisabled}</span>
      </button>
      {enabled && <button className="source-pause-btn" disabled={!value} title={`${value?.paused ? t.resume : t.pause} ${name}`} aria-label={`${value?.paused ? t.resume : t.pause} ${name}`} onClick={() => onTogglePause(source)}><Icon name={value?.paused ? 'play' : 'pause'} size={15} /></button>}
    </div>
  )
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {showSearch && <input
        ref={searchRef}
        className="input search-top"
        dir="auto"
        placeholder={t.searchPlaceholder}
        title={t.searchTitle}
        aria-label={t.searchPlaceholder}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />}
      <span className="spacer" />
      <div className="source-health-strip">
        {sourcePill('mostaql', t.sourceMostaql, health)}
        {sourcePill('khamsat', t.sourceKhamsat, khamsatHealth, khamsatEnabled)}
        {sourcePill('nafezly', t.sourceNafezly, nafezlyHealth, nafezlyEnabled)}
      </div>
      {pop && (
        <HealthPopover lang={lang} health={health} khamsatHealth={khamsatHealth} khamsatEnabled={khamsatEnabled} nafezlyHealth={nafezlyHealth} nafezlyEnabled={nafezlyEnabled} onTogglePause={onTogglePause} onRefresh={onRefresh} onClose={() => setPop(false)} />
      )}
    </div>
  )
}

export function Statusbar({
  lang,
  health,
  khamsatHealth,
  nafezlyHealth,
  settings
}: {
  lang: Lang
  health: SourceHealth | null
  khamsatHealth: SourceHealth | null
  nafezlyHealth: SourceHealth | null
  settings: AppSettings
}): React.ReactElement {
  const t = STRINGS[lang]
  useNow(1000)
  return (
    <div className="statusbar" role="status">
      <span title={[statusText(health, lang), statusText(khamsatHealth, lang), statusText(nafezlyHealth, lang)].join(' · ')}>
        {overallText(overallSourceState([health, ...(settings.khamsatEnabled ? [khamsatHealth] : []), ...(settings.nafezlyEnabled ? [nafezlyHealth] : [])]), lang)}
      </span>
      <span className="sep" aria-hidden="true">·</span>
      <span className="muted">{lang === 'ar' ? 'تفاصيل كل مصدر في الشريط العلوي' : 'Source details are in the top bar'}</span>
      <span className="grow" />
      <IconBtn
        name="keyboard"
        title={t.shortcutsTitle}
        onClick={() => go({ name: 'settings', section: 'appearance' })}
      />
    </div>
  )
}

export async function togglePause(source: 'mostaql' | 'khamsat' | 'nafezly', health: SourceHealth | null): Promise<void> {
  if (!health) return
  if (source === 'nafezly') {
    if (health.paused) await rased.resumeNafezly()
    else await rased.pauseNafezly()
  } else if (source === 'khamsat') {
    if (health.paused) await rased.resumeKhamsat()
    else await rased.pauseKhamsat()
  } else if (health.paused) await rased.resume()
  else await rased.pause()
}
