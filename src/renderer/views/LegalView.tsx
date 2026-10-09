import React from 'react'
import { rased } from '../api.js'
import type { Lang } from '../i18n.js'
import type { AboutLink } from '@shared/about.js'
import { LEGAL_DOCUMENTS, LEGAL_UPDATED_AT } from '@shared/legal.js'
import notices from '../../../resources/legal/THIRD_PARTY_NOTICES.txt?raw'
import license from '../../../LICENSE?raw'

export function LegalView({ lang }: { lang: Lang }): React.ReactElement {
  const [doc, setDoc] = React.useState<'terms' | 'privacy' | 'licenses'>('terms')
  const [error, setError] = React.useState(false)
  const ar = lang === 'ar'
  const content = LEGAL_DOCUMENTS[lang]
  const open = async (id: AboutLink): Promise<void> => {
    try { setError(!(await rased.openAboutLink(id)).ok) } catch { setError(true) }
  }
  return <div className="legal-page">
    <div className="set-group"><h2>{ar ? 'شروط الاستخدام والخصوصية' : 'Terms & privacy'}</h2><p className="muted">{ar ? 'راصد برنامج مستقل طوّره david atef؛ ليس تابعًا لحسوب أو نفذلي ولا منتجًا رسميًا للمنصات المدعومة.' : 'RASED is an independent app by david atef; it is not affiliated with Hsoub, Nafezly, or the supported platforms.'}</p><span className="small muted">{ar ? 'آخر تحديث: ' : 'Last updated: '}{LEGAL_UPDATED_AT}</span></div>
    <div className="chips" role="tablist" aria-label={ar ? 'المستندات القانونية' : 'Legal documents'}>{(['terms','privacy','licenses'] as const).map((id,index)=><button key={id} id={`legal-tab-${id}`} role="tab" aria-controls={`legal-panel-${id}`} tabIndex={doc===id?0:-1} aria-selected={doc===id} className={doc===id?'chip active':'chip'} onClick={()=>setDoc(id)} onKeyDown={e=>{
      const ids=['terms','privacy','licenses'] as const
      const delta=e.key==='ArrowRight'?(ar?-1:1):e.key==='ArrowLeft'?(ar?1:-1):0
      if(!delta && e.key!=='Home' && e.key!=='End')return
      e.preventDefault()
      const next=ids[e.key==='Home'?0:e.key==='End'?2:(index+delta+3)%3]!
      setDoc(next);document.getElementById(`legal-tab-${next}`)?.focus()
    }}>{content[id].title}</button>)}</div>
    <article id={`legal-panel-${doc}`} className="set-group" role="tabpanel" aria-labelledby={`legal-tab-${doc}`} tabIndex={0}>
      {content[doc].sections.map(([title,body])=><section className="legal-section" key={title}><h3>{title}</h3><p>{body}</p></section>)}
      {doc==='licenses' && <><details><summary>MIT — RASED</summary><pre className="license-text" dir="ltr">{license}</pre></details><details><summary>{ar ? 'نصوص رخص المكونات والخطوط' : 'Component and font license texts'}</summary><pre className="license-text" dir="ltr">{notices}</pre></details></>}
    </article>
    <div className="set-group about-links"><button className="btn" onClick={()=>void open('mostaqlTerms')}>{ar?'شروط مستقل الرسمية ↗':'Mostaql terms ↗'}</button><button className="btn" onClick={()=>void open('mostaqlPrivacy')}>{ar?'خصوصية مستقل ↗':'Mostaql privacy ↗'}</button><button className="btn" onClick={()=>void open('geminiTerms')}>{ar?'شروط Gemini الرسمية ↗':'Gemini terms ↗'}</button><button className="btn" onClick={()=>void open('openaiData')}>{ar?'بيانات OpenAI API الرسمية ↗':'OpenAI API data controls ↗'}</button><button className="btn" onClick={()=>void open('claudeTerms')}>{ar?'شروط Claude API الرسمية ↗':'Claude API terms ↗'}</button><button className="btn" onClick={()=>void open('claudeData')}>{ar?'خصوصية Claude API ↗':'Claude API privacy ↗'}</button><button className="btn" onClick={()=>void open('issues')}>{ar?'بلاغ أو استفسار ↗':'Report an issue ↗'}</button></div>
    {error && <p role="alert">{ar?'تعذر فتح المتصفح. حاول مرة أخرى.':'Could not open the browser. Please try again.'}</p>}
  </div>
}
