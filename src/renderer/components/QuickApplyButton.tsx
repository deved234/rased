import React from 'react'
import { sourceAllowed } from '@shared/extension/protocol.js'
import { rased } from '../api.js'
export function QuickApplyButton({id,source,lang}:{id:number;source:string;lang:'ar'|'en'}):React.ReactElement|null {
  const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState('')
  if(!sourceAllowed(source))return null
  const run=async()=>{setBusy(true);setMessage('');try{const result=await rased.quickApplyProject(id);setMessage(result.ok?(lang==='ar'?'جارٍ تجهيز العرض في Chrome':'Preparing in Chrome'):(lang==='ar'?'اربط Chrome وفعّل القالب من الإعدادات':'Pair Chrome and enable your template in Settings'))}catch{setMessage(lang==='ar'?'تعذر الاتصال':'Connection failed')}finally{setBusy(false)}}
  return <span onClick={e=>e.stopPropagation()}><button className="btn sm" disabled={busy} onClick={()=>void run()}>{lang==='ar'?'تقديم سريع':'Quick Apply'}</button>{message&&<span className="hint" role="status">{message}</span>}</span>
}
