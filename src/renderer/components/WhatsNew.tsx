import React from 'react'
import type { AppSettings } from '@shared/types.js'
import { selectWhatsNew, selectLatestWhatsNew, type WhatsNewEntry } from '@shared/whatsNew.js'
import { rased } from '../api.js'
import type { Lang } from '../i18n.js'
import logo from '../assets/logo.svg'
import { Icon } from './Icon.js'
import { isTopDialog, useDialogFocus } from './ui.js'
import '../styles/whats-new.css'

/** Mounted only after splash and AnalyticsAccess, outside the compact route. */
export function WhatsNewAccess({ settings, patchSettings, children }: {
  settings: AppSettings
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  children: (open: (() => void) | null, visible: boolean) => React.ReactNode
}): React.ReactElement {
  const [version, setVersion] = React.useState<string | null>(null)
  const [manual, setManual] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    void rased.getAppInfo().then(info => { if (alive) setVersion(info.version) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const latestEntries = version ? selectLatestWhatsNew(version) : []
  const entries = manual ? latestEntries : version ? selectWhatsNew(settings.whatsNewSeen, version) : []
  const visible = !!version && entries.length > 0
  return <>
    {children(latestEntries.length ? () => setManual(true) : null, visible)}
    {version && visible && <WhatsNewDialog lang={settings.language} version={version} entries={entries} onDone={async () => {
      await patchSettings({ whatsNewSeen: version })
      setManual(false)
    }} />}
  </>
}

function WhatsNewDialog({ lang, version, entries, onDone }: {
  lang: Lang; version: string; entries: WhatsNewEntry[]; onDone: () => Promise<void>
}): React.ReactElement {
  const ar = lang === 'ar'
  const panel = React.useRef<HTMLDivElement>(null)
  const saving = React.useRef(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  useDialogFocus(panel)
  const close = React.useCallback(async (): Promise<void> => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError(null)
    try { await onDone() } catch { setError(ar ? 'تعذّر حفظ الإعدادات. حاول مجددًا.' : 'Could not save settings. Please retry.') }
    finally { saving.current = false; setBusy(false) }
  }, [onDone, ar])
  React.useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isTopDialog(panel.current)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void close()
      }
    }
    // Let the dialog's Tab trap run, then keep workspace window handlers out.
    const contain = (event: KeyboardEvent): void => {
      if (!isTopDialog(panel.current)) return
      if (event.ctrlKey || event.metaKey || event.altKey) event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('keydown', contain)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', contain)
      document.removeEventListener('keydown', key, true)
    }
  }, [close])
  return <div className="whats-new-overlay">
    <div ref={panel} className="whats-new-dialog" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" aria-describedby="whats-new-subtitle" tabIndex={-1} lang={lang} dir={ar ? 'rtl' : 'ltr'}>
      <header className="whats-new-header">
        <img src={logo} alt="" width="56" height="56" />
        <h2 id="whats-new-title">{ar ? 'مبروك! تم التحديث إلى راصد ' : 'Updated to RASED '}<bdi dir="ltr">{version}</bdi>{ar ? '' : ' 🎉'}</h2>
        <p id="whats-new-subtitle">{ar ? 'إليك أبرز الجديد' : "Here's what's new"}</p>
      </header>
      <div className="whats-new-content">
        {entries.map(entry => <section key={entry.version} aria-label={entry.version}>
          <div className="whats-new-release"><strong dir="ltr">{entry.version}</strong><time dateTime={entry.date}>{new Date(entry.date + 'T12:00:00Z').toLocaleDateString(ar ? 'ar-EG' : 'en-US')}</time></div>
          <div className="whats-new-cards">{entry.highlights.map((highlight, index) => <article className={`whats-new-card whats-new-card-${index}`} key={highlight.title.en}>
            <span className="whats-new-icon"><Icon name={highlight.icon} size={22} /></span>
            <div><h3>{highlight.title[lang]}</h3><p>{highlight.body[lang]}</p></div>
          </article>)}</div>
        </section>)}
      </div>
      <footer className="whats-new-footer">
        {error && <p role="alert" className="field-err">{error}</p>}
        <div className="row-actions">
          <button className="btn primary" disabled={busy} onClick={() => void close()}>{ar ? 'ابدأ الاستخدام' : 'Start using RASED'}</button>
          <button className="btn" disabled={busy} onClick={() => {
            void rased.openAboutLink('releases').then(result => {
              if (!result.ok) setError(ar ? 'تعذّر فتح سجل التغييرات.' : 'Could not open the changelog.')
            }).catch(() => setError(ar ? 'تعذّر فتح سجل التغييرات.' : 'Could not open the changelog.'))
          }}>{ar ? 'عرض سجل التغييرات' : 'View changelog'} <Icon name="external" size={14} /></button>
        </div>
      </footer>
    </div>
  </div>
}
