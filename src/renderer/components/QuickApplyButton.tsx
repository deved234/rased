import React from 'react'
import { sourceAllowed } from '@shared/extension/protocol.js'
import { rased } from '../api.js'
import { activePhase, phaseText, useExtensionStatus, useQuickEnabled } from './extensionStatus.js'
import { go } from '../router.js'
export function QuickApplyButton({id,source,lang}:{id:number;source:string;lang:'ar'|'en'}):React.ReactElement|null {
  const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState('')
  const status=useExtensionStatus()
  const enabled=useQuickEnabled()
  const job=status?.lastJob?.projectId===id?status.lastJob:null
  const active=!!status?.lastJob&&activePhase(status.lastJob.phase)
  if(!sourceAllowed(source))return null
  const run=async()=>{setBusy(true);setMessage('');try{const result=await rased.quickApplyProject(id);setMessage(result.ok?(lang==='ar'?'جارٍ تجهيز العرض في Chrome':'Preparing in Chrome'):(lang==='ar'?'اربط Chrome وفعّل القالب من الإعدادات':'Pair Chrome and enable your template in Settings'))}catch{setMessage(lang==='ar'?'تعذر الاتصال':'Connection failed')}finally{setBusy(false)}}
  return <span className="quick-action" onClick={e=>e.stopPropagation()}><button className="btn sm" title={lang==='ar'?'يجهز مسودة في Chrome دون تقديمها':'Prepares a draft in Chrome without submitting'} disabled={busy||active} onClick={()=>{if(enabled===false || (status&&!status.selectedId))go({name:'settings',section:'quick'});else void run()}}>{status&&!status.selectedId?(lang==='ar'?'إعداد التقديم السريع':'Set up Quick Apply'):enabled===false?(lang==='ar'?'التقديم السريع متوقف':'Quick Apply is off'):(lang==='ar'?'تجهيز عرض':'Prepare draft')}</button>{(job||message)&&<span className="hint" role="status">{job?phaseText(job.phase,lang==='ar'):message}</span>}</span>
}
