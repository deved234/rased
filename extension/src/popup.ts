/// <reference types="chrome" />
export {}
let ar=chrome.i18n.getUILanguage().startsWith('ar')
document.documentElement.dir=ar?'rtl':'ltr'
const status=document.getElementById('status')!,code=document.getElementById('code')!,pair=document.getElementById('pair') as HTMLButtonElement,connect=document.getElementById('connect') as HTMLButtonElement
pair.textContent=ar?'طلب ربط براصد':'Pair with RASED';connect.textContent=ar?'إعادة الاتصال':'Reconnect'
document.getElementById('help')!.textContent=ar?'افتح راصد ← الإعدادات ← التقديم السريع. طابق رمز الربط ووافق عليه هناك. لا يتم تقديم أي عرض تلقائيًا.':'Open RASED → Settings → Quick Apply. Match and approve the pairing code there. Offers are never submitted automatically.'
pair.onclick=()=>void chrome.runtime.sendMessage({type:'pair'})
connect.onclick=()=>void chrome.runtime.sendMessage({type:'connect'})
async function refresh():Promise<void>{
  try{const value=await chrome.runtime.sendMessage({type:'state'}) as {status:string;code?:string;expiresAt?:number;error?:string}
    const language=(value as {language?:string}).language
    ar=language ? language==='ar' : chrome.i18n.getUILanguage().startsWith('ar')
    document.documentElement.lang=ar?'ar':'en';document.documentElement.dir=ar?'rtl':'ltr'
    pair.textContent=ar?'طلب ربط براصد':'Pair with RASED';connect.textContent=ar?'إعادة الاتصال':'Reconnect'
    document.getElementById('help')!.textContent=ar?'راصد ← الإعدادات ← التقديم السريع. طابق رمز الربط قبل الموافقة. لا نقدم عرضًا تلقائيًا.':'RASED → Settings → Quick Apply. Match the pairing code before approval. We never submit automatically.'
    const labels:Record<string,string>=ar?{connected:'متصل براصد',disconnected:'غير متصل — افتح راصد وجهز الإضافة',unpaired:'يحتاج الربط',pairing:'طابق هذا الرمز في راصد',error:'تعذر الاتصال'}:{connected:'Connected to RASED',disconnected:'Disconnected — open RASED and prepare the extension',unpaired:'Pairing required',pairing:'Match this code in RASED',error:'Connection failed'}
    status.textContent=labels[value.status]??value.status;code.dir='ltr';code.textContent=value.expiresAt&&value.expiresAt>Date.now()?value.code??'':'';pair.disabled=!['unpaired','pairing'].includes(value.status)
    document.getElementById('expiry')!.textContent=value.expiresAt&&value.expiresAt>Date.now()?(ar?`متبقي ${Math.ceil((value.expiresAt-Date.now())/1000)} ثانية`:`Expires in ${Math.ceil((value.expiresAt-Date.now())/1000)} seconds`):''
  }catch{status.textContent=ar?'تعذر قراءة حالة الإضافة':'Extension unavailable'}
}
void refresh();setInterval(()=>void refresh(),1000)
