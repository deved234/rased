import React from 'react'
import type { AppSettings, FilterDefinition, SourceHealth } from '@shared/types.js'
import { SOURCES, type SourceId } from '@shared/sources.js'
import { monitoringIssue } from '@shared/monitoring.js'
import type { Lang } from '../i18n.js'
import { STRINGS } from '../i18n.js'
import { countdownTo, fullDate, timeAgo } from '../format.js'
import { useNow } from '../hooks.js'
import { rased } from '../api.js'
import { Icon } from './Icon.js'

/** Keep operational notices available without displacing the opportunity list. */
export function MonitoringNotices({ source, health, settings, lang }: {
  source: FilterDefinition['source']
  health: Record<SourceId, SourceHealth | null>
  settings: AppSettings
  lang: Lang
}): React.ReactElement | null {
  const ar = lang === 'ar', t = STRINGS[lang]
  const visible = SOURCES.filter(item => source === 'all' || source === item.id)
  const disabled = visible.find(item => !settings[item.enabledKey])
  const notices = visible.flatMap(item => {
    const value = health[item.id]
    if (!settings[item.enabledKey] || !value || value.enabled === false || value.state === 'disabled') return []
    if (!monitoringHelp(value, lang) && !value.coverageGap && !value.recovering && !value.paused) return []
    return [{ source: item, health: value }]
  })
  if (source !== 'all' && disabled) return <div className="banner">{disabled[lang]}: {t.statusDisabled}. {ar ? 'الفرص المحفوظة ما زالت متاحة.' : 'Saved opportunities are still available.'}</div>
  if (!notices.length) return null
  const issues = notices.some(item => !item.health.paused && monitoringHelp(item.health, lang))
  const recovering = notices.some(item => !item.health.paused && item.health.recovering)
  const gaps = notices.some(item => item.health.coverageGap)
  const count = notices.length
  const platforms = ar ? count === 1 ? 'منصة واحدة' : count === 2 ? 'منصتين' : `${count.toLocaleString('ar')} منصات` : `${count} platform${count === 1 ? '' : 's'}`
  const title = issues ? ar ? `مشكلات في الرصد ضمن ${platforms}` : `Monitoring issues across ${platforms}`
    : recovering ? ar ? `استرجاع فرص وملاحظات الرصد ضمن ${platforms}` : `Catch-up and monitoring notices across ${platforms}`
    : gaps ? notices.every(item => item.health.coverageGap)
      ? ar ? `فترات رصد غير مكتملة ضمن ${platforms}` : `Possible coverage gaps across ${platforms}`
      : ar ? `ملاحظات الرصد ضمن ${platforms}` : `Monitoring notices across ${platforms}`
    : ar ? `الرصد متوقف مؤقتًا ضمن ${platforms}` : `Monitoring paused across ${platforms}`
  const names = notices.map(item => item.source[lang]).join(ar ? '، ' : ', ')
  return <details className={`monitoring-notices${issues ? ' has-issues' : ''}`}>
    <summary className="monitoring-summary">
      <Icon name={issues || gaps ? 'warn' : 'info'} />
      <span className="monitoring-summary-text"><strong>{title}</strong><span>{names}</span></span>
      <span className="monitoring-disclosure"><span className="when-closed">{ar ? 'عرض التفاصيل' : 'Show details'}</span><span className="when-open">{ar ? 'طي التفاصيل' : 'Hide details'}</span><Icon name="chevD" size={16} /></span>
    </summary>
    <div className="monitoring-notices-body" role="region" aria-label={ar ? 'تفاصيل تنبيهات الرصد' : 'Monitoring notice details'} tabIndex={0}>
      {notices.map(item => <section className="monitoring-notice-item" key={item.source.id} data-monitoring-source={item.source.id}>
        <h3>{item.source[lang]}<span>{item.health.paused ? t.statusPaused : item.health.state === 'watching' ? t.statusWatching : item.health.state === 'needs-review' ? t.statusNeedsReview : item.health.state === 'backing-off' ? t.statusBackingOff : item.health.state === 'offline' ? t.statusOffline : t.statusError}</span></h3>
        <SourceNotice source={item.source.id} health={item.health} lang={lang} />
      </section>)}
    </div>
  </details>
}

export function monitoringHelp(health: SourceHealth, lang: Lang): string | null {
  const ar = lang === 'ar'
  switch (monitoringIssue(health.lastError)) {
    case 'restricted': return ar ? 'المنصة قيّدت الوصول أو طلبت تحققًا. انتظر موعد المحاولة، ويمكنك فتح موقعها في المتصفح للتحقق من إتاحته. تسجيل الدخول في المتصفح لا يلغي التقييد داخل راصد.' : 'The platform restricted access or requested verification. Wait for the next attempt; you can check the website in your browser. Browser login does not remove a restriction on RASED.'
    case 'rate-limited': return ar ? 'المنصة طلبت تقليل الطلبات. راصد ينتظر فترة التهدئة قبل المحاولة تلقائيًا؛ التحديث اليدوي لن يتجاوزها.' : 'The platform requested fewer requests. RASED will retry after its cooldown; manual refresh cannot bypass it.'
    case 'network': return ar ? 'تعذر الاتصال. تحقق من اتصال الإنترنت؛ ستتم إعادة المحاولة تلقائيًا وبياناتك المحفوظة متاحة.' : 'Could not connect. Check your internet connection; RASED retries automatically and saved opportunities remain available.'
    case 'timeout': return ar ? 'استغرقت الاستجابة وقتًا أطول من المسموح. تحقق من الاتصال وانتظر المحاولة التالية.' : 'The response took too long. Check your connection and wait for the next attempt.'
    case 'content': return ar ? 'استجابة المنصة لا تطابق البيانات المتوقعة. سيحاول راصد مجددًا بهدوء؛ إذا استمرت المشكلة انسخ تقرير حالة الرصد للإبلاغ عنها.' : 'The platform returned unexpected data. RASED will retry with backoff; if this continues, copy the monitoring report to report the issue.'
    case 'server': return ar ? 'المنصة تواجه مشكلة مؤقتة في الاستجابة. ستتم إعادة المحاولة تلقائيًا بعد التهدئة.' : 'The platform has a temporary server problem. RASED will retry automatically after backoff.'
    case 'unknown': return ar ? 'تعذر تحديث المنصة. ستتم إعادة المحاولة تلقائيًا؛ انسخ تقرير الحالة إذا استمرت المشكلة.' : 'Could not update the platform. RASED retries automatically; copy the status report if the problem persists.'
    default: return null
  }
}

export function SourceNotice({ source, health, lang }: { source: SourceId; health: SourceHealth | null; lang: Lang }): React.ReactElement | null {
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(false)
  if (!health || health.enabled === false || health.state === 'disabled') return null
  const help = monitoringHelp(health, lang), gap = health.coverageGap, ar = lang === 'ar'
  if (!help && !gap && !health.recovering) return null
  return <div className="source-notice">
    {help && health.paused && <p>{ar ? 'الرصد متوقف مؤقتًا. المشكلة التالية هي آخر مشكلة مسجلة؛ لن تُعاد المحاولة حتى تستأنف الرصد، مع احترام التهدئة.' : 'Monitoring is paused. The issue below is the last recorded problem; retries require resuming monitoring and still respect cooldowns.'}</p>}
    {help && <p>{help}</p>}
    {health.recovering && <p>{ar ? 'جارٍ استرجاع صفحات سابقة على دفعات. اكتمال الفترة لم يُتحقق منه بعد، والفرص المسترجعة لا ترسل تنبيهات.' : 'Catching up with older pages in bounded batches. Coverage is not yet verified; recovered opportunities are silent.'}</p>}
    {gap && <div className="coverage-warning" role="status">
      <p>{gap.reason === 'no-overlap'
        ? ar ? 'قد توجد فرص لم تظهر في راصد: القائمة الجديدة لم تتداخل مع آخر قائمة محفوظة. نجاح الفحص الحالي لا يضمن اكتمال الفترة السابقة.' : 'Some opportunities may be missing: the new list had no overlap with the previous list. A successful current check does not guarantee complete earlier coverage.'
        : ar ? 'انقطع الرصد لأكثر من دقيقتين. قد تكون بعض الفرص خرجت من القائمة قبل عودة راصد؛ لا يمكن ضمان اكتمال هذه الفترة.' : 'Monitoring was interrupted for more than two minutes. Some opportunities may have left the list before RASED returned; coverage for this period is not guaranteed.'}</p>
      <p className="small">{ar ? 'الفترة المحتملة' : 'Possible gap'}: <bdi>{fullDate(gap.since, lang)}</bdi> — <bdi>{fullDate(gap.detectedAt, lang)}</bdi></p>
      <button className="btn sm" disabled={busy} onClick={() => {
        setBusy(true); setError(false)
        void rased.acknowledgeSourceGap(source).then(result => setError(!result.ok)).catch(() => setError(true)).finally(() => setBusy(false))
      }}>{ar ? 'فهمت، إخفاء التحذير' : 'Understood, dismiss warning'}</button>
      <span className="hint">{ar ? 'إخفاؤه لا يسترجع فرصًا مفقودة.' : 'Dismissing does not recover missing opportunities.'}</span>
      {error && <p className="field-err" role="alert">{ar ? 'تعذر إخفاء التحذير. حاول مجددًا.' : 'Could not dismiss the warning. Try again.'}</p>}
    </div>}
  </div>
}

export function SourceHealthDetails({ source, health, lang }: { source: SourceId; health: SourceHealth | null; lang: Lang }): React.ReactElement {
  const t = STRINGS[lang], ar = lang === 'ar'
  useNow(1000)
  const date = (value: string | null | undefined): React.ReactNode => value ? <span title={fullDate(value, lang)}>{timeAgo(value, lang)}</span> : ar ? 'لم يُسجل بعد' : 'Not recorded yet'
  const idle = !health || health.state === 'disabled' || health.paused
  return <div className="source-health-details">
    <dl className="source-health-facts">
      <div><dt>{t.lastSuccessAt}</dt><dd>{date(health?.lastSuccessAt)}</dd></div>
      <div><dt>{ar ? 'آخر فرصة اكتُشفت' : 'Last opportunity detected'}</dt><dd>{date(health?.lastDiscoveryAt)}</dd></div>
      <div><dt>{t.nextCheck}</dt><dd>{idle ? '—' : health.checking ? ar ? 'فحص جارٍ…' : 'Checking…' : health.nextAttemptAt ? countdownTo(health.nextAttemptAt, lang) : ar ? 'انتظار الجدولة' : 'Waiting for scheduler'}</dd></div>
    </dl>
    <SourceNotice source={source} health={health} lang={lang} />
  </div>
}
