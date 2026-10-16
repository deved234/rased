import React from 'react'
import { SOURCES, type SourceId } from '@shared/sources.js'
import type { AppSettings, SourceHealth } from '@shared/types.js'
import { STRINGS, type Lang } from '../i18n.js'
import { rased } from '../api.js'
import { Toggle } from '../components/ui.js'
import { statusText, togglePause } from '../components/shell.js'
import { SourceHealthDetails } from '../components/SourceHealthDetails.js'

export function SourceMonitoringSettings({ lang, settings, health, patchSettings }: { lang: Lang; settings: AppSettings; health: Record<SourceId, SourceHealth | null>; patchSettings: (patch: Partial<AppSettings>) => Promise<void> }): React.ReactElement {
  const ar = lang === 'ar', t = STRINGS[lang]
  const [actionError, setActionError] = React.useState(false), [report, setReport] = React.useState<'busy' | 'ok' | 'error' | null>(null)
  const [busySource, setBusySource] = React.useState<SourceId | null>(null)
  const act = (id: SourceId, action: () => Promise<unknown>): void => {
    setBusySource(id); setActionError(false)
    void action().catch(() => setActionError(true)).finally(() => setBusySource(null))
  }
  const features = { details: ar ? 'تفاصيل داخل راصد' : 'Details in RASED', categories: ar ? 'تصنيفات مؤكدة للفلاتر' : 'Verified category filters', ai: ar ? 'مساعد العروض' : 'AI proposals', quickApply: ar ? 'التقديم السريع' : 'Quick Apply' }
  return <>
    <div className="set-group monitoring-intro">
      <h2>{ar ? 'إدارة المنصات وصحة الرصد' : 'Platforms and monitoring health'}</h2>
      <p className="hint">{ar ? 'تفعيل المنصة يُحفظ بعد إعادة التشغيل. الإيقاف المؤقت يخص هذه الجلسة وحدها؛ إعادة التفعيل لا تلغيه. كتم التنبيهات لا يوقف الجلب، وتعطيل المنصة لا يحذف فرصها المحفوظة.' : 'Platform enablement survives restart. Pause lasts for this session; re-enabling does not clear it. Muting alerts does not stop polling, and disabling a platform keeps its saved opportunities.'}</p>
      <p className="hint">{ar ? 'الفترات تقريبية وتزداد عند بطء الشبكة أو التهدئة. التحديث والاستئناف وإعادة التفعيل تحترم التهدئة؛ لا تتغير السرعة لمجرد قلة المشاريع.' : 'Intervals are approximate and increase with slow responses or backoff. Refresh, resume and re-enabling respect cooldowns; low project volume does not reduce polling speed.'}</p>
      <button className="btn sm" disabled={report === 'busy'} onClick={() => { setReport('busy'); void rased.copyMonitoringReport().then(result => setReport(result.ok ? 'ok' : 'error')).catch(() => setReport('error')) }}>{ar ? 'نسخ تقرير حالة الرصد' : 'Copy monitoring report'}</button>
      <p className="hint">{ar ? 'يتضمن حالات المنصات وأوقاتها ورموز الأعطال فقط، دون مفاتيح أو مشاريع أو ملاحظات أو مسارات جهازك. يمكنك مراجعته قبل مشاركته.' : 'Includes platform states, timestamps and issue codes; excludes keys, projects, notes and device paths. You can review it before sharing.'}</p>
      {report === 'ok' && <p role="status">{ar ? 'نُسخ التقرير.' : 'Report copied.'}</p>}
      {report === 'error' && <p className="field-err" role="alert">{ar ? 'تعذر نسخ التقرير.' : 'Could not copy the report.'}</p>}
      {actionError && <p className="field-err" role="alert">{ar ? 'تعذر تغيير حالة الرصد. حاول مرة أخرى.' : 'Could not change monitoring state. Try again.'}</p>}
    </div>
    {SOURCES.map(source => {
      const id = source.id, name = source[lang], value = health[id], enabled = settings[source.enabledKey]
      return <section className="set-group monitoring-source" key={id} data-source={id} aria-labelledby={`monitoring-${id}`}>
        <h2 id={`monitoring-${id}`}>{ar ? `رصد ${name}` : `${name} monitoring`}</h2>
        <div className="set-row"><span>{ar ? 'تفعيل المصدر' : 'Enable source'}</span><Toggle checked={enabled} onChange={on => act(id, () => patchSettings({ [source.enabledKey]: on }))} label={ar ? `تفعيل رصد ${name}` : `Enable ${name} monitoring`} /></div>
        <div className="set-row"><span>{ar ? 'حالة الرصد' : 'Monitoring status'}</span><span>{enabled ? statusText(value, lang) : t.statusDisabled}</span><button className="btn sm" disabled={!enabled || !value || busySource === id} onClick={() => act(id, () => togglePause(id, value))}>{enabled && value?.paused ? t.resume : t.pause} {name}</button></div>
        <div className="set-row"><span>{ar ? 'تنبيهات هذه المنصة' : 'Alerts for this platform'}</span><Toggle checked={settings[source.alertsKey]} onChange={on => act(id, () => patchSettings({ [source.alertsKey]: on }))} label={ar ? `تفعيل تنبيهات ${name}` : `Enable ${name} alerts`} /></div>
        {(!enabled || !settings.notificationsEnabled) && <p className="hint">{ar ? 'لن تصل تنبيهات هذه المنصة أثناء تعطيل مصدرها أو إيقاف التنبيهات العامة.' : 'This platform cannot notify while its source or global notifications are disabled.'}</p>}
        <p className="hint">{source.cadence[lang]}</p>
        {id === 'mostaql' && <>
          <div className="set-row"><label htmlFor="settings-field-2">{t.settingsInterval}</label><select id="settings-field-2" className="select" value={settings.pollIntervalMs} onChange={e => act(id, () => patchSettings({ pollIntervalMs: Number(e.target.value) as AppSettings['pollIntervalMs'] }))}><option value={5000}>{t.interval5}</option><option value={15000}>{t.interval15}</option><option value={2000}>{t.interval2}</option></select></div>
          {settings.pollIntervalMs === 2000 && <p className="hint">{t.interval2Warn}</p>}
        </>}
        <SourceHealthDetails source={id} health={value} lang={lang} />
        <details className="source-capabilities"><summary>{ar ? 'الوظائف المتاحة لهذه المنصة' : 'Capabilities for this platform'}</summary><ul>{(Object.keys(features) as (keyof typeof features)[]).map(key => <li key={key}>{features[key]}: {source.capabilities[key] ? ar ? 'متاح' : 'Available' : ar ? 'غير مدعوم حاليًا' : 'Not currently supported'}</li>)}</ul></details>
      </section>
    })}
  </>
}
