import React from 'react'
import { rased } from '../api.js'
import { defaultFilterDefinition, type ProjectWithUser } from '@shared/types.js'
import { STRINGS } from '../i18n.js'
import { applyUiPrefs, useHealth, useKhamsatHealth, useNafezlyHealth, useNow, useSettings } from '../hooks.js'
import { timeAgo } from '../format.js'
import { Icon } from '../components/Icon.js'
import { overallDot, overallText } from '../components/shell.js'
import { overallSourceState } from '@shared/sourceStatus.js'
import { openOnSource, sourceName } from '../sourceCopy.js'

/** Mini follower window: latest headlines, same services, no collector of its own. */
export function CompactView(): React.ReactElement {
  const [settings, patch, ready] = useSettings()
  const lang = settings.language
  const t = STRINGS[lang]
  const health = useHealth(ready)
  const khamsatHealth = useKhamsatHealth(ready)
  const nafezlyHealth = useNafezlyHealth(ready)
  const overall = overallSourceState([health, ...(settings.khamsatEnabled ? [khamsatHealth] : []), ...(settings.nafezlyEnabled ? [nafezlyHealth] : [])])
  const [error, setError] = React.useState(false)
  const [rows, setRows] = React.useState<ProjectWithUser[]>([])
  void useNow(5000)

  React.useEffect(() => {
    if (ready) applyUiPrefs(settings)
  }, [settings, ready])

  const queryGeneration = React.useRef(0)
  const reload = React.useCallback(() => {
    const generation = ++queryGeneration.current
    void rased.queryProjectsPage(settings.ui.compactUseDisplayFilter ? settings.displayQuery : defaultFilterDefinition(), 8, 0).then((r) => { if (generation === queryGeneration.current) { setRows(r.rows); setError(false) } }).catch(() => { if (generation === queryGeneration.current) setError(true) })
  }, [settings.displayQuery, settings.ui.compactUseDisplayFilter])
  React.useEffect(() => {
    if (!ready) return
    reload()
    const off = rased.onProjectsChanged(() => reload())
    return () => { queryGeneration.current++; off() }
  }, [ready, reload])

  const pin = settings.ui.compactAlwaysOnTop
  return (
    <div className="compact">
      <div className="compact-top">
        <span className={`dot ${overallDot(overall)}`} aria-hidden="true" />
        <strong>{overallText(overall, lang)}</strong>
        <span className="grow" />
        <button
          className={pin ? 'icon-btn on' : 'icon-btn'}
          title={t.alwaysOnTop}
          aria-label={t.alwaysOnTop}
          aria-pressed={pin}
          onClick={() => {
            // Main persists the pref and broadcasts settingsChanged; no double write here.
            void rased.setAlwaysOnTop(!pin).catch(() => setError(true))
          }}
        >
          <Icon name="pin" size={16} />
        </button>
      </div>
      <div className="compact-caption"><span>{lang === 'ar' ? 'أحدث 8 فرص' : 'Latest 8 opportunities'}</span><label><input type="checkbox" checked={settings.ui.compactUseDisplayFilter} onChange={e => void patch({ui:{...settings.ui,compactUseDisplayFilter:e.target.checked}}).catch(()=>setError(true))}/>{lang === 'ar' ? 'استخدم فلتر القائمة' : 'Use list filter'}</label></div>
      {error && <p className="field-err" role="alert">{lang === 'ar' ? 'تعذر التحديث. حاول مرة أخرى.' : 'Could not refresh. Try again.'}<button className="btn sm" onClick={reload}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></p>}
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
              <span className="tag">{sourceName(p.source, lang)}</span>
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
                  void rased.updateProjectUserState(p.id, { saved: !p.saved }).then(() => reload()).catch(() => setError(true))
                }}
              >
                <Icon name={p.saved ? 'bookmarkFill' : 'bookmark'} size={15} />
              </button>
              <button
                className="icon-btn"
                title={openOnSource(p.source, lang)}
                aria-label={openOnSource(p.source, lang)}
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
