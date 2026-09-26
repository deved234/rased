import React from 'react'
import { rased } from '../api.js'
import type { Lang } from '../i18n.js'
import logo from '../assets/logo.svg'

export function Titlebar({ lang }: { lang: Lang }): React.ReactElement {
  const [maximized, setMaximized] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    void rased.getWindowState().then(s => { if (alive) setMaximized(s.maximized) })
    const off = rased.onWindowState(s => setMaximized(s.maximized))
    return () => { alive = false; off() }
  }, [])
  const action = (a: 'minimize' | 'maximize' | 'close'): void => { void rased.windowControl(a) }
  const minimize = lang === 'ar' ? 'تصغير النافذة' : 'Minimize window'
  const maximize = maximized ? (lang === 'ar' ? 'استعادة حجم النافذة' : 'Restore window') : (lang === 'ar' ? 'تكبير النافذة' : 'Maximize window')
  const close = lang === 'ar' ? 'إغلاق النافذة' : 'Close window'
  return <header className="window-titlebar" dir="ltr">
    <div className="window-brand"><img src={logo} alt="" /><span>RASED</span></div>
    <div className="window-drag" onDoubleClick={() => action('maximize')} />
    <div className="window-controls">
      <button aria-label={minimize} title={minimize} onClick={() => action('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button>
      <button aria-label={maximize} title={maximize} aria-pressed={maximized} onClick={() => action('maximize')}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <><path d="M5 4V2h9v9h-2" /><path d="M2 5h9v9H2z" /></> : <path d="M3 3h10v10H3z" />}</svg></button>
      <button className="window-close" aria-label={close} title={close} onClick={() => action('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>
    </div>
  </header>
}
