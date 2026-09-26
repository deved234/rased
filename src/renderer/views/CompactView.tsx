import React from 'react'
import { rased } from '../api.js'
import { defaultFilterDefinition, type ProjectWithUser } from '@shared/types.js'
import { STRINGS } from '../i18n.js'
import { applyUiPrefs, useHealth, useNow, useSettings } from '../hooks.js'
import { timeAgo } from '../format.js'
import { Icon } from '../components/Icon.js'
import { dotClass, statusText } from '../components/shell.js'

/** Mini follower window: latest headlines, same services, no collector of its own. */
export function CompactView(): React.ReactElement {
  const [settings, , ready] = useSettings()
  const lang = settings.language
  const t = STRINGS[lang]
  const health = useHealth(ready)
  const [rows, setRows] = React.useState<ProjectWithUser[]>([])
  void useNow(5000)

  React.useEffect(() => {
    if (ready) applyUiPrefs(settings)
  }, [settings, ready])

  const reload = React.useCallback(() => {
    void rased.queryProjectsPage(defaultFilterDefinition(), 8, 0).then((r) => setRows(r.rows))
  }, [])
  React.useEffect(() => {
    if (!ready) return
    reload()
    const off = rased.onProjectsChanged(() => reload())
    return off
  }, [ready, reload])

  const pin = settings.ui.compactAlwaysOnTop
  return (
    <div className="compact">
      <div className="compact-top">
        <span className={`dot ${dotClass(health)}`} aria-hidden="true" />
        <strong>{statusText(health, lang)}</strong>
        <span className="grow" />
        <button
          className={pin ? 'icon-btn on' : 'icon-btn'}
          title={t.alwaysOnTop}
          aria-label={t.alwaysOnTop}
          aria-pressed={pin}
          onClick={() => {
            // Main persists the pref and broadcasts settingsChanged; no double write here.
            void rased.setAlwaysOnTop(!pin)
          }}
        >
          <Icon name="pin" size={16} />
        </button>
      </div>
      <div className="compact-list" role="list">
        {rows.map((p) => (
          <div key={p.id} className={p.readAt ? 'row' : 'row unread'} role="listitem">
            <h3>
              <button
                className="btn ghost sm link-title"
                dir="auto"
                onClick={() => void rased.showProjectInMain(p.id)}
                title={t.openInMain}
              >
                <span className="clamp-1">{p.title}</span>
              </button>
            </h3>
            <div className="meta">
              <span>
                {timeAgo(p.publishedAt ?? p.firstSeenAt, lang)}
              </span>
              <button
                className={p.saved ? 'icon-btn on' : 'icon-btn'}
                title={p.saved ? t.unsaveProject : t.saveProject}
                aria-label={p.saved ? t.unsaveProject : t.saveProject}
                aria-pressed={p.saved}
                onClick={(e) => {
                  e.stopPropagation()
                  void rased.updateProjectUserState(p.id, { saved: !p.saved }).then(() => reload())
                }}
              >
                <Icon name={p.saved ? 'bookmarkFill' : 'bookmark'} size={15} />
              </button>
              <button
                className="icon-btn"
                title={t.openExternal}
                aria-label={t.openExternal}
                onClick={() => void rased.openProjectExternal(p.id)}
              >
                <Icon name="external" size={15} />
              </button>
            </div>
          </div>
        ))}
        {ready && rows.length === 0 && <p className="muted small">{t.emptyNone}</p>}
      </div>
    </div>
  )
}
