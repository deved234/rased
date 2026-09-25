import { useEffect, useState } from 'react'
import { rased } from './api.js'
import { KNOWN_CATEGORIES } from '@shared/categories.js'
import { defaultSettings, type AppSettings, type CategoryFilter, type DiagnosticEntry } from '@shared/types.js'
import { STRINGS, type Lang } from './i18n.js'

interface Props {
  settings: AppSettings
  lang: Lang
  onChange: (patch: Partial<AppSettings>) => void
}

function splitKws(v: string): string[] {
  return v.split(/[،,]/).map((s) => s.trim()).filter(Boolean).slice(0, 100)
}

function FilterEditor({
  lang,
  title,
  value,
  onChange
}: {
  lang: Lang
  title: string
  value: CategoryFilter
  onChange: (f: CategoryFilter) => void
}) {
  const t = STRINGS[lang]
  return (
    <div className="set-group">
      <h2>{title}</h2>
      <div className="set-row">
        <label>{t.filterModeAll} / {t.filterModeSelected}</label>
        <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value === 'selected' ? 'selected' : 'all' })}>
          <option value="all">{t.filterModeAll}</option>
          <option value="selected">{t.filterModeSelected}</option>
        </select>
      </div>
      {value.mode === 'selected' && (
        <div className="cat-grid">
          {KNOWN_CATEGORIES.map((c) => {
            const on = value.categories.includes(c.slug)
            return (
              <button
                key={c.slug}
                className={on ? 'chip active' : 'chip'}
                onClick={() =>
                  onChange({ ...value, categories: on ? value.categories.filter((x) => x !== c.slug) : [...value.categories, c.slug] })
                }
              >
                {lang === 'ar' ? c.ar : c.en}
              </button>
            )
          })}
        </div>
      )}
      <div className="set-row">
        <label>{t.keywordsAny}</label>
      </div>
      <div className="set-row">
        <input
          className="kw-input"
          type="text"
          dir="auto"
          defaultValue={value.keywordsAny.join('، ')}
          key={value.keywordsAny.join('|')}
          onBlur={(e) => onChange({ ...value, keywordsAny: splitKws(e.target.value) })}
        />
      </div>
      <div className="set-row">
        <label>{t.keywordsAll}</label>
      </div>
      <div className="set-row">
        <input
          className="kw-input"
          type="text"
          dir="auto"
          defaultValue={value.keywordsAll.join('، ')}
          key={value.keywordsAll.join('|')}
          onBlur={(e) => onChange({ ...value, keywordsAll: splitKws(e.target.value) })}
        />
      </div>
      <div className="set-row">
        <label>{t.excludeKeywords}</label>
      </div>
      <div className="set-row">
        <input
          className="kw-input"
          type="text"
          dir="auto"
          defaultValue={value.excludeKeywords.join('، ')}
          key={value.excludeKeywords.join('|')}
          onBlur={(e) => onChange({ ...value, excludeKeywords: splitKws(e.target.value) })}
        />
      </div>
      <div className="set-row">
        <span className="hint">{t.keywordExcerptNote}</span>
      </div>
    </div>
  )
}

export function SettingsView({ settings, lang, onChange }: Props) {
  const t = STRINGS[lang]
  const [diag, setDiag] = useState<DiagnosticEntry[]>([])
  useEffect(() => {
    let alive = true
    void rased.getDiagnostics(20).then((d) => alive && setDiag(d))
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="settings">
      <div className="set-group">
        <h2>{t.navSettings}</h2>
        <div className="set-row">
          <label>{t.settingsLanguage}</label>
          <select value={settings.language} onChange={(e) => onChange({ language: e.target.value === 'en' ? 'en' : 'ar' })}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="set-row">
          <label>{t.settingsInterval}</label>
          <select
            value={settings.pollIntervalMs}
            onChange={(e) => onChange({ pollIntervalMs: Number(e.target.value) as 2000 | 5000 | 15000 })}
          >
            <option value={5000}>{t.interval5}</option>
            <option value={15000}>{t.interval15}</option>
            <option value={2000}>{t.interval2}</option>
          </select>
        </div>
        {settings.pollIntervalMs === 2000 && (
          <div className="set-row">
            <span className="hint">{t.interval2Warn}</span>
          </div>
        )}
        <div className="set-row">
          <label>{t.settingsNotifications}</label>
          <span className="switch">
            <input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => onChange({ notificationsEnabled: e.target.checked })} aria-label={t.settingsNotifications} />
            <span className="knob" />
          </span>
        </div>
        <div className="set-row">
          <label>{t.settingsSound}</label>
          <span className="switch">
            <input type="checkbox" checked={settings.soundEnabled} onChange={(e) => onChange({ soundEnabled: e.target.checked })} aria-label={t.settingsSound} />
            <span className="knob" />
          </span>
        </div>
        <div className="set-row">
          <label>{t.settingsStartup}</label>
          <span className="switch">
            <input type="checkbox" checked={settings.runAtStartup} onChange={(e) => onChange({ runAtStartup: e.target.checked })} aria-label={t.settingsStartup} />
            <span className="knob" />
          </span>
        </div>
        <div className="set-row">
          <label>{t.notifyUncertain}</label>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.notifyUncertainCategory}
              onChange={(e) => onChange({ notifyUncertainCategory: e.target.checked })}
              aria-label={t.notifyUncertain}
            />
            <span className="knob" />
          </span>
        </div>
        <div className="set-row">
          <span className="hint">{t.notifyUncertainHint}</span>
        </div>
      </div>

      <FilterEditor lang={lang} title={t.settingsNotifyFilter} value={settings.notifyFilter} onChange={(f) => onChange({ notifyFilter: f })} />
      <div className="set-group">
        <div className="set-row">
          <button className="btn" onClick={() => onChange({ displayFilter: { ...settings.notifyFilter } })}>
            {t.copyNotifyToDisplay}
          </button>
        </div>
      </div>
      <FilterEditor lang={lang} title={t.settingsDisplayFilter} value={settings.displayFilter} onChange={(f) => onChange({ displayFilter: f })} />

      <div className="set-group">
        <h2>{t.diagnostics}</h2>
        {diag.length === 0 && <div className="diag">—</div>}
        {diag.map((d, i) => (
          <div className="diag" key={i}>
            <code>{d.at}</code> · {d.endpointKind} · {d.status}
            {d.durationMs != null && ` · ${d.durationMs}ms`}
            {d.itemCount != null && ` · ${d.itemCount}`}
            {d.errorCategory && ` · ${d.errorCategory}`}
          </div>
        ))}
        <div className="set-row">
          <span className="hint">{t.dataNote}</span>
        </div>
      </div>
    </div>
  )
}

export function useDefaultSettingsFallback(): AppSettings {
  return defaultSettings()
}
