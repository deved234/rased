import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rased } from './api.js'
import { categoryDisplay, KNOWN_CATEGORIES } from '@shared/categories.js'
import { defaultSettings, type AppSettings, type Project, type SourceHealth } from '@shared/types.js'
import { STRINGS, fmt, type Lang } from './i18n.js'
import { playBeep } from './sound.js'
import { SettingsView } from './SettingsView.js'
import logo from './assets/logo.png'

const PAGE = 50

type Tab = 'projects' | 'unread' | 'settings'

function timeAgo(iso: string | null, lang: Lang): string {
  const t = STRINGS[lang]
  if (!iso) return t.unknownTime
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return t.unknownTime
  if (ms < 60_000) return t.justNow
  const m = Math.floor(ms / 60_000)
  if (m < 60) return fmt(t.minutesAgo, { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return fmt(t.hoursAgo, { n: h })
  return fmt(t.daysAgo, { n: Math.floor(h / 24) })
}

function fullDate(iso: string | null, lang: Lang): string {
  if (!iso) return STRINGS[lang].unknownTime
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function countdown(iso: string | null, lang: Lang): string {
  if (!iso) return '…'
  const ms = Date.parse(iso) - Date.now()
  if (Number.isNaN(ms) || ms <= 1000) return '…'
  const s = Math.ceil(ms / 1000)
  return lang === 'ar' ? `بعد ${s} ث` : `in ${s}s`
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings())
  const [ready, setReady] = useState(false)
  const [health, setHealth] = useState<SourceHealth | null>(null)
  const [tab, setTab] = useState<Tab>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pill, setPill] = useState(0)
  const [, setNow] = useState(Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settings)
  const loadedCountRef = useRef(PAGE)
  settingsRef.current = settings

  const lang: Lang = settings.language
  const t = STRINGS[lang]

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const query = useMemo(
    () => ({
      unreadOnly: tab === 'unread' ? true : settings.showUnreadOnly ? true : undefined,
      search: search.trim() ? search.trim() : undefined,
      categories:
        settings.displayFilter.mode === 'selected' && settings.displayFilter.categories.length > 0
          ? settings.displayFilter.categories
          : undefined
    }),
    [tab, search, settings.displayFilter, settings.showUnreadOnly]
  )

  const reload = useCallback(
    async (offset = 0, append = false) => {
      const [rows, counts] = await Promise.all([
        rased.getProjects({ ...query, limit: append ? PAGE : loadedCountRef.current, offset }),
        rased.getProjectCount(query)
      ])
      setProjects((prev) => (append ? [...prev, ...rows] : rows))
      loadedCountRef.current = append ? offset + rows.length : rows.length
      setTotal(counts.total)
      setUnread(counts.unread)
      setHasMore(offset + rows.length < counts.total)
      setLoading(false)
    },
    [query]
  )

  // boot
  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, h] = await Promise.all([rased.getSettings(), rased.getHealth()])
      if (!alive) return
      setSettings(s)
      setHealth(h)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  // reload when query changes
  useEffect(() => {
    if (!ready) return
    loadedCountRef.current = PAGE
    setLoading(true)
    void reload(0, false)
  }, [ready, reload])

  // live subscriptions (StrictMode-safe: cleanup removes them)
  useEffect(() => {
    const offP = rased.onProjectsChanged((e) => {
      void reload(0, false)
      const el = listRef.current
      if (el && el.scrollTop > 120 && e.newIds.length > 0) {
        setPill((p) => p + e.newIds.length)
      } else {
        setPill(0)
      }
    })
    const offH = rased.onHealthChanged((h) => setHealth(h))
    const offSettings = rased.onSettingsChanged((s) => setSettings(s))
    const offB = rased.onPlayBeep(() => {
      if (settingsRef.current.soundEnabled) playBeep()
    })
    const offS = rased.onOpenSettings(() => setTab('settings'))
    return () => {
      offP()
      offH()
      offSettings()
      offB()
      offS()
    }
  }, [reload])

  // search debounce + clock tick for time-ago labels
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const patchSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await rased.updateSettings(patch)
    setSettings(next)
  }, [])

  const openProject = useCallback(
    async (id: number) => {
      await rased.openProject(id)
      await reload(0, false)
    },
    [reload]
  )

  const toggleCat = useCallback(
    (slug: string) => {
      const cur = settings.displayFilter
      const cats = cur.categories.includes(slug) ? cur.categories.filter((c) => c !== slug) : [...cur.categories, slug]
      void patchSettings({ displayFilter: { ...cur, mode: cats.length > 0 ? 'selected' : 'all', categories: cats } })
    },
    [settings.displayFilter, patchSettings]
  )

  if (!ready) {
    return (
      <div className="app">
        <div className="empty">{STRINGS.ar.emptyLoading}</div>
      </div>
    )
  }

  const dotClass = !health
    ? ''
    : health.state === 'watching'
      ? 'ok'
      : health.state === 'paused' || health.state === 'backing-off'
        ? 'warn'
        : health.state === 'initializing'
          ? ''
          : 'bad'
  const statusText = !health
    ? t.statusInitializing
    : health.state === 'watching'
      ? t.statusWatching
      : health.state === 'paused'
        ? t.statusPaused
        : health.state === 'backing-off'
          ? t.statusBackingOff
          : health.state === 'offline'
            ? t.statusOffline
            : health.state === 'needs-review'
              ? t.statusNeedsReview
              : health.state === 'error'
                ? t.statusError
                : t.statusInitializing

  const showBanner = health && (health.state === 'paused' || health.state === 'error' || health.state === 'needs-review' || health.state === 'backing-off')
  const bannerText =
    health?.state === 'paused' ? t.pausedBanner : health?.state === 'needs-review' ? t.reviewBanner : health?.state === 'backing-off' ? t.backoffBanner : t.errorBanner
  const bannerClass = health?.state === 'paused' || health?.state === 'backing-off' ? 'banner' : 'banner bad'

  const refreshDisabled = !health || health.paused || health.state === 'backing-off' || health.state === 'needs-review'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="RASED" />
          <div>
            <div className="brand-name">{lang === 'ar' ? t.appName : 'RASED'}</div>
            <div className="brand-sub">{t.tagline}</div>
          </div>
        </div>
        <button className={tab === 'projects' ? 'nav-btn active' : 'nav-btn'} onClick={() => setTab('projects')}>
          <span className="txt">{t.navProjects}</span>
        </button>
        <button className={tab === 'unread' ? 'nav-btn active' : 'nav-btn'} onClick={() => setTab('unread')}>
          <span className="txt">{t.navUnread}</span>
          {unread > 0 && <span className="count">{unread}</span>}
        </button>
        <div className="side-spacer" />
        <div className="side-foot">
          <button className={tab === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => setTab('settings')}>
            <span className="txt">{t.navSettings}</span>
          </button>
          <button className="lang-toggle" onClick={() => void patchSettings({ language: lang === 'ar' ? 'en' : 'ar' })}>
            <span className="txt">{lang === 'ar' ? 'العربية / EN' : 'EN / العربية'}</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{tab === 'settings' ? t.navSettings : tab === 'unread' ? t.navUnread : t.allProjects}</h1>
          <span className="health">
            <span className={`dot ${dotClass}`} />
            {statusText}
            {health?.lastSuccessAt && <> · {t.lastCheck}: {timeAgo(health.lastSuccessAt, lang)}</>}
          </span>
          <span className="spacer" />
          {tab !== 'settings' && (
            <>
              <button className="btn" disabled={refreshDisabled} onClick={() => void rased.refresh().then(() => reload(0, false))} title={t.refreshNow}>
                {t.refreshNow}
              </button>
              {health?.paused ? (
                <button className="btn primary" onClick={() => void rased.resume()}>{t.resume}</button>
              ) : (
                <button className="btn" onClick={() => void rased.pause()}>{t.pause}</button>
              )}
            </>
          )}
        </div>

        {tab === 'settings' ? (
          <SettingsView settings={settings} lang={lang} onChange={(p) => void patchSettings(p)} />
        ) : (
          <>
            {showBanner && <div className={bannerClass}>{bannerText}</div>}
            <div className="toolbar">
              <div className="search-row">
                <input
                  className="search"
                  dir="auto"
                  placeholder={t.searchPlaceholder}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <button className="btn" onClick={() => void rased.markAllRead().then(() => reload(0, false))}>
                  {t.markAllRead}
                </button>
              </div>
              <div className="chips">
                <button
                  className={settings.displayFilter.mode === 'all' ? 'chip active' : 'chip'}
                  onClick={() => void patchSettings({ displayFilter: { ...settings.displayFilter, mode: 'all', categories: [] } })}
                >
                  {t.allCategories}
                </button>
                {KNOWN_CATEGORIES.map((c) => {
                  const on = settings.displayFilter.mode === 'selected' && settings.displayFilter.categories.includes(c.slug)
                  return (
                    <button key={c.slug} className={on ? 'chip active' : 'chip'} onClick={() => toggleCat(c.slug)}>
                      {lang === 'ar' ? c.ar : c.en}
                    </button>
                  )
                })}
              </div>
            </div>

            <div
              className="list-wrap"
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget
                if (el.scrollTop <= 120) setPill(0)
              }}
            >
              <div className="list-head">
                <strong>{tab === 'unread' ? t.navUnread : t.allProjects}</strong>
                <span>
                  {unread} {t.unreadCount}
                </span>
              </div>
              {pill > 0 && (
                <button
                  className="pill"
                  onClick={() => {
                    setPill(0)
                    listRef.current?.scrollTo({ top: 0 })
                    void reload(0, false)
                  }}
                >
                  {pill} {t.newProjectsPill}
                </button>
              )}
              {loading ? (
                <div className="empty">{t.emptyLoading}</div>
              ) : projects.length === 0 ? (
                <div className="empty">{total === 0 ? t.emptyNone : t.emptyFilter}</div>
              ) : (
                projects.map((p) => (
                  <article key={p.id} className={p.readAt ? 'card' : 'card unread'}>
                    <h3>
                      <button dir="auto" onClick={() => void openProject(p.id)} title={t.openProject}>
                        {p.title}
                      </button>
                    </h3>
                    {p.descriptionExcerpt && <p className="excerpt" dir="auto">{p.descriptionExcerpt}</p>}
                    <div className="meta">
                      {!p.readAt && <span className="tag fresh">{t.newBadge}</span>}
                      {p.categorySlug ? (
                        <span className="tag cat">{categoryDisplay(p.categorySlug, lang) ?? p.categorySlug}</span>
                      ) : (
                        <span className="tag uncertain">{t.uncertainCategory}</span>
                      )}
                      {p.budgetRaw && <span className="tag" dir="ltr">{p.budgetRaw}</span>}
                      <span title={fullDate(p.publishedAt, lang)}>
                        {t.publishedAt}: {timeAgo(p.publishedAt, lang)}
                      </span>
                      <span title={fullDate(p.firstSeenAt, lang)}>
                        {t.discoveredAt}: {timeAgo(p.firstSeenAt, lang)}
                      </span>
                      {p.discoveryKind === 'recovered' && <span className="tag">{t.catchUpTag}</span>}
                    </div>
                    {p.skills && p.skills.length > 0 && (
                      <div className="meta" style={{ marginTop: 6 }}>
                        {p.skills.slice(0, 6).map((s) => (
                          <span key={s} className="tag" dir="auto">{s}</span>
                        ))}
                      </div>
                    )}
                    <div className="row-actions">
                      <button className="link-btn" onClick={() => void openProject(p.id)}>
                        {t.openProject} ↗
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => void rased.setReadState(p.id, !p.readAt).then(() => reload(0, false))}
                      >
                        {p.readAt ? t.markUnread : t.markRead}
                      </button>
                    </div>
                  </article>
                ))
              )}
              {hasMore && !loading && (
                <button className="btn" onClick={() => void reload(projects.length, true)}>
                  {t.loadMore}
                </button>
              )}
            </div>

            <div className="statusbar">
              <span>
                <span className={`dot ${dotClass}`} style={{ display: 'inline-block', marginInlineEnd: 6 }} />
                {health?.state === 'watching' ? t.connectedMostaql : statusText}
              </span>
              <span className="sep">|</span>
              <span>RSS</span>
              <span className="sep">|</span>
              <span>
                {t.everySeconds} {settings.pollIntervalMs / 1000} {t.secondsUnit}
              </span>
              {health?.nextAttemptAt && (
                <>
                  <span className="sep">|</span>
                  <span title={fullDate(health.nextAttemptAt, lang)}>
                    {t.nextCheck}: {countdown(health.nextAttemptAt, lang)}
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
