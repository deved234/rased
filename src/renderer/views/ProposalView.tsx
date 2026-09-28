import React from 'react'
import { rased } from '../api.js'
import { go, registerNavigationBlocker } from '../router.js'
import type { Lang } from '../i18n.js'
import type { ProposalDraft, ProposalPreview } from '@shared/proposals.js'

const terms = 'https://ai.google.dev/gemini-api/terms'

function errorText(code: string | undefined, ar: boolean): string {
  const messages: Record<string, [string, string]> = {
    'key-unavailable': ['أضف مفتاح Gemini من الإعدادات أولًا.', 'Add your Gemini key in Settings first.'],
    'key-rejected': ['رفض Gemini المفتاح. راجع المفتاح وصلاحياته.', 'Gemini rejected the key. Check its access.'],
    'rate-limited': ['تجاوزت الحصة مؤقتًا. جرّب لاحقًا.', 'Rate limit reached. Try again later.'],
    'model-unavailable': ['النموذج غير متاح لهذا المفتاح أو المنطقة.', 'The model is unavailable for this key or region.'],
    'provider-http-503': ['خدمة Gemini مشغولة حاليًا. جرّب لاحقًا.', 'Gemini is temporarily unavailable. Try again later.'],
    'preview-changed': ['تغيّرت بيانات المشروع. راجع المعاينة مرة أخرى.', 'Project data changed. Review the preview again.'],
    'invalid-response': ['استجابة Gemini غير صالحة. أعد المحاولة.', 'Gemini returned an invalid response. Try again.'],
    'network-error': ['تعذر الاتصال بـGemini.', 'Could not reach Gemini.'],
    timeout: ['انتهت مهلة الاتصال بـGemini. جرّب لاحقًا.', 'Gemini timed out. Try again later.'],
    cancelled: ['أُلغي الطلب.', 'Request cancelled.']
  }
  return messages[code ?? '']?.[ar ? 0 : 1] ?? (ar ? 'حدث خطأ. أعد المحاولة.' : 'Something went wrong. Try again.')
}

export function ProposalView({ lang, projectId }: { lang: Lang; projectId: number }): React.ReactElement {
  const ar = lang === 'ar'
  const [preview, setPreview] = React.useState<ProposalPreview | null>(null)
  const [previewLoaded, setPreviewLoaded] = React.useState(false)
  const [draft, setDraft] = React.useState<ProposalDraft | null>(null)
  const [saved, setSaved] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [hasKey, setHasKey] = React.useState(false)
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const dirtyRef = React.useRef(false)
  const draftRef = React.useRef<ProposalDraft | null>(null)
  draftRef.current = draft
  dirtyRef.current = !!draft && draft.proposal !== saved

  React.useEffect(() => {
    let alive = true
    void Promise.all([rased.getProposalSetup(), rased.getProposalDraft(projectId), rased.getProposalPreview(projectId, '')]).then(([setup, existing, p]) => {
      if (!alive) return
      setHasKey(setup?.hasKey ?? false)
      setDraft(existing)
      setSaved(existing?.proposal ?? '')
      setPreview(p)
      setPreviewLoaded(true)
    }).catch(() => alive && setError(ar ? 'تعذر تحميل مساعد العروض.' : 'Could not load Proposal Assistant.'))
    return () => { alive = false; void rased.cancelProposal() }
  }, [projectId, ar])

  React.useEffect(() => registerNavigationBlocker(() => {
    if (!dirtyRef.current) return true
    return window.confirm(ar ? 'لديك تعديلات غير محفوظة. هل تريد المغادرة؟' : 'You have unsaved changes. Leave?')
  }), [ar])

  const refresh = async (): Promise<void> => {
    try { setPreview(await rased.getProposalPreview(projectId, notes)); setPreviewLoaded(true); setConsent(false); setError('') }
    catch { setError(ar ? 'تعذرت المعاينة.' : 'Preview failed.') }
  }
  const generate = async (): Promise<void> => {
    if (!preview || !consent || !hasKey || busy) return
    setBusy(true); setError('')
    try {
      const result = await rased.generateProposal(projectId, notes, preview.fingerprint)
      if (!result.ok || !result.draft) { setError(errorText(result.error, ar)); return }
      setDraft(result.draft)
      setSaved(result.draft.proposal)
    } catch { setError(errorText('network-error', ar)) }
    finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (!draft) return
    const result = await rased.saveProposalDraft(draft)
    if (result.ok) { setSaved(draft.proposal); setError('') }
    else setError(ar ? 'تعذر حفظ المسودة.' : 'Could not save draft.')
  }
  const copy = async (): Promise<void> => {
    if (!draft) return
    try { await navigator.clipboard.writeText(draft.proposal); setCopied(true); setTimeout(() => setCopied(false), 2200) }
    catch { setError(ar ? 'تعذر النسخ.' : 'Copy failed.') }
  }
  const open = async (): Promise<void> => {
    const result = await rased.openProjectExternal(projectId)
    if (!result.ok) setError(ar ? 'تعذر فتح المشروع في المتصفح.' : 'Could not open project in browser.')
  }

  return <div className="proposal-page">
    <button className="btn ghost sm" onClick={() => go({ name: 'project', id: projectId })}>{ar ? '← المشروع' : '← Project'}</button>
    <div className="proposal-hero"><span className="tag">Gemini</span><h2>{ar ? 'مساعد العروض' : 'Proposal Assistant'}</h2><p className="muted">{ar ? 'مسودة قابلة للتعديل. راجعها ثم قدمها بنفسك على مستقل.' : 'An editable draft. Review it, then submit it yourself on Mostaql.'}</p></div>
    {!hasKey && <div className="banner warn">{ar ? 'أضف مفتاح Gemini الخاص بك من الإعدادات.' : 'Add your own Gemini key in Settings.'} <button className="btn sm" onClick={() => go({ name: 'settings', section: 'ai' })}>{ar ? 'إعدادات المساعد' : 'Assistant settings'}</button></div>}
    <section className="proposal-card"><h3>{ar ? 'البيانات التي ستُرسل' : 'Data to be sent'}</h3>
      <p className="muted">{ar ? 'لا يُرسل شيء إلى Gemini إلا بعد ضغط توليد. ملاحظاتك الشخصية على المشروع غير مدرجة.' : 'Nothing is sent to Gemini until you press Generate. Your private project note is not included.'}</p>
      {preview ? <>
        <div className="proposal-fields"><strong dir="auto">{preview.title}</strong><span className="tag uncertain">{preview.provenance === 'full' ? (ar ? 'وصف كامل' : 'Full description') : (ar ? 'وصف غير كامل' : 'Incomplete description')}</span></div>
        <details><summary>{ar ? 'عرض نص المشروع والملف الشخصي المرسل' : 'Show project text and profile sent'}</summary>
          <pre className="proposal-preview" dir="auto">{preview.description}</pre>
          <p>{ar ? 'التصنيف' : 'Category'}: {preview.category ?? '—'} · {ar ? 'المهارات' : 'Skills'}: {preview.skills.join('، ') || '—'} · {ar ? 'الميزانية' : 'Budget'}: {preview.budget ?? '—'}</p>
          <pre className="proposal-preview" dir="auto">{JSON.stringify(preview.profile, null, 2)}</pre>
          {preview.projectNotes && <p dir="auto">{preview.projectNotes}</p>}
        </details>
      </> : <p className="muted">{previewLoaded ? (ar ? 'المعاينة غير متاحة أو تحتاج تحديثًا بعد تعديل التفاصيل.' : 'Preview unavailable or needs refreshing after editing notes.') : (ar ? 'جارٍ تحميل المشروع…' : 'Loading project…')}</p>}
      <label htmlFor="proposal-notes">{ar ? 'تفاصيل إضافية لهذا العرض فقط (اختياري)' : 'Notes for this proposal only (optional)'}</label>
      <textarea id="proposal-notes" className="textarea" dir="auto" maxLength={2000} value={notes} onChange={e => { setNotes(e.target.value); setPreview(null); setConsent(false) }} />
      <button className="btn sm" onClick={() => void refresh()}>{ar ? 'تحديث المعاينة' : 'Refresh preview'}</button>
      <p className="muted small">{ar ? 'Google قد تستخدم طلبات الخدمة المجانية ومخرجاتها لتحسين خدماتها وقد يراجعها أشخاص. لا ترسل بيانات سرية أو شخصية دون تصريح. قد تنطبق رسوم وحصص على حسابك.' : 'Google may use unpaid requests and outputs to improve services, and human reviewers may see them. Do not send confidential or personal data without permission. Your account may incur charges or quotas.'} <a href={terms} onClick={e => { e.preventDefault(); void rased.openAboutLink('geminiTerms') }}>Gemini API terms ↗</a></p>
      <label className="proposal-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {ar ? 'راجعت البيانات وأوافق على إرسالها إلى Google لهذا الطلب' : 'I reviewed the data and agree to send it to Google for this request'}</label>
      <div className="row-actions"><button className="btn primary" disabled={!preview || !consent || !hasKey || busy} onClick={() => void generate()}>{busy ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'توليد المسودة' : 'Generate draft')}</button>{busy && <button className="btn" onClick={() => void rased.cancelProposal()}>{ar ? 'إلغاء' : 'Cancel'}</button>}</div>
    </section>
    {draft && <section className="proposal-card"><h3>{ar ? 'مسودتك' : 'Your draft'}</h3><textarea className="textarea proposal-editor" dir="auto" maxLength={12000} value={draft.proposal} onChange={e => setDraft({ ...draft, proposal: e.target.value })} />
      <div className="row-actions"><button className="btn" disabled={draft.proposal === saved} onClick={() => void save()}>{ar ? 'حفظ محليًا' : 'Save locally'}</button><button className="btn" onClick={() => void copy()}>{copied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ العرض' : 'Copy proposal')}</button><button className="btn primary" onClick={() => void open()}>{ar ? 'فتح المشروع في المتصفح' : 'Open project in browser'}</button><button className="btn danger" onClick={() => { if (window.confirm(ar ? 'حذف المسودة المحفوظة؟' : 'Delete saved draft?')) void rased.deleteProposalDraft(projectId).then(() => { setDraft(null); setSaved('') }) }}>{ar ? 'حذف المسودة' : 'Delete draft'}</button></div>
      {draft.assumptions.length > 0 && <><h4>{ar ? 'افتراضات تحتاج مراجعة' : 'Assumptions to review'}</h4><ul>{draft.assumptions.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul></>}
      {draft.questions.length > 0 && <><h4>{ar ? 'أسئلة مقترحة' : 'Suggested questions'}</h4><ul>{draft.questions.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul></>}
    </section>}
    {error && <p className="field-err" role="alert">{error}</p>}
  </div>
}
