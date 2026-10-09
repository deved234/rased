/// <reference types="chrome" />
import { inspectOffer, fillOffer } from '../../src/shared/quickApplyDom.js'
import { quickPrice } from '../../src/shared/quickApply.js'
import { record, validPrepare, type PrepareJob } from '../../src/shared/extension/protocol.js'
let busy=false
const completed=new Set<string>()
let panel:HTMLElement|null=null
let current:string|null=null
let cancelled=false
function banner(text:string,ar:boolean,actions?:{label:string;run:()=>void}[]):void {
  panel?.remove();panel=document.createElement('div')
  // The host element and isolated styles don't cover the page or its submit button.
  const shadow=panel.attachShadow({mode:'closed'})
  const style=document.createElement('style');style.textContent=':host{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483647;width:360px;max-width:calc(100vw - 48px)}section{font:14px/1.7 system-ui;background:#182329;color:#edf0ef;padding:18px;border:1px solid #48635c;border-radius:14px;box-shadow:0 8px 30px #0005}strong{color:#b8d0c2}p{margin:8px 0}button{font:inherit;background:#36584a;color:#fff;border:1px solid #739887;border-radius:8px;padding:7px 12px;cursor:pointer;margin:4px}button:focus-visible{outline:2px solid #c7e1d1}'
  const section=document.createElement('section');section.dir=ar?'rtl':'ltr';section.setAttribute('role','status')
  const title=document.createElement('strong');title.textContent=ar?'راصد · التقديم السريع':'RASED · Quick Apply'
  const p=document.createElement('p');p.textContent=text
  section.append(title,p)
  for(const action of actions??[]){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.onclick=action.run;section.append(b)}
  const close=document.createElement('button');close.type='button';close.textContent=ar?'إغلاق':'Dismiss';close.onclick=()=>panel?.remove();section.append(close)
  shadow.append(style,section);document.documentElement.append(panel)
}
async function prepare(job:PrepareJob):Promise<void> {
  if(busy||completed.has(job.requestId)||job.expiresAt<=Date.now())return
  busy=true;completed.add(job.requestId);current=job.requestId;cancelled=false
  const ar=job.language==='ar'
  const report=(phase:string,error?:string,price?:number|null,days?:number|null)=>{void chrome.runtime.sendMessage({type:'content-result',requestId:job.requestId,phase,error,price,days}).catch(()=>undefined)}
  try {
    banner(ar?'نقرأ بيانات المشروع ونجهز مسودة فقط…':'Reading this project and preparing a draft only…',ar)
    let info=inspectOffer(job)
    while((info.kind==='unavailable'||info.kind==='login')&&!cancelled&&Date.now()<job.expiresAt){
      if(info.kind==='login')break
      await new Promise(resolve=>setTimeout(resolve,250));info=inspectOffer(job)
    }
    if(info.kind!=='form'){report(info.kind==='login'?'needs-login':'failed',info.kind==='login'?'login-required':'form-unavailable');banner(ar?'سجّل دخولك في الموقع، ثم ابدأ التقديم السريع مرة أخرى من راصد.':'Sign in to the website, then start Quick Apply again in RASED.',ar);return}
    if(info.existing){report('draft-exists','draft-exists');banner(ar?'توجد مسودة في النموذج. تركناها كما هي؛ راجعها أو امسحها بنفسك ثم أعد المحاولة.':'An existing draft was preserved. Review or clear it yourself, then retry.',ar);return}
    const cost=info.constraints[1]!,period=info.constraints[0]!
    let price=info.min!=null&&info.max!=null?quickPrice(info.min,info.max,job.settings.budgetPositionPercent,cost.step==='any'?0.01:Number(cost.step)||1,cost.min??0):null
    const rawDays=info.originalDays===null?null:info.originalDays+job.settings.extraDays
    const days=rawDays!==null&&rawDays>0&&(!period.min||rawDays>=period.min)&&(!period.max||rawDays<=period.max)&&(!period.step||period.step==='any'||Number.isFinite(Number(period.step))&&(rawDays-(period.min??0))%Number(period.step)===0)?rawDays:null
    if(price!==null&&((cost.min!==null&&price<cost.min)||(cost.max!==null&&price>cost.max)||(cost.step!=='any'&&(price-(cost.min??0))/(Number(cost.step)||1)%1>1e-7)))price=null
    if(cancelled||Date.now()>=job.expiresAt){report('failed','expired');return}
    const filled=await fillOffer({source:job.source,externalId:job.externalId,template:job.settings.template,price,days,replace:false})
    if(!filled.ok){report(filled.error==='draft-exists'?'draft-exists':'failed',filled.error??'fill-failed');banner(ar?'تعذر تعبئة النموذج بأمان. راجعه يدويًا.':'The form could not be filled safely. Review it manually.',ar);return}
    report(price===null||days===null?'needs-input':'ready',undefined,price,days)
    banner(price===null||days===null?(ar?'النص جاهز. أدخل السعر أو المدة الناقصة بنفسك، وراجع العرض قبل تقديمه.':'Draft prepared. Complete missing price or duration and review before submitting.'):(ar?`المسودة جاهزة: $${price} · ${days} يوم. راجع العرض واضغط تقديم بنفسك.`:`Draft ready: $${price} · ${days} days. Review and submit yourself.`),ar)
  }finally{busy=false}
}
chrome.runtime.onMessage.addListener((v:unknown,sender)=>{if(sender.id!==chrome.runtime.id||!record(v))return false;if(v.type==='cancel'&&v.requestId===current)cancelled=true;if(v.type==='prepare'&&validPrepare(v.job))void prepare(v.job).catch(()=>{busy=false});return false})
void chrome.runtime.sendMessage({type:'content-ready'}).catch(()=>undefined)
