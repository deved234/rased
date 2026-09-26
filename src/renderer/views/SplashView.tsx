import React from 'react'
import { STRINGS, type Lang } from '../i18n.js'
import logo from '../assets/logo.svg'

export type SplashPhase = 'loading' | 'slow' | 'error' | 'ready'

export function SplashView({
  lang,
  phase,
  stage,
  error,
  onRetry,
  onContinue
}: {
  lang: Lang
  phase: SplashPhase
  stage: 'settings' | 'database' | 'ready'
  error: string | null
  onRetry: () => void
  onContinue: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  return (
    <div className="splash" data-phase={phase} data-stage={stage}>
      <div className="splash-mark"><img src={logo} alt="" /></div>
      <h1>RASED</h1>
      <p className="splash-tagline">{t.splashTagline}</p>
      <div className="splash-startup" role="status" aria-live="polite">
      <p className="muted">{phase === 'ready' ? t.splashReady : t.preparing}</p>
      {phase !== 'error' && (
        <><div className="bar" aria-hidden="true"><i /></div>
        <ol className="splash-steps" aria-label={t.preparing}>
          <li className={stage !== 'settings' ? 'done' : 'current'}>{t.splashSettings}</li>
          <li className={stage === 'ready' ? 'done' : stage === 'database' ? 'current' : ''}>{t.splashData}</li>
          <li className={stage === 'ready' ? 'done' : ''}>{t.splashWorkspace}</li>
        </ol></>
      )}
      {phase === 'ready' && <><button className="btn primary splash-enter" onClick={onContinue}>{t.splashEnter}</button><p className="muted small">{t.splashAutomatic}</p></>}
      {phase === 'slow' && <p className="muted small">{t.splashSlow}</p>}
      {phase === 'error' && (
        <>
          <p className="err">{error ?? t.splashDbError}</p>
          <button className="btn primary" onClick={onRetry}>
            {t.retry}
          </button>
        </>
      )}
      </div>
      <span className="splash-foot">{t.splashLocal}</span>
    </div>
  )
}
