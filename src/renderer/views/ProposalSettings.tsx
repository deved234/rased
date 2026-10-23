import React from 'react'
import { rased } from '../api.js'
import { useUnsavedChanges } from '../components/useUnsavedChanges.js'
import type { Lang } from '../i18n.js'
import { sanitizeProfileSet, type ProfileSet } from '@shared/proposalProfiles.js'
import { ProfileEditor } from '../components/ProfileEditor.js'

import { AI_NAMES, aiErrorText, defaultAiSettings, sanitizeSelection, type AiSettings, type AiSetup } from '@shared/ai.js'
import { AiModelPicker } from '../components/AiModelPicker.js'

export function ProposalSettings({ lang }: { lang: Lang }): React.ReactElement {
  const ar = lang === 'ar'
  const [profiles, setProfiles] = React.useState<ProfileSet | null>(null)
  const [savedProfiles, setSavedProfiles] = React.useState<ProfileSet | null>(null)
  const [profileError, setProfileError] = React.useState(false)
  const profileDirty = JSON.stringify(profiles) !== JSON.stringify(savedProfiles)
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
  const [messageSection, setMessageSection] = React.useState<'key' | 'model' | 'profile' | 'all'>('all')
  const [showKey, setShowKey] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    void Promise.all([rased.getProfileSet(), rased.getAiSetup()]).then(([profileSetup, ai]) => {
      if (!alive) return
      setProfiles(profileSetup.set); setSavedProfiles(profileSetup.set); setProfileError(!!profileSetup.error)
      setSetup(ai); setAiSettings(ai.settings); setSavedAiSettings(ai.settings)
    }).catch(() => alive && setMessage(aiErrorText('network-error', ar)))
    return () => { alive = false; void rased.cancelProposal() }
  }, [])
  const dirty = profileDirty || aiDirty || !!key
  const saveAll = async (): Promise<boolean> => {
    if (busy || !setup || !sanitizeSelection(selection)) return false
    setBusy(true)
    try {
      if (key) { const result = await rased.saveAiKey(provider, key); if (!result.ok) { setMessage(aiErrorText(result.error, ar)); return false }; setKey('') }
      const config = await rased.saveAiSettings(aiSettings)
      if (!config.ok) return false
      setSavedAiSettings(aiSettings)
      if (profileDirty && !(await persistProfiles(profiles))) return false
      await reload()
      setMessage(ar ? 'تم حفظ تعديلاتك محليًا.' : 'Your changes were saved locally.')
      return true
    } catch { setMessage(aiErrorText('network-error', ar)); return false }
    finally { setBusy(false) }
  }
  const unsavedDialog = useUnsavedChanges(dirty, ar, saveAll)
  const persistProfiles = async (value: ProfileSet | null): Promise<boolean> => {
    if (profileError || !sanitizeProfileSet(value)) return false
    const result = await rased.saveProfileSet(value!)
    if (!result.ok) { setMessage(ar ? 'تعذر حفظ الملفات المهنية.' : 'Could not save profiles.'); return false }
    const state = await rased.getProfileSet()
    setProfiles(state.set); setSavedProfiles(state.set); setProfileError(!!state.error)
    setMessage(ar ? 'تم حفظ الملفات المهنية محليًا.' : 'Profiles saved locally.')
    return true
  }
  const saveProfiles = (value: ProfileSet): void => {
    setMessageSection('profile'); setBusy(true)
    void persistProfiles(value).catch(() => setMessage(aiErrorText('network-error', ar))).finally(() => setBusy(false))
  }
  const reload = async (): Promise<void> => setSetup(await rased.getAiSetup())
  const saveKey = async (): Promise<void> => {
    setMessageSection('key'); setBusy(true)
    try {
      const result = await rased.saveAiKey(provider, key)
      if (result.ok) { setKey(''); await reload(); setMessage(ar ? 'تم حفظ المفتاح مشفرًا على هذا الجهاز؛ لم يُختبر الاتصال بعد.' : 'Key encrypted on this device; connection has not been tested.') }
      else setMessage(aiErrorText(result.error, ar))
    } catch { setMessage(aiErrorText('key-save-failed', ar)) }
    finally { setBusy(false) }
  }
  const test = async (): Promise<void> => {
    if (!sanitizeSelection(selection) || !window.confirm(ar ? 'سيُرسل طلب ببيانات وهمية إلى الموفر المختار وقد يستهلك رصيدًا أو حصة. متابعة؟' : 'Send a synthetic test to this provider? It may consume credits or quota.')) return
    setMessageSection('model'); setBusy(true); setMessage('')
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
    <div className="readiness-summary"><strong>{hasKey ? (ar ? 'مفتاح محفوظ' : 'Key saved') : (ar ? 'ابدأ بإضافة مفتاح' : 'Start by adding a key')}</strong><span>{status?.verification?.model === selection.model ? (ar ? 'الموديل اختُبر بنجاح' : 'Model verified') : (ar ? 'لم يُتحقق من الموديل المختار' : 'Selected model not verified')}</span></div>
    <div className="set-row"><label htmlFor="setup-provider">{ar ? '1. الشركة' : '1. Provider'}</label><select id="setup-provider" className="select" disabled={busy || !setup} value={provider} onChange={e => {
      if (key && !window.confirm(ar ? 'تجاهل المفتاح غير المحفوظ وتغيير الشركة؟' : 'Discard the unsaved key and switch provider?')) return
      setKey(''); setShowKey(false); setMessage(''); setAiSettings(previous => ({ ...previous, activeProvider: e.target.value as AiSettings['activeProvider'] }))
    }}>{Object.entries(AI_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
    <h3>{ar ? '2. المفتاح والاتصال' : '2. Key and connection'}</h3>
    <div className="set-row"><label htmlFor="ai-key">{AI_NAMES[provider]} API key</label><span className={hasKey ? 'tag good' : 'tag uncertain'}>{hasKey ? (ar ? 'محفوظ' : 'Saved') : (ar ? 'غير محفوظ' : 'Not saved')}</span></div>
    {hasKey && !status?.keyReadable && <p className="field-err">{aiErrorText('key-unreadable', ar)}</p>}
    <input id="ai-key" className="input" dir="ltr" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={key} disabled={busy} maxLength={4096} onChange={e => setKey(e.target.value)} placeholder={ar ? 'الصق مفتاح هذا الموفر' : 'Paste this provider’s key'} />
    <button className="btn ghost sm" aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>{showKey ? (ar ? 'إخفاء المفتاح' : 'Hide key') : (ar ? 'إظهار المفتاح' : 'Show key')}</button>
    <div className="row-actions"><button className="btn primary sm" disabled={!key || busy} onClick={() => void saveKey()}>{ar ? 'حفظ المفتاح' : 'Save key'}</button><button className="btn danger sm" disabled={!hasKey || busy} onClick={() => {
      if (!window.confirm(ar ? 'حذف مفتاح هذا الموفر فقط؟' : 'Delete only this provider’s key?')) return
      setMessageSection('key'); setBusy(true)
      void rased.deleteAiKey(provider).then(async result => { if (result.ok) { setKey(''); await reload() }; setMessage(result.ok ? (ar ? 'تم حذف المفتاح.' : 'Key deleted.') : aiErrorText(result.error, ar)) }).catch(() => setMessage(aiErrorText('key-save-failed', ar))).finally(() => setBusy(false))
    }}>{ar ? 'حذف المفتاح' : 'Delete key'}</button></div>
    <p className="hint">{ar ? 'المفاتيح مستقلة ومشفرة بحماية Windows، خارج قاعدة البيانات والتصدير. حفظ المفتاح لا يثبت صلاحيته. الاستخدام والحصة والتكلفة حسب حسابك لدى الشركة.' : 'Separate Windows-encrypted keys stay outside the database and exports. Saving does not verify a key. Quotas and costs depend on your provider account.'}</p>
    {status?.verification?.model === selection.model && <p className="tag good">{ar ? 'آخر توليد ناجح: ' : 'Last successful generation: '}{new Date(status.verification.testedAt).toLocaleString(ar ? 'ar-EG' : 'en-US')}</p>}
    <p className="hint">{ar ? 'في التوليد اليدوي ستراجع البيانات والشركة المستقبلة. راجع الخصوصية وشروط API؛ لا تشارك بيانات سرية دون إذن.' : 'For manual generation, review input and its recipient first. Read API terms and privacy policies; do not send confidential data without permission.'}</p>
    {message && messageSection === 'key' && <p className="inline-feedback" role="status">{message}</p>}
    <h3>{ar ? '3. الموديل والإعدادات الافتراضية' : '3. Model and defaults'}</h3>
    <AiModelPicker hideProvider ar={ar} setup={setup} selection={selection} disabled={busy || !setup} onSetup={setSetup} onChange={next => {
      if (next.provider !== provider) { if (key && !window.confirm(ar ? 'تجاهل المفتاح غير المحفوظ؟' : 'Discard the unsaved key?')) return; setKey(''); setShowKey(false) }
      setMessage(''); setAiSettings(prev => ({ ...prev, activeProvider: next.provider, modelByProvider: { ...prev.modelByProvider, [next.provider]: next.model } }))
    }} />
    <button className="btn primary sm" disabled={busy || !aiDirty} onClick={() => { setMessageSection('model'); setBusy(true); void rased.saveAiSettings(aiSettings).then(async result => {
      if (result.ok) { setSavedAiSettings(aiSettings); await reload() }
      setMessage(result.ok ? (ar ? 'تم حفظ اختيار الموفر والموديلات.' : 'Provider and model defaults saved.') : aiErrorText('bad-request', ar))
    }).catch(() => setMessage(aiErrorText('network-error', ar))).finally(() => setBusy(false)) }}>{ar ? 'حفظ إعدادات المساعد' : 'Save assistant settings'}</button>
    <div className="row-actions"><button className="btn sm" disabled={busy || !status?.keyReadable || !sanitizeSelection(selection)} onClick={() => void test()}>{ar ? 'اختبار التوليد' : 'Test generation'}</button>{busy && <button className="btn sm" onClick={() => void rased.cancelProposal()}>{ar ? 'إلغاء الاختبار' : 'Cancel test'}</button>}</div>
    <p className="hint">{ar ? 'الاختبار يستخدم بيانات وهمية فقط. الموديلات الجديدة قد تحتاج اختبار توافق؛ لا ننتقل إلى موفر آخر عند الفشل.' : 'Tests use synthetic data only. New models may require compatibility testing; failures never switch provider automatically.'}</p>
    {message && messageSection === 'model' && <p className="inline-feedback" role="status">{message}</p>}
    <section className="quick-consent-settings">
      <h3>{ar ? 'التقديم السريع بمساعد العروض (اختياري)' : 'Quick Apply with Assistant (optional)'}</h3>
      <p id="quick-consent-description" className="hint">{ar ? `عند كل نقرة، إذا لم توجد مسودة محفوظة، تُرسل بيانات المشروع العامة (العنوان والوصف والتصنيف والمهارات والميزانية) وملفك المهني إلى ${AI_NAMES[provider]} / ${selection.model} بلا معاينة. لا تُرسل الملاحظات الخاصة. تنطبق رسوم وحصص وسياسات المزوّد. تُعاد استخدام المسودة المحفوظة دون توليد. راجع العرض في Chrome وقدّمه بنفسك. يمكنك سحب الموافقة هنا؛ لا تُنقل بالتصدير أو النسخ الاحتياطي.` : `On each click, if no saved draft exists, public project data (title, description, category, skills, budget) and your freelancer profile are sent to ${AI_NAMES[provider]} / ${selection.model} without a preview. Private notes are excluded. Provider charges, quotas and policies apply. Saved drafts are reused without generation. Review in Chrome and submit yourself. Withdraw consent here; it is excluded from exports and backups.`}</p>
      <label><input id="ai-quick-consent" type="checkbox" aria-describedby="quick-consent-description" checked={!!setup?.quickConsent} disabled={busy || (!setup?.quickConsent && (aiDirty || !status?.keyReadable || !sanitizeSelection(selection)))} onChange={e => {
        const enabled = e.target.checked
        setBusy(true)
        void rased.setQuickConsent(enabled, selection).then(async result => { if (!result.ok) setMessage(aiErrorText('bad-request', ar)); await reload() }).catch(() => setMessage(aiErrorText('network-error', ar))).finally(() => setBusy(false))
      }} /> {ar ? 'اسمح بالتقديم السريع بمساعد العروض' : 'Allow Quick Apply with Assistant'}</label>
      {aiDirty && <p className="hint">{ar ? 'احفظ اختيار المزوّد والموديل أولًا.' : 'Save the provider and model selection first.'}</p>}
    </section>
    <ProfileEditor ar={ar} value={profiles} saved={savedProfiles} error={profileError} busy={busy} onChange={setProfiles} onSave={saveProfiles} onRecover={() => {
      setBusy(true); setMessageSection('profile')
      void rased.recoverProfileSet().then(async result => { if (!result.ok) throw Error(); const state = await rased.getProfileSet(); setProfiles(state.set); setSavedProfiles(state.set); setProfileError(!!state.error) }).catch(() => setMessage(ar ? 'تعذرت إعادة الإنشاء.' : 'Recovery failed.')).finally(() => setBusy(false))
    }} />

    {message && messageSection === 'profile' && <p className="inline-feedback" role="status">{message}</p>}
    {message && messageSection === 'all' && <p className="inline-feedback" role="status">{message}</p>}
    {unsavedDialog}
  </div>
}
