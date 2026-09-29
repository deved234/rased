import React from 'react'
import { rased } from '../api.js'
import { KNOWN_CATEGORIES } from '@shared/categories.js'
import { defaultFilterDefinition, type CategoryFilter, type FilterDefinition } from '@shared/types.js'
import { STRINGS, type Lang } from '../i18n.js'
import { Icon } from './Icon.js'
import { Toggle, useDialogFocus } from './ui.js'

function splitKws(v: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of v.split(/[،,]/)) {
    const s = part.trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out.slice(0, 100)
}

export function KeywordTokens({
  label,
  values,
  onChange
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
}): React.ReactElement {
  const [draft, setDraft] = React.useState('')
  const commit = (): void => {
    if (!draft.trim()) return
    onChange([...values, ...splitKws(draft)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 100))
    setDraft('')
  }
  return (
    <div>
      <div className="small muted">{label}</div>
      <div className="tokens">
        {values.map((v) => (
          <span key={v} className="tag">
            <span dir="auto">{v}</span>
            <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`${label}: ${v}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="input"
          dir="auto"
          value={draft}
          placeholder="…"
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            }
          }}
        />
      </div>
    </div>
  )
}

export function FilterDrawer({
  lang,
  initial,
  notifyFilter,
  linked,
  onToggleLink,
  onApply,
  onSave,
  onClose
}: {
  lang: Lang
  initial: FilterDefinition
  notifyFilter: CategoryFilter
  linked: boolean
  onToggleLink: (v: boolean) => void
  onApply: (def: FilterDefinition) => void
  onSave: (name: string, def: FilterDefinition) => void
  onClose: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const [def, setDef] = React.useState<FilterDefinition>(initial)
  const [name, setName] = React.useState('')
  const [count, setCount] = React.useState<{ total: number; unread: number } | null>(null)
  const gen = React.useRef(0)
  const panelRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef)

  React.useEffect(() => {
    const my = ++gen.current
    const id = setTimeout(() => {
      void rased.previewFilterCount(def).then((c) => {
        if (gen.current === my) setCount(c)
      })
    }, 350)
    return () => clearTimeout(id)
  }, [def])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setCat = (mode: 'all' | 'selected', categories: string[]): void =>
    setDef({ ...def, categoryFilter: { ...def.categoryFilter, mode, categories } });
  const setKw = (k: 'keywordsAny' | 'keywordsAll' | 'excludeKeywords', v: string[]): void =>
    setDef({ ...def, categoryFilter: { ...def.categoryFilter, [k]: v } });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-label={t.filterTitle}>
        <h2>{t.filterTitle}</h2>

        <div className="set-row">
          <label>{t.filterSource}</label>
          <select className="select" value={def.source} onChange={(e) => {
            const source = e.target.value as FilterDefinition['source']
            setDef(source === 'khamsat' || source === 'nafezly' ? { ...def, source, categoryFilter: { ...def.categoryFilter, mode: 'all', categories: [] }, budgetMin: null, budgetMax: null, includeUnknownBudget: true } : { ...def, source })
          }}>
            <option value="all">{lang === 'ar' ? 'كل المصادر' : 'All sources'}</option>
            <option value="mostaql">{t.sourceMostaql}</option>
            <option value="khamsat">{t.sourceKhamsat}</option>
            <option value="nafezly">{t.sourceNafezly}</option>
          </select>
        </div>
        <p className="hint">{def.source === 'khamsat' ? t.filterKhamsatScope : def.source === 'nafezly' ? (lang === 'ar' ? 'نفذلي: البحث في العنوان ومقتطف الوصف؛ المجال والميزانية غير مؤكدين.' : 'Nafezly: search the title and description excerpt; category and budget are unverified.') : t.filterCategoryScope}</p>

        <div className="set-row">
          <label>{t.scopeAll}</label>
          <select className="select" value={def.scope} onChange={(e) => setDef({ ...def, scope: e.target.value as FilterDefinition['scope'] })}>
            <option value="all">{t.scopeAll}</option>
            <option value="saved">{t.scopeSaved}</option>
            <option value="hidden">{t.scopeHidden}</option>
          </select>
        </div>

        <div className="set-row">
          <label>{t.showUnreadOnly}</label>
          <Toggle checked={def.unreadOnly} onChange={(v) => setDef({ ...def, unreadOnly: v })} label={t.showUnreadOnly} />
        </div>

        <div>
          <div className="small muted">{t.statusesTitle}</div>
          <div className="chips">
            {(['interested', 'submitted', 'ignored'] as const).map((s) => {
              const on = def.statuses.includes(s)
              const label = s === 'interested' ? t.statusInterested : s === 'submitted' ? t.statusSubmitted : t.statusIgnored
              return (
                <button key={s} className={on ? 'chip active' : 'chip'} aria-pressed={on} onClick={() => setDef({ ...def, statuses: on ? def.statuses.filter((x) => x !== s) : [...def.statuses, s] })}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {(def.source === 'mostaql' || def.source === 'all') && <div>
          <div className="small muted">{t.filterModeAll} / {t.filterModeSelected}</div>
          <div className="chips">
            <button
              className={def.categoryFilter.mode === 'all' ? 'chip active' : 'chip'}
              aria-pressed={def.categoryFilter.mode === 'all'}
              onClick={() => setCat('all', [])}
            >
              {t.filterModeAll}
            </button>
            {KNOWN_CATEGORIES.map((c) => {
              const on = def.categoryFilter.mode === 'selected' && def.categoryFilter.categories.includes(c.slug)
              return (
                <button
                  key={c.slug}
                  className={on ? 'chip active' : 'chip'}
                  aria-pressed={on}
                  onClick={() => {
                    const cats = on
                      ? def.categoryFilter.categories.filter((x) => x !== c.slug)
                      : [...def.categoryFilter.categories, c.slug]
                    setCat(cats.length > 0 ? 'selected' : 'all', cats)
                  }}
                >
                  {lang === 'ar' ? c.ar : c.en}
                </button>
              )
            })}
          </div>
        </div>}

        <KeywordTokens label={t.keywordsAny} values={def.categoryFilter.keywordsAny} onChange={(v) => setKw('keywordsAny', v)} />
        <KeywordTokens label={t.keywordsAll} values={def.categoryFilter.keywordsAll} onChange={(v) => setKw('keywordsAll', v)} />
        <KeywordTokens label={t.excludeKeywords} values={def.categoryFilter.excludeKeywords} onChange={(v) => setKw('excludeKeywords', v)} />

        {(def.source === 'mostaql' || def.source === 'all') && <div className="set-row">
          <label>{t.budget}</label>
          <input
            className="input num"
            dir="ltr"
            inputMode="decimal"
            aria-label={t.budgetFrom}
            placeholder="min $"
            value={def.budgetMin ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              setDef({ ...def, budgetMin: e.target.value === '' || !Number.isFinite(n) || n < 0 ? null : n })
            }}
          />
          <input
            className="input num"
            dir="ltr"
            inputMode="decimal"
            aria-label={t.budgetTo}
            placeholder="max $"
            value={def.budgetMax ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              setDef({ ...def, budgetMax: e.target.value === '' || !Number.isFinite(n) || n < 0 ? null : n })
            }}
          />
        </div>}
        {(def.source === 'mostaql' || def.source === 'all') && <div className="set-row">
          <label>{t.includeUnknownBudget}</label>
          <Toggle checked={def.includeUnknownBudget} onChange={(v) => setDef({ ...def, includeUnknownBudget: v })} label={t.includeUnknownBudget} />
        </div>}

        <div className="set-row">
          <label>{t.sortTitle}</label>
          <select className="select" value={def.sort} onChange={(e) => setDef({ ...def, sort: e.target.value as FilterDefinition['sort'] })}>
            <option value="latestDetected">{t.sortDetected}</option>
            <option value="latestPublished">{t.sortPublished}</option>
          </select>
        </div>

        {(def.source === 'mostaql' || def.source === 'all') && <div className="set-row">
          <label>{t.linkFilters}</label>
          <Toggle checked={linked} onChange={onToggleLink} label={t.linkFilters} />
        </div>}
        {(def.source === 'mostaql' || def.source === 'all') && <div className="set-row">
          <span className="hint">{t.linkFiltersHint}</span>
        </div>}
        {(def.source === 'mostaql' || def.source === 'all') && !linked && (
          <div className="set-row">
            <button className="btn sm ghost" onClick={() => setDef({ ...def, categoryFilter: { ...notifyFilter } })}>
              {t.copyNotifyToDisplay}
            </button>
          </div>
        )}

        <div className="meta">
          <Icon name="info" size={14} />
          <span>
            {t.previewCount}: {count ? <strong className="num">{count.total}</strong> : '…'} {t.projectsUnit}
          </span>
        </div>

        <div className="set-row">
          <input
            className="input"
            dir="auto"
            maxLength={80}
            placeholder={t.filterNamePlaceholder}
            aria-label={t.filterNameLabel}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn sm" disabled={!name.trim()} onClick={() => onSave(name.trim(), def)}>
            {t.saveFilterBtn}
          </button>
        </div>

        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              setDef(defaultFilterDefinition())
              setName('')
            }}
          >
            {t.clearAllBtn}
          </button>
          <button className="btn primary" onClick={() => onApply(def)}>
            {t.applyFilterBtn}
          </button>
        </div>
      </div>
    </>
  )
}
