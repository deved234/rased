import React from 'react'
import type { Lang } from '../i18n.js'
import { STRINGS } from '../i18n.js'
import { rased } from '../api.js'
import type { WatchCounts, WatchListResult, WatchListRow } from '../../shared/api.js'
import { WATCH_ENABLED, WATCH_SOURCES } from '../../shared/projectWatch.js'
import { sourceName } from '../sourceCopy.js'
import { timeAgo } from '../format.js'
import { EmptyState, SkeletonList } from '../components/ui.js'
import { WatchButton } from '../components/WatchButton.js'
import {
  canWatchAgain,
  watchFactsLines,
  watchFocusTarget,
  watchPlatformCounter
} from '../components/watchUi.js'

export interface WatchMemory {
  scrollTop: number
  projectId: number | null
}

export interface WatchingViewProps {
  lang: Lang
  memory?: WatchMemory
  onOpenProject: (id: number) => void
}

export function WatchingView({ lang, memory, onOpenProject }: WatchingViewProps): React.ReactElement {
  const t = STRINGS[lang]
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const mountedRef = React.useRef(true)
  const generation = React.useRef(0)
  const firstLoadRestoredRef = React.useRef(false)
  const hasLoadedDataRef = React.useRef(false)
  const pendingFocusRef = React.useRef<{ id: number; kind: 'title' | 'button' } | null>(null)
  const focusHeadingAfterRefreshRef = React.useRef(false)

  const [loading, setLoading] = React.useState(true)
  const [initialError, setInitialError] = React.useState(false)
  const [refreshError, setRefreshError] = React.useState(false)
  const [counts, setCounts] = React.useState<WatchCounts | null>(null)
  const [rows, setRows] = React.useState<WatchListRow[]>([])
  const [dataVersion, setDataVersion] = React.useState(0)

  const handleScroll = (): void => {
    if (memory && scrollContainerRef.current) {
      memory.scrollTop = scrollContainerRef.current.scrollTop
    }
  }

  const handleOpenProject = (id: number): void => {
    if (memory) {
      memory.projectId = id
    }
    onOpenProject(id)
  }

  const load = React.useCallback(async () => {
    if (!WATCH_ENABLED) {
      setLoading(false)
      return
    }
    const my = ++generation.current
    try {
      const [countsRes, listRes] = await Promise.all([
        rased.watchCounts(),
        rased.watchList()
      ])
      if (!mountedRef.current || my !== generation.current) return
      if (
        !countsRes ||
        ('ok' in countsRes && !countsRes.ok) ||
        !listRes ||
        ('ok' in listRes && !(listRes as { rows?: unknown }).rows)
      ) {
        if (hasLoadedDataRef.current) {
          setRefreshError(true)
        } else {
          setInitialError(true)
        }
        return
      }

      const newRows = (listRes as WatchListResult).rows
      const newCounts = countsRes as WatchCounts

      const activeEl = document.activeElement
      const focusedRow = activeEl?.closest<HTMLElement>('[data-watch-project-id]')
      const recordedId = focusedRow ? Number(focusedRow.dataset.watchProjectId) : null
      const isButton = Boolean(activeEl?.matches('button[aria-pressed]') || activeEl?.closest('button[aria-pressed]'))
      const isTitle = Boolean(activeEl?.hasAttribute('data-watch-title') || activeEl?.closest('[data-watch-title]'))
      const recordedKind: 'title' | 'button' | null = isButton ? 'button' : isTitle ? 'title' : null
      pendingFocusRef.current = recordedId !== null && recordedKind !== null
        ? { id: recordedId, kind: recordedKind }
        : null
      // The Retry banner disappears on success; keep keyboard focus inside the screen.
      focusHeadingAfterRefreshRef.current = Boolean(activeEl?.closest('.watch-refresh-error-banner'))

      hasLoadedDataRef.current = true
      setCounts(newCounts)
      setRows(newRows)
      setInitialError(false)
      setRefreshError(false)
      setDataVersion(v => v + 1)
    } catch {
      if (mountedRef.current && my === generation.current) {
        if (hasLoadedDataRef.current) {
          setRefreshError(true)
        } else {
          setInitialError(true)
        }
      }
    } finally {
      if (mountedRef.current && my === generation.current) {
        setLoading(false)
      }
    }
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      generation.current++
      if (memory && scrollContainerRef.current) {
        memory.scrollTop = scrollContainerRef.current.scrollTop
      }
    }
  }, [load, memory])

  React.useEffect(() => {
    if (!WATCH_ENABLED) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = 0
    const off = rased.onProjectsChanged(() => {
      generation.current++
      if (!first) first = Date.now()
      clearTimeout(timer)
      timer = setTimeout(() => {
        first = 0
        void load()
      }, Math.min(100, Math.max(0, 300 - (Date.now() - first))))
    })
    return () => {
      generation.current++
      clearTimeout(timer)
      off()
    }
  }, [load])

  React.useLayoutEffect(() => {
    if (!firstLoadRestoredRef.current) {
      if (counts !== null || rows.length > 0) {
        firstLoadRestoredRef.current = true
        if (memory && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = memory.scrollTop
        }
        const active = document.activeElement
        const userMovedFocus = !!active && active !== document.body && !scrollContainerRef.current?.contains(active)
        if (memory?.projectId != null && !userMovedFocus) {
          const targetId = memory.projectId
          const exists = rows.some(r => r.projectId === targetId)
          if (exists) {
            const btn = scrollContainerRef.current?.querySelector<HTMLButtonElement>(
              `[data-watch-project-id="${targetId}"] [data-watch-title]`
            )
            btn?.focus({ preventScroll: true })
          }
        }
        pendingFocusRef.current = null
      }
      return
    }

    if (focusHeadingAfterRefreshRef.current) {
      focusHeadingAfterRefreshRef.current = false
      const active = document.activeElement
      if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true })
    }

    if (pendingFocusRef.current) {
      const { id, kind } = pendingFocusRef.current
      pendingFocusRef.current = null

      const active = document.activeElement
      const inside = scrollContainerRef.current && active && scrollContainerRef.current.contains(active)
      if (!inside) {
        const presentIds = rows.map(r => r.projectId)
        const target = watchFocusTarget(id, kind, presentIds)
        if (target.kind === 'button' && target.id !== null) {
          const rowEl = scrollContainerRef.current?.querySelector(`[data-watch-project-id="${target.id}"]`)
          const btn = rowEl?.querySelector<HTMLButtonElement>('button[aria-pressed]') ??
                      rowEl?.querySelector<HTMLButtonElement>('[data-watch-title]')
          btn?.focus({ preventScroll: true })
        } else if (target.kind === 'title' && target.id !== null) {
          const titleBtn = scrollContainerRef.current?.querySelector<HTMLButtonElement>(
            `[data-watch-project-id="${target.id}"] [data-watch-title]`
          )
          titleBtn?.focus({ preventScroll: true })
        } else if (target.kind === 'heading') {
          headingRef.current?.focus({ preventScroll: true })
        }
      }
    }
  }, [dataVersion, rows, memory, counts])

  if (loading && !counts && rows.length === 0 && !initialError) {
    return (
      <div className="watching-view" role="status">
        <div className="watch-loading">
          <SkeletonList lang={lang} rows={6} />
        </div>
      </div>
    )
  }

  if (initialError && !hasLoadedDataRef.current) {
    return (
      <div className="watching-view" role="status">
        <div className="watch-error">
          <p>{lang === 'ar' ? 'تعذّر تحميل المتابعة' : 'Could not load watched projects'}</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setLoading(true)
              setInitialError(false)
              void load()
            }}
          >
            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  const activeRows = rows.filter(r => r.state === 'active')
  const waitingRows = rows.filter(r => r.state === 'waiting')
  const stoppedRows = rows.filter(r => r.state === 'stopped')
  const allEmpty = activeRows.length === 0 && waitingRows.length === 0 && stoppedRows.length === 0

  const renderRow = (row: WatchListRow, sectionKind: 'active' | 'waiting' | 'stopped'): React.ReactElement => {
    const facts = watchFactsLines(row, lang, timeAgo)
    return (
      <article
        className="row watch-row"
        key={row.projectId}
        data-watch-project-id={row.projectId}
        aria-label={row.project.title}
      >
        <div className="watch-row-main">
          <div className="watch-row-header">
            <h4 className="watch-row-title">
              <button
                type="button"
                className="project-title-button"
                data-watch-title
                dir="auto"
                onClick={() => handleOpenProject(row.projectId)}
              >
                <span className="t clamp-2">{row.project.title}</span>
              </button>
            </h4>
            <div className="watch-row-actions">
              {sectionKind !== 'stopped' ? (
                <WatchButton lang={lang} project={row.project} entry="watch_view" />
              ) : canWatchAgain(row.status) ? (
                <WatchButton lang={lang} project={row.project} entry="watch_view" offLabel={lang === 'ar' ? 'تابع من جديد' : 'Watch again'} />
              ) : null}
            </div>
          </div>
          <div className="meta watch-row-meta">
            <span className="tag">{sourceName(row.project.source, lang)}</span>
            {sectionKind === 'stopped' && row.project.hidden && (
              <span className="tag">{lang === 'ar' ? 'مخفي' : 'Hidden'}</span>
            )}
            {facts.map((fact, idx) => (
              <span key={idx} className="watch-fact-item">{fact}</span>
            ))}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div
      className="watching-view"
      ref={scrollContainerRef}
      onScroll={handleScroll}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <header className="watch-header">
        <h2 ref={headingRef} tabIndex={-1} className="watch-title">
          {t.navWatching}
        </h2>
        <div className="watch-platform-counters">
          {WATCH_SOURCES.map(source => {
            const info = counts?.[source]
            const text = watchPlatformCounter(source, info, lang)
            return (
              <span key={source} className="watch-platform-counter tag">
                {text}
              </span>
            )
          })}
        </div>
      </header>

      {refreshError && (
        <div className="watch-refresh-error-banner">
          <span role="status">
            {lang === 'ar' ? 'تعذّر تحديث المتابعة' : 'Could not refresh watched projects'}
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void load()
            }}
          >
            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      {allEmpty ? (
        <EmptyState
          title={
            lang === 'ar'
              ? 'لسه مفيش مشاريع تحت المتابعة. اضغط «متابعة» على أي مشروع من مستقل أو نفذلي أو كاف علشان يتابعه راصد ويبلغك لما حالته تتغير.'
              : 'No watched projects yet. Press Watch on any Mostaql, Nafezly or KAF project and RASED will tell you when it changes.'
          }
        />
      ) : (
        <div className="watch-sections">
          {activeRows.length > 0 && (
            <section className="watch-section" aria-label={lang === 'ar' ? 'تحت المتابعة' : 'Watching'}>
              <h3 className="watch-section-title">{lang === 'ar' ? 'تحت المتابعة' : 'Watching'}</h3>
              <div className="watch-section-rows">
                {activeRows.map(row => renderRow(row, 'active'))}
              </div>
            </section>
          )}

          {waitingRows.length > 0 && (
            <section className="watch-section" aria-label={lang === 'ar' ? 'بانتظار مكان' : 'Waiting for a slot'}>
              <h3 className="watch-section-title">{lang === 'ar' ? 'بانتظار مكان' : 'Waiting for a slot'}</h3>
              <div className="watch-section-rows">
                {waitingRows.map(row => renderRow(row, 'waiting'))}
              </div>
            </section>
          )}

          {stoppedRows.length > 0 && (
            <section className="watch-section" aria-label={lang === 'ar' ? 'توقفت مؤخرًا' : 'Stopped recently'}>
              <h3 className="watch-section-title">{lang === 'ar' ? 'توقفت مؤخرًا' : 'Stopped recently'}</h3>
              <div className="watch-section-rows">
                {stoppedRows.map(row => renderRow(row, 'stopped'))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
