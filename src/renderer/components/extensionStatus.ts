import { AI_ERROR_CODES, aiErrorText } from '@shared/ai.js'
import { useSyncExternalStore } from 'react'
import type { ExtensionStatus, JobPhase } from '@shared/extension/protocol.js'
import { rased } from '../api.js'

let status: ExtensionStatus | null = null
let unsubscribe: (() => void) | null = null
let unsubscribeSettings: (() => void) | null = null
let enabled: boolean | null = null
let generation = 0
const listeners = new Set<() => void>()
function publish(next: ExtensionStatus): void { status = next; for (const listener of listeners) listener() }
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribe) {
    const currentGeneration = ++generation
    let received = false
    unsubscribe = rased.onExtensionStatus(next => { received = true; publish(next) })
    void rased.getExtensionStatus().then(next => { if (currentGeneration === generation && !received && listeners.size) publish(next) }).catch(() => {})
    let settingsReceived = false
    const update = (value: boolean): void => { enabled = value; for (const notify of listeners) notify() }
    unsubscribeSettings = rased.onSettingsChanged(next => { settingsReceived = true; update(next.quickApply.enabled) })
    void rased.getSettings().then(next => { if (currentGeneration === generation && !settingsReceived && listeners.size) update(next.quickApply.enabled) }).catch(() => {})
  }
  return () => { listeners.delete(listener); if (!listeners.size) { generation++; unsubscribe?.(); unsubscribeSettings?.(); unsubscribe = null; unsubscribeSettings = null; status = null; enabled = null } }
}
export function useExtensionStatus(): ExtensionStatus | null { return useSyncExternalStore(subscribe, () => status) }
export function useQuickEnabled(): boolean | null { return useSyncExternalStore(subscribe, () => enabled) }
export function activePhase(phase: JobPhase): boolean { return ['waiting-client', 'opening', 'reading'].includes(phase) }

type Bilingual = [string, string]
const quickErrorMessages: Record<string, Bilingual> = {
  'consent-required': ['فعّل الموافقة الاختيارية من إعدادات المساعد أو وافق على هذا الطلب هنا.', 'Enable optional standing consent in Assistant settings or approve this request here.'],
  'no-key': ['أضف مفتاحًا قابلًا للقراءة للمزوّد النشط من إعدادات المساعد.', 'Add a readable key for the active provider in Assistant settings.'],
  'generation-failed': ['تعذر توليد العرض. حاول من صفحة المساعد.', 'Could not generate a proposal. Try from the Assistant page.'],
  blocked: ['اقبل تحليلات الاستخدام من شاشة بدء راصد (أو استخدم نافذة راصد الرئيسية) ثم أعد المحاولة', 'Accept usage analytics on the RASED start screen (or use the main RASED window), then retry'],
  'not-ready': ['أكمل تجهيز إضافة Chrome وربطها من إعدادات التقديم السريع ثم أعد المحاولة', 'Finish setting up and pairing the Chrome extension in Quick Apply settings, then retry'],
  disabled: ['فعّل التقديم السريع من الإعدادات ثم أعد المحاولة', 'Enable Quick Apply in Settings, then retry'],
  busy: ['هناك تجهيز آخر قيد التنفيذ — انتظر انتهاءه أو ألغه من الإعدادات ثم أعد المحاولة', 'A preparation is already running — wait for it or cancel it in Settings, then retry'],
  'unsupported-source': ['هذا المصدر غير مدعوم للتقديم السريع — مستقل ونفذلي فقط', 'Quick Apply supports Mostaql and Nafezly only'],
  'invalid-project': ['تعذر التعرف على هذا المشروع — أعد فتح القائمة وأعد المحاولة', 'This project could not be identified — reopen it, then retry'],
  'text-missing': ['نص العرض غير متوفر؛ راجعه من جديد', 'The proposal text is missing; review it again'],
  'text-changed': ['تغيّر نص العرض المحفوظ؛ راجعه من جديد.', 'The saved text changed; review it again.'],
  'text-empty': ['أضف قالبًا للبروفايل الافتراضي أو استخدم التقديم السريع بمساعد العروض', 'Add a template to the default profile or use Quick Apply with Assistant'],
  'draft-empty': ['العرض المحفوظ فارغ — اكتبه في مساعد العروض أو احذفه', 'The saved proposal is empty — write it in the Proposal Assistant or delete it'],
  'text-too-long': ['نص العرض أطول من الحد المسموح (10000 حرف) — اختصره ثم أعد المحاولة', 'The proposal text exceeds the 10,000-character limit — shorten it, then retry'],
  'message-too-large': ['نص العرض كبير جدًا على قناة الربط — اختصره ثم أعد المحاولة', 'The proposal text is too large for the bridge — shorten it, then retry'],
  'chrome-unavailable': ['تعذر فتح Chrome — افتح البروفايل المختار بنفسك وأعد المحاولة', 'Chrome could not be started — open your selected Chrome profile yourself and retry'],
  'login-required': ['سجّل دخولك إلى الموقع في بروفايل Chrome المختار ثم أعد المحاولة', 'Sign in to the website in your selected Chrome profile, then retry'],
  'form-unavailable': ['لم نجد حقول العرض في صفحة المشروع — تأكد أن الصفحة مفتوحة ثم أعد المحاولة', 'The proposal fields were not found on the project page — keep the project page open and retry'],
  'draft-exists': ['المسودة موجودة بالفعل في Chrome — راجعها وقدّمها أو احذفها ثم أعد المحاولة', 'A draft already exists in Chrome — review and submit it or clear it, then retry'],
  'template-too-long': ['نصك أطول من حد حقل العرض في الموقع — اختصره ثم أعد المحاولة', 'The website field is shorter than your text — shorten it, then retry'],
  'client-timeout': ['لم يتصل بروفايل Chrome المختار خلال المهلة — افتحه بنفسك وأعد المحاولة', 'The selected Chrome profile did not connect in time — open it yourself and retry'],
  'form-timeout': ['انتهت مهلة نموذج الموقع — أعد التجهيز ثم أكمل في Chrome', 'The website form timed out — prepare again, then finish in Chrome'],
  'connection-lost': ['قطع الاتصال مع إضافة Chrome — أعد تحميل الإضافة وأعد المحاولة', 'Connection to the Chrome extension dropped — reload the extension and retry'],
  'tab-closed': ['أُغلق تبويب المشروع أثناء التجهيز — أعد المحاولة ولا تغلق التبويب', 'The project tab was closed during preparation — retry and keep the tab open'],
  'navigation-changed': ['انتقل التبويب بعيدًا عن صفحة المشروع — أعد المحاولة وابقَ في الصفحة', 'The tab moved away from the project page — retry and stay on the page'],
  'user-cancelled': ['أُلغي التجهيز قبل اكتماله — أعد المحاولة', 'Preparation was cancelled before finishing — retry'],
  'app-restarted': ['أُعيد تشغيل راصد وتوقفت التجهيزات قيد التنفيذ — أعد المحاولة', 'RASED restarted and the running preparations stopped — retry']
}
const quickErrorGeneral: Bilingual = ['تعذر تجهيز العرض — أعد المحاولة', 'Preparation failed — retry']
export function quickErrorText(error: string | undefined, ar: boolean): string {
  if (error && (AI_ERROR_CODES as readonly string[]).includes(error) && !quickErrorMessages[error]) return aiErrorText(error, ar)
  return ((error && quickErrorMessages[error]) || quickErrorGeneral)[ar ? 0 : 1]
}
export function phaseText(phase: JobPhase, ar: boolean, error?: string): string {
  const labels: Record<JobPhase, Bilingual> = {
    'waiting-client': ['في انتظار بروفايل Chrome المختار', 'Waiting for your selected Chrome profile'],
    opening: ['جارٍ فتح المشروع', 'Opening the project'], reading: ['جارٍ قراءة النموذج', 'Reading the form'],
    ready: ['المسودة جاهزة — راجعها وقدّم بنفسك', 'Draft ready — review and submit yourself'],
    'needs-input': ['أكمل السعر أو المدة في Chrome', 'Complete price or duration in Chrome'],
    'needs-login': ['سجّل دخولك في الموقع ثم أعد المحاولة', 'Sign in on the website, then retry'],
    'draft-exists': ['احتفظنا بالمسودة الموجودة', 'Existing draft preserved'],
    failed: ['تعذر التجهيز — أعد المحاولة', 'Preparation failed — retry'],
    cancelled: ['أُلغي التجهيز', 'Preparation cancelled'], expired: ['انتهت المهلة — افتح البروفايل المختار وأعد المحاولة', 'Timed out — open the selected profile and retry']
  }
  const base = labels[phase][ar ? 0 : 1]
  const known = !!error && Object.hasOwn(quickErrorMessages, error) && ['failed', 'needs-login', 'expired'].includes(phase)
  return known ? `${base} — ${quickErrorText(error, ar)}` : base
}
