import React from 'react'
import { rased } from '../api.js'
import { go } from '../router.js'
import { useUnsavedChanges } from '../components/useUnsavedChanges.js'
import type { Lang } from '../i18n.js'
import type { ProposalDraft, ProposalPreview } from '@shared/proposals.js'

import { AI_NAMES, aiErrorText, defaultAiSettings, sanitizeSelection, type AiSelection, type AiSetup } from '@shared/ai.js'
import { AiModelPicker } from '../components/AiModelPicker.js'

export function ProposalView({ lang, projectId }: { lang: Lang; projectId: number }): React.ReactElement {
  const ar = lang === 'ar'
  const [preview, setPreview] = React.useState<ProposalPreview | null>(null)
  const [previewLoaded, setPreviewLoaded] = React.useState(false)
  const [draft, setDraft] = React.useState<ProposalDraft | null>(null)
  const [saved, setSaved] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [setup, setSetup] = React.useState<AiSetup | null>(null)
  const [selection, setSelection] = React.useState<AiSelection>({ provider: 'gemini', model: defaultAiSettings().modelByProvider.gemini })
  const hasKey = setup?.providers[selection.provider].keyReadable ?? false
  const previewSequence = React.useRef(0)
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [loadEpoch, setLoadEpoch] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const dirtyRef = React.useRef(false)
  const draftRef = React.useRef<ProposalDraft | null>(null)
  draftRef.current = draft
  dirtyRef.current = !!draft && draft.proposal !== saved

  React.useEffect(() => {
    let alive = true
    setPreview(null); setConsent(false); setBusy(false); setNotes(''); setError(''); setPreviewLoaded(false)
    void Promise.all([rased.getAiSetup(), rased.getProposalDraft(projectId), rased.getProposalPreview(projectId, '')]).then(([setup, existing, p]) => {
      if (!alive) return
      setSetup(setup)
      setSelection({ provider: setup.settings.activeProvider, model: setup.settings.modelByProvider[setup.settings.activeProvider] })
      setDraft(existing)
      setSaved(existing?.proposal ?? '')
      setPreview(p)
      setPreviewLoaded(true)
    }).catch(() => alive && setError(ar ? 'تعذر تحميل مساعد العروض.' : 'Could not load Proposal Assistant.'))
    return () => { alive = false; previewSequence.current++; void rased.cancelProposal() }
  }, [projectId, loadEpoch])

  const refresh = async (): Promise<void> => {
    const seq = ++previewSequence.current
    setConsent(false)
    try { const p = await rased.getProposalPreview(projectId, notes, selection); if (seq !== previewSequence.current) return; setPreview(p); setPreviewLoaded(true); setError(p ? '' : aiErrorText('bad-request', ar)) }
    catch { setError(ar ? 'تعذرت المعاينة.' : 'Preview failed.') }
  }
  const generate = async (): Promise<void> => {
    if (!preview || !consent || !hasKey || busy) return
    if (dirtyRef.current && !window.confirm(ar ? 'سيستبدل التوليد الجديد تعديلاتك غير المحفوظة. متابعة؟' : 'New generation will replace your unsaved draft edits. Continue?')) return
    const seq = previewSequence.current
    setBusy(true); setConsent(false); setError('')
    try {
      const result = await rased.generateProposal(projectId, notes, preview.fingerprint, selection)
      if (seq !== previewSequence.current) return
      if (!result.ok || !result.draft) { setError(aiErrorText(result.error, ar, result.retryAfterSeconds)); return }
      setDraft(result.draft)
      setSaved(result.draft.proposal)
    } catch { if (seq === previewSequence.current) setError(aiErrorText('network-error', ar)) }
    finally { if (seq === previewSequence.current) setBusy(false) }
  }
  const save = async (): Promise<boolean> => {
    const current = draftRef.current
    if (!current || busy || saving) return false
    setSaving(true)
    try {
      const result = await rased.saveProposalDraft(current)
      if (!result.ok) { setError(ar ? 'تعذر حفظ المسودة.' : 'Could not save draft.'); return false }
      setSaved(current.proposal); setError(''); return true
    } catch { setError(ar ? 'تعذر حفظ المسودة. تعديلاتك ما زالت هنا.' : 'Could not save. Your edits are still here.'); return false } finally { setSaving(false) }
  }
  const unsavedDialog = useUnsavedChanges(dirtyRef.current, ar, save)
  const copy = async (): Promise<void> => {
    if (!draft) return
    try { await navigator.clipboard.writeText(draft.proposal); setCopied(true); setTimeout(() => setCopied(false), 2200) }
    catch { setError(ar ? 'تعذر النسخ.' : 'Copy failed.') }
  }
  const open = async (): Promise<void> => {
    let result
    try { result = await rased.openProjectExternal(projectId) } catch { setError(ar ? 'تعذر فتح المتصفح.' : 'Could not open browser.'); return }
    if (!result.ok) setError(ar ? 'تعذر فتح المشروع في المتصفح.' : 'Could not open project in browser.')
  }

  return <div className="proposal-page">
    <button className="btn ghost sm" onClick={() => go({ name: 'project', id: projectId })}>{ar ? 'المشروع →' : '← Project'}</button>
    <div className="proposal-hero"><span className="tag" dir="ltr">{AI_NAMES[selection.provider]}</span><h2>{ar ? 'مساعد العروض' : 'Proposal Assistant'}</h2><p className="muted">{ar ? 'مسودة قابلة للتعديل. راجعها ثم قدمها بنفسك على مستقل.' : 'An editable draft. Review it, then submit it yourself on Mostaql.'}</p></div>
    {!hasKey && <div className="banner warn">{ar ? 'أضف مفتاح الموفر المختار من الإعدادات.' : 'Add this provider’s API key in Settings.'} <button className="btn sm" onClick={() => go({ name: 'settings', section: 'ai' })}>{ar ? 'إعدادات المساعد' : 'Assistant settings'}</button></div>}
    <section className="proposal-card"><h3>{ar ? 'الموفر والموديل لهذا العرض' : 'Provider and model for this proposal'}</h3>
      <AiModelPicker ar={ar} setup={setup} selection={selection} disabled={busy} onSetup={next => { setSetup(next); setPreview(null); setConsent(false); previewSequence.current++ }} onChange={next => { setSelection(next); setPreview(null); setConsent(false); setError(''); previewSequence.current++ }} />
      <p className="hint">{ar ? 'هذا اختيار مؤقت؛ الافتراضي في الإعدادات لا يتغير.' : 'This is a temporary selection; your saved default stays unchanged.'}</p>
    </section>
    <section className="proposal-card"><h3>{ar ? 'البيانات التي ستُرسل' : 'Data to be sent'}</h3>
      <p className="muted">{ar ? 'لا تُرسل بيانات هذا العرض إلا بعد ضغط توليد إلى الشركة المختارة. ملاحظاتك الشخصية على المشروع غير مدرجة.' : 'This proposal’s data goes to the selected provider only after you press Generate. Your private project note is not included.'}</p>
      {preview ? <>
        <p className="tag" dir="ltr">{AI_NAMES[preview.provider]} · {preview.model}</p>
        <div className="proposal-fields"><strong dir="auto">{preview.title}</strong><span className="tag uncertain">{preview.provenance === 'full' ? (ar ? 'وصف كامل' : 'Full description') : (ar ? 'وصف غير كامل' : 'Incomplete description')}</span></div>
        <details><summary>{ar ? 'عرض نص المشروع والملف الشخصي المرسل' : 'Show project text and profile sent'}</summary>
          <pre className="proposal-preview" dir="auto">{preview.description}</pre>
          <p>{ar ? 'التصنيف' : 'Category'}: {preview.category ?? '—'} · {ar ? 'المهارات' : 'Skills'}: {preview.skills.join('، ') || '—'} · {ar ? 'الميزانية' : 'Budget'}: {preview.budget ?? '—'}</p>
          <dl className="profile-preview">{Object.entries(preview.profile).map(([field,value])=><div key={field}><dt>{({skills:ar?'المهارات':'Skills',experience:ar?'الخبرة':'Experience',portfolio:ar?'الأعمال':'Portfolio',tone:ar?'أسلوب العرض':'Tone',language:ar?'اللغة':'Language'} as Record<string,string>)[field]??field}</dt><dd dir="auto">{String(value)||'—'}</dd></div>)}</dl>
          {preview.projectNotes && <p dir="auto">{preview.projectNotes}</p>}
        </details>
      </> : <p className="muted">{previewLoaded ? (ar ? 'المعاينة غير متاحة أو تحتاج تحديثًا بعد تعديل التفاصيل.' : 'Preview unavailable or needs refreshing after editing notes.') : (ar ? 'جارٍ تحميل المشروع…' : 'Loading project…')}</p>}
      <label htmlFor="proposal-notes">{ar ? 'تفاصيل إضافية لهذا العرض فقط (اختياري)' : 'Notes for this proposal only (optional)'}</label>
      <textarea id="proposal-notes" className="textarea" dir="auto" maxLength={2000} value={notes} disabled={busy} onChange={e => { previewSequence.current++; setNotes(e.target.value); setPreview(null); setConsent(false) }} />
      <button className="btn sm" disabled={busy || !sanitizeSelection(selection)} onClick={() => void refresh()}>{ar ? 'تحديث المعاينة' : 'Refresh preview'}</button>
      <p className="muted small">{ar ? 'تخضع البيانات لسياسات API للشركة المختارة؛ قد تُحفظ أو تُراجع حسب حسابك وخطتك. لا ترسل بيانات سرية دون إذن. قد تنطبق رسوم وحصص.' : 'Input is subject to the selected provider’s API policies; retention and review depend on your account and plan. Do not send confidential data without permission. Charges and quotas may apply.'}{selection.provider === 'gemini' && (ar ? ' خدمة Gemini المجانية قد تستخدم المدخلات والمخرجات للتحسين والمراجعة البشرية.' : ' Unpaid Gemini input and output may be used for improvement and human review.')} <button className="btn ghost sm" onClick={() => go({ name: 'settings', section: 'legal' })}>{ar ? 'الخصوصية والشروط' : 'Privacy and terms'}</button></p>
      <label className="proposal-consent"><input type="checkbox" checked={consent} disabled={!preview || busy} onChange={e => setConsent(e.target.checked)} /> {ar ? `راجعت البيانات وأوافق على إرسالها إلى ${AI_NAMES[selection.provider]} باستخدام ${selection.model} لهذا الطلب` : `I reviewed the data and agree to send it to ${AI_NAMES[selection.provider]} using ${selection.model} for this request`}</label>
      <div className="row-actions"><button className="btn primary" disabled={!preview || !consent || !hasKey || busy} onClick={() => void generate()}>{busy ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'توليد المسودة' : 'Generate draft')}</button>{busy && <button className="btn" onClick={() => void rased.cancelProposal()}>{ar ? 'إلغاء' : 'Cancel'}</button>}</div>
    </section>
    {draft && <section className="proposal-card"><h3>{ar ? 'مسودتك' : 'Your draft'}</h3><p className="muted small" dir="auto">{draft.provider && draft.model ? `${AI_NAMES[draft.provider]} · ${draft.model}` : (ar ? 'مسودة سابقة — المصدر غير مسجل' : 'Earlier draft — source not recorded')}</p><textarea aria-label={ar ? 'نص مسودة العرض' : 'Proposal draft text'} className="textarea proposal-editor" dir="auto" maxLength={12000} value={draft.proposal} disabled={busy} onChange={e => setDraft({ ...draft, proposal: e.target.value })} />
      <div className="row-actions"><button className="btn" disabled={busy || draft.proposal === saved} onClick={() => void save()}>{ar ? 'حفظ محليًا' : 'Save locally'}</button><button className="btn" onClick={() => void copy()}>{copied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ العرض' : 'Copy proposal')}</button><button className="btn primary" onClick={() => void open()}>{ar ? 'فتح المشروع في المتصفح' : 'Open project in browser'}</button><button className="btn danger" disabled={busy} onClick={() => { if (window.confirm(ar ? 'حذف المسودة المحفوظة؟' : 'Delete saved draft?')) void rased.deleteProposalDraft(projectId).then(() => { setDraft(null); setSaved('') }).catch(() => setError(ar ? 'تعذر حذف المسودة.' : 'Could not delete the draft.')) }}>{ar ? 'حذف المسودة' : 'Delete draft'}</button></div>
      {draft.assumptions.length > 0 && <><h4>{ar ? 'افتراضات تحتاج مراجعة' : 'Assumptions to review'}</h4><ul>{draft.assumptions.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul></>}
      {draft.questions.length > 0 && <><h4>{ar ? 'أسئلة مقترحة' : 'Suggested questions'}</h4><ul>{draft.questions.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul></>}
    </section>}
    {error && <p className="field-err" role="alert">{error}{!setup && <button className="btn sm" onClick={() => setLoadEpoch(e => e + 1)}>{ar ? 'إعادة المحاولة' : 'Retry'}</button>}</p>}
    {unsavedDialog}
  </div>
}
