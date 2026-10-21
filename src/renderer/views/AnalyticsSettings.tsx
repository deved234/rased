import React from 'react'
import { rased } from '../api.js'
import type { AnalyticsStatus } from '@shared/telemetry.js'
import { ConfirmDialog } from '../components/ui.js'

function useAnalytics(): [AnalyticsStatus | null, (next: AnalyticsStatus | null) => void] {
  const [status, setStatus] = React.useState<AnalyticsStatus | null>(null)
  React.useEffect(() => {
    let alive = true
    void rased.getAnalyticsStatus().then(value => { if (alive) setStatus(value) }).catch(() => {})
    const off = rased.onAnalyticsChanged(value => setStatus(value))
    return () => { alive = false; off() }
  }, [])
  return [status, setStatus]
}
export function AnalyticsSettings({ lang, onboarding = false }: { lang: 'ar' | 'en'; onboarding?: boolean }): React.ReactElement {
  const ar = lang === 'ar'
  const [status, setStatus] = useAnalytics()
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [forget, setForget] = React.useState(false)
  const retryRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { if (status?.purgePending && !busy) retryRef.current?.focus() }, [status?.purgePending, busy])
  const lastAccepted = status?.lastAcceptedAt ? new Date(status.lastAcceptedAt).toLocaleString(ar ? 'ar-EG' : 'en-GB') : ar ? 'لم يُسجّل بعد' : 'None yet'
  const action = async (value: 'enable' | 'disable' | 'forget'): Promise<void> => {
    if (busy) return
    setBusy(true); setMessage(null)
    try {
      const result = await rased.analyticsConsent(value)
      if (!result.ok) throw Error(result.error)
      setStatus(await rased.getAnalyticsStatus()); setForget(false)
    } catch (error) {
      setStatus(await rased.getAnalyticsStatus().catch(() => null))
      setForget(false)
      setMessage(error instanceof Error && error.message === 'forget-incomplete' ? ar ? 'لم يكتمل النسيان المحلي. المشاركة متوقفة؛ أعد محاولة النسيان.' : 'Local forgetting is incomplete. Sharing is off; retry forgetting.' : ar ? 'تعذر حفظ الاختيار. أعد المحاولة؛ لم يتم تأكيد التغيير.' : 'Could not save your choice. Retry; the change was not confirmed.')
    }
    finally { setBusy(false) }
  }
  const support = async (value: 'copy-reference' | 'contact'): Promise<void> => {
    try {
      if (!(await rased.analyticsAction(value)).ok) throw Error()
      setMessage(value === 'copy-reference' ? ar ? 'نُسخ معرّف المشاركة. أرسله بنفسك على واتساب لطلب الحذف.' : 'Reference copied. Send it yourself on WhatsApp to request deletion.' : ar ? 'تم طلب فتح واتساب. لم يُرسل معرّفك تلقائيًا.' : 'Requested WhatsApp opening. Your reference was not sent automatically.')
    } catch { setMessage(ar ? 'تعذر إتمام العملية. حاول مرة أخرى.' : 'Could not complete the action. Retry.') }
  }
  const stateText = !status ? ar ? 'جارٍ قراءة الحالة…' : 'Loading status…' : status.state === 'enabled' ? ar ? 'المشاركة مفعلة' : 'Sharing enabled' : ar ? 'المشاركة مغلقة' : 'Sharing off'
  return <section className="analytics-settings" aria-labelledby="analytics-heading">
    <h2 id="analytics-heading">{ar ? 'الخصوصية والإحصائيات' : 'Privacy & analytics'}</h2>
    <p>{ar ? 'في النسخة المهيأة رسميًا، قبول إحصائيات الاستخدام شرط لتشغيل راصد. يمكنك سحب الموافقة؛ يتوقف الرصد وتظهر شاشة الموافقة أو الخروج. لا تُحذف بياناتك المحلية.' : 'In the officially configured distribution, accepting usage analytics is required to use RASED. You can withdraw acceptance; monitoring stops and the accept-or-exit screen returns. Your local data is not deleted.'}</p>
    <p role="status">{stateText}</p>
    {status && !status.available && <p className="hint">{ar ? 'الإرسال غير متاح في نسخة التطوير أو البناء غير المهيأ. لا ترسل هذه النسخة إحصائيات إلى PostHog.' : 'Sending is unavailable in development or an unconfigured build. This build does not send analytics to PostHog.'}</p>}
    <h3>{ar ? 'البيانات التي تشاركها' : 'What you share'}</h3>
    <ul>
      <li>{ar ? 'معرّف تثبيت عشوائي، الإصدار، اللغة، ونوع Windows العام.' : 'A random installation ID, app version, language and broad Windows family.'}</li>
      <li>{ar ? 'نشاط الواجهة والرصد ونتائج الميزات، بملخصات للنجاح والفشل.' : 'Interface and monitoring activity and feature outcomes, with aggregated success/failure counts.'}</li>
    </ul>
    <p>{ar ? 'لا نرسل اسمك أو محتوى المشاريع أو العروض والملاحظات أو البحث أو مفاتيح API أو حسابات المتصفح. لا تسجيل للشاشة أو تتبع تلقائي لكل ضغطة.' : 'No name, project content, proposals, notes, searches, API keys or browser accounts. No screen recording or automatic click capture.'}</p>
    <p>{ar ? 'الجهة المستقبلة: PostHog US Cloud. لا يحدد راصد موعد حذف دوري لبيانات الإحصائيات السابقة؛ تُحتفظ إلى أن تطلب حذفها، مع مراعاة سياسات التخزين لدى المزود ومتطلبات القانون. لا نضمن بقاء البيانات للأبد. طلب الحذف يُنفذ إداريًا وليس لحظيًا. يصل عنوان الشبكة للمزود أثناء الاتصال حتى مع استبعاده من بيانات الإحصائيات المخزنة.' : 'Destination: PostHog US Cloud. RASED sets no scheduled expiry for previously sent analytics; they are retained until you request deletion, subject to the provider’s storage policies and applicable legal requirements. Permanent availability is not guaranteed. Deletion requests are handled administratively and are not immediate. The provider receives your network address during connection even when it is discarded from stored analytics.'}</p>
    <p className="hint">{ar ? 'التحقق النهائي من اكتمال حذف الأحداث لدى PostHog لم يكتمل بعد. يمكنك طلب الحذف؛ لن نؤكد اكتماله قبل التحقق من المزود، وقد تتأخر المعالجة.' : 'End-to-end verification of completed event deletion at PostHog is still pending. You can request deletion; completion will not be confirmed before provider verification, and processing may be delayed.'}</p>
    <div className="actions analytics-consent-actions">
      <button className="btn primary" disabled={busy || !status?.available || status.accessAllowed || status.purgePending} onClick={() => void action('enable')}>{ar ? 'أوافق وأستخدم راصد' : 'Agree & use RASED'}</button>
      {onboarding ? <button className="btn" disabled={busy} onClick={() => { void rased.confirmClose(true) }}>{ar ? 'خروج' : 'Exit'}</button> : <button className="btn" disabled={busy || !status} onClick={() => void action('disable')}>{ar ? 'سحب الموافقة وإيقاف الاستخدام' : 'Withdraw acceptance & stop using'}</button>}
    </div>
    <p className="hint">{ar ? 'الإيقاف يوقف الإرسال ويمسح الأحداث المحلية المؤجلة؛ لا يحذف ما وصل للخادم سابقًا.' : 'Stopping cancels sending and clears queued local events. It does not erase previously received server data.'}</p>
    {status?.state === 'enabled' && <p className="hint">{ar ? `أحداث مؤجلة: ${status.queued} · آخر قبول إرسال: ` : `Queued: ${status.queued} · Last accepted: `}<bdi>{lastAccepted}</bdi>{ar ? ` · حالة النقل: ${({idle:'جاهز',sending:'جارٍ الإرسال',retrying:'إعادة محاولة لاحقًا',rejected:'توقف بسبب رفض الإعداد',unavailable:'غير متاح'})[status.transport]}` : ` · Transport: ${status.transport}`}</p>}
    <h3>{ar ? 'طلب حذف بيانات سبق إرسالها' : 'Request deletion of previously sent data'}</h3>
    <p>{ar ? 'انسخ معرّف مشاركتك وتواصل مع المطور على واتساب: 01201780258. الطلب يُراجع ويُنفذ إداريًا؛ فتح واتساب أو نسخ المعرّف لا يعني اكتمال الحذف.' : 'Copy your analytics reference and contact the developer on WhatsApp: +20 120 178 0258. Deletion is reviewed and performed by the administrator; opening WhatsApp or copying the reference does not complete deletion.'}</p>
    <p className="hint">{ar ? 'احفظ المعرّف وأوقف المشاركة قبل طلب الحذف. بعد تأكيد اكتماله، انسَ المعرّف المحلي قبل تفعيل المشاركة مرة أخرى.' : 'Save the reference and stop sharing before requesting deletion. After completion is confirmed, forget the local reference before enabling sharing again.'}</p>
    {status?.reference && <>
      <code className="analytics-reference" dir="ltr">{status.reference}</code>
      <div className="actions">
        <button className="btn" onClick={() => void support('copy-reference')}>{ar ? 'نسخ معرّف المشاركة' : 'Copy analytics reference'}</button>
        <button className="btn" onClick={() => void support('contact')}>{ar ? 'فتح واتساب' : 'Open WhatsApp'}</button>
      </div>
      <button className="btn analytics-forget" disabled={busy} onClick={() => setForget(true)}>{ar ? 'نسيان المعرّف على هذا الجهاز' : 'Forget reference on this device'}</button>
    </>}
    {status?.purgePending && <div role="status"><p>{ar ? 'لم يكتمل النسيان المحلي. المشاركة متوقفة.' : 'Local forgetting is incomplete. Sharing is off.'}</p><button ref={retryRef} className="btn analytics-purge-retry" disabled={busy} onClick={() => void action('forget')}>{ar ? 'إعادة محاولة النسيان' : 'Retry forgetting'}</button></div>}
    {message && <p role="status">{message}</p>}
    {forget && <ConfirmDialog lang={lang} title={ar ? 'نسيان المعرّف المحلي؟' : 'Forget the local reference?'} body={ar ? 'احفظ المعرّف أولًا إذا أردت طلب حذف البيانات البعيدة. هذا الإجراء يوقف المشاركة وينسى المعرّف على الجهاز فقط؛ لا يحذف بيانات PostHog.' : 'Save the reference first if you want remote deletion. This stops sharing and forgets the local reference only; it does not delete PostHog data.'} confirmLabel={ar ? 'نسيان محليًا' : 'Forget locally'} onConfirm={() => void action('forget')} onCancel={() => setForget(false)} busy={busy} />}
  </section>
}
