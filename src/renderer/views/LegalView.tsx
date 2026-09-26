import React from 'react'
import { rased } from '../api.js'
import type { Lang } from '../i18n.js'
import { LEGAL_DOCUMENTS } from '@shared/legal.js'
import notices from '../../../resources/legal/THIRD_PARTY_NOTICES.txt?raw'
import license from '../../../LICENSE?raw'

export function LegalView({ lang }: { lang: Lang }): React.ReactElement {
  const [doc, setDoc] = React.useState<'terms' | 'privacy' | 'licenses'>('terms')
  const [error, setError] = React.useState(false)
  const ar = lang === 'ar'
  const content = LEGAL_DOCUMENTS[lang]
  const open = async (id: 'mostaqlTerms' | 'mostaqlPrivacy' | 'issues'): Promise<void> => {
    try { setError(!(await rased.openAboutLink(id)).ok) } catch { setError(true) }
  }
  return <div className="legal-page">
    <div className="set-group"><h2>{ar ? 'شروط الاستخدام والخصوصية' : 'Terms & privacy'}</h2><p className="muted">{ar ? 'راصد مشروع مستقل طوّره david atef؛ ليس منتجًا تابعًا لحسوب أو معتمدًا من مستقل.' : 'RASED is an independent project by david atef; it is not affiliated with Hsoub or endorsed by Mostaql.'}</p><span className="small muted">{ar ? 'آخر تحديث: ' : 'Last updated: '}2026-09-26</span></div>
    <div className="chips" role="tablist" aria-label={ar ? 'المستندات القانونية' : 'Legal documents'}>{(['terms','privacy','licenses'] as const).map(id=><button key={id} role="tab" aria-selected={doc===id} className={doc===id?'chip active':'chip'} onClick={()=>setDoc(id)}>{content[id].title}</button>)}</div>
    <article className="set-group" role="tabpanel" aria-label={content[doc].title}>
      {content[doc].sections.map(([title,body])=><section className="legal-section" key={title}><h3>{title}</h3><p>{body}</p></section>)}
      {doc==='licenses' && <><details><summary>MIT — RASED</summary><pre className="license-text" dir="ltr">{license}</pre></details><details><summary>{ar ? 'نصوص رخص المكونات والخطوط' : 'Component and font license texts'}</summary><pre className="license-text" dir="ltr">{notices}</pre></details></>}
    </article>
    <div className="set-group about-links"><button className="btn" onClick={()=>void open('mostaqlTerms')}>{ar?'شروط مستقل الرسمية ↗':'Mostaql terms ↗'}</button><button className="btn" onClick={()=>void open('mostaqlPrivacy')}>{ar?'خصوصية مستقل ↗':'Mostaql privacy ↗'}</button><button className="btn" onClick={()=>void open('issues')}>{ar?'بلاغ أو استفسار ↗':'Report an issue ↗'}</button></div>
    {error && <p role="alert">{ar?'تعذر فتح المتصفح. حاول مرة أخرى.':'Could not open the browser. Please try again.'}</p>}
  </div>
}
