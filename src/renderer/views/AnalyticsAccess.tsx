import React from 'react'
import { rased } from '../api.js'
import { AnalyticsSettings } from './AnalyticsSettings.js'
import type { AnalyticsStatus } from '@shared/telemetry.js'
import logo from '../assets/logo.svg'

/** The configured distribution requires an explicit decision before feature views mount. */
export function AnalyticsAccess({ lang, children }: { lang: 'ar' | 'en'; children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = React.useState<AnalyticsStatus | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [epoch, setEpoch] = React.useState(0)
  const [language, setLanguage] = React.useState(lang)
  const ar = language === 'ar'
  React.useEffect(() => { setLanguage(lang) }, [lang])
  React.useEffect(() => {
    let alive = true
    setFailed(false)
    const off = rased.onAnalyticsChanged(next => { if (alive) setStatus(next) })
    void rased.getAnalyticsStatus().then(next => {
      if (!alive) return
      if (!next) setFailed(true)
      else setStatus(next)
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; off() }
  }, [epoch])
  if (status?.accessAllowed) return <>{children}</>
  return <main className="analytics-access" lang={language} dir={ar ? 'rtl' : 'ltr'}>
    <div className="analytics-access-card">
      <header className="analytics-access-heading">
        <img src={logo} alt="" />
        <div><h1>{ar ? 'قبل استخدام راصد' : 'Before using RASED'}</h1><p>{ar ? 'شروط إحصائيات الاستخدام' : 'Usage analytics requirement'}</p></div>
        <button className="btn sm" onClick={() => {
          // Persist the choice so the workspace keeps it after acceptance.
          const next = ar ? 'en' : 'ar'
          setLanguage(next)
          void rased.updateSettings({ language: next }).catch(() => {})
        }}>{ar ? 'English' : 'العربية'}</button>
      </header>
      <p>{ar ? 'هذه النسخة تشترط الموافقة على إرسال إحصائيات الاستخدام المحدودة الموضحة أدناه. لا يبدأ الجمع أو الرصد قبل قبولك. إذا لم توافق، يمكنك الخروج؛ تبقى بياناتك المحلية محفوظة.' : 'This distribution requires acceptance of the limited usage analytics described below. Collection and monitoring do not start before you accept. If you do not agree, you can exit; your local data remains intact.'}</p>
      {status ? <AnalyticsSettings lang={language} onboarding /> : <p role="status">{ar ? 'جارٍ قراءة حالة الموافقة…' : 'Loading acceptance status…'}</p>}
      {failed && <div role="alert"><p>{ar ? 'تعذر قراءة حالة الموافقة؛ لم يتم فتح وظائف التطبيق. أعد المحاولة أو اخرج.' : 'Acceptance status could not be loaded. Features remain locked. Retry or exit.'}</p><button className="btn" onClick={() => setEpoch(value => value + 1)}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>}
      {!status && <button className="btn" onClick={() => { void rased.confirmClose(true) }}>{ar ? 'خروج' : 'Exit'}</button>}
    </div>
  </main>
}
