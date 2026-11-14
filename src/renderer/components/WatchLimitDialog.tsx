import React from 'react'
import type { Lang } from '../i18n.js'
import { sourceName } from '../sourceCopy.js'
import { useDialogFocus } from './ui.js'

export interface WatchLimitDialogProps {
  lang: Lang
  source: string
  onWait: () => void
  onSwap: () => void
}

export function WatchLimitDialog({
  lang,
  source,
  onWait,
  onSwap
}: WatchLimitDialogProps): React.ReactElement {
  const panelRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onWait() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onWait])

  const platform = sourceName(source, lang)
  const title = lang === 'ar' ? `وصلت للحد 10 في ${platform}` : `You reached the limit of 10 on ${platform}`
  const body =
    lang === 'ar'
      ? 'المشروع في قائمة الانتظار وهيبدأ يتتابع أول ما يفضى مكان. تقدر كمان تبدّله بمشروع بتتابعه دلوقتي.'
      : 'The project is queued and starts as soon as a slot frees up. You can also swap it with a project you are watching now.'
  const waitLabel = lang === 'ar' ? 'انتظر مكانًا' : 'Wait for a slot'
  const swapLabel = lang === 'ar' ? 'بدّل بمشروع آخر' : 'Swap with another project'

  return (
    <>
      <div className="scrim" onClick={onWait} />
      <div ref={panelRef} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
        <div className="actions">
          <button type="button" className="btn primary" autoFocus onClick={onWait}>
            {waitLabel}
          </button>
          <button type="button" className="btn" onClick={onSwap}>
            {swapLabel}
          </button>
        </div>
      </div>
    </>
  )
}
