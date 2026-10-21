import { MonitoringNotices } from '../components/SourceHealthDetails.js'
import React from 'react'
import { QuickApplyButton } from '../components/QuickApplyButton.js'
import { rased } from '../api.js'
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
import { openOnSource, platformStatusName, sourceName } from '../sourceCopy.js'
import { timeAgo } from '../format.js'
import { ProjectFactsPanel } from '../components/ProjectFacts.js'
import { isSearchSuperseded } from '@shared/searchReply.js'

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
  khamsatHealth,
  nafezlyHealth,
  kafHealth,
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
  khamsatHealth: SourceHealth | null
  nafezlyHealth: SourceHealth | null
  kafHealth: SourceHealth | null
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
  const [updating, setUpdating] = React.useState(false)
  const [showUpdating, setShowUpdating] = React.useState(false)
  const [filterBusy, setFilterBusy] = React.useState(false)
  const filterMutation = React.useRef(false)
  const [drawer, setDrawer] = React.useState(false)
  const [visibleTotal, setVisibleTotal] = React.useState(0)
  const ceilingRef = React.useRef<number | undefined>(undefined)
  const queryKeyRef = React.useRef('')
  const [selectedId, setSelectedId] = React.useState<number | null>(memory.selectedId)
  const [narrow, setNarrow] = React.useState(() => window.innerWidth < 900)
  const listRef = React.useRef<HTMLDivElement>(null)
  const splitRef = React.useRef<HTMLDivElement>(null)
  const gen = React.useRef(0)
  const scopeRef = React.useRef(scope)
  const restoreRef = React.useRef<{ id?: number; offset?: number; scrollTop: number } | null>({ scrollTop: memory.scrollTop })
  const previewAnchorRef = React.useRef<{ id?: number; offset?: number; scrollTop: number } | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [searchError, setSearchError] = React.useState(false)
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
  }, [scope])

  React.useEffect(() => {
    if (scope !== 'saved' && JSON.stringify(defRef.current) !== JSON.stringify(settings.displayQuery)) {
      setDef(settings.displayQuery)
    }
  }, [JSON.stringify(settings.displayQuery)])

  const applyDefinition = (d: FilterDefinition): void => {
    if (d.search !== search) onSearch(d.search)
    setDef(d)
    setLimit(PAGE)
    if (scope !== 'saved') void patchSettings({ displayQuery: d })
  }

  React.useEffect(() => {
    if (!updating) { setShowUpdating(false); return }
    const timer = setTimeout(() => setShowUpdating(true), 200)
    return () => clearTimeout(timer)
  }, [updating])

  const fetchPage = React.useCallback(async (d: FilterDefinition, lim: number, off: number, reveal = false) => {
    // Every invocation owns a generation, including a trailing live refresh.
    // Sharing a generation let an older cancelled request overwrite newer UI.
    const my = ++gen.current
    setUpdating(true)
    try {
      if (reveal) ceilingRef.current = undefined
      const accumulated: ProjectWithUser[] = []
      let totalCount = 0, unreadCount = 0, visibleCount = 0, revision: number | undefined, restarts = 0
      for (let offset = off; offset < off + lim; offset += 200) {
        const r = await rased.queryProjectsPage(d, Math.min(200, off + lim - offset), offset, { ceilingId: ceilingRef.current })
        if (gen.current !== my) return
        ceilingRef.current = r.ceilingId
        if (revision !== undefined && revision !== r.revision) {
          if (++restarts > 3) throw new Error('search-changing')
          accumulated.length = 0; revision = undefined; offset = off - 200; continue
        }
        revision = r.revision
        totalCount = r.total; unreadCount = r.unread
        visibleCount = r.visibleTotal ?? r.total
        accumulated.push(...r.rows)
        if (offset + r.rows.length >= visibleCount || r.rows.length === 0) break
      }
      setRows(accumulated)
      setTotal(totalCount)
      setUnread(unreadCount)
      setVisibleTotal(visibleCount)
      setLoading(false)
      setSearchError(false)
    } catch (error) {
      if (gen.current !== my || isSearchSuperseded(error)) return
      setSearchError(true)
      setLoading(false)
    } finally { if (gen.current === my) setUpdating(false) }
  }, [])

  // initial load + reload on query change (generation-guarded).
  // Deps are intentionally the serialized query + limit (fetchPage is stable).
  React.useEffect(() => {
    const key = JSON.stringify(fullDef)
    if (queryKeyRef.current !== key) { ceilingRef.current = undefined; queryKeyRef.current = key }
    if (rowsRef.current.length) restoreRef.current = captureAnchor()
    setLoading(rowsRef.current.length === 0)
    void fetchPage(fullDef, limit, 0)
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
    const onResize = (): void => setNarrow(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Background updates preserve the visible row anchor. New arrivals stay
  // outside the loaded window until explicitly revealed (or auto-reveal at top).
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, first = 0, arrivals = false
    const off = rased.onProjectsChanged(e => {
      arrivals ||= e.newIds.length > 0
      ++gen.current // Do not apply a response from before this committed change.
      if (!first) first = Date.now()
      clearTimeout(timer)
      timer = setTimeout(() => {
        first = 0
        const reveal = arrivals && ((!listRef.current || listRef.current.scrollTop <= 120) && liveRef.current.autoReveal || rowsRef.current.length === 0)
        arrivals = false
        restoreRef.current = captureAnchor()
        const d = { ...defRef.current, search: liveRef.current.search.trim() }
        void fetchPage(d, liveRef.current.limit, 0, reveal)
      }, Math.min(100, Math.max(0, 300 - (Date.now() - first))))
    })
    return () => { clearTimeout(timer); ++gen.current; off() }
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

  const openPreview = (id: number): void => {
    previewAnchorRef.current = captureAnchor()
    setSelectedId(id)
    if (!settings.ui.previewOpen) void patchSettings({ ui: { ...settings.ui, previewOpen: true } })
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

  const sourceHealth = { mostaql: health, khamsat: khamsatHealth, nafezly: nafezlyHealth, kaf: kafHealth }
  const selected = rows.find((r) => r.id === selectedId) ?? null
  const showPreview = settings.ui.previewOpen && selected && !narrow
  const showOverlay = !!(settings.ui.previewOpen && selected && narrow)
  React.useLayoutEffect(() => {
    const saved = previewAnchorRef.current
    const el = listRef.current
    if (!saved || !el || (!showPreview && !showOverlay)) return
    const anchor = saved.id ? el.querySelector<HTMLElement>(`[data-row="${saved.id}"]`) : null
    if (anchor && saved.offset !== undefined) el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset
    else el.scrollTop = saved.scrollTop
    previewAnchorRef.current = null
  }, [showPreview, showOverlay, selectedId])
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
      const ratio = Math.min(0.6, Math.max(0.25, px / Math.max(1, box.width)))
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
    const step = (e.key === 'ArrowLeft' ? 0.05 : -0.05) * (lang === 'ar' ? 1 : -1)
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
      else openPreview(selectedId)
    } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && selected) {
      e.preventDefault()
      void toggleSave(selected)
    }
  }

  return (
    <div className="split" ref={splitRef}>
      <div className="list-pane">
        {actionError && <div className="banner bad" role="alert">{actionError}</div>}
        {searchError && <div className="banner bad" role="alert">{lang === 'ar' ? 'تعذر تحديث النتائج. النتائج السابقة قد تكون قديمة.' : 'Could not update results. Previous results may be stale.'} <button className="btn sm" onClick={() => { void fetchPage(fullDef, limit, 0) }}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div>}
        <MonitoringNotices source={def.source} health={sourceHealth} settings={settings} lang={lang} />
        <div className={showUpdating ? 'small muted search-progress active' : 'small muted search-progress'} role="status">{showUpdating ? (lang === 'ar' ? 'جارٍ تحديث نتائج البحث…' : 'Updating search results…') : '\u00a0'}</div>
        {def.source === 'all' && def.categoryFilter.mode === 'selected' && <div className="banner">{t.filterCategoryScope}</div>}
        <div className="list-toolbar">
          <div className="source-segment" role="group" aria-label={t.filterSource}>
            {(['all', 'mostaql', 'khamsat', 'nafezly', 'kaf'] as const).map(source => (
              <button key={source} className={def.source === source ? 'source-option active' : 'source-option'} aria-pressed={def.source === source} onClick={() => applyDefinition(source === 'khamsat' || source === 'nafezly' || source === 'kaf' ? { ...fullDef, source, categoryFilter: { ...def.categoryFilter, mode: 'all', categories: [] }, ...(source === 'kaf' ? {} : { budgetMin: null, budgetMax: null, includeUnknownBudget: true }) } : { ...fullDef, source })}>
                {source === 'all' ? (lang === 'ar' ? 'كل المصادر' : 'All sources') : source === 'mostaql' ? t.sourceMostaql : source === 'khamsat' ? t.sourceKhamsat : source === 'kaf' ? t.sourceKaf : t.sourceNafezly}
              </button>
            ))}
          </div>
          <button className={def.unreadOnly ? 'chip active' : 'chip'} aria-pressed={def.unreadOnly} onClick={() => applyDefinition({ ...fullDef, unreadOnly: !def.unreadOnly })}>{t.navUnread}</button>
          <select
            className="select"
            aria-label={t.sortTitle}
            value={def.sort}
            onChange={(e) => { applyDefinition({ ...fullDef, sort: e.target.value as FilterDefinition['sort'] }); setLimit(PAGE) }}
          >
            <option value="latestDetected">{t.sortDetected}</option>
            <option value="latestPublished">{t.sortPublished}</option>
          </select>
          <button className="chip filter-trigger" onClick={() => setDrawer(true)}>
              <Icon name="filter" size={15} /> {t.filters}
              {activeFilterCount > 0 && <span className="num">({activeFilterCount})</span>}
          </button>
        </div>
        <div className="list-scroll" ref={listRef} onKeyDown={onListKey} tabIndex={0} aria-busy={loading || updating} aria-label={scope === 'saved' ? t.navSaved : t.allProjects}
          onScroll={() => { onMemory({ def: fullDef, limit, scrollTop: listRef.current?.scrollTop ?? 0, selectedId }) }}
        >

          <div className="list-head">
            <strong>{scope === 'saved' ? t.navSaved : t.allProjects}</strong>
            <span>
              {unread} {t.unreadCount}
            </span>
            <span className="num">{total} {t.projectsUnit}</span>
          </div>

          {total > visibleTotal && (
            <button
              className="pill"
              onClick={() => {
                restoreRef.current = { scrollTop: 0 }
                void fetchPage(fullDef, limit, 0, true)
              }}
            >
              {fmt(t.newArrivals, { n: total - visibleTotal })}
            </button>
          )}

          {loading ? (
            <SkeletonList lang={lang} rows={6} />
          ) : !searchError && rows.length === 0 ? (
            <EmptyState
              title={scope === 'saved' && activeFilterCount === 0 ? t.emptySaved : activeFilterCount === 0 ? t.emptyNone : t.emptyFilter}
              body={activeFilterCount === 0 ? t.firstRunHint : undefined}
              actions={<button className="btn" onClick={() => applyDefinition(defaultFilterDefinition())}>{t.clearFilter}</button>}
            />
          ) : (
            rows.map((p) => (
              <div key={p.id} data-row={p.id}>
                {!!p.matchedFields?.length && <div className="small muted">{lang === 'ar' ? 'تطابق في: ' : 'Matched in: '}{p.matchedFields.map(field => ({ title: lang === 'ar' ? 'العنوان' : 'title', excerpt: lang === 'ar' ? 'المقتطف' : 'excerpt', skills: lang === 'ar' ? 'المهارات' : 'skills', body: lang === 'ar' ? 'الوصف المحفوظ' : 'cached description', note: lang === 'ar' ? 'ملاحظاتي' : 'my notes', draft: lang === 'ar' ? 'مسودة العرض' : 'proposal draft' })[field]).join('، ')}</div>}
                <ProjectRow
                  lang={lang}
                  project={p}
                  isNew={p.discoveryKind === 'live' && !p.readAt && Date.parse(p.firstSeenAt) >= sessionStart}
                  selected={p.id === selectedId}
                  onPreview={() => openPreview(p.id)}
                  onToggleSave={() => void toggleSave(p)}
                  onOpenExternal={() => void openExternal(p.id)}
                />
              </div>
            ))
          )}
          {!loading && rows.length < visibleTotal && (
            <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
              {t.loadMore} <span className="num">({rows.length}/{visibleTotal})</span>
            </button>
          )}
        </div>
      </div>

      {showPreview && selected && (
        <div className="preview-pane">
          <PreviewPanel
            lang={lang}
            project={selected}
            onClose={() => { void patchSettings({ ui: { ...settings.ui, previewOpen: false } }).then(() => document.querySelector<HTMLElement>(`[data-row="${selected.id}"] .project-title-button`)?.focus()).catch(() => setActionError(lang === 'ar' ? 'تعذر حفظ إعداد المعاينة.' : 'Could not save preview preference.')) }}
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
              onClose={() => { void patchSettings({ ui: { ...settings.ui, previewOpen: false } }).then(() => document.querySelector<HTMLElement>(`[data-row="${selected.id}"] .project-title-button`)?.focus()).catch(() => setActionError(lang === 'ar' ? 'تعذر حفظ إعداد المعاينة.' : 'Could not save preview preference.')) }}
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
          busy={filterBusy}
          error={!!actionError}
          initial={def}
          notifyFilter={settings.notifyFilter}
          linked={settings.linkDisplayAndNotifyFilters}
          onToggleLink={(v) => void patchSettings({ linkDisplayAndNotifyFilters: v })}
          onApply={(d) => { applyDefinition(d); setDrawer(false) }}
          onSave={(name, d) => {
            if (filterMutation.current) return
            filterMutation.current = true; setFilterBusy(true); setActionError(null)
            void rased.createSavedFilter(name, d).then(() => setDrawer(false)).catch(() => setActionError(lang === 'ar' ? 'تعذر حفظ الفلتر. أعد المحاولة.' : 'Could not save the filter. Retry.')).finally(() => { filterMutation.current = false; setFilterBusy(false) })
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
          <span className="tag">{sourceName(p.source, lang)}</span>
          {p.source === 'mostaql' && <CategoryTag lang={lang} slug={p.categorySlug} confirmed={p.categoryConfirmed} />}
          {p.source === 'kaf' && <span className="tag" title={lang === 'ar' ? 'حالة المنصة' : 'Platform status'}>{platformStatusName(p.platformStatus, lang)}</span>}
        </div>
        <div className="preview-facts">
          <div className="fact"><span className="k">{t.factsDiscovered}</span><span className="v">{timeAgo(p.firstSeenAt, lang)}</span></div>
          {p.publishedAt && <div className="fact"><span className="k">{t.factsPublished}</span><span className="v">{timeAgo(p.publishedAt, lang)}</span></div>}
          <ProjectFactsPanel key={p.id} project={p} lang={lang} />
        </div>
        <h3 className="preview-section-title">{t.descriptionTitle}</h3>
        {p.source !== 'khamsat' && p.descriptionExcerpt && (
          <p className="muted preview-excerpt" dir="auto">
            {p.descriptionExcerpt.slice(0, 400)}
          </p>
        )}
        {(p.source === 'khamsat' || !p.descriptionExcerpt) && <p className="muted preview-excerpt">{p.source === 'khamsat' ? t.previewKhamsatDescription : t.detailsUnavailable}</p>}
        {p.skills && p.skills.length > 0 && (
          <div className="chips">
            {p.skills.slice(0, 8).map((s) => (
              <span key={s} className="tag" dir="auto">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="preview-footer">
        <div className="row-actions">
          <QuickApplyButton id={p.id} source={p.source} lang={lang}/>
          <button className="btn primary sm" onClick={onOpenDetail}>
            {t.previewFullDetails}
          </button>
          <button className="btn sm" onClick={onOpenExternal}>
            {openOnSource(p.source, lang)}
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
