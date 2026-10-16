import React from 'react'
import type { Project } from '@shared/types.js'
import type { ProjectFacts } from '@shared/projectFacts.js'
import { rased } from '../api.js'
import { STRINGS, type Lang } from '../i18n.js'
import { budgetLabel, fullDate } from '../format.js'

export function ProjectFactsPanel({ project, lang }: { project: Project; lang: Lang }): React.ReactElement {
  const [facts, setFacts] = React.useState<ProjectFacts | null>(null)
  const [error, setError] = React.useState(false)
  const value = React.useRef<ProjectFacts | null>(null)
  const reload = React.useRef<(request?: boolean, force?: boolean) => void>(() => {})
  React.useEffect(() => {
    let alive = true, seq = 0
    setFacts(null); value.current = null; setError(false)
    const load = (request = false, force = false): void => {
      const current = ++seq
      void (request ? rased.requestProjectFacts(project.id, force) : rased.getProjectFacts(project.id)).then(result => {
        if (alive && current === seq) { value.current = result; setFacts(result); setError(!result) }
      }).catch(() => { if (alive && current === seq) setError(true) })
    }
    reload.current = load
    load(true)
    const offD = rased.onDetailsChanged(event => { if (event.projectIds.includes(project.id)) load() })
    const offP = rased.onProjectsChanged(event => { if (event.changedIds.includes(project.id)) load() })
    const onHealth = (): void => { if (value.current?.status === 'deferred') load(true); else if (value.current?.status === 'loading') load() }
    const offH = project.source === 'kaf' ? rased.onKafHealthChanged(onHealth) : project.source === 'nafezly' ? rased.onNafezlyHealthChanged(onHealth) : rased.onHealthChanged(onHealth)
    return () => { alive = false; seq++; offD(); offP(); offH() }
  }, [project.id, project.source])
  const ar = lang === 'ar', status = facts?.status ?? 'loading'
  const formattedBudget = facts ? budgetLabel(facts.budgetMin, facts.budgetMax) : budgetLabel(project.budgetMin, project.budgetMax)
  const budget = formattedBudget ?? (facts ? facts.budgetRaw : project.budgetRaw)
  const days = facts ? facts.durationDays : project.durationDays
  const duration = days ? `${days} ${ar ? days >= 3 && days <= 10 ? 'أيام' : 'يوم' : days === 1 ? 'day' : 'days'}` : (facts ? facts.durationRaw : project.durationRaw) ?? null
  const missing = status === 'unsupported' ? ar ? 'غير متاح من قائمة الطلبات' : 'Not available in the request list'
    : error || status === 'failed' ? ar ? 'تعذر جلب البيانات' : 'Could not fetch data'
    : status === 'ready' ? ar ? 'غير مذكور في بطاقة المشروع' : 'Not provided in the project card'
    : status === 'deferred' || status === 'not_requested' ? ar ? 'لم يُجلب بعد' : 'Not fetched yet'
    : ar ? 'جارٍ التحميل…' : 'Loading…'
  const note = status === 'deferred' ? facts?.deferredReason === 'disabled' ? ar ? 'فعّل رصد المنصة لجلب البيانات الناقصة.' : 'Enable this platform to fetch missing data.'
    : facts?.deferredReason === 'paused' ? ar ? 'استأنف رصد المنصة لجلب البيانات الناقصة.' : 'Resume this platform to fetch missing data.'
    : ar ? 'جلب التفاصيل مؤجل حتى انتهاء تهدئة المنصة؛ إعادة المحاولة لا تتجاوزها.' : 'Details are deferred until the platform cooldown ends; retry cannot bypass it.'
    : status === 'failed' || error ? ar ? 'تعذر تحديث الميزانية والمدة. أي قيم ظاهرة هي آخر بيانات محفوظة؛ يمكنك إعادة المحاولة أو فتح المصدر.' : 'Could not refresh the budget and duration. Any visible values are cached; retry or open the source.'
    : status === 'loading' ? ar ? 'جارٍ جلب بيانات بطاقة المشروع؛ تظل القيم المحفوظة ظاهرة إن وُجدت.' : 'Fetching project-card data; cached values remain visible when available.' : null
  return <>
    <div className="fact project-budget" data-fact="budget"><div className="k">{STRINGS[lang].factsBudget}</div><div className={formattedBudget ? 'v num' : 'v'} dir={formattedBudget ? 'ltr' : 'auto'}>{budget ?? missing}</div></div>
    <div className="fact project-duration" data-fact="duration"><div className="k">{ar ? 'مدة التنفيذ' : 'Project duration'}</div><div className="v" dir="auto">{duration ?? missing}</div></div>
    <div className="project-facts-status" data-status={error ? 'failed' : status}>
      {note && <p className="hint" role="status">{note}</p>}
      {facts?.fetchedAt && <p className="hint">{ar ? 'آخر جلب للبيانات' : 'Last fetched'}: <bdi>{fullDate(facts.fetchedAt, lang)}</bdi></p>}
      {status !== 'unsupported' && <button className="btn sm" disabled={status === 'loading' && !error || status === 'deferred'} onClick={() => { setError(false); reload.current(true, true) }}>{ar ? 'تحديث الميزانية والمدة' : 'Refresh budget and duration'}</button>}
    </div>
  </>
}
