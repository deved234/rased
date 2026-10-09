import React from 'react'
import { registerNavigationBlocker } from '../router.js'
import { ConfirmDialog } from './ui.js'

/** A transition resumes only after a successful save or an explicit discard. */
export function useUnsavedChanges(dirty: boolean, ar: boolean, save: () => Promise<boolean>, enabled = true, onDiscard?: () => void): React.ReactNode {
  const current = React.useRef({ dirty, save, onDiscard })
  current.current = { dirty, save, onDiscard }
  const pending = React.useRef<(() => void) | null>(null)
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(false)
  React.useEffect(() => enabled ? registerNavigationBlocker(proceed => {
    if (!current.current.dirty) return true
    if (!pending.current) pending.current = proceed
    setOpen(true)
    return false
  }) : undefined, [enabled])
  const finish = (): void => {
    const proceed = pending.current
    pending.current = null
    setOpen(false)
    setError(false)
    proceed?.()
  }
  return open ? <ConfirmDialog busy={busy} lang={ar ? 'ar' : 'en'} title={ar ? 'تعديلات غير محفوظة' : 'Unsaved changes'}
    body={error ? (ar ? 'تعذر الحفظ. راجع البيانات وأعد المحاولة؛ تعديلاتك ما زالت هنا.' : 'Could not save. Check your data and retry; your edits are still here.') : (ar ? 'احفظ تعديلاتك قبل المتابعة، أو اختر تجاهلها.' : 'Save your edits before continuing, or discard them.')}
    confirmLabel={ar ? 'البقاء هنا' : 'Stay here'}
    onConfirm={() => { if (!busy) { pending.current = null; setOpen(false); setError(false) } }}
    onCancel={() => { if (!busy) { pending.current = null; setOpen(false); setError(false) } }}
    extraAction={<><button className="btn primary" disabled={busy} onClick={() => {
      setBusy(true)
      void current.current.save().then(ok => { if (ok) finish(); else setError(true) }).catch(() => setError(true)).finally(() => setBusy(false))
    }}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ والمتابعة' : 'Save and continue')}</button>
      <button className="btn danger" disabled={busy} onClick={() => { current.current.onDiscard?.(); finish() }}>{ar ? 'تجاهل التعديلات' : 'Discard edits'}</button></>} /> : null
}
