import React from 'react'
import type { ProjectWithUser } from '../../shared/types.js'
import type { WatchOrigin, WatchSource } from '../../shared/projectWatch.js'
import type { WatchListRow } from '../../shared/api.js'
import { rased } from '../api.js'
import { timeAgo } from '../format.js'
import { useDialogFocus } from './ui.js'
import { replaceSelectionAfterReload, sortReplaceCandidates } from './watchUi.js'

export interface WatchReplaceDialogProps {
  lang: 'ar' | 'en'
  project: ProjectWithUser
  waitingVersion: number
  entry: WatchOrigin
  onClose: () => void
}

export function WatchReplaceDialog({
  lang,
  project,
  waitingVersion,
  entry,
  onClose
}: WatchReplaceDialogProps): React.ReactElement {
  const [candidates, setCandidates] = React.useState<WatchListRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)
  const [selectedVictimId, setSelectedVictimId] = React.useState<number | null>(null)

  const panelRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef)

  const source = project.source as WatchSource

  const loadCandidates = React.useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await rased.watchList({ source })
      if (res && 'rows' in res) {
        const activeOnly = res.rows.filter((r: WatchListRow) => r.state === 'active' && r.projectId !== project.id)
        const sorted = sortReplaceCandidates(activeOnly)
        setCandidates(sorted)
        setSelectedVictimId(prev => replaceSelectionAfterReload(prev, sorted))
      } else {
        setLoadError(true)
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [source, project.id])

  React.useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, busy])

  const handleSwap = async (): Promise<void> => {
    if (selectedVictimId === null || busy) return
    const victim = candidates.find(c => c.projectId === selectedVictimId)
    if (!victim) return

    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await rased.watchReplace({
        projectId: project.id,
        victimId: victim.projectId,
        expectVersions: {
          project: waitingVersion,
          victim: victim.version
        },
        entry
      })
      if (res && res.ok) {
        onClose()
      } else {
        setErrorMsg(lang === 'ar' ? 'تعذّر إتمام الاستبدال، حاول مجددًا' : 'Could not complete swap. Try again.')
        void loadCandidates()
      }
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذّر إتمام الاستبدال، حاول مجددًا' : 'Could not complete swap. Try again.')
      void loadCandidates()
    } finally {
      setBusy(false)
    }
  }

  const title = lang === 'ar' ? 'المبادلة بمشروع آخر' : 'Swap with another project'
  const hintText = lang === 'ar' ? 'الإلغاء يسيب المشروع في الانتظار' : 'Cancel keeps the project waiting'
  const hasSelectedVictim = selectedVictimId !== null && candidates.some(c => c.projectId === selectedVictimId)

  return (
    <>
      <div className="scrim" onClick={() => { if (!busy) onClose() }} />
      <div ref={panelRef} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {errorMsg && <p role="status" className="field-err small">{errorMsg}</p>}
        {loading ? (
          <p className="muted small">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>
        ) : loadError ? (
          <div className="watch-load-error">
            <p className="field-err small" role="alert">
              {lang === 'ar' ? 'تعذّر تحميل المشاريع المتابَعة' : 'Could not load watched projects.'}
            </p>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void loadCandidates()}>
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="muted small">{lang === 'ar' ? 'لا توجد مشاريع أخرى للمبادلة' : 'No other projects to swap'}</p>
        ) : (
          <div className="watch-replace-list" role="radiogroup" aria-label={title}>
            {candidates.map((c) => {
              const changeDate = c.lastChangedAt ?? c.startedAt
              const timeText = changeDate ? timeAgo(changeDate, lang) : '—'
              const lastChangeLabel = lang === 'ar' ? `آخر تغيير: ${timeText}` : `Last change: ${timeText}`
              const isChecked = selectedVictimId === c.projectId

              return (
                <label
                  key={c.projectId}
                  className={`watch-replace-item${isChecked ? ' selected' : ''}`}
                  htmlFor={`replace-victim-${c.projectId}`}
                >
                  <input
                    type="radio"
                    id={`replace-victim-${c.projectId}`}
                    name="replace-victim"
                    value={c.projectId}
                    checked={isChecked}
                    disabled={busy}
                    onChange={() => setSelectedVictimId(c.projectId)}
                  />
                  <div className="watch-replace-item-body">
                    <span className="watch-replace-item-title">{c.project.title}</span>
                    <div className="meta">
                      {c.project.personalStatus === 'submitted' && (
                        <span className="tag good">{lang === 'ar' ? 'قدّمت' : 'Submitted'}</span>
                      )}
                      <span className="faint">{lastChangeLabel}</span>
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
        <p className="hint small muted">{hintText}</p>
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || loading || loadError || !hasSelectedVictim}
            onClick={() => void handleSwap()}
          >
            {lang === 'ar' ? 'بدّل' : 'Swap'}
          </button>
        </div>
      </div>
    </>
  )
}
