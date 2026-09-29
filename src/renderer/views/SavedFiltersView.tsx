import React from 'react'
import { rased } from '../api.js'
import type { FilterDefinition, SavedFilter } from '@shared/types.js'
import { STRINGS, type Lang } from '../i18n.js'
import { fullDate } from '../format.js'
import { FilterDrawer } from '../components/FilterDrawer.js'
import { ConfirmDialog, EmptyState } from '../components/ui.js'
import { Icon } from '../components/Icon.js'
import { defaultFilterDefinition } from '@shared/types.js'

export function SavedFiltersView({
  lang,
  notifyFilter,
  linked,
  onToggleLink,
  onApply
}: {
  lang: Lang
  notifyFilter: FilterDefinition['categoryFilter']
  linked: boolean
  onToggleLink: (v: boolean) => void
  onApply: (def: FilterDefinition) => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const [filters, setFilters] = React.useState<SavedFilter[]>([])
  const [loading, setLoading] = React.useState(true)
  const [editing, setEditing] = React.useState<SavedFilter | null>(null)
  const [deleting, setDeleting] = React.useState<SavedFilter | null>(null)
  const [creating, setCreating] = React.useState(false)

  const reload = React.useCallback(() => {
    void rased.getSavedFilters().then((f) => {
      setFilters(f)
      setLoading(false)
    })
  }, [])
  React.useEffect(() => {
    reload()
  }, [reload])

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="set-group">
          <h2>{t.navFilters}</h2>
          <p className="desc">{t.keywordExcerptNote}</p>
          <div className="set-row">
            <button className="btn primary sm" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> {t.saveFilterBtn}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="set-group">
            <div className="skel" />
            <div className="skel w70" />
          </div>
        ) : filters.length === 0 ? (
          <EmptyState title={t.noSavedFilters} />
        ) : (
          filters.map((f) => (
            <div key={f.id} className="set-group">
              <div className="set-row">
                <strong dir="auto">{f.name}</strong>
                <span className="tag">{f.definition.source === 'all' ? (lang === 'ar' ? 'كل المصادر' : 'All sources') : f.definition.source === 'khamsat' ? t.sourceKhamsat : f.definition.source === 'nafezly' ? t.sourceNafezly : t.sourceMostaql}</span>
                <span className="faint small num">{fullDate(f.updatedAt, lang)}</span>
              </div>
              <div className="row-actions">
                <button className="btn sm primary" onClick={() => onApply(f.definition)}>
                  {t.applyFilterBtn}
                </button>
                <button className="btn sm" onClick={() => setEditing(f)}>
                  {t.rename}
                </button>
                <button className="btn sm danger" onClick={() => setDeleting(f)}>
                  {t.deleteFilterBtn}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {(creating || editing) && (
        <FilterDrawer
          lang={lang}
          initial={editing ? editing.definition : defaultFilterDefinition()}
          notifyFilter={notifyFilter}
          linked={linked}
          onToggleLink={onToggleLink}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onApply={(def) => {
            onApply(def)
            setCreating(false)
            setEditing(null)
          }}
          onSave={(name, def) => {
            if (editing) {
              void rased.updateSavedFilter(editing.id, name, def).then(() => {
                setEditing(null)
                reload()
              })
            } else {
              void rased.createSavedFilter(name, def).then(() => {
                setCreating(false)
                reload()
              })
            }
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          lang={lang}
          title={t.confirmDeleteFilter}
          body={deleting.name}
          danger
          confirmLabel={t.deleteFilterBtn}
          onConfirm={() => {
            void rased.deleteSavedFilter(deleting.id).then(() => {
              setDeleting(null)
              reload()
            })
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
