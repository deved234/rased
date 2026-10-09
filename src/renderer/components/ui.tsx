import React from 'react'
import { Icon } from './Icon.js'
import { STRINGS, type Lang } from '../i18n.js'

export function useDialogFocus(ref: React.RefObject<HTMLElement | null>, enabled = true): void {
  React.useEffect(() => {
    const panel = ref.current
    if (!enabled || !panel) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = (): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter(e => e.getClientRects().length > 0)
    focusable()[0]?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) { e.preventDefault(); panel.focus(); return }
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && index <= 0) { e.preventDefault(); items.at(-1)?.focus() }
      else if (!e.shiftKey && (index === -1 || index === items.length - 1)) { e.preventDefault(); items[0]?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [ref, enabled])
}

export function EmptyState({
  title,
  body,
  actions
}: {
  title: string
  body?: string
  actions?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="empty" role="status">
      <h3>{title}</h3>
      {body && <p className="muted">{body}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}

export function SkeletonList({ lang, rows = 5 }: { lang: Lang; rows?: number }): React.ReactElement {
  return (
    <div aria-label={STRINGS[lang].loading} role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" aria-hidden="true">
          <div className="skel w70" />
          <div className="skel" />
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog({
  lang,
  title,
  body,
  confirmLabel,
  busy = false,
  danger,
  onConfirm,
  onCancel,
  extraAction
}: {
  lang: Lang
  title: string
  body?: string
  confirmLabel?: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  extraAction?: React.ReactNode
}): React.ReactElement {
  const t = STRINGS[lang]
  const panelRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])
  return (
    <>
      <div className="scrim" onClick={() => { if (!busy) onCancel() }} />
      <div ref={panelRef} className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {body && <p className="muted">{body}</p>}
        <div className="actions">
          {extraAction}
          <button className="btn" disabled={busy} onClick={onCancel}>
            {t.cancel}
          </button>
          <button className={danger ? 'btn danger' : 'btn primary'} disabled={busy} onClick={onConfirm} autoFocus>
            {confirmLabel ?? t.confirm}
          </button>
        </div>
      </div>
    </>
  )
}

export function FieldError({ message }: { message: string | null }): React.ReactElement | null {
  if (!message) return null
  return (
    <div className="field-err" role="alert">
      {message}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.ReactElement {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="knob" />
    </span>
  )
}

export function IconBtn({
  name,
  title,
  onClick,
  on = false,
  disabled
}: {
  name: Parameters<typeof Icon>[0]['name']
  title: string
  onClick: (e: React.MouseEvent) => void
  on?: boolean
  disabled?: boolean
}): React.ReactElement {
  return (
    <button className={on ? 'icon-btn on' : 'icon-btn'} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <Icon name={name} size={17} />
    </button>
  )
}
