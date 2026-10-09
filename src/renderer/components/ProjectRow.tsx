import React from 'react'
import { QuickApplyButton } from './QuickApplyButton.js'
import { categoryDisplay } from '@shared/categories.js'
import type { ProjectWithUser } from '@shared/types.js'
import { STRINGS, type Lang } from '../i18n.js'
import { budgetLabel, timeAgo } from '../format.js'
import { Icon } from './Icon.js'
import { openOnSource, sourceName } from '../sourceCopy.js'

export function CategoryTag({ lang, slug, confirmed }: { lang: Lang; slug: string | null; confirmed: boolean }): React.ReactElement | null {
  const t = STRINGS[lang]
  if (!slug) return <span className="tag">{t.unknownCategory}</span>
  if (!confirmed) return <span className="tag">{t.uncertainCategory}</span>
  return <span className="tag cat">{categoryDisplay(slug, lang) ?? slug}</span>
}

export function ProjectRow({
  lang,
  project: p,
  isNew,
  selected,
  onPreview,
  onToggleSave,
  onOpenExternal
}: {
  lang: Lang
  project: ProjectWithUser
  isNew: boolean
  selected: boolean
  onPreview: () => void
  onToggleSave: () => void
  onOpenExternal: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const budget = budgetLabel(p.budgetMin, p.budgetMax)
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return // inner buttons handle their own keys
    e.stopPropagation()
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault()
      onPreview()
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      onOpenExternal()
    }
  }
  return (
    <article
      className={['row', 'opportunity-row', p.readAt ? '' : 'unread', selected ? 'selected' : ''].filter(Boolean).join(' ')}
      onClick={onPreview}
      onKeyDown={onKey}
      tabIndex={0}
      role="button"
      aria-label={`${t.previewAction}: ${p.title}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="opportunity-content">
        <h3><span className="t clamp-1" dir="auto">{p.title}</span></h3>
        {p.descriptionExcerpt && <p className="ex clamp-1" dir="auto">{p.descriptionExcerpt}</p>}
        <div className="meta opportunity-meta">
          <span className="tag">{sourceName(p.source, lang)}</span>
          {isNew && <span className="tag fresh">{t.newBadge}</span>}
          {!p.readAt && !isNew && <span className="tag fresh">{t.unreadBadge}</span>}
          <span title={p.publishedAt ?? p.firstSeenAt}>{p.publishedAt ? t.publishedAt : t.discoveredAt}: {timeAgo(p.publishedAt ?? p.firstSeenAt, lang)}</span>
          {p.source === 'mostaql' && <CategoryTag lang={lang} slug={p.categorySlug} confirmed={p.categoryConfirmed} />}
          {p.source === 'mostaql' && budget && <span className="tag num" dir="ltr">{budget}</span>}
          {p.discoveryKind === 'recovered' && <span className="tag">{t.catchUpTag}</span>}
          {p.personalStatus !== 'none' && <span className="tag good">{p.personalStatus === 'interested' ? t.statusInterested : p.personalStatus === 'submitted' ? t.statusSubmitted : t.statusIgnored}</span>}
        </div>
      </div>
      <div className="opportunity-actions">
        <QuickApplyButton id={p.id} source={p.source} lang={lang}/>
        <button className="btn sm ghost preview-action" title={t.previewTitle} aria-label={`${t.previewAction}: ${p.title}`} onClick={(e) => { e.stopPropagation(); onPreview() }}><Icon name="eye" size={16} />{t.previewAction}</button>
        <button className="btn sm external-action" title={openOnSource(p.source, lang)} onClick={(e) => { e.stopPropagation(); onOpenExternal() }}>{openOnSource(p.source, lang)} <Icon name="external" size={15} /></button>
        <button className={p.saved ? 'icon-btn on' : 'icon-btn'} title={p.saved ? t.unsaveProject : t.saveProject} aria-label={p.saved ? t.unsaveProject : t.saveProject} aria-pressed={p.saved} onClick={(e) => { e.stopPropagation(); onToggleSave() }}><Icon name={p.saved ? 'bookmarkFill' : 'bookmark'} size={16} /></button>
      </div>
    </article>
  )
}
