import React from 'react'
import { rased } from '../api.js'
import { requestAction } from '../router.js'
import { ConfirmDialog, FieldError, Toggle } from '../components/ui.js'
import { dataErrorText, type BackupCounts, type BackupPreferences, type DataStatus, type RestorePreview } from '@shared/data.js'
import type { Lang } from '../i18n.js'
import { fullDate } from '../format.js'

export function BackupSettings({ lang, busy, setBusy }: { lang: Lang; busy: boolean; setBusy: (value: boolean) => void }): React.ReactElement {
  const ar = lang === 'ar'
  const [status, setStatus] = React.useState<DataStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<RestorePreview | null>(null)
  const [applyStartup, setApplyStartup] = React.useState(false)
  const [confirm, setConfirm] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)
  const disabled = busy || status?.busy === true || restarting
  const refresh = React.useCallback(async () => { setStatus(await rased.getDataStatus()) }, [])
  React.useEffect(() => {
    let alive = true
    const read = (): void => { void rased.getDataStatus().then(s => { if (alive) setStatus(s) }).catch(() => { if (alive) setError(dataErrorText(undefined, ar)) }) }
    read()
    const timer = setInterval(read, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [ar])
  React.useEffect(() => () => { void rased.cancelRestore() }, [])

  const act = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null); setMessage(null)
    try { await job() } catch { setError(dataErrorText(undefined, ar)) }
    finally { setBusy(false); await refresh().catch(() => {}) }
  }
  const update = (patch: Partial<BackupPreferences>): void => {
    if (!status) return
    void act(async () => {
      const result = await rased.setBackupPreferences({ ...status.preferences, ...patch })
      if (!result.ok) setError(dataErrorText(result.error, ar))
    })
  }
  const cancelPreview = (): void => { setPreview(null); setConfirm(false); void rased.cancelRestore() }
  const counts: [keyof BackupCounts, string][] = [['projects', ar ? 'المشاريع والطلبات' : 'Opportunities'], ['notes', ar ? 'الملاحظات' : 'Notes'], ['drafts', ar ? 'مسودات العروض' : 'Proposal drafts'], ['filters', ar ? 'الفلاتر المحفوظة' : 'Saved filters']]

  return <div className="set-group backup-settings" aria-busy={disabled}>
    <h2>{ar ? 'النسخ الاحتياطي والاستعادة' : 'Backup and restore'}</h2>
    <p className="desc">{ar ? 'نسخة كاملة للمشاريع والتفاصيل والملاحظات والمسودات والإعدادات والملف المهني. احفظ نسخة خارج قرص الجهاز للحماية من تلفه.' : 'Back up opportunities, details, notes, drafts, settings and your professional profile. Keep a copy off this device to protect against drive failure.'}</p>
    <p className="hint">{ar ? 'الملف غير مشفّر ويحتوي بياناتك الخاصة. مفاتيح API وجلسات المتصفح ورموز ربط الإضافة غير مشمولة. النسخ المحلية الدورية تعمل أثناء تشغيل راصد فقط.' : 'The file is unencrypted and contains private data. API keys, browser sessions and extension pairing tokens are excluded. Scheduled local backups run only while RASED is running.'}</p>
    <div className="row-actions">
      <button className="btn primary sm" disabled={disabled} onClick={() => void act(async () => {
        const result = await rased.createBackup()
        if (result.ok) setMessage((ar ? 'حُفظت النسخة الاحتياطية: ' : 'Backup saved: ') + result.path)
        else if (result.error) setError(dataErrorText(result.error, ar))
      })}>{ar ? 'إنشاء نسخة احتياطية' : 'Create backup'}</button>
      <button className="btn sm" disabled={disabled} onClick={() => void act(async () => {
        setPreview(null)
        const result = await rased.validateRestore()
        if (result.ok) { setPreview(result); setApplyStartup(false) }
        else if (result.error) setError(dataErrorText(result.error, ar))
      })}>{ar ? 'اختيار نسخة للاستعادة' : 'Choose backup to restore'}</button>
      <button className="btn sm" disabled={disabled} onClick={() => void act(async () => {
        const result = await rased.openBackupFolder()
        if (!result.ok) setError(dataErrorText(result.error, ar))
      })}>{ar ? 'فتح مجلد النسخ المحلية' : 'Open local backups folder'}</button>
    </div>
    <div className="set-row">
      <label htmlFor="backup-schedule">{ar ? 'النسخ التلقائي المحلي' : 'Automatic local backups'}</label>
      <select id="backup-schedule" className="select" value={status?.preferences.schedule ?? 'off'} disabled={disabled || !status} onChange={e => update({ schedule: e.target.value as BackupPreferences['schedule'] })}>
        <option value="off">{ar ? 'متوقف' : 'Off'}</option><option value="daily">{ar ? 'يوميًا' : 'Daily'}</option><option value="weekly">{ar ? 'أسبوعيًا' : 'Weekly'}</option>
      </select>
    </div>
    <div className="set-row">
      <label htmlFor="backup-retention">{ar ? 'الاحتفاظ بأحدث نسخ تلقائية ونسخ رجوع' : 'Keep latest automatic and rollback backups'}</label>
      <select id="backup-retention" className="select" value={status?.preferences.keep ?? 5} disabled={disabled || !status} onChange={e => update({ keep: Number(e.target.value) as BackupPreferences['keep'] })}>
        {[3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
    <p className="hint">{ar ? 'الحذف الدوري يخص النسخ التي أنشأها راصد تلقائيًا ونسخ الرجوع فقط؛ الملفات التي تحفظها يدويًا لا تُحذف. الجدولة لا تنتقل ضمن تصدير الإعدادات.' : 'Retention applies only to automatic and rollback copies created by RASED. Manually saved files are never pruned. Scheduling stays on this device and is not exported.'}</p>
    <p className="meta">{ar ? 'آخر نسخة ناجحة: ' : 'Last successful backup: '}{status?.lastBackupAt ? fullDate(status.lastBackupAt, lang) : (ar ? 'لا توجد نسخة مسجلة بعد' : 'No recorded backup yet')}</p>
    {status?.lastBackupPath && <p className="hint backup-path" dir="auto">{status.lastBackupPath}</p>}
    {disabled && <p role="status">{restarting ? (ar ? 'جارٍ إعادة تشغيل راصد لاستعادة البيانات…' : 'Restarting RASED to restore your data…') : (ar ? 'جارٍ تنفيذ العملية…' : 'Working…')}</p>}
    {message && <p className="backup-path" dir="auto" role="status">{message}</p>}
    <FieldError message={error ?? (status?.lastBackupError ? dataErrorText(status.lastBackupError, ar) : null)} />
    {status?.lastRestore && <div className="backup-result" role={status.lastRestore.ok ? 'status' : 'alert'}>
      <p>{status.lastRestore.ok ? (ar ? 'اكتملت آخر استعادة. أُوقف التقديم السريع للمراجعة؛ مفاتيحك وربط الإضافة على هذا الجهاز لم يتغيرا.' : 'Last restore completed. Quick Apply was disabled for review; keys and pairing on this device were kept.') : dataErrorText(status.lastRestore.error, ar)}</p>
      {status.lastRestore.rollbackPath && <p className="hint backup-path" dir="auto">{(ar ? 'نسخة الرجوع: ' : 'Rollback copy: ') + status.lastRestore.rollbackPath}</p>}
      {status.lastRestore.originalFilesPath && <p className="hint backup-path" dir="auto">{(ar ? 'حُفظت ملفات قاعدة البيانات التالفة دون حذف: ' : 'Original damaged database files were preserved: ') + status.lastRestore.originalFilesPath}</p>}
    </div>}
    {preview?.ok && <section className="backup-preview" aria-labelledby="restore-preview-title">
      <h3 id="restore-preview-title">{ar ? 'مراجعة النسخة قبل الاستعادة' : 'Review before restoring'}</h3>
      <p className="hint">{ar ? 'تاريخ النسخة: ' : 'Created: '}{preview.createdAt ? fullDate(preview.createdAt, lang) : '—'} · {ar ? 'إصدار راصد: ' : 'RASED version: '}{preview.appVersion}</p>
      <table className="backup-counts"><thead><tr><th>{ar ? 'البيانات' : 'Data'}</th><th>{ar ? 'الحالي الآن' : 'Current'}</th><th>{ar ? 'داخل النسخة' : 'In backup'}</th></tr></thead><tbody>
        {counts.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{preview.current?.[key] ?? 0}</td><td>{preview.incoming?.[key] ?? 0}</td></tr>)}
      </tbody></table>
      <p>{ar ? 'الاستعادة تستبدل الأرشيف والإعدادات والملف المهني واختيارات الموديلات؛ لا تدمجها. الأعداد الحالية معاينة وقد تتغير أثناء الرصد. تُنشأ نسخة رجوع من أحدث بياناتك بعد إعادة التشغيل وقبل الاستبدال.' : 'Restore replaces the archive, settings, professional profile and model choices; it does not merge them. Current counts may change during monitoring. A rollback copy of your latest data is created after restart, before replacement.'}</p>
      <div className="set-row"><label>{ar ? `نقل إعداد بدء Windows من النسخة (${preview.startupRequested ? 'مفعّل' : 'متوقف'})` : `Import Windows startup preference (${preview.startupRequested ? 'on' : 'off'})`}</label><Toggle checked={applyStartup} onChange={setApplyStartup} label={ar ? 'نقل إعداد بدء Windows' : 'Import Windows startup preference'} /></div>
      <div className="row-actions"><button className="btn" disabled={disabled} onClick={cancelPreview}>{ar ? 'إلغاء الاستعادة' : 'Cancel restore'}</button><button className="btn danger" disabled={disabled} onClick={() => setConfirm(true)}>{ar ? 'متابعة الاستعادة…' : 'Continue restore…'}</button></div>
    </section>}
    {confirm && <ConfirmDialog lang={lang} title={ar ? 'استبدال البيانات وإعادة التشغيل؟' : 'Replace data and restart?'}
      body={ar ? 'سيُغلق راصد بعد انتهاء الكتابات الجارية، ثم يستعيد النسخة المحددة. إذا تعذر إنشاء نسخة الرجوع أو فشل الاستبدال ستبقى بياناتك السابقة. أكمل فقط إذا راجعت محتويات النسخة.' : 'RASED will close after outstanding writes settle, then restore the selected backup. If rollback creation or replacement fails, your previous data stays intact. Continue only after reviewing the preview.'}
      confirmLabel={ar ? 'استعادة وإعادة التشغيل' : 'Restore and restart'} danger busy={disabled}
      onCancel={() => setConfirm(false)} onConfirm={() => requestAction(() => { void act(async () => {
        const result = await rased.applyRestore(preview?.token ?? '', applyStartup)
        if (result.ok) { setRestarting(true); setConfirm(false) }
        else { setConfirm(false); setError(dataErrorText(result.error, ar)) }
      }) })} />}
  </div>
}
