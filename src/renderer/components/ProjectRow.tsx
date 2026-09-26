import React from 'react'
import { categoryDisplay } from '@shared/categories.js'
import type { ProjectWithUser } from '@shared/types.js'
import { STRINGS, type Lang } from '../i18n.js'
import { budgetLabel, timeAgo } from '../format.js'
import { Icon } from './Icon.js'

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
  onOpen,
  onPreview,
  onToggleSave,
  onOpenExternal
}: {
  lang: Lang
  project: ProjectWithUser
  isNew: boolean
  selected: boolean
  onOpen: () => void
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
      onOpen()
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      onOpenExternal()
    }
  }
  return (
    <article
      className={['row', p.readAt ? '' : 'unread', selected ? 'selected' : ''].filter(Boolean).join(' ')}
      onClick={onOpen}
      onKeyDown={onKey}
      tabIndex={0}
      role="button"
      aria-label={p.title}
      aria-current={selected ? 'true' : undefined}
    >
      <h3>
        <span className="t clamp-1" dir="auto">
          {p.title}
        </span>
      </h3>
      {p.descriptionExcerpt && (
        <p className="ex clamp-1" dir="auto">
          {p.descriptionExcerpt}
        </p>
      )}
      <div className="meta">
        {isNew && <span className="tag fresh">{t.newBadge}</span>}
        {!p.readAt && !isNew && <span className="tag fresh">{t.unreadBadge}</span>}
        <CategoryTag lang={lang} slug={p.categorySlug} confirmed={p.categoryConfirmed} />
        {budget ? (
          <span className="tag num" dir="ltr">
            {budget}
          </span>
        ) : (
          <span className="tag">{t.budgetUnknown}</span>
        )}
        <span title={p.publishedAt ?? ''}>
          {t.publishedAt}: {timeAgo(p.publishedAt, lang)}
        </span>
        {p.discoveryKind === 'recovered' && <span className="tag">{t.catchUpTag}</span>}
        {p.personalStatus !== 'none' && (
          <span className="tag good">
            {p.personalStatus === 'interested' ? t.statusInterested : p.personalStatus === 'submitted' ? t.statusSubmitted : t.statusIgnored}
          </span>
        )}
        {p.saved && (
          <span className="tag" aria-label={t.savedBadge}>
            <Icon name="bookmarkFill" size={12} /> {t.savedBadge}
          </span>
        )}
        <span className="row-actions">
          <button className="icon-btn" title={t.previewTitle} aria-label={t.previewTitle} onClick={(e) => { e.stopPropagation(); onPreview() }}><Icon name="eye" size={16} /></button>
          <button
            className={p.saved ? 'icon-btn on' : 'icon-btn'}
            title={p.saved ? t.unsaveProject : t.saveProject}
            aria-label={p.saved ? t.unsaveProject : t.saveProject}
            aria-pressed={p.saved}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSave()
            }}
          >
            <Icon name={p.saved ? 'bookmarkFill' : 'bookmark'} size={16} />
          </button>
          <button
            className="icon-btn"
            title={t.openExternal}
            aria-label={t.openExternal}
            onClick={(e) => {
              e.stopPropagation()
              onOpenExternal()
            }}
          >
            <Icon name="external" size={16} />
          </button>
        </span>
      </div>
    </article>
  )
}
