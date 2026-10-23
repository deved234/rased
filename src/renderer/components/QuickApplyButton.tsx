import React from 'react'
import { sourceAllowed } from '@shared/extension/protocol.js'
import { activePhase, phaseText, quickErrorText, useExtensionStatus, useQuickEnabled } from './extensionStatus.js'
import { go, requestAction } from '../router.js'
import { rased } from '../api.js'
export function QuickApplyButton({id,source,lang}:{id:number;source:string;lang:'ar'|'en'}):React.ReactElement|null {
  const [error,setError]=React.useState('')
  const [pending,setPending]=React.useState(false)
  const locked=React.useRef(false)
  const status=useExtensionStatus()
  const enabled=useQuickEnabled()
  const ar=lang==='ar'
  const job=status?.lastJob?.projectId===id?status.lastJob:null
  const assistant=status?.assistant
  const active=pending||!!assistant||!!status?.lastJob&&activePhase(status.lastJob.phase)
  if(!sourceAllowed(source))return null
  const run=async(useAssistant:boolean):Promise<void>=>{
    if(locked.current)return
    if(enabled===false||(status&&!status.selectedId)){go({name:'settings',section:'quick'});return}
    locked.current=true;setPending(true);setError('')
    try {
      const result=await(useAssistant?rased.quickApplyAssistant(id):rased.quickApplyProject(id,'template'))
      if(!result.ok){
        setError(quickErrorText(result.error,ar))
        if(useAssistant&&['consent-required','no-key'].includes(result.error))go({name:'proposal',id,reason:result.error})
      }
    }catch{setError(quickErrorText('generation-failed',ar))}
    finally{locked.current=false;setPending(false)}
  }
  const hint=job?phaseText(job.phase,ar,job.error)+(job.text==='draft'?(ar?' · بعرض المشروع':" · using this project's proposal"):''):''
  return <span className="quick-action" onClick={e=>e.stopPropagation()}>
    <button className="btn sm quick-template-action" title={ar?'يجهز مسودة في Chrome دون تقديمها':'Prepares a draft in Chrome without submitting'} disabled={active} onClick={()=>requestAction(()=>void run(false))}>{status&&!status.selectedId?(ar?'إعداد التقديم السريع':'Set up Quick Apply'):enabled===false?(ar?'التقديم السريع متوقف':'Quick Apply is off'):(ar?'تقديم سريع':'Quick Apply')}</button>
    {source==='mostaql'&&<button className="btn sm quick-assistant-action" disabled={active} onClick={()=>requestAction(()=>void run(true))}>{ar?'تقديم سريع بمساعد العروض':'Quick Apply with Assistant'}</button>}
    {assistant?.projectId===id&&<span role="status">{assistant.phase==='writing'?(ar?'جارٍ كتابة العرض…':'Writing proposal…'):(ar?'جارٍ التجهيز…':'Preparing…')} <button className="btn sm" onClick={()=>void rased.cancelQuickAssistant(assistant.operationId)}>{ar?'إلغاء':'Cancel'}</button></span>}
    {job&&<span className="hint" role="status">{hint}</span>}{error&&<span className="field-err" role="alert">{error}</span>}
  </span>
}
