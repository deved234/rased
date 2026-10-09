import React from 'react'
import { LegalView } from './LegalView.js'
import { UpdatesView, updatesTitle } from './UpdatesView.js'
import { ProposalSettings } from './ProposalSettings.js'
import { QuickApplySettings } from './QuickApplySettings.js'
import { rased } from '../api.js'
import { DEVELOPER_NAME, type AboutLink } from '@shared/about.js'
import logo from '../assets/logo.svg'
import { Icon } from '../components/Icon.js'
import { KNOWN_CATEGORIES } from '@shared/categories.js'
import type { AppSettings, CategoryFilter, DiagnosticEntry, SourceHealth } from '@shared/types.js'
import type { ImportSummary } from '@shared/api.js'
import { STRINGS, type Lang } from '../i18n.js'
import { fullDate } from '../format.js'
import { useNow } from '../hooks.js'
import { ConfirmDialog, FieldError, Toggle } from '../components/ui.js'
import { KeywordTokens } from '../components/FilterDrawer.js'
import { statusText, togglePause } from '../components/shell.js'

type Section = 'watching' | 'notifications' | 'appearance' | 'ai' | 'quick' | 'data' | 'about' | 'legal' | 'updates'

const SECTIONS: Section[] = ['watching', 'notifications', 'appearance', 'ai', 'quick', 'data', 'updates', 'about', 'legal']

function sectionTitle(s: Section, lang: Lang): string {
  if (s === 'quick') return lang === 'ar' ? 'التقديم السريع' : 'Quick apply'
  const t = STRINGS[lang]
  if (s === 'watching') return t.settingsWatching
  if (s === 'notifications') return t.settingsNotifications
  if (s === 'appearance') return t.settingsAppearance
  if (s === 'ai') return lang === 'ar' ? 'مساعد العروض' : 'Proposal Assistant'
  if (s === 'data') return t.settingsData
  if (s === 'legal') return lang === 'ar' ? 'الشروط والخصوصية' : 'Terms & privacy'
  if (s === 'updates') return updatesTitle(lang)
  return t.settingsAbout
}

function CategoryEditor({
  lang,
  value,
  onChange
}: {
  lang: Lang
  value: CategoryFilter
  onChange: (f: CategoryFilter) => void
}): React.ReactElement {
  const t = STRINGS[lang]
  return (
    <>
      <div className="set-row">
        <label>{t.filterModeAll} / {t.filterModeSelected}</label>
        <select className="select" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value === 'selected' ? 'selected' : 'all' })}>
          <option value="all">{t.filterModeAll}</option>
          <option value="selected">{t.filterModeSelected}</option>
        </select>
      </div>
      {value.mode === 'selected' && (
        <div className="cat-grid chips">
          {KNOWN_CATEGORIES.map((c) => {
            const on = value.categories.includes(c.slug)
            return (
              <button
                key={c.slug}
                className={on ? 'chip active' : 'chip'}
                aria-pressed={on}
                onClick={() => onChange({ ...value, categories: on ? value.categories.filter((x) => x !== c.slug) : [...value.categories, c.slug] })}
              >
                {lang === 'ar' ? c.ar : c.en}
              </button>
            )
          })}
        </div>
      )}
      <KeywordTokens label={t.keywordsAny} values={value.keywordsAny} onChange={(v) => onChange({ ...value, keywordsAny: v })} />
      <KeywordTokens label={t.keywordsAll} values={value.keywordsAll} onChange={(v) => onChange({ ...value, keywordsAll: v })} />
      <KeywordTokens label={t.excludeKeywords} values={value.excludeKeywords} onChange={(v) => onChange({ ...value, excludeKeywords: v })} />
      <div className="set-row">
        <span className="hint">{t.keywordExcerptNote}</span>
      </div>
    </>
  )
}

export function SettingsView({
  lang,
  settings,
  health,
  khamsatHealth,
  nafezlyHealth,
  patchSettings,
  section,
  onSection
}: {
  lang: Lang
  settings: AppSettings
  health: SourceHealth | null
  khamsatHealth: SourceHealth | null
  nafezlyHealth: SourceHealth | null
  patchSettings: (p: Partial<AppSettings>) => Promise<void>
  section: string | null
  onSection: (s: Section) => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const active: Section = section && (SECTIONS as string[]).includes(section) ? (section as Section) : 'watching'
  const [diag, setDiag] = React.useState<DiagnosticEntry[]>([])
  const [testMsg, setTestMsg] = React.useState<string | null>(null)
  const [importSummary, setImportSummary] = React.useState<ImportSummary | null>(null)
  const [importMode, setImportMode] = React.useState<'merge' | 'replace'>('merge')
  const [importStartup, setImportStartup] = React.useState(false)
  const [importMsg, setImportMsg] = React.useState<string | null>(null)
  const [exportMsg, setExportMsg] = React.useState<string | null>(null)
  const [purgeDays, setPurgeDays] = React.useState(90)
  const [purgeCount, setPurgeCount] = React.useState<number | null>(null)
  const [purgeConfirm, setPurgeConfirm] = React.useState(false)
  const [purgeMsg, setPurgeMsg] = React.useState<string | null>(null)
  const [appInfo, setAppInfo] = React.useState<{ version: string; platform: string; arch: string } | null>(null)
  const [aboutError, setAboutError] = React.useState<string | null>(null)
  const [khamsatAny, setKhamsatAny] = React.useState(settings.khamsatKeywordsAny.join(', '))
  const [khamsatExclude, setKhamsatExclude] = React.useState(settings.khamsatExcludeKeywords.join(', '))
  const [nafezlyAny, setNafezlyAny] = React.useState(settings.nafezlyKeywordsAny.join(', '))
  const [nafezlyExclude, setNafezlyExclude] = React.useState(settings.nafezlyExcludeKeywords.join(', '))
  React.useEffect(() => setKhamsatAny(settings.khamsatKeywordsAny.join(', ')), [settings.khamsatKeywordsAny.join(',')])
  React.useEffect(() => setKhamsatExclude(settings.khamsatExcludeKeywords.join(', ')), [settings.khamsatExcludeKeywords.join(',')])
  React.useEffect(() => setNafezlyAny(settings.nafezlyKeywordsAny.join(', ')), [settings.nafezlyKeywordsAny.join(',')])
  React.useEffect(() => setNafezlyExclude(settings.nafezlyExcludeKeywords.join(', ')), [settings.nafezlyExcludeKeywords.join(',')])
  const splitKeywords = (value: string): string[] => value.split(/[,،\n]/).map(x => x.trim()).filter(Boolean).slice(0, 100)
  const openAboutLink = async (link: AboutLink): Promise<void> => {
    try {
      const result = await rased.openAboutLink(link)
      setAboutError(result.ok ? null : t.aboutLinkError)
    } catch { setAboutError(t.aboutLinkError) }
  }
  useNow(5000)

  React.useEffect(() => {
    let alive = true
    void rased.getDiagnostics(20).then((d) => alive && setDiag(d))
    void rased.getAppInfo().then((a) => alive && setAppInfo(a))
    return () => {
      alive = false
    }
  }, [])

  const dndActive = settings.doNotDisturbUntil && Date.parse(settings.doNotDisturbUntil) > Date.now()
  const setDndMinutes = (m: number): void => {
    void rased.setDnd(m === 0 ? null : new Date(Date.now() + m * 60_000).toISOString())
  }

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="chips" role="tablist" aria-label={t.navSettings}>
          {SECTIONS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={active === s}
              className={active === s ? 'chip active' : 'chip'}
              onClick={() => onSection(s)}
            >
              {sectionTitle(s, lang)}
            </button>
          ))}
        </div>

        {active === 'watching' && (
          <><div className="set-group">
            <h2>{lang === 'ar' ? 'رصد مستقل' : 'Mostaql monitoring'}</h2>
            <div className="set-row">
              <label>{lang === 'ar' ? 'حالة رصد مستقل' : 'Mostaql status'}</label>
              <span className="muted">{statusText(health, lang)}</span>
              <button className="btn sm" disabled={!health} onClick={() => void togglePause('mostaql', health)}>{health?.paused ? t.resume : t.pause} {t.sourceMostaql}</button>
            </div>
            <p className="hint">{lang === 'ar' ? 'الإيقاف المؤقت يخص مستقل وحده ويُلغى عند إعادة تشغيل راصد.' : 'Pause affects only Mostaql and resets when RASED restarts.'}</p>
            <div className="set-row">
              <label>{t.settingsInterval}</label>
              <select
                className="select"
                value={settings.pollIntervalMs}
                onChange={(e) => void patchSettings({ pollIntervalMs: Number(e.target.value) as 2000 | 5000 | 15000 })}
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
          </div>
          <div className="set-group">
            <h2>{lang === 'ar' ? 'تشغيل راصد' : 'RASED behavior'}</h2>
            <div className="set-row">
              <label>{t.settingsStartup}</label>
              <Toggle checked={settings.runAtStartup} onChange={(v) => void patchSettings({ runAtStartup: v })} label={t.settingsStartup} />
            </div>
            <div className="set-row">
              <label>{t.closeBehavior}</label>
              <select
                className="select"
                value={settings.ui.closeBehavior}
                onChange={(e) => void patchSettings({ ui: { ...settings.ui, closeBehavior: e.target.value === 'quit' ? 'quit' : 'tray' } })}
              >
                <option value="tray">{t.closeTray}</option>
                <option value="quit">{t.closeQuit}</option>
              </select>
            </div>
            <div className="set-row">
              <span className="hint">{t.autoSaveNote}</span>
            </div>
          </div>
          <div className="set-group">
            <h2>{lang === 'ar' ? 'رصد خمسات' : 'Khamsat monitoring'}</h2>
            <div className="set-row">
              <label>{lang === 'ar' ? 'تفعيل المصدر' : 'Enable source'}</label>
              <Toggle checked={settings.khamsatEnabled} onChange={(v) => void patchSettings({ khamsatEnabled: v })} label={lang === 'ar' ? 'تفعيل رصد خمسات' : 'Enable Khamsat monitoring'} />
            </div>
            <div className="set-row">
              <label>{lang === 'ar' ? 'حالة رصد خمسات' : 'Khamsat status'}</label>
              <span className="muted">{settings.khamsatEnabled ? statusText(khamsatHealth, lang) : t.statusDisabled}</span>
              <button className="btn sm" disabled={!settings.khamsatEnabled || !khamsatHealth} onClick={() => void togglePause('khamsat', khamsatHealth)}>{settings.khamsatEnabled && khamsatHealth?.paused ? t.resume : t.pause} {t.sourceKhamsat}</button>
            </div>
            <p className="hint">{lang === 'ar' ? 'الإيقاف المؤقت يخص خمسات وحده ويُلغى عند إعادة تشغيل راصد. تعطيل المصدر أعلاه يُحفظ في الإعدادات.' : 'Pause affects only Khamsat and resets when RASED restarts. Disabling the source above is saved in settings.'}</p>
            <p className="hint">{lang === 'ar' ? 'يُفحص عنوان الطلب ورابطه وتاريخ نشره كل 5 ثوانٍ؛ عند تعذر الوصول يتباطأ الفحص تلقائيًا. الوصف الكامل يُقرأ من موقع خمسات.' : 'Checks request titles, links and publication times every 5 seconds, with automatic backoff on errors. Read the full description on Khamsat.'}</p>
          </div>
          <div className="set-group">
            <h2>{lang === 'ar' ? 'رصد نفذلي' : 'Nafezly monitoring'}</h2>
            <div className="set-row">
              <label>{lang === 'ar' ? 'تفعيل المصدر' : 'Enable source'}</label>
              <Toggle checked={settings.nafezlyEnabled} onChange={(v) => void patchSettings({ nafezlyEnabled: v })} label={lang === 'ar' ? 'تفعيل رصد نفذلي' : 'Enable Nafezly monitoring'} />
            </div>
            <div className="set-row">
              <label>{lang === 'ar' ? 'حالة رصد نفذلي' : 'Nafezly status'}</label>
              <span className="muted">{settings.nafezlyEnabled ? statusText(nafezlyHealth, lang) : t.statusDisabled}</span>
              <button className="btn sm" disabled={!settings.nafezlyEnabled || !nafezlyHealth} onClick={() => void togglePause('nafezly', nafezlyHealth)}>{settings.nafezlyEnabled && nafezlyHealth?.paused ? t.resume : t.pause} {t.sourceNafezly}</button>
            </div>
            <p className="hint">{lang === 'ar' ? 'يفحص RSS العام كل 15–18 ثانية تقريبًا. يتباطأ تلقائيًا عند أخطاء الوصول. الإيقاف المؤقت مستقل عن باقي المصادر ويُلغى بعد إعادة التشغيل.' : 'Checks the public RSS feed roughly every 15–18 seconds. Automatically backs off on access errors. Pause is independent and resets on restart.'}</p>
          </div></>
        )}

        {active === 'notifications' && (
          <>
            <div className="set-group">
              <h2>{t.settingsNotifications}</h2>
              <div className="set-row">
                <label>{t.enableNotifications}</label>
                <Toggle checked={settings.notificationsEnabled} onChange={(v) => void patchSettings({ notificationsEnabled: v })} label={t.enableNotifications} />
              </div>
              <div className="set-row">
                <label>{t.settingsSound}</label>
                <Toggle checked={settings.soundEnabled} onChange={(v) => void patchSettings({ soundEnabled: v })} label={t.settingsSound} />
              </div>
              <div className="set-row">
                <button
                  className="btn sm"
                  onClick={() => {
                    setTestMsg(null)
                    void rased.testNotification().then((r) => setTestMsg(r.ok ? t.testNotificationBtn + ' ✓' : t.testNotificationBtn + ' ✗'))
                  }}
                >
                  {t.testNotificationBtn}
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    void rased.testSound().then(() => setTestMsg(t.testSoundBtn + ' ✓'))
                  }}
                >
                  {t.testSoundBtn}
                </button>
                {testMsg && <span className="muted small">{testMsg}</span>}
              </div>
              <div className="set-row">
                <span className="hint">{t.testNotifNote}</span>
              </div>
              {appInfo?.platform === 'win32' && (
                <div className="set-row">
                  <button className="btn sm" onClick={() => void rased.openWindowsNotificationSettings()}>{t.windowsNotificationSettings}</button>
                  <span className="hint">{t.windowsNotificationHint}</span>
                </div>
              )}
            </div>

            <div className="set-group">
              <h2>{lang === 'ar' ? 'تنبيهات خمسات' : 'Khamsat notifications'}</h2>
              <div className="set-row">
                <label>{lang === 'ar' ? 'تنبيهات الطلبات الجديدة' : 'New request alerts'}</label>
                <Toggle checked={settings.khamsatNotificationsEnabled} onChange={(v) => void patchSettings({ khamsatNotificationsEnabled: v })} label={lang === 'ar' ? 'تفعيل تنبيهات خمسات' : 'Enable Khamsat alerts'} />
              </div>
              <div className="set-row">
                <label htmlFor="khamsat-any">{lang === 'ar' ? 'أي كلمة من' : 'Any keyword'}</label>
                <input id="khamsat-any" className="input" value={khamsatAny} onChange={e => setKhamsatAny(e.target.value)} onBlur={() => void patchSettings({ khamsatKeywordsAny: splitKeywords(khamsatAny) })} placeholder={lang === 'ar' ? 'مثال: React، تصميم، برمجة' : 'React, design, development'} />
              </div>
              <div className="set-row">
                <label htmlFor="khamsat-exclude">{lang === 'ar' ? 'استبعاد كلمات' : 'Exclude keywords'}</label>
                <input id="khamsat-exclude" className="input" value={khamsatExclude} onChange={e => setKhamsatExclude(e.target.value)} onBlur={() => void patchSettings({ khamsatExcludeKeywords: splitKeywords(khamsatExclude) })} />
              </div>
              <p className="hint">{lang === 'ar' ? 'فلترة خمسات تعتمد على عنوان الطلب فقط حاليًا. اترك حقل «أي كلمة» فارغًا للتنبيه بكل الطلبات.' : 'Khamsat filtering currently uses request titles only. Leave “Any keyword” blank for all requests.'}</p>
            </div>

            <div className="set-group">
              <h2>{lang === 'ar' ? 'تنبيهات نفذلي' : 'Nafezly notifications'}</h2>
              <div className="set-row">
                <label>{lang === 'ar' ? 'تنبيهات المشاريع الجديدة' : 'New project alerts'}</label>
                <Toggle checked={settings.nafezlyNotificationsEnabled} onChange={(v) => void patchSettings({ nafezlyNotificationsEnabled: v })} label={lang === 'ar' ? 'تفعيل تنبيهات نفذلي' : 'Enable Nafezly alerts'} />
              </div>
              <div className="set-row">
                <label htmlFor="nafezly-any">{lang === 'ar' ? 'أي كلمة من' : 'Any keyword'}</label>
                <input id="nafezly-any" className="input" value={nafezlyAny} onChange={e => setNafezlyAny(e.target.value)} onBlur={() => void patchSettings({ nafezlyKeywordsAny: splitKeywords(nafezlyAny) })} placeholder={lang === 'ar' ? 'مثال: React، تصميم، برمجة' : 'React, design, development'} />
              </div>
              <div className="set-row">
                <label htmlFor="nafezly-exclude">{lang === 'ar' ? 'استبعاد كلمات' : 'Exclude keywords'}</label>
                <input id="nafezly-exclude" className="input" value={nafezlyExclude} onChange={e => setNafezlyExclude(e.target.value)} onBlur={() => void patchSettings({ nafezlyExcludeKeywords: splitKeywords(nafezlyExclude) })} />
              </div>
              <p className="hint">{lang === 'ar' ? 'تُطبّق الكلمات على عنوان المشروع والوصف الكامل الوارد في RSS. اترك «أي كلمة» فارغًا للتنبيه بكل المشاريع.' : 'Keywords match the project title and full RSS description. Leave “Any keyword” blank for all projects.'}</p>
            </div>

            <div className="set-group">
              <h2>{t.dndTitle}</h2>
              <p className="desc">{t.dndHint}</p>
              {dndActive ? (
                <div className="set-row">
                  <span>
                    {t.dndActiveUntil} <strong className="num" dir="ltr">{settings.doNotDisturbUntil ? fullDate(settings.doNotDisturbUntil, lang) : ''}</strong>
                  </span>
                  <button className="btn sm" onClick={() => setDndMinutes(0)}>
                    {t.dndOff}
                  </button>
                </div>
              ) : (
                <div className="set-row">
                  <select
                    className="select"
                    aria-label={t.dndTitle}
                    value="off"
                    onChange={(e) => {
                      const v = e.target.value
                      if (v !== 'off') setDndMinutes(Number(v))
                    }}
                  >
                    <option value="off">{t.dndOff}</option>
                    <option value="15">{t.dnd15}</option>
                    <option value="30">{t.dnd30}</option>
                    <option value="60">{t.dnd60}</option>
                    <option value="120">{t.dnd120}</option>
                  </select>
                </div>
              )}
            </div>

            <div className="set-group">
              <h2>{t.settingsNotifyFilter}</h2>
              <CategoryEditor lang={lang} value={settings.notifyFilter} onChange={(f) => void patchSettings({ notifyFilter: f })} />
              <div className="set-row">
                <label>{t.notifyUncertain}</label>
                <Toggle checked={settings.notifyUncertainCategory} onChange={(v) => void patchSettings({ notifyUncertainCategory: v })} label={t.notifyUncertain} />
              </div>
              <div className="set-row">
                <span className="hint">{t.notifyUncertainHint}</span>
              </div>
              <div className="set-row">
                <label>{t.linkFilters}</label>
                <Toggle checked={settings.linkDisplayAndNotifyFilters} onChange={(v) => void patchSettings({ linkDisplayAndNotifyFilters: v })} label={t.linkFilters} />
              </div>
              <div className="set-row">
                <span className="hint">{t.linkFiltersHint}</span>
              </div>
            </div>
          </>
        )}

        {active === 'appearance' && (
          <div className="set-group">
            <h2>{t.settingsAppearance}</h2>
            <div className="set-row">
              <label>{t.settingsLanguage}</label>
              <select className="select" value={settings.language} onChange={(e) => void patchSettings({ language: e.target.value === 'en' ? 'en' : 'ar' })}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="set-row">
              <label>{t.themeTitle}</label>
              <select className="select" value={settings.ui.theme} onChange={(e) => void patchSettings({ ui: { ...settings.ui, theme: e.target.value === 'light' ? 'light' : 'dark' } })}>
                <option value="dark">{t.themeDark}</option>
                <option value="light">{t.themeLight}</option>
              </select>
            </div>
            <div className="set-row">
              <label>{t.textScaleTitle}</label>
              <select
                className="select"
                value={settings.ui.textScale}
                onChange={(e) => void patchSettings({ ui: { ...settings.ui, textScale: Number(e.target.value) as 90 | 100 | 110 | 125 } })}
              >
                <option value={90}>90%</option>
                <option value={100}>100%</option>
                <option value={110}>110%</option>
                <option value={125}>125%</option>
              </select>
            </div>
            <div className="set-row">
              <label>{t.densityTitle}</label>
              <select
                className="select"
                value={settings.ui.density}
                onChange={(e) => void patchSettings({ ui: { ...settings.ui, density: e.target.value === 'compact' ? 'compact' : 'comfortable' } })}
              >
                <option value="comfortable">{t.densityComfortable}</option>
                <option value="compact">{t.densityCompact}</option>
              </select>
            </div>
            <div className="set-row">
              <label>{t.sidebarTitle}</label>
              <select
                className="select"
                value={settings.ui.sidebarCollapsed ? 'collapsed' : 'expanded'}
                onChange={(e) => void patchSettings({ ui: { ...settings.ui, sidebarCollapsed: e.target.value === 'collapsed' } })}
              >
                <option value="expanded">{t.sidebarExpanded}</option>
                <option value="collapsed">{t.sidebarCollapsed}</option>
              </select>
            </div>
            <div className="set-row">
              <label>{t.previewTitle}</label>
              <Toggle checked={settings.ui.previewOpen} onChange={(v) => void patchSettings({ ui: { ...settings.ui, previewOpen: v } })} label={t.previewTitle} />
            </div>
            <div className="set-row">
              <label>{t.autoReveal}</label>
              <Toggle checked={settings.ui.autoRevealNew} onChange={(v) => void patchSettings({ ui: { ...settings.ui, autoRevealNew: v } })} label={t.autoReveal} />
            </div>
            <div className="set-row">
              <label>{t.openCompact}</label>
              <button className="btn sm" onClick={() => void rased.openCompact()}>
                {t.openCompact}
              </button>
            </div>
            <div className="set-row">
              <label>{t.alwaysOnTop}</label>
              <Toggle checked={settings.ui.compactAlwaysOnTop} onChange={(v) => void patchSettings({ ui: { ...settings.ui, compactAlwaysOnTop: v } })} label={t.alwaysOnTop} />
            </div>
            <div className="set-group">
              <h2>{t.shortcutsTitle}</h2>
              <ShortcutRow keys="Ctrl+K" label={t.kbdSearch} />
              <ShortcutRow keys="↑ / ↓" label={t.kbdMove} />
              <ShortcutRow keys="Enter" label={t.kbdOpen} />
              <ShortcutRow keys="Ctrl+Enter" label={t.kbdBrowser} />
              <ShortcutRow keys="Ctrl+D" label={t.kbdSave} />
              <ShortcutRow keys="Esc" label={t.kbdBack} />
            </div>
          </div>
        )}

        {active === 'data' && (
          <>
            <div className="set-group">
              <h2>{t.settingsData}</h2>
              <div className="set-row">
                <button className="btn sm" onClick={() => void rased.openDataFolder()}>
                  {t.openDataFolder}
                </button>
              </div>
              <div className="set-row">
                <span className="hint">{t.dataNote}</span>
              </div>
            </div>
            <div className="set-group">
              <h2>{t.exportSettings} / {t.importSettings}</h2>
              <div className="set-row">
                <button
                  className="btn sm"
                  onClick={() => {
                    setExportMsg(null)
                    void rased.exportSettings().then((r) => {
                      if (r.ok) setExportMsg(r.path ?? t.exportSettings + ' ✓')
                      else if (r.error) setExportMsg(r.error)
                    })
                  }}
                >
                  {t.exportSettings}
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    setImportMsg(null)
                    setImportSummary(null)
                    void rased.validateImport().then((s) => {
                      if (!s.ok && !s.error) return // user cancelled the dialog
                      if (!s.ok) {
                        setImportMsg(s.error ?? '?')
                        return
                      }
                      setImportSummary(s)
                      setImportStartup(false)
                    })
                  }}
                >
                  {t.importSettings}
                </button>
              </div>
              {exportMsg && <div className="meta"><span dir="auto">{exportMsg}</span></div>}
              {importMsg && <FieldError message={importMsg} />}
              {importSummary?.ok && (
                <div className="set-group">
                  <div className="meta"><span>{t.importSummarySettings}: </span><span dir="auto">{(importSummary.settingsKeys ?? []).join(', ') || '—'}</span></div>
                  <div className="meta"><span>{t.importSummaryAdded}: </span><span className="num">{importSummary.filtersAdded ?? 0}</span></div>
                  <div className="meta"><span>{t.importSummaryReplaced}: </span><span className="num">{importSummary.filtersReplaced ?? 0}</span></div>
                  {importSummary.startupRequested && (
                    <div className="set-row">
                      <label>{t.importApplyStartup}</label>
                      <Toggle checked={importStartup} onChange={setImportStartup} label={t.importApplyStartup} />
                    </div>
                  )}
                  <div className="set-row">
                    <label>{t.importReplace}</label>
                    <Toggle checked={importMode === 'replace'} onChange={(v) => setImportMode(v ? 'replace' : 'merge')} label={t.importReplace} />
                  </div>
                  <div className="set-row"><span className="hint">{t.importMerge}</span></div>
                  <div className="row-actions">
                    <button
                      className="btn primary sm"
                      onClick={() => {
                        void rased.applyImport(importMode, importStartup).then((r) => {
                          if (r.ok) {
                            setImportSummary(null)
                            setImportMsg(t.importConfirm + ' ✓')
                          } else if (r.error) setImportMsg(r.error)
                        })
                      }}
                    >
                      {t.importConfirm}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="set-group">
              <h2>{t.purgeTitle}</h2>
              <p className="desc">{t.purgeDesc}</p>
              <div className="set-row">
                <label>{t.purgeCutoff}</label>
                <select className="select" value={purgeDays} onChange={(e) => { setPurgeDays(Number(e.target.value)); setPurgeCount(null) }}>
                  <option value={7}>7</option>
                  <option value={30}>30</option>
                  <option value={90}>90</option>
                  <option value={180}>180</option>
                </select>
                <button
                  className="btn sm"
                  onClick={() => {
                    const iso = new Date(Date.now() - purgeDays * 86400_000).toISOString()
                    void rased.purgeHistoryPreview(iso).then((r) => {
                      if (r.ok) setPurgeCount(r.affected ?? 0)
                      else setPurgeMsg(r.error ?? '?')
                    })
                  }}
                >
                  {t.purgePreviewBtn}
                </button>
              </div>
              {purgeCount !== null && (
                <div className="meta"><span>{t.purgeAffected}: </span><strong className="num">{purgeCount}</strong></div>
              )}
              <div className="set-row"><span className="hint">{t.purgeBackupNote}</span></div>
              {purgeMsg && <FieldError message={purgeMsg} />}
              <div className="row-actions">
                <button className="btn danger sm" disabled={purgeCount === null || purgeCount === 0} onClick={() => setPurgeConfirm(true)}>
                  {t.purgeApplyBtn}
                </button>
              </div>
            </div>
          </>
        )}

        {active === 'legal' && <LegalView lang={lang} />}
        {active === 'ai' && <ProposalSettings lang={lang} />}
        {active === 'quick' && <QuickApplySettings settings={settings} />}
        {active === 'updates' && <UpdatesView lang={lang} />}

        {active === 'about' && (
          <div className="about-page">
            <section className="set-group about-hero" aria-label={t.settingsAbout}>
              <img src={logo} className="about-logo" alt="" />
              <div>
                <h2 dir="ltr">RASED <span className="about-arabic" lang="ar">راصد</span></h2>
                <p className="muted">{t.aboutDescription}</p>
                <div className="meta about-version"><span>{t.aboutVersion}</span><strong className="tag num" dir="ltr">{appInfo?.version ?? '…'}</strong></div>
              </div>
            </section>
            <section className="set-group about-developer" aria-labelledby="developer-name">
              <div className="about-monogram" aria-hidden="true">da</div>
              <div className="about-developer-info">
                <p className="small muted">{t.aboutDeveloperIntro}</p>
                <h3 id="developer-name" dir="ltr">{DEVELOPER_NAME}</h3>
                <p className="muted">{t.aboutDeveloper}</p>
                <div className="about-links">
                  <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('github')}>GitHub <Icon name="external" size={14} /></button>
                  <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('linkedin')}>LinkedIn <Icon name="external" size={14} /></button>
                </div>
              </div>
            </section>
            <section className="set-group">
              <h3>{t.aboutLicense} <span className="tag num" dir="ltr">MIT</span></h3>
              <p className="muted">{t.aboutOpenSource}</p>
              <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('source')}>{t.aboutViewSource} <Icon name="external" size={14} /></button>
            </section>
            <button className="btn" onClick={() => onSection('legal')}>{lang === 'ar' ? 'شروط الاستخدام والخصوصية والرخص' : 'Terms, privacy and licenses'}</button>
            <FieldError message={aboutError} />
            <details className="set-group about-diagnostics">
              <summary>{t.diagnostics}</summary>
              <div className="meta"><span dir="ltr">{appInfo ? `${appInfo.platform}-${appInfo.arch}` : '…'}</span></div>
              <div className="meta"><span>{t.sourceMostaql}: RSS · https://mostaql.com/rss</span></div>
              <div className="meta"><span>{t.sourceKhamsat}: HTML · https://khamsat.com/community/requests</span></div>
              <div className="meta"><span>{t.sourceNafezly}: RSS · https://nafezly.com/feed</span></div>
              {diag.length === 0 && <div className="faint small">—</div>}
              {diag.map((d, i) => (
                <div className="diag" key={i}>
                  <code className="num">{d.at}</code> · <span dir="auto">{d.endpointKind}</span> · <span dir="auto">{d.status}</span>
                  {d.durationMs != null && <span className="num"> · {d.durationMs}ms</span>}
                  {d.itemCount != null && <span className="num"> · {d.itemCount}</span>}
                  {d.errorCategory && <span> · <span dir="auto">{d.errorCategory}</span></span>}
                </div>
              ))}
            </details>
          </div>
        )}
      </div>

      {purgeConfirm && (
        <ConfirmDialog
          lang={lang}
          title={t.purgeConfirm}
          body={`${t.purgeConfirmBody} (${t.purgeAffected}: ${purgeCount ?? 0})`}
          danger
          confirmLabel={t.purgeApplyBtn}
          onConfirm={() => {
            const iso = new Date(Date.now() - purgeDays * 86400_000).toISOString()
            void rased.purgeHistoryApply(iso).then((r) => {
              setPurgeConfirm(false)
              if (r.ok) {
                setPurgeCount(null)
                setPurgeMsg(`${t.purgeApplyBtn} ✓ (${r.deleted ?? 0})`)
              } else if (r.error) setPurgeMsg(r.error)
            })
          }}
          onCancel={() => setPurgeConfirm(false)}
        />
      )}
    </div>
  )
}

function ShortcutRow({ keys, label }: { keys: string; label: string }): React.ReactElement {
  return (
    <div className="set-row">
      <span className="tag num" dir="ltr">{keys}</span>
      <label>{label}</label>
    </div>
  )
}
