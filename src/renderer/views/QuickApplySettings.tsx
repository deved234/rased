import React from 'react'
import type { AppSettings } from '@shared/types.js'
import type { ExtensionAction } from '@shared/api.js'
import type { ExtensionStatus } from '@shared/extension/protocol.js'
import { validQuickApply, quickPrice } from '@shared/quickApply.js'
import { rased } from '../api.js'
import { useUnsavedChanges } from '../components/useUnsavedChanges.js'
import { activePhase, phaseText } from '../components/extensionStatus.js'
export function QuickApplySettings({settings}:{settings:AppSettings}):React.ReactElement {
  const ar=settings.language==='ar'
  const [draft,setDraft]=React.useState({...settings.quickApply})
  const [status,setStatus]=React.useState<ExtensionStatus|null>(null)
  const [message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false)
  const [label,setLabel]=React.useState(ar?'بروفايل Chrome الرئيسي':'Main Chrome profile')
  const [conflict,setConflict]=React.useState(false)
  const baseline = React.useRef(settings.quickApply)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current)
  React.useEffect(()=>{
    const previousBaseline=baseline.current
    if (JSON.stringify(previousBaseline)!==JSON.stringify(settings.quickApply) && JSON.stringify(draft)!==JSON.stringify(previousBaseline) && JSON.stringify(draft)!==JSON.stringify(settings.quickApply)) setConflict(true)
    setDraft(previous => JSON.stringify(previous) === JSON.stringify(previousBaseline) ? {...settings.quickApply} : previous)
    baseline.current = settings.quickApply
  },[settings.quickApply])
  React.useEffect(()=>{void rased.getExtensionStatus().then(setStatus).catch(()=>setMessage(ar?'تعذر الاتصال':'Connection failed'));return rased.onExtensionStatus(setStatus)},[ar])
  const ready=!!status?.registered&&!!status?.selectedId
  const act=async(action:ExtensionAction)=>{setBusy(true);try{const result=await rased.extensionAction(action);setStatus(await rased.getExtensionStatus());setMessage(result.ok?(ar?'تم':'Done'):(ar?'تعذر إتمام الخطوة. تأكد أن Chrome مثبت ثم أعد المحاولة.':'Unable to complete this step. Check Chrome installation and retry.'))}catch{setMessage(ar?'تعذر الاتصال':'Connection failed')}finally{setBusy(false)}}
  const save=async():Promise<boolean>=>{if(!validQuickApply(draft)||busy)return false;setBusy(true);try{const saved=await rased.updateSettings({quickApply:draft});baseline.current={...saved.quickApply};setDraft({...saved.quickApply});setConflict(false);setMessage(ar?'تم الحفظ':'Saved');return true}catch{setMessage(ar?'راجع القالب والقيم وربط الإضافة':'Check template, values, and extension pairing');return false}finally{setBusy(false)}}
  const unsavedDialog=useUnsavedChanges(dirty,ar,save)
  return <section className="set-group">
    <h2>{ar?'التقديم السريع':'Quick Apply'}</h2>
    {conflict&&<p className="field-err" role="alert">{ar?'تغيرت الإعدادات المحفوظة أثناء التحرير. احتفظنا بنصك؛ الحفظ يستبدل القيم السابقة.':'Saved settings changed while editing. Your edits are retained; saving replaces the previous values.'}<button className="btn sm" onClick={()=>{setDraft({...settings.quickApply});setConflict(false)}}>{ar?'استخدام المحفوظ':'Use saved values'}</button></p>}
    {status?.error&&<p className="field-err" role="alert">{ar?'تعذر تجهيز الاتصال المحلي. جرّب إصلاح الملفات، ثم إعادة تشغيل راصد، وراجع صلاحيات مجلد بيانات التطبيق.':'Local bridge unavailable. Repair extension files, restart RASED, and check app data folder permissions.'}</p>}
    <p className="hint">{ar?'لمستقل ونفذلي فقط. تستخدم الإضافة حساباتك داخل Chrome، وتجهز مسودة دون الضغط على تقديم. خمسات غير مشمول.':'Mostaql and Nafezly only. The extension uses your normal Chrome sessions and prepares a draft without submitting. Khamsat is excluded.'}</p>
    <div className="readiness-summary" role="status"><strong>{ready?(ar?'البروفايل مربوط':'Profile paired'):(ar?'أكمل ربط Chrome':'Finish pairing Chrome')}</strong><span>{status?.clients.find(p=>p.selected)?.connected?(ar?'متصل الآن':'Connected now'):(ar?'اتصال البروفايل غير متاح الآن':'Profile currently offline')}</span></div>
    <details className="setup-disclosure" open={!ready || !!status?.pairing.length}><summary>{ar?'خطوات الإعداد وإدارة الربط':'Setup steps and pairing management'}</summary><ol className="quick-setup-steps">
      <li><h3>{ar?'تجهيز الإضافة':'Prepare the extension'} {status?.registered?'✓':''}</h3><p className="hint">{ar?'نحفظ ملفات الإضافة والربط المحلي في مجلد ثابت على جهازك. لا تحتاج تثبيت Node.js.':'Files and the local bridge are stored in a stable folder on your device. No Node.js installation needed.'}</p><button className="btn" disabled={busy} onClick={()=>void act({action:'prepare'})}>{ar?'تجهيز / إصلاح ملفات الإضافة':'Prepare / repair extension files'}</button></li>
      <li><h3>{ar?'تثبيت في بروفايل Chrome':'Install in your Chrome profile'}</h3><p className="hint">{ar?'افتح إضافات Chrome في البروفايل الذي تستخدمه للمواقع، فعّل وضع المطوّر، واضغط تحميل إضافة غير مضغوطة، ثم اختر المجلد التالي. هذه خطوة يدوية مرة واحدة لكل بروفايل.':'Open Chrome extensions in your preferred profile, enable Developer mode, choose Load unpacked, and select the folder below. This is a manual step once per profile.'}</p><code dir="ltr">{status?.folder??'…'}</code><div className="row-actions"><button className="btn sm" disabled={busy||!status?.installed} onClick={()=>void act({action:'copy-path'})}>{ar?'نسخ المسار':'Copy path'}</button><button className="btn sm" disabled={busy||!status?.installed} onClick={()=>void act({action:'folder'})}>{ar?'فتح المجلد':'Open folder'}</button><button className="btn sm" disabled={busy} onClick={()=>void act({action:'chrome-extensions'})}>{ar?'فتح إضافات Chrome':'Open Chrome extensions'}</button></div></li>
      <li><h3>{ar?'ربط واختيار البروفايل':'Pair and select a profile'} {ready?'✓':''}</h3><p className="hint">{ar?'افتح أيقونة RASED في إضافات Chrome واضغط طلب الربط. طابق الرمز الظاهر هناك مع الرمز هنا قبل الموافقة.':'Open the RASED extension popup and request pairing. Match its code with the code here before approving.'}</p>
        {status?.pairing.map(p=><div key={p.id}><strong dir="ltr">{p.code}</strong><label>{ar?'اسم البروفايل':'Profile label'}<input className="input" maxLength={60} value={label} onChange={e=>setLabel(e.target.value)}/></label><button className="btn" disabled={busy||!label.trim()} onClick={()=>{if(window.confirm(ar?`هل الرمز في الإضافة هو ${p.code}؟`:`Does the extension show ${p.code}?`))void act({action:'approve',id:p.id,code:p.code,label})}}>{ar?'مطابقة الرمز والموافقة':'Match code and approve'}</button></div>)}
        {!!status?.clients.length&&<label>{ar?'البروفايل المستخدم للتقديم':'Profile used for Quick Apply'}<select className="select" value={status.selectedId??''} disabled={busy} onChange={e=>void act({action:'select',id:e.target.value})}><option value="" disabled>{ar?'اختر بروفايل':'Choose profile'}</option>{status.clients.map(p=><option key={p.id} value={p.id}>{p.label} · {p.connected?(ar?'متصل':'connected'):(ar?'غير متصل':'offline')} · {p.version}</option>)}</select></label>}
        {status?.selectedId&&<button className="btn sm ghost" disabled={busy} onClick={()=>{if(window.confirm(ar?'إلغاء ربط البروفايل؟ لن نحذف تسجيل دخولك بالمواقع.':'Unpair this profile? Website sessions will remain.'))void act({action:'revoke',id:status.selectedId!})}}>{ar?'إلغاء الربط':'Unpair'}</button>}
      </li>
    </ol></details>
    <p className="hint">{ar?'إذا كان Chrome مغلقًا نحاول فتحه وننتظر البروفايل المختار 20 ثانية. قد يفتح Chrome بروفايلًا مختلفًا؛ افتح المختار وأعد المحاولة بعد انتهاء المهلة. بعد تحديث الإضافة اضغط إعادة تحميل في صفحة إضافات Chrome.':'If Chrome is closed, RASED opens it and waits 20 seconds for the selected profile. Chrome may open a different profile; open yours and retry after a timeout. Reload the extension in Chrome after extension updates.'}</p>
    <label className="set-row"><span>{ar?'تفعيل التقديم السريع':'Enable Quick Apply'}</span><input type="checkbox" checked={draft.enabled} disabled={busy||!ready} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/></label>
    <label htmlFor="quick-template">{ar?'نص العرض المحفوظ':'Saved proposal text'}</label><textarea id="quick-template" disabled={busy} className="input" rows={9} maxLength={10000} dir="auto" value={draft.template} onChange={e=>setDraft({...draft,template:e.target.value})}/>
    <label className="set-row"><span>{ar?'موضع السعر داخل الميزانية (%)':'Position within budget (%)'}</span><input className="input" type="number" disabled={busy} min={0} max={100} step={1} value={Number.isFinite(draft.budgetPositionPercent)?draft.budgetPositionPercent:''} onChange={e=>setDraft({...draft,budgetPositionPercent:e.target.valueAsNumber})}/></label>
    <input aria-label={ar?'موضع السعر':'Budget position'} type="range" disabled={busy} min={0} max={100} step={1} value={Number.isFinite(draft.budgetPositionPercent)?draft.budgetPositionPercent:0} onChange={e=>setDraft({...draft,budgetPositionPercent:Number(e.target.value)})}/>
    <label className="set-row"><span>{ar?'أيام إضافية فوق مدة العميل':'Extra days beyond client duration'}</span><input className="input" type="number" disabled={busy} min={0} max={365} step={1} value={Number.isFinite(draft.extraDays)?draft.extraDays:''} onChange={e=>setDraft({...draft,extraDays:e.target.valueAsNumber})}/></label>
    <p className="hint">{ar?'مثال: ميزانية 25–50 دولارًا، مدة 5 أيام →':'Example: $25–50 budget, 5 days →'} <b>{quickPrice(25,50,draft.budgetPositionPercent)??'—'} USD / {Number.isInteger(draft.extraDays)?5+draft.extraDays:'—'} {ar?'أيام':'days'}</b></p>
    {!validQuickApply(draft)&&<p className="field-err" role="status">{ar?'اكتب قالبًا، وحدد نسبة من 0 إلى 100 وأيامًا صحيحة من 0 إلى 365.':'Enter a template, a position from 0 to 100, and whole extra days from 0 to 365.'}</p>}
    <button className="btn primary" disabled={busy||!validQuickApply(draft)} onClick={()=>void save()}>{ar?'حفظ القالب والإعدادات':'Save template and settings'}</button>
    <p className="hint" role="status">{dirty?(ar?'تعديلات غير محفوظة':'Unsaved changes'):(ar?'القالب والإعدادات محفوظة':'Template and settings saved')}</p>
    {status?.lastJob&&<p role="status">{phaseText(status.lastJob.phase,ar)} {activePhase(status.lastJob.phase)&&<button className="btn sm" disabled={busy} onClick={()=>void act({action:'cancel'})}>{ar?'إلغاء التجهيز':'Cancel preparation'}</button>}</p>}
    <p className="hint">{ar?'0% للحد الأدنى و100% للحد الأعلى. البيانات الناقصة تُدخل يدويًا؛ المسودة الموجودة لا تُستبدل. القالب يدخل في تصدير الإعدادات؛ مفاتيح الربط لا تدخل فيه.':'0% selects the minimum and 100% the maximum. Missing values require manual input; existing drafts are preserved. Settings exports include the template but exclude pairing keys.'}</p><p role="status">{message}</p>
    {unsavedDialog}
  </section>
}
