import React from 'react'
import { AI_NAMES, AI_PROVIDERS, aiErrorText, type AiSelection, type AiSetup } from '@shared/ai.js'
import { rased } from '../api.js'

export function AiModelPicker({ ar, selection, setup, disabled = false, hideProvider = false, onChange, onSetup }: {
  ar: boolean; selection: AiSelection; setup: AiSetup | null; disabled?: boolean; hideProvider?: boolean
  onChange: (selection: AiSelection) => void; onSetup: (setup: AiSetup) => void
}): React.ReactElement {
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [search, setSearch] = React.useState('')
  const status = setup?.providers[selection.provider]
  const models = status?.catalog?.models ?? []
  const filtered = models.filter(m => `${m.id} ${m.displayName}`.toLowerCase().includes(search.toLowerCase()))
  const listed = models.find(m => m.id === selection.model)
  const refresh = async (): Promise<void> => {
    setLoading(true); setMessage('')
    try {
      const result = await rased.listAiModels(selection.provider)
      setMessage(result.ok ? (ar ? 'تم جلب الموديلات؛ الإتاحة للتوليد تتحدد باختبار الموديل.' : 'Models fetched; generation access requires a model test.') : aiErrorText(result.error, ar, result.retryAfterSeconds))
      onSetup(await rased.getAiSetup())
    } catch { setMessage(aiErrorText('network-error', ar)) }
    finally { setLoading(false) }
  }
  return <div className="ai-picker">
    {!hideProvider && <div className="set-row"><label htmlFor="ai-provider">{ar ? 'الموفر' : 'Provider'}</label><select id="ai-provider" className="select" disabled={disabled || loading} value={selection.provider} onChange={e => {
      const provider = e.target.value as AiSelection['provider']
      setSearch(''); setMessage(''); onChange({ provider, model: setup?.settings.modelByProvider[provider] ?? '' })
    }}>{AI_PROVIDERS.map(p => <option key={p} value={p}>{AI_NAMES[p]}</option>)}</select></div>}
    <div className="proposal-field"><label htmlFor="ai-model">{ar ? 'الموديل' : 'Model'}</label>
      {models.length > 15 && <input className="input" aria-label={ar ? 'بحث الموديلات' : 'Search models'} placeholder={ar ? 'بحث في الموديلات' : 'Search models'} value={search} onChange={e => setSearch(e.target.value)} disabled={disabled || loading} />}
      <select id="ai-model" className="select" dir="ltr" value={selection.model} disabled={disabled || loading} onChange={e => { setMessage(''); onChange({ ...selection, model: e.target.value }) }}>
        <option value="">{ar ? 'اختر موديلًا أو أدخل معرفه يدويًا' : 'Choose a model or enter its ID manually'}</option>
        {selection.model && !filtered.some(m => m.id === selection.model) && <option value={selection.model}>{selection.model}</option>}
        {filtered.map(m => <option key={m.id} value={m.id}>{m.displayName} · {m.id}{m.compatibility === 'unknown' ? ' (?)' : ''}</option>)}
      </select>
      <details className="ai-manual"><summary>{ar ? 'متقدم: إدخال معرف الموديل يدويًا' : 'Advanced: enter a model ID manually'}</summary><input className="input" dir="ltr" aria-label={ar ? 'معرف الموديل' : 'Model ID'} maxLength={200} value={selection.model} disabled={disabled || loading} onChange={e => onChange({ ...selection, model: e.target.value })} placeholder="model-id" /></details>
      {selection.model && !listed && <p className="hint">{ar ? 'هذا المعرف غير موجود في القائمة المحفوظة. التوافق غير متحقق؛ جرّب اختبار الموديل.' : 'This ID is not in the saved catalog. Compatibility is unverified; test the model.'}</p>}
      {listed?.compatibility === 'unknown' && <p className="hint">{ar ? 'التوافق مع مساعد العروض غير متحقق لهذا الموديل.' : 'Proposal compatibility is unverified for this model.'}</p>}
    </div>
    <button className="btn sm" disabled={disabled || loading || !status?.keyReadable} onClick={() => void refresh()}>{loading ? (ar ? 'جارٍ جلب الموديلات…' : 'Fetching models…') : (ar ? 'تحديث الموديلات' : 'Refresh models')}</button>
    {!status?.keyReadable && <p className="hint">{ar ? 'احفظ مفتاح هذا الموفر لجلب القائمة. تقدر تختار المعرف يدويًا قبل حفظ المفتاح.' : 'Save a readable key to fetch models. You can enter an ID beforehand.'}</p>}
    {status?.catalog && <p className="muted small">{ar ? 'آخر جلب للقائمة: ' : 'Catalog fetched: '}{new Date(status.catalog.fetchedAt).toLocaleString(ar ? 'ar-EG' : 'en-US')}</p>}
    {message && <p role="status" className="hint">{message}</p>}
  </div>
}
