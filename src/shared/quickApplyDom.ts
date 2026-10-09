/// <reference lib="dom" />
// Pure DOM adapter used by the isolated Chrome content script.
// Self-contained functions for the site's JS world, without privileged/network APIs.
export function inspectOffer(expected: {source: string; externalId: string}) {
  if (expected.source !== 'mostaql' && expected.source !== 'nafezly') return { kind: 'wrong-project' as const }
  const match = location.pathname.match(/^\/project\/(\d+)(?:-|\/?$)/)
  if (location.hostname !== `${expected.source}.com` || match?.[1] !== expected.externalId) return { kind: 'wrong-project' as const }
  const ids = expected.source === 'mostaql' ? ['bid__period','bid__cost','bid__details'] : ['period','cost','offer_description']
  const fields = ids.map(id=>document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)
  if (fields.some(e=>!e || !e.getClientRects().length || e.disabled || e.readOnly)) {
    const login = !!document.querySelector('a[href*="/login"],input[type="password"]')
    return {kind: login ? 'login' as const : 'unavailable' as const}
  }
  if (!fields.every(e=>e!.form === fields[0]!.form) || !fields[0]!.form) return {kind:'unavailable' as const}
  const labelValue = (labels: string[]): string => {
    const leaves=Array.from(document.querySelectorAll('dt,label,span,div,th,strong')).filter(e=>e.children.length===0 && labels.includes(e.textContent?.trim() ?? ''))
    for(const e of leaves) {
      const text=(e.nextElementSibling?.textContent ?? e.parentElement?.textContent ?? '').replace(e.textContent ?? '', '').trim()
      if(text.length < 100 && /\d/.test(text)) return text
    }
    return ''
  }
  const budget = labelValue(['الميزانية','ميزانية المشروع'])
  const rawDays = labelValue(['مدة التنفيذ','المدة المتاحة'])
  const dollars = /\$|USD|دولار/i.test(budget)
  const numbers = dollars ? budget.replace(/,/g,'').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [] : []
  const duration = rawDays.match(/^(\d+)\s*(?:يوم|يوما|يوماً|أيام|ايام)/)
  const constraint=(e: HTMLInputElement | HTMLTextAreaElement)=>({type:e.type,min: Number(e.getAttribute('min')) || null,max:Number(e.getAttribute('max')) || null,step:e.getAttribute('step'),maxLength:e.maxLength})
  return {kind:'form' as const,budget,min:numbers.length===1||numbers.length===2?numbers[0]:null,max:numbers.length===1?numbers[0]:numbers.length===2?numbers[1]:null,originalDays:duration?Number(duration[1]):null,existing:fields.some(e=>!!e!.value),constraints:fields.map(e=>constraint(e!))}
}
export async function fillOffer(data: {source:string;externalId:string;template:string;price:number|null;days:number|null;replace:boolean}) {
  if (data.source !== 'mostaql' && data.source !== 'nafezly') return {ok:false,error:'unsupported-source'}
  const id=location.pathname.match(/^\/project\/(\d+)(?:-|\/?$)/)?.[1]
  if(location.hostname!==`${data.source}.com` || id!==data.externalId) return {ok:false,error:'wrong-project'}
  const ids=data.source==='mostaql'?['bid__period','bid__cost','bid__details']:['period','cost','offer_description']
  const fields=ids.map(id=>document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)
  if(fields.some(e=>!e || !e.getClientRects().length || e.disabled || e.readOnly)) return {ok:false,error:'form-unavailable'}
  if(fields.some(e=>e!.value) && !data.replace) return {ok:false,error:'draft-exists'}
  if(fields[2]!.maxLength>=0 && data.template.length>fields[2]!.maxLength) return {ok:false,error:'template-too-long'}
  const values=[data.days===null?null:String(data.days),data.price===null?null:String(data.price),data.template]
  const previous=fields.map(e=>e!.value)
  const set=(e: HTMLInputElement | HTMLTextAreaElement,v:string)=>{
    Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(e,v)
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))
  }
  try {
    fields.forEach((e,i)=>{if(values[i]!==null)set(e!,values[i]!)})
    await new Promise(resolve=>setTimeout(resolve,100))
    if (location.pathname.match(/^\/project\/(\d+)(?:-|\/?$)/)?.[1] !== data.externalId || fields.some(e=>!e!.isConnected)) return {ok:false,error:'wrong-project'}
    if(fields.some((e,i)=>values[i]!==null && (e!.value!==values[i] || !e!.checkValidity()))) throw Error('invalid-fields')
    fields[2]!.scrollIntoView({block:'center',behavior:'instant'})
    return {ok:true,error:null}
  }catch{fields.forEach((e,i)=>{if(e!.isConnected&&values[i]!==null&&e!.value===values[i])set(e!,previous[i]!)});return {ok:false,error:'invalid-fields'}}
}
