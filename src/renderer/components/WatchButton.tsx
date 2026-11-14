import React from 'react'
import type { ProjectWithUser } from '../../shared/types.js'
import { WATCH_ENABLED, type WatchOrigin } from '../../shared/projectWatch.js'
import { rased } from '../api.js'
import { Icon } from './Icon.js'
import { WatchLimitDialog } from './WatchLimitDialog.js'
import { WatchReplaceDialog } from './WatchReplaceDialog.js'
import { canWatch, shouldApplyWatchResult, watchButtonLabel, watchButtonState } from './watchUi.js'

export interface WatchButtonProps {
  lang: 'ar' | 'en'
  project: ProjectWithUser
  entry: WatchOrigin
  compact?: boolean
  /** Label for the not-watching state, e.g. «تابع من جديد» on stopped rows. */
  offLabel?: string
}

export function WatchButton({ lang, project, entry, compact = false, offLabel }: WatchButtonProps): React.ReactElement | null {
  if (!WATCH_ENABLED || !canWatch(project.source)) return null

  const [busy, setBusy] = React.useState(false)
  const [inlineMsg, setInlineMsg] = React.useState<string | null>(null)
  const [showLimitDialog, setShowLimitDialog] = React.useState(false)
  const [showReplaceDialog, setShowReplaceDialog] = React.useState(false)
  const [waitingVersion, setWaitingVersion] = React.useState<number | null>(null)

  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const projectIdRef = React.useRef(project.id)
  projectIdRef.current = project.id

  const state = watchButtonState(project.watch)
  const label = state === 'off' && offLabel ? offLabel : watchButtonLabel(state, lang)
  const isPressed = state === 'active' || state === 'waiting'
  const stateClass = state === 'active' ? ' watch-on' : state === 'waiting' ? ' watch-wait' : ''

  const returnFocus = React.useCallback(() => {
    if (buttonRef.current?.isConnected) {
      buttonRef.current.focus()
    }
  }, [])

  const handleClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (busy) return

    setBusy(true)
    setInlineMsg(null)
    const want = state === 'off' ? 'on' : 'off'
    const requestProjectId = project.id
    try {
      const res = await rased.watchSet({
        projectId: requestProjectId,
        want,
        expectVersion: project.watch?.version ?? null,
        entry
      })

      if (!shouldApplyWatchResult(mountedRef.current, projectIdRef.current, requestProjectId)) {
        return
      }

      if (res && res.ok) {
        if (want === 'on' && res.row?.state === 'waiting') {
          setWaitingVersion(res.row.version)
          setShowLimitDialog(true)
        }
      } else {
        const err = res && !res.ok ? res.error : 'error'
        if (err === 'stale') {
          setInlineMsg(
            lang === 'ar'
              ? 'تغيّرت حالة المتابعة، حدّث القائمة وحاول مرة أخرى'
              : 'Watch state changed. Refresh and try again.'
          )
        } else {
          setInlineMsg(lang === 'ar' ? 'تعذّر تحديث المتابعة' : 'Could not update watching.')
        }
      }
    } catch {
      if (shouldApplyWatchResult(mountedRef.current, projectIdRef.current, requestProjectId)) {
        setInlineMsg(lang === 'ar' ? 'تعذّر تحديث المتابعة' : 'Could not update watching.')
      }
    } finally {
      if (mountedRef.current && projectIdRef.current === requestProjectId) {
        setBusy(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  }

  const handleLimitWait = (): void => {
    setShowLimitDialog(false)
    returnFocus()
  }

  const handleLimitSwap = (): void => {
    setShowLimitDialog(false)
    setShowReplaceDialog(true)
  }

  const handleReplaceClose = (): void => {
    setShowReplaceDialog(false)
    returnFocus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={compact ? `icon-btn${stateClass}` : `btn sm${stateClass}`}
        aria-label={label}
        title={compact ? (inlineMsg ?? label) : undefined}
        aria-pressed={isPressed}
        disabled={busy}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Icon name="bell" size={compact ? 15 : 16} />
        {!compact && <span>{label}</span>}
      </button>
      {!compact && inlineMsg && (
        <span role="status" className="field-err small" style={{ marginInlineStart: '6px' }}>
          {inlineMsg}
        </span>
      )}
      {(showLimitDialog || showReplaceDialog) && (
        <span className="watch-dialogs" onClick={e => e.stopPropagation()}>
          {showLimitDialog && (
            <WatchLimitDialog
              lang={lang}
              source={project.source}
              onWait={handleLimitWait}
              onSwap={handleLimitSwap}
            />
          )}
          {showReplaceDialog && waitingVersion !== null && (
            <WatchReplaceDialog
              lang={lang}
              project={project}
              waitingVersion={waitingVersion}
              entry={entry}
              onClose={handleReplaceClose}
            />
          )}
        </span>
      )}
    </>
  )
}
