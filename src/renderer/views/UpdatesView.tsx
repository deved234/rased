import React from 'react'
import type { UpdateState } from '@shared/updates.js'
import { rased } from '../api.js'
import type { Lang } from '../i18n.js'
import { go } from '../router.js'
import { ConfirmDialog } from '../components/ui.js'

const COPY = {
  ar: {
    title: 'تحديثات راصد', current: 'الإصدار الحالي', target: 'الإصدار الجديد', check: 'التحقق من التحديثات', download: 'تحميل التحديث', install: 'إعادة التشغيل والتحديث', later: 'لاحقًا', details: 'عرض التحديث', changes: 'ما الجديد؟', noNotes: 'لا يوجد ملخص تغييرات لهذا الإصدار.',
    description: 'يتحقق راصد من GitHub عند التشغيل وكل 6 ساعات. التحميل والتثبيت باختيارك؛ لا تحتاج تنزيل المثبّت يدويًا بعد هذه النسخة.', checked: 'آخر فحص', restart: 'سيُغلق راصد لتثبيت التحديث ثم يفتح من جديد. تُحفظ البيانات المحلية، وستتاح لك فرصة حفظ أي ملاحظات غير محفوظة.', consent: 'التحديث عبر GitHub. لا تُرفع مشاريعك أو ملاحظاتك. المثبّت الحالي غير موقّع رقميًا؛ يجري التحقق من بصمة التحميل.',
    disabled: 'التحديثات متاحة في نسخة Windows المجمّعة. نسخة التطوير لا تستبدل ملفات مشروعك.', idle: 'تحقق من وجود إصدار جديد.', latest: 'أنت تستخدم أحدث إصدار متاح.', checking: 'جارٍ فحص الإصدارات…', available: 'تحديث جديد متاح', downloading: 'جارٍ تحميل التحديث…', downloaded: 'التحديث جاهز للتثبيت', installing: 'جارٍ إعادة التشغيل للتحديث…', error: 'تعذّر إكمال التحديث. تحقق من الاتصال وحاول مجددًا.', retry: 'إعادة المحاولة', requestError: 'تعذّر تنفيذ الطلب. حاول مجددًا.'
  },
  en: {
    title: 'RASED updates', current: 'Current version', target: 'New version', check: 'Check for updates', download: 'Download update', install: 'Restart and update', later: 'Later', details: 'View update', changes: 'What’s new?', noNotes: 'No release notes were provided.',
    description: 'RASED checks GitHub at startup and every 6 hours. You choose when to download and install; future updates do not require a manual installer download.', checked: 'Last checked', restart: 'RASED will close to install the update, then reopen. Local data stays in place. You will be able to save any unsaved notes first.', consent: 'Updates come from GitHub. Projects and notes are not uploaded. The current installer is unsigned; the download checksum is verified.',
    disabled: 'Updates are available in the packaged Windows app. Development builds do not replace your project files.', idle: 'Check for a newer release.', latest: 'You are using the latest available version.', checking: 'Checking releases…', available: 'An update is available', downloading: 'Downloading update…', downloaded: 'Update ready to install', installing: 'Restarting to update…', error: 'Could not complete the update. Check your connection and retry.', retry: 'Retry', requestError: 'Could not complete the request. Please retry.'
  }
}
export function updatesTitle(lang: Lang): string { return COPY[lang].title }

export function useUpdates(): UpdateState | null {
  const [state, setState] = React.useState<UpdateState | null>(null)
  React.useEffect(() => {
    let alive = true, receivedEvent = false
    const off = rased.onUpdateState(next => { receivedEvent = true; if (alive) setState(next) })
    void rased.getUpdateState().then(next => { if (alive && !receivedEvent) setState(next) }).catch(() => {})
    return () => { alive = false; off() }
  }, [])
  return state
}

export function UpdateBanner({ lang, state }: { lang: Lang; state: UpdateState | null }): React.ReactElement | null {
  const [dismissed, setDismissed] = React.useState<string | null>(null)
  const t = COPY[lang]
  if (!state || !['available', 'downloading', 'downloaded', 'installing'].includes(state.phase) || state.phase === 'available' && dismissed === state.version) return null
  return <div className="update-banner" role="status">
    <span>{t[state.phase as 'available']} <strong dir="ltr">{state.version}</strong>{state.phase === 'downloading' ? ` · ${Math.round(state.percent)}%` : ''}</span>
    <div className="row-actions">
      <button className="btn sm" onClick={() => go({ name: 'settings', section: 'updates' })}>{t.details}</button>
      {state.phase === 'downloaded' && <button className="btn primary sm" onClick={() => { void rased.installUpdate() }}>{t.install}</button>}
      {state.phase === 'available' && <button className="btn ghost sm" onClick={() => setDismissed(state.version)}>{t.later}</button>}
    </div>
  </div>
}

export function UpdatesView({ lang }: { lang: Lang }): React.ReactElement {
  const state = useUpdates()
  const t = COPY[lang]
  const [confirm, setConfirm] = React.useState(false)
  const [requestError, setRequestError] = React.useState(false)
  const act = async (action: 'check' | 'download' | 'install'): Promise<void> => {
    setRequestError(false)
    try {
      const result = await (action === 'check' ? rased.checkUpdate() : action === 'download' ? rased.downloadUpdate() : rased.installUpdate())
      if (!result.ok) setRequestError(true)
    } catch { setRequestError(true) }
  }
  const busy = !state || ['checking', 'downloading', 'installing', 'disabled'].includes(state.phase)
  const downloadable = state?.phase === 'available' || state?.phase === 'error' && state.error === 'download'
  return <section className="set-group updates-page" aria-label={t.title}>
    <h2>{t.title}</h2><p className="desc">{t.description}</p>
    <div className="meta"><span>{t.current}</span> <strong className="tag num" dir="ltr">{state?.currentVersion ?? '…'}</strong></div>
    {state?.version && <div className="meta"><span>{t.target}</span> <strong className="tag num" dir="ltr">{state.version}</strong></div>}
    <p role="status" aria-live="polite" className={state?.phase === 'error' ? 'field-err' : 'update-status'}>{!state ? t.checking : state.phase === 'idle' && state.checkedAt ? t.latest : t[state.phase]}</p>
    {state?.phase === 'downloading' && <div className="update-progress"><progress value={state.percent} max={100} aria-label={t.downloading} /><span className="num">{Math.round(state.percent)}% · {(state.transferred / 1048576).toFixed(1)} / {(state.total / 1048576).toFixed(1)} MB</span></div>}
    {state?.checkedAt && <p className="small muted">{t.checked}: {new Date(state.checkedAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}</p>}
    <div className="row-actions">
      <button className="btn" disabled={busy || state?.phase === 'downloaded'} onClick={() => void act('check')}>{state?.phase === 'error' && !downloadable ? t.retry : t.check}</button>
      {downloadable && <button className="btn primary" onClick={() => void act('download')}>{state?.phase === 'error' ? t.retry : t.download}</button>}
      {state?.phase === 'downloaded' && <button className="btn primary" onClick={() => setConfirm(true)}>{t.install}</button>}
    </div>
    {requestError && <p className="field-err" role="alert">{t.requestError}</p>}
    {state?.version && <div className="update-notes"><h3>{t.changes}</h3><p dir="auto">{state.notes || t.noNotes}</p></div>}
    <p className="small muted">{t.consent}</p>
    {confirm && <ConfirmDialog lang={lang} title={t.install} body={t.restart} confirmLabel={t.install} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void act('install') }} />}
  </section>
}
