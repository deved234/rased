import React from 'react'
import { rased } from '../api.js'
import { STRINGS, type Lang } from '../i18n.js'
import type { AppSettings, SourceHealth } from '@shared/types.js'
import { Icon } from './Icon.js'
import { IconBtn, useDialogFocus } from './ui.js'
import { go, type Route } from '../router.js'
import { countdownTo, fullDate, timeAgo } from '../format.js'
import { useNow } from '../hooks.js'
import logo from '../assets/logo.svg'

export function dotClass(h: SourceHealth | null): string {
  if (!h) return ''
  if (h.state === 'watching') return 'ok'
  if (h.state === 'paused' || h.state === 'backing-off') return 'warn'
  if (h.state === 'initializing') return ''
  return 'bad'
}

export function statusText(h: SourceHealth | null, lang: Lang): string {
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
  onPause,
  onResume,
  onRefresh,
  onClose
}: {
  lang: Lang
  health: SourceHealth | null
  onPause: () => void
  onResume: () => void
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
  const refreshDisabled = !health || health.paused || health.state === 'backing-off' || health.state === 'needs-review'
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={panelRef} className="popover" role="dialog" aria-modal="true" aria-label={t.healthDetails}>
        <div className="meta">
          <span className={`dot ${dotClass(health)}`} />
          <strong>{statusText(health, lang)}</strong>
        </div>
        <div className="meta">
          <span>
            {t.lastSuccessAt}: {health?.lastSuccessAt ? timeAgo(health.lastSuccessAt, lang) : t.unknownTime}
          </span>
        </div>
        <div className="meta">
          <span>
            {t.nextCheck}: {health?.nextAttemptAt ? countdownTo(health.nextAttemptAt, lang) : '…'}
          </span>
        </div>
        {health?.lastError && (
          <div className="meta">
            <span>
              {t.lastErrorLabel}: <span dir="auto">{health.lastError}</span>
            </span>
          </div>
        )}
        {health?.lastSuccessAt && <div className="faint small num">{fullDate(health.lastSuccessAt, lang)}</div>}
        <div className="row-actions">
          <button className="btn sm" disabled={refreshDisabled} onClick={onRefresh}>
            {t.refreshNow}
          </button>
          {health?.paused ? (
            <button className="btn sm primary" onClick={onResume}>
              {t.resume}
            </button>
          ) : (
            <button className="btn sm" onClick={onPause}>
              {t.pause}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

export function Topbar({
  lang,
  title,
  health,
  search,
  onSearch,
  searchRef,
  onPause,
  onResume,
  onRefresh
}: {
  lang: Lang
  title: string
  health: SourceHealth | null
  search: string
  onSearch: (v: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  onPause: () => void
  onResume: () => void
  onRefresh: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const [pop, setPop] = React.useState(false)
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <input
        ref={searchRef}
        className="input search-top"
        dir="auto"
        placeholder={t.searchPlaceholder}
        title={t.searchTitle}
        aria-label={t.searchPlaceholder}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <span className="spacer" />
      <button className="health-btn" onClick={() => setPop((v) => !v)} aria-haspopup="dialog" aria-expanded={pop}>
        <span className={`dot ${dotClass(health)}`} />
        {statusText(health, lang)}
      </button>
      {pop && (
        <HealthPopover lang={lang} health={health} onPause={onPause} onResume={onResume} onRefresh={onRefresh} onClose={() => setPop(false)} />
      )}
    </div>
  )
}

export function Statusbar({
  lang,
  health,
  settings
}: {
  lang: Lang
  health: SourceHealth | null
  settings: AppSettings
}): React.ReactElement {
  const t = STRINGS[lang]
  useNow(1000)
  const text = health?.state === 'watching' ? t.connectedMostaql : statusText(health, lang)
  return (
    <div className="statusbar" role="status">
      <span>
        <span className={`dot ${dotClass(health)}`} aria-hidden="true" /> {text}
      </span>
      <span className="sep" aria-hidden="true">
        |
      </span>
      <span>RSS</span>
      <span className="sep" aria-hidden="true">
        |
      </span>
      <span className="num">
        {t.everySeconds} {settings.pollIntervalMs / 1000}
        {t.secondsUnit}
      </span>
      <span className="grow" />
      <IconBtn
        name="keyboard"
        title={t.shortcutsTitle}
        onClick={() => go({ name: 'settings', section: 'appearance' })}
      />
    </div>
  )
}

export async function togglePause(health: SourceHealth | null): Promise<void> {
  if (!health) return
  if (health.paused) await rased.resume()
  else await rased.pause()
}
