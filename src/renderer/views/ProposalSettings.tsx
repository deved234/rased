import React from 'react'
import { rased } from '../api.js'
import { registerNavigationBlocker } from '../router.js'
import type { Lang } from '../i18n.js'
import { emptyProposalProfile, type ProposalProfile } from '@shared/proposals.js'

import { AI_NAMES, aiErrorText, defaultAiSettings, sanitizeSelection, type AiSettings, type AiSetup } from '@shared/ai.js'
import { AiModelPicker } from '../components/AiModelPicker.js'

export function ProposalSettings({ lang }: { lang: Lang }): React.ReactElement {
  const ar = lang === 'ar'
  const [profile, setProfile] = React.useState<ProposalProfile>(emptyProposalProfile())
  const [savedProfile, setSavedProfile] = React.useState<ProposalProfile>(emptyProposalProfile())
  const [setup, setSetup] = React.useState<AiSetup | null>(null)
  const [aiSettings, setAiSettings] = React.useState<AiSettings>(defaultAiSettings())
  const [savedAiSettings, setSavedAiSettings] = React.useState<AiSettings>(defaultAiSettings())
  const [busy, setBusy] = React.useState(false)
  const provider = aiSettings.activeProvider
  const selection = { provider, model: aiSettings.modelByProvider[provider] }
  const status = setup?.providers[provider]
  const hasKey = status?.hasKey ?? false
  const aiDirty = JSON.stringify(aiSettings) !== JSON.stringify(savedAiSettings)
  const [key, setKey] = React.useState('')
  const [message, setMessage] = React.useState('')
  React.useEffect(() => {
    let alive = true
    void Promise.all([rased.getProposalSetup(), rased.getAiSetup()]).then(([profileSetup, ai]) => {
      if (!alive) return
      setProfile(profileSetup.profile); setSavedProfile(profileSetup.profile)
      setSetup(ai); setAiSettings(ai.settings); setSavedAiSettings(ai.settings)
    }).catch(() => alive && setMessage(aiErrorText('network-error', ar)))
    return () => { alive = false; void rased.cancelProposal() }
  }, [ar])
  const dirtyRef = React.useRef(false)
  dirtyRef.current = JSON.stringify(profile) !== JSON.stringify(savedProfile) || aiDirty || !!key
  React.useEffect(() => registerNavigationBlocker(() => !dirtyRef.current || window.confirm(ar ? 'لديك تعديلات غير محفوظة. هل تريد المغادرة؟' : 'You have unsaved settings or a key. Leave?')), [ar])
  const set = (field: keyof ProposalProfile, value: string): void => setProfile(p => ({ ...p, [field]: value }))
  const reload = async (): Promise<void> => setSetup(await rased.getAiSetup())
  const saveKey = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await rased.saveAiKey(provider, key)
      if (result.ok) { setKey(''); await reload(); setMessage(ar ? 'تم حفظ المفتاح مشفرًا على هذا الجهاز؛ لم يُختبر الاتصال بعد.' : 'Key encrypted on this device; connection has not been tested.') }
      else setMessage(aiErrorText(result.error, ar))
    } catch { setMessage(aiErrorText('key-save-failed', ar)) }
    finally { setBusy(false) }
  }
  const test = async (): Promise<void> => {
    if (!sanitizeSelection(selection) || !window.confirm(ar ? 'سيُرسل طلب ببيانات وهمية إلى الموفر المختار وقد يستهلك رصيدًا أو حصة. متابعة؟' : 'Send a synthetic test to this provider? It may consume credits or quota.')) return
    setBusy(true); setMessage('')
    try {
      const result = await rased.testAiModel(selection)
      setMessage(result.ok ? (ar ? `نجح اختبار الموديل (${result.elapsedMs} مللي ثانية).` : `Model test succeeded (${result.elapsedMs} ms).`) : aiErrorText(result.error, ar, result.retryAfterSeconds))
      await reload()
    } catch { setMessage(aiErrorText('network-error', ar)) }
    finally { setBusy(false) }
  }
  return <div className="set-group proposal-settings">
    <h2>{ar ? 'مساعد العروض' : 'Proposal Assistant'}</h2>
    <p className="desc">{ar ? 'اختر الشركة والموديل. لا تُولّد عروض ولا تُرسل بيانات مشاريع تلقائيًا أثناء الرصد.' : 'Choose a provider and model. No project data is sent or draft generated while watching.'}</p>
    <AiModelPicker ar={ar} setup={setup} selection={selection} disabled={busy || !setup} onSetup={setSetup} onChange={next => {
      if (next.provider !== provider) setKey('')
      setMessage(''); setAiSettings(prev => ({ ...prev, activeProvider: next.provider, modelByProvider: { ...prev.modelByProvider, [next.provider]: next.model } }))
    }} />
    <button className="btn primary sm" disabled={busy || !aiDirty} onClick={() => void rased.saveAiSettings(aiSettings).then(async result => {
      if (result.ok) { setSavedAiSettings(aiSettings); await reload() }
      setMessage(result.ok ? (ar ? 'تم حفظ اختيار الموفر والموديلات.' : 'Provider and model defaults saved.') : aiErrorText('bad-request', ar))
    }).catch(() => setMessage(aiErrorText('network-error', ar)))}>{ar ? 'حفظ إعدادات المساعد' : 'Save assistant settings'}</button>
    <h3>{ar ? 'المفتاح والاتصال' : 'Key and connection'}</h3>
    <div className="set-row"><label htmlFor="ai-key">{AI_NAMES[provider]} API key</label><span className={hasKey ? 'tag good' : 'tag uncertain'}>{hasKey ? (ar ? 'محفوظ' : 'Saved') : (ar ? 'غير محفوظ' : 'Not saved')}</span></div>
    {hasKey && !status?.keyReadable && <p className="field-err">{aiErrorText('key-unreadable', ar)}</p>}
    <input id="ai-key" className="input" dir="ltr" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} maxLength={4096} onChange={e => setKey(e.target.value)} placeholder={ar ? 'الصق مفتاح هذا الموفر' : 'Paste this provider’s key'} />
    <div className="row-actions"><button className="btn primary sm" disabled={!key || busy} onClick={() => void saveKey()}>{ar ? 'حفظ المفتاح' : 'Save key'}</button><button className="btn danger sm" disabled={!hasKey || busy} onClick={() => {
      if (!window.confirm(ar ? 'حذف مفتاح هذا الموفر فقط؟' : 'Delete only this provider’s key?')) return
      setBusy(true)
      void rased.deleteAiKey(provider).then(async result => { if (result.ok) { setKey(''); await reload() }; setMessage(result.ok ? (ar ? 'تم حذف المفتاح.' : 'Key deleted.') : aiErrorText(result.error, ar)) }).catch(() => setMessage(aiErrorText('key-save-failed', ar))).finally(() => setBusy(false))
    }}>{ar ? 'حذف المفتاح' : 'Delete key'}</button></div>
    <p className="hint">{ar ? 'المفاتيح مستقلة ومشفرة بحماية Windows، خارج قاعدة البيانات والتصدير. حفظ المفتاح لا يثبت صلاحيته. الاستخدام والحصة والتكلفة حسب حسابك لدى الشركة.' : 'Separate Windows-encrypted keys stay outside the database and exports. Saving does not verify a key. Quotas and costs depend on your provider account.'}</p>
    {status?.verification?.model === selection.model && <p className="tag good">{ar ? 'آخر توليد ناجح: ' : 'Last successful generation: '}{new Date(status.verification.testedAt).toLocaleString(ar ? 'ar-EG' : 'en-US')}</p>}
    <div className="row-actions"><button className="btn sm" disabled={busy || !status?.keyReadable || !sanitizeSelection(selection)} onClick={() => void test()}>{ar ? 'اختبار التوليد' : 'Test generation'}</button>{busy && <button className="btn sm" onClick={() => void rased.cancelProposal()}>{ar ? 'إلغاء الاختبار' : 'Cancel test'}</button>}</div>
    <p className="hint">{ar ? 'الاختبار يستخدم بيانات وهمية فقط. الموديلات الجديدة قد تحتاج اختبار توافق؛ لا ننتقل إلى موفر آخر عند الفشل.' : 'Tests use synthetic data only. New models may require compatibility testing; failures never switch provider automatically.'}</p>
    <p className="hint">{ar ? 'قبل التوليد ستراجع البيانات والشركة المستقبلة. راجع الخصوصية وشروط API؛ لا تشارك بيانات سرية دون إذن.' : 'Review input and its recipient before generating. Read API terms and privacy policies; do not send confidential data without permission.'}</p>
    <h3>{ar ? 'ملفك المهني' : 'Your freelancer profile'}</h3>
    <p className="hint">{ar ? 'اكتب حقائق حقيقية فقط. المعلومات دي هتظهر في المعاينة قبل إرسالها.' : 'Enter only real facts. You will preview these before sending.'}</p>
    {([['skills', ar ? 'المهارات' : 'Skills', 2000], ['experience', ar ? 'الخبرة' : 'Experience', 3000], ['portfolio', ar ? 'نماذج الأعمال والروابط' : 'Portfolio examples and links', 3000], ['tone', ar ? 'أسلوب العرض' : 'Proposal tone', 500]] as const).map(([field, label, max]) => <div key={field} className="proposal-field"><label htmlFor={`profile-${field}`}>{label}</label><textarea id={`profile-${field}`} className="textarea" dir="auto" maxLength={max} value={profile[field]} onChange={e => set(field, e.target.value)} /></div>)}
    <div className="set-row"><label htmlFor="profile-language">{ar ? 'لغة العرض' : 'Proposal language'}</label><select id="profile-language" className="select" value={profile.language} onChange={e => set('language', e.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></div>
    <div className="row-actions"><button className="btn primary sm" disabled={JSON.stringify(profile) === JSON.stringify(savedProfile) || busy} onClick={() => void rased.saveProposalProfile(profile).then(r => { if (r.ok) setSavedProfile(profile); setMessage(r.ok ? (ar ? 'تم حفظ الملف الشخصي محليًا.' : 'Profile saved locally.') : (ar ? 'تعذر حفظ الملف الشخصي.' : 'Could not save profile.')) })}>{ar ? 'حفظ الملف الشخصي' : 'Save profile'}</button><button className="btn danger sm" onClick={() => { if (window.confirm(ar ? 'مسح الملف الشخصي؟' : 'Clear profile?')) void rased.saveProposalProfile(emptyProposalProfile()).then(() => { setProfile(emptyProposalProfile()); setSavedProfile(emptyProposalProfile()); setMessage(ar ? 'تم مسح الملف الشخصي.' : 'Profile cleared.') }) }}>{ar ? 'مسح الملف' : 'Clear profile'}</button></div>
    {message && <p className="meta" role="status">{message}</p>}
  </div>
}
