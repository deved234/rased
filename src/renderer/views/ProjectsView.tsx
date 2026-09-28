import React from 'react'
import { rased } from '../api.js'
import { KNOWN_CATEGORIES } from '@shared/categories.js'
import { matchesDefinition } from '@shared/filters.js'
import {
  defaultFilterDefinition,
  type AppSettings,
  type FilterDefinition,
  type ProjectWithUser,
  type SourceHealth
} from '@shared/types.js'
import { STRINGS, fmt, type Lang } from '../i18n.js'
import { useNow } from '../hooks.js'
import { go } from '../router.js'
import { CategoryTag, ProjectRow } from '../components/ProjectRow.js'
import { FilterDrawer } from '../components/FilterDrawer.js'
import { EmptyState, IconBtn, SkeletonList, useDialogFocus } from '../components/ui.js'
import { Icon } from '../components/Icon.js'
import { budgetLabel, timeAgo } from '../format.js'

const PAGE = 50

export interface ListMemory {
  def: FilterDefinition
  limit: number
  scrollTop: number
  selectedId: number | null
}

export function emptyMemory(displayCats: FilterDefinition['categoryFilter']): ListMemory {
  return { def: { ...defaultFilterDefinition(), categoryFilter: { ...displayCats } }, limit: PAGE, scrollTop: 0, selectedId: null }
}

export function ProjectsView({
  lang,
  settings,
  patchSettings,
  health,
  search,
  onSearch,
  memory,
  onMemory,
  sessionStart,
  scope
}: {
  lang: Lang
  settings: AppSettings
  patchSettings: (p: Partial<AppSettings>) => Promise<void>
  health: SourceHealth | null
  search: string
  onSearch: (value: string) => void
  memory: ListMemory
  onMemory: (m: ListMemory) => void
  sessionStart: number
  scope: 'all' | 'saved'
}): React.ReactElement {
  const t = STRINGS[lang]
  const [def, setDef] = React.useState<FilterDefinition>(() => ({ ...memory.def, scope: scope === 'saved' ? 'saved' : memory.def.scope, search }));
  const [limit, setLimit] = React.useState(memory.limit)
  const [rows, setRows] = React.useState<ProjectWithUser[]>([])
  const [total, setTotal] = React.useState(0)
  const [unread, setUnread] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [drawer, setDrawer] = React.useState(false)
  const [pendingNew, setPendingNew] = React.useState<number[]>([])
  const [selectedId, setSelectedId] = React.useState<number | null>(memory.selectedId)
  const [narrow, setNarrow] = React.useState(() => window.innerWidth < 1100)
  const listRef = React.useRef<HTMLDivElement>(null)
  const splitRef = React.useRef<HTMLDivElement>(null)
  const gen = React.useRef(0)
  const scopeRef = React.useRef(scope)
  const restoreRef = React.useRef<{ id?: number; offset?: number; scrollTop: number } | null>({ scrollTop: memory.scrollTop })
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [khamsatHealth, setKhamsatHealth] = React.useState<SourceHealth | null>(null)
  React.useEffect(() => {
    let alive = true
    void rased.getKhamsatHealth().then(value => { if (alive) setKhamsatHealth(value) })
    const off = rased.onKhamsatHealthChanged(value => setKhamsatHealth(value))
    return () => { alive = false; off() }
  }, [])
  const captureAnchor = (): { id?: number; offset?: number; scrollTop: number } => {
    const el = listRef.current
    if (!el) return { scrollTop: 0 }
    const top = el.getBoundingClientRect().top
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-row]')).find(r => r.getBoundingClientRect().bottom > top)
    return { id: row ? Number(row.dataset.row) : undefined, offset: row ? row.getBoundingClientRect().top - top : undefined, scrollTop: el.scrollTop }
  }
  const defRef = React.useRef(def)
  defRef.current = def
  const rowsRef = React.useRef(rows)
  rowsRef.current = rows
  // latest values for the stable live-event subscription (no stale closures)
  const liveRef = React.useRef({ scope, search, limit, autoReveal: settings.ui.autoRevealNew })
  liveRef.current = { scope, search, limit, autoReveal: settings.ui.autoRevealNew }
  void useNow(5000)

  const fullDef = React.useMemo(() => ({ ...def, search: search.trim() }), [def, scope, search])
  React.useEffect(() => {
    if (scope === 'saved' || settings.displayQuery.search === search.trim()) return
    const timer = setTimeout(() => { void patchSettings({ displayQuery: { ...defRef.current, search: search.trim() } }) }, 350)
    return () => clearTimeout(timer)
  }, [search, scope, settings.displayQuery.search])

  React.useEffect(() => {
    if (scopeRef.current === scope) return
    scopeRef.current = scope
    setDef(d => ({ ...d, scope: scope === 'saved' ? 'saved' : settings.displayQuery.scope }))
    setLimit(PAGE)
    setPendingNew([])
  }, [scope])

  React.useEffect(() => {
    if (scope !== 'saved' && JSON.stringify(defRef.current) !== JSON.stringify(settings.displayQuery)) {
      setDef(settings.displayQuery)
      setPendingNew([])
    }
  }, [JSON.stringify(settings.displayQuery)])

  const applyDefinition = (d: FilterDefinition): void => {
    if (d.search !== search) onSearch(d.search)
    setDef(d)
    setLimit(PAGE)
    setPendingNew([])
    if (scope !== 'saved') void patchSettings({ displayQuery: d })
  }

  const fetchPage = React.useCallback(async (d: FilterDefinition, lim: number, off: number, my: number) => {
    const accumulated: ProjectWithUser[] = []
    let totalCount = 0, unreadCount = 0
    for (let offset = off; offset < off + lim; offset += 200) {
      const r = await rased.queryProjectsPage(d, Math.min(200, off + lim - offset), offset)
      if (gen.current !== my) return
      totalCount = r.total; unreadCount = r.unread
      accumulated.push(...r.rows)
      if (offset + r.rows.length >= r.total || r.rows.length === 0) break
    }
    setRows(accumulated)
    setTotal(totalCount)
    setUnread(unreadCount)
    setLoading(false)
  }, [])

  // initial load + reload on query change (generation-guarded).
  // Deps are intentionally the serialized query + limit (fetchPage is stable).
  React.useEffect(() => {
    const my = ++gen.current
    if (rowsRef.current.length) restoreRef.current = captureAnchor()
    setLoading(rowsRef.current.length === 0)
    setPendingNew([])
    void fetchPage(fullDef, limit, 0, my).catch(err => { if (gen.current === my) { setActionError(String(err)); setLoading(false) } })
  }, [JSON.stringify(fullDef), limit, fetchPage])

  React.useLayoutEffect(() => {
    const saved = restoreRef.current
    const el = listRef.current
    if (!el || !saved || loading) return
    const anchor = saved.id ? el.querySelector<HTMLElement>(`[data-row="${saved.id}"]`) : null
    if (anchor && saved.offset !== undefined) el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset
    else el.scrollTop = saved.scrollTop
    restoreRef.current = null
  }, [rows, loading])

  // persist memory for return navigation
  React.useEffect(() => {
    const id = setTimeout(() => {
      onMemory({ def, limit, scrollTop: listRef.current?.scrollTop ?? 0, selectedId })
    }, 400)
    return () => clearTimeout(id)
  }, [def, limit, selectedId, onMemory])

  React.useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < 1100)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Background updates preserve the visible row anchor. New arrivals stay
  // outside the loaded window until explicitly revealed (or auto-reveal at top).
  React.useEffect(() => {
    let alive = true
    let serial = Promise.resolve()
    const off = rased.onProjectsChanged((e) => {
      serial = serial.then(async () => {
        if (!alive) return
        const my = gen.current
        const d = { ...defRef.current, search: liveRef.current.search.trim() }
        const matched: number[] = []
        for (const id of e.newIds) {
          const p = await rased.getProject(id)
          if (p && matchesDefinition(p, d)) matched.push(id)
        }
        if (!alive || my !== gen.current) return
        if (matched.length && ((!listRef.current || listRef.current.scrollTop <= 120) && liveRef.current.autoReveal || rowsRef.current.length === 0)) {
          restoreRef.current = { scrollTop: 0 }
          setPendingNew([])
          await fetchPage(d, liveRef.current.limit, 0, my)
          return
        }
        if (matched.length) setPendingNew(prev => [...new Set([...prev, ...matched.filter(id => !rowsRef.current.some(p => p.id === id))])])
        if (e.changedIds.length) {
          const updates = await Promise.all(e.changedIds.map(id => rased.getProject(id)))
          if (!alive || my !== gen.current) return
          restoreRef.current = captureAnchor()
          const byId = new Map(updates.filter((p): p is NonNullable<typeof p> => p !== null).map(p => [p.id, p]))
          const removed = new Set(e.changedIds.filter(id => !byId.has(id)))
          setRows(prev => prev.filter(p => !removed.has(p.id)).map(p => byId.get(p.id) ?? p).filter(p => matchesDefinition(p, d)))
          setPendingNew(prev => prev.filter(id => !e.changedIds.includes(id) || !!byId.get(id) && matchesDefinition(byId.get(id)!, d)))
        }
        const counts = await rased.previewFilterCount(d)
        if (alive && my === gen.current) { setTotal(counts.total); setUnread(counts.unread) }
      }).catch(err => { if (alive) setActionError(String(err)) })
    })
    return () => { alive = false; off() }
  }, [fetchPage])

  const openDetail = React.useCallback((id: number) => {
    onMemory({ def: { ...defRef.current, search }, limit, scrollTop: listRef.current?.scrollTop ?? 0, selectedId: id })
    go({ name: 'project', id })
  }, [limit, search, onMemory])

  const openExternal = React.useCallback(async (id: number) => {
    try {
      const result = await rased.openProjectExternal(id)
      setActionError(result.ok ? null : (lang === 'ar' ? 'تعذر فتح المتصفح: ' : 'Could not open browser: ') + result.error)
    } catch (err) { setActionError(String(err)) }
  }, [lang])

  const toggleSave = React.useCallback(async (p: ProjectWithUser) => {
    await rased.updateProjectUserState(p.id, { saved: !p.saved })
  }, [])

  const toggleCat = (slug: string): void => {
    const cur = def.categoryFilter
    const cats = cur.categories.includes(slug) ? cur.categories.filter((c) => c !== slug) : [...cur.categories, slug]
    applyDefinition({ ...fullDef, categoryFilter: { ...cur, mode: cats.length > 0 ? 'selected' : 'all', categories: cats } })
    setLimit(PAGE)
  }

  const activeFilterCount =
    (def.source !== 'all' ? 1 : 0) +
    (def.categoryFilter.mode === 'selected' ? def.categoryFilter.categories.length : 0) +
    def.categoryFilter.keywordsAny.length +
    def.categoryFilter.keywordsAll.length +
    def.categoryFilter.excludeKeywords.length +
    (def.statuses.length > 0 ? 1 : 0) +
    (def.budgetMin !== null || def.budgetMax !== null ? 1 : 0) +
    (def.scope !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0) + (def.unreadOnly ? 1 : 0) + (!def.includeUnknownBudget ? 1 : 0)

  const showBanner = health && (health.state === 'paused' || health.state === 'error' || health.state === 'needs-review' || health.state === 'backing-off' || health.state === 'offline')
  const bannerText =
    health?.state === 'paused' ? t.pausedBanner : health?.state === 'needs-review' ? t.reviewBanner : health?.state === 'backing-off' ? t.backoffBanner : health?.state === 'offline' ? t.offlineCached : t.errorBanner
  const bannerClass = health?.state === 'paused' || health?.state === 'backing-off' ? 'banner' : 'banner bad'

  const selected = rows.find((r) => r.id === selectedId) ?? null
  const showPreview = settings.ui.previewOpen && selected && !narrow
  const showOverlay = !!(settings.ui.previewOpen && selected && narrow)
  const overlayRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(overlayRef, showOverlay)
  React.useEffect(() => {
    if (!settings.ui.previewOpen || selectedId === null) return
    const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSelectedId(null) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [settings.ui.previewOpen, selectedId])

  // preview width via CSS var (no inline styles; CSP-safe). Drag updates the
  // var imperatively; only drop persists the ratio to settings.
  React.useEffect(() => {
    splitRef.current?.style.setProperty('--preview-ratio', String(settings.ui.previewRatio))
  }, [settings.ui.previewRatio])

  const startPreviewDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const container = splitRef.current
    if (!container) return
    const rtl = document.documentElement.dir === 'rtl'
    const move = (ev: MouseEvent): void => {
      const box = container.getBoundingClientRect()
      const px = rtl ? box.right - ev.clientX : ev.clientX - box.left
      const ratio = Math.min(0.6, Math.max(0.25, 1 - px / Math.max(1, box.width)))
      container.style.setProperty('--preview-ratio', String(ratio))
      container.dataset['dragRatio'] = String(ratio)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const r = Number(container.dataset['dragRatio'])
      if (Number.isFinite(r)) void patchSettings({ ui: { ...settings.ui, previewRatio: r } })
      delete container.dataset['dragRatio']
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  };
  const resizeKey = (e: React.KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const step = (e.key === 'ArrowLeft' ? 0.05 : -0.05) * (lang === 'ar' ? -1 : 1)
    const ratio = e.key === 'Home' ? 0.25 : e.key === 'End' ? 0.6 : Math.min(0.6, Math.max(0.25, settings.ui.previewRatio + step))
    void patchSettings({ ui: { ...settings.ui, previewRatio: ratio } })
  }

  const onListKey = (e: React.KeyboardEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, select, [contenteditable], article')) return
    if (e.key === 'Escape') { setSelectedId(null); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = rows.findIndex((r) => r.id === selectedId)
      const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1)
      const row = rows[next]
      if (row) {
        setSelectedId(row.id)
        document.querySelector(`[data-row="${row.id}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    } else if (e.key === 'Enter' && selectedId !== null) {
      if (e.ctrlKey || e.metaKey) void openExternal(selectedId)
      else openDetail(selectedId)
    } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && selected) {
      e.preventDefault()
      void toggleSave(selected)
    }
  }

  return (
    <div className="split" ref={splitRef}>
      <div className="list-pane">
        {actionError && <div className="banner bad" role="alert">{actionError}</div>}
        {showBanner && <div className={bannerClass}>{bannerText}</div>}
        {settings.khamsatEnabled && def.source !== 'mostaql' && khamsatHealth && ['error', 'backing-off'].includes(khamsatHealth.state) && (
          <div className="banner warn">{lang === 'ar' ? 'رصد خمسات متعطل مؤقتًا؛ سيُعاد الفحص تلقائيًا.' : 'Khamsat monitoring is temporarily unavailable; it will retry automatically.'}</div>
        )}
        <div className="list-scroll" ref={listRef} onKeyDown={onListKey} tabIndex={0} aria-label={scope === 'saved' ? t.navSaved : t.allProjects}
          onScroll={() => { onMemory({ def: fullDef, limit, scrollTop: listRef.current?.scrollTop ?? 0, selectedId }) }}
        >
          <div className="chips">
            {(['all', 'mostaql', 'khamsat'] as const).map(source => (
              <button key={source} className={def.source === source ? 'chip active' : 'chip'} aria-pressed={def.source === source} onClick={() => applyDefinition(source === 'khamsat' ? { ...fullDef, source, categoryFilter: { ...def.categoryFilter, mode: 'all', categories: [] }, budgetMin: null, budgetMax: null, includeUnknownBudget: true } : { ...fullDef, source })}>
                {source === 'all' ? (lang === 'ar' ? 'كل المصادر' : 'All sources') : source === 'mostaql' ? (lang === 'ar' ? 'مستقل' : 'Mostaql') : (lang === 'ar' ? 'خمسات' : 'Khamsat')}
              </button>
            ))}
            <button className={def.categoryFilter.mode === 'all' ? 'chip active' : 'chip'} onClick={() => { applyDefinition({ ...fullDef, categoryFilter: { ...def.categoryFilter, mode: 'all', categories: [] } }); setLimit(PAGE) }}>
              {t.allCategories}
            </button>
            {KNOWN_CATEGORIES.map((c) => {
              const on = def.categoryFilter.mode === 'selected' && def.categoryFilter.categories.includes(c.slug)
              return (
                <button key={c.slug} className={on ? 'chip active' : 'chip'} aria-pressed={on} onClick={() => toggleCat(c.slug)}>
                  {lang === 'ar' ? c.ar : c.en}
                </button>
              )
            })}
            <button className="chip" onClick={() => setDrawer(true)}>
              <Icon name="filter" size={15} /> {t.filters}
              {activeFilterCount > 0 && <span className="num">({activeFilterCount})</span>}
            </button>
            <select
              className="select"
              aria-label={t.sortTitle}
              value={def.sort}
              onChange={(e) => { applyDefinition({ ...fullDef, sort: e.target.value as FilterDefinition['sort'] }); setLimit(PAGE) }}
            >
              <option value="latestDetected">{t.sortDetected}</option>
              <option value="latestPublished">{t.sortPublished}</option>
            </select>
          </div>

          <div className="list-head">
            <strong>{scope === 'saved' ? t.navSaved : t.allProjects}</strong>
            <span>
              {unread} {t.unreadCount}
            </span>
            <span className="num">{total} {t.projectsUnit}</span>
          </div>

          {pendingNew.length > 0 && (
            <button
              className="pill"
              onClick={() => {
                setPendingNew([])
                restoreRef.current = { scrollTop: 0 }
                const my = ++gen.current
                void fetchPage(fullDef, limit, 0, my)
              }}
            >
              {fmt(t.newArrivals, { n: pendingNew.length })}
            </button>
          )}

          {loading ? (
            <SkeletonList lang={lang} rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={scope === 'saved' && activeFilterCount === 0 ? t.emptySaved : activeFilterCount === 0 ? t.emptyNone : t.emptyFilter}
              body={activeFilterCount === 0 ? t.firstRunHint : undefined}
              actions={<button className="btn" onClick={() => applyDefinition(defaultFilterDefinition())}>{t.clearFilter}</button>}
            />
          ) : (
            rows.map((p) => (
              <div key={p.id} data-row={p.id}>
                <ProjectRow
                  lang={lang}
                  project={p}
                  isNew={p.discoveryKind === 'live' && !p.readAt && Date.parse(p.firstSeenAt) >= sessionStart}
                  selected={p.id === selectedId}
                  onOpen={() => { setSelectedId(p.id); openDetail(p.id) }}
                  onPreview={() => { setSelectedId(p.id); void patchSettings({ ui: { ...settings.ui, previewOpen: true } }) }}
                  onToggleSave={() => void toggleSave(p)}
                  onOpenExternal={() => void openExternal(p.id)}
                />
              </div>
            ))
          )}
          {!loading && rows.length < total && (
            <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
              {t.loadMore} <span className="num">({rows.length}/{total})</span>
            </button>
          )}
        </div>
      </div>

      {showPreview && selected && (
        <div className="preview-pane">
          <PreviewPanel
            lang={lang}
            project={selected}
            onClose={() => void patchSettings({ ui: { ...settings.ui, previewOpen: false } })}
            onOpenDetail={() => openDetail(selected.id)}
            onOpenExternal={() => void openExternal(selected.id)}
            onToggleSave={() => void toggleSave(selected)}
            onResizeStart={startPreviewDrag}
            onResizeKey={resizeKey}
            ratio={settings.ui.previewRatio}
          />
        </div>
      )}
      {showOverlay && selected && (
        <>
          <div className="scrim" onClick={() => void patchSettings({ ui: { ...settings.ui, previewOpen: false } })} />
          <div ref={overlayRef} className="preview-pane overlay" role="dialog" aria-modal="true" aria-label={t.previewTitle}>
            <PreviewPanel
              lang={lang}
              project={selected}
              onClose={() => void patchSettings({ ui: { ...settings.ui, previewOpen: false } })}
              onOpenDetail={() => openDetail(selected.id)}
              onOpenExternal={() => void openExternal(selected.id)}
              onToggleSave={() => void toggleSave(selected)}
              onResizeStart={startPreviewDrag}
              onResizeKey={resizeKey}
            ratio={settings.ui.previewRatio}
            />
          </div>
        </>
      )}

      {drawer && (
        <FilterDrawer
          lang={lang}
          initial={def}
          notifyFilter={settings.notifyFilter}
          linked={settings.linkDisplayAndNotifyFilters}
          onToggleLink={(v) => void patchSettings({ linkDisplayAndNotifyFilters: v })}
          onApply={(d) => { applyDefinition(d); setDrawer(false) }}
          onSave={(name, d) => {
            void rased.createSavedFilter(name, d).then(() => setDrawer(false))
          }}
          onClose={() => setDrawer(false)}
        />
      )}
    </div>
  )
}

function PreviewPanel({
  lang,
  project: p,
  onClose,
  onOpenDetail,
  onOpenExternal,
  onToggleSave,
  onResizeStart,
  onResizeKey,
  ratio
}: {
  lang: Lang
  project: ProjectWithUser
  onClose: () => void
  onOpenDetail: () => void
  onOpenExternal: () => void
  onToggleSave: () => void
  onResizeStart: (e: React.MouseEvent) => void
  onResizeKey: (e: React.KeyboardEvent) => void
  ratio: number
}): React.ReactElement {
  const t = STRINGS[lang]
  const budget = budgetLabel(p.budgetMin, p.budgetMax)
  return (
    <>
      <div className="list-head">
        <strong>{t.previewTitle}</strong>
        <span className="grow" />
        <IconBtn name="x" title={t.overlayClose} onClick={onClose} />
      </div>
      <div className="detail-wrap">
        <h2 className="clamp-2" dir="auto">
          {p.title}
        </h2>
        <div className="meta">
          <span className="tag">{p.source === 'khamsat' ? (lang === 'ar' ? 'خمسات' : 'Khamsat') : (lang === 'ar' ? 'مستقل' : 'Mostaql')}</span>
          {p.source !== 'khamsat' && <CategoryTag lang={lang} slug={p.categorySlug} confirmed={p.categoryConfirmed} />}
          {p.source !== 'khamsat' && budget && <span className="tag num" dir="ltr">{budget}</span>}
          <span>
            {t.publishedAt}: {timeAgo(p.publishedAt, lang)}
          </span>
        </div>
        {p.descriptionExcerpt && (
          <p className="muted" dir="auto">
            {p.descriptionExcerpt.slice(0, 400)}
          </p>
        )}
        {p.skills && p.skills.length > 0 && (
          <div className="chips">
            {p.skills.slice(0, 8).map((s) => (
              <span key={s} className="tag" dir="auto">
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="row-actions">
          <button className="btn primary sm" onClick={onOpenDetail}>
            {t.projectDetails}
          </button>
          <button className="btn sm" onClick={onOpenExternal}>
            {t.openExternal}
          </button>
          <button className="btn sm ghost" onClick={onToggleSave}>
            {p.saved ? t.unsaveProject : t.saveProject}
          </button>
        </div>
        <div className="faint small">{t.previewResizeHint}</div>
        <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label={t.previewResizeHint} aria-valuemin={25} aria-valuemax={60} aria-valuenow={Math.round(ratio * 100)} onMouseDown={onResizeStart} onKeyDown={onResizeKey} tabIndex={0} />
      </div>
    </>
  )
}
