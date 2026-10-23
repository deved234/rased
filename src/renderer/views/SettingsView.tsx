import React from 'react'
import { LegalView } from './LegalView.js'
import { UpdatesView, updatesTitle } from './UpdatesView.js'
import { ProposalSettings } from './ProposalSettings.js'
import { QuickApplySettings } from './QuickApplySettings.js'
import { BackupSettings } from './BackupSettings.js'
import { dataErrorText } from '@shared/data.js'
import { useUnsavedChanges } from '../components/useUnsavedChanges.js'
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
import { SourceMonitoringSettings } from './SourceMonitoringSettings.js'
import { SOURCES } from '@shared/sources.js'
import { AnalyticsSettings } from './AnalyticsSettings.js'

type Section = 'watching' | 'notifications' | 'appearance' | 'ai' | 'quick' | 'data' | 'about' | 'legal' | 'updates' | 'analytics'

const SECTIONS: Section[] = ['watching', 'notifications', 'appearance', 'ai', 'quick', 'data', 'updates', 'analytics', 'about', 'legal']

function sectionTitle(s: Section, lang: Lang): string {
  if (s === 'analytics') return lang === 'ar' ? 'الخصوصية والإحصائيات' : 'Privacy & analytics'
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
        <label htmlFor="settings-field-1">{t.filterModeAll} / {t.filterModeSelected}</label>
        <select id="settings-field-1" className="select" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value === 'selected' ? 'selected' : 'all' })}>
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
  kafHealth,
  patchSettings: writeSettings,
  section,
  onSection,
  onWhatsNew
}: {
  lang: Lang
  settings: AppSettings
  health: SourceHealth | null
  khamsatHealth: SourceHealth | null
  nafezlyHealth: SourceHealth | null
  kafHealth: SourceHealth | null
  patchSettings: (p: Partial<AppSettings>) => Promise<void>
  section: string | null
  onSection: (s: Section) => void
  onWhatsNew: (() => void) | null
}): React.ReactElement {
  const [dataBusy, setDataBusy] = React.useState(false)
  const [saveError, setSaveError] = React.useState(false)
  const patchSettings = async (value: Partial<AppSettings>): Promise<void> => {
    try { await writeSettings(value); setSaveError(false) } catch { setSaveError(true) }
  }
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
  const [kafAny, setKafAny] = React.useState(settings.kafKeywordsAny.join(', '))
  const [nafezlyExclude, setNafezlyExclude] = React.useState(settings.nafezlyExcludeKeywords.join(', '))
  const [kafExclude, setKafExclude] = React.useState(settings.kafExcludeKeywords.join(', '))
  React.useEffect(() => setKhamsatAny(settings.khamsatKeywordsAny.join(', ')), [settings.khamsatKeywordsAny.join(',')])
  React.useEffect(() => setKhamsatExclude(settings.khamsatExcludeKeywords.join(', ')), [settings.khamsatExcludeKeywords.join(',')])
  React.useEffect(() => setNafezlyAny(settings.nafezlyKeywordsAny.join(', ')), [settings.nafezlyKeywordsAny.join(',')])
  React.useEffect(() => setKafAny(settings.kafKeywordsAny.join(', ')), [settings.kafKeywordsAny.join(',')])
  React.useEffect(() => setNafezlyExclude(settings.nafezlyExcludeKeywords.join(', ')), [settings.nafezlyExcludeKeywords.join(',')])
  React.useEffect(() => setKafExclude(settings.kafExcludeKeywords.join(', ')), [settings.kafExcludeKeywords.join(',')])
  const splitKeywords = (value: string): string[] => value.split(/[,،\n]/).map(x => x.trim()).filter(Boolean).slice(0, 100)
  const keywordDirty = khamsatAny !== settings.khamsatKeywordsAny.join(', ') || khamsatExclude !== settings.khamsatExcludeKeywords.join(', ') || nafezlyAny !== settings.nafezlyKeywordsAny.join(', ') || nafezlyExclude !== settings.nafezlyExcludeKeywords.join(', ') || kafAny !== settings.kafKeywordsAny.join(', ') || kafExclude !== settings.kafExcludeKeywords.join(', ')
  const [keywordBusy, setKeywordBusy] = React.useState(false)
  const saveKeywords = async (): Promise<boolean> => {
    if (keywordBusy) return false
    setKeywordBusy(true)
    try { await writeSettings({khamsatKeywordsAny:splitKeywords(khamsatAny),khamsatExcludeKeywords:splitKeywords(khamsatExclude),nafezlyKeywordsAny:splitKeywords(nafezlyAny),nafezlyExcludeKeywords:splitKeywords(nafezlyExclude),kafKeywordsAny:splitKeywords(kafAny),kafExcludeKeywords:splitKeywords(kafExclude)});setSaveError(false);return true } catch {setSaveError(true);return false} finally {setKeywordBusy(false)}
  }
  const keywordDialog = useUnsavedChanges(keywordDirty, lang === 'ar', saveKeywords, active === 'notifications', () => { setKhamsatAny(settings.khamsatKeywordsAny.join(', '));setKhamsatExclude(settings.khamsatExcludeKeywords.join(', '));setNafezlyAny(settings.nafezlyKeywordsAny.join(', '));setNafezlyExclude(settings.nafezlyExcludeKeywords.join(', '));setKafAny(settings.kafKeywordsAny.join(', '));setKafExclude(settings.kafExcludeKeywords.join(', ')) })
  const openAboutLink = async (link: AboutLink): Promise<void> => {
    try {
      const result = await rased.openAboutLink(link)
      setAboutError(result.ok ? null : t.aboutLinkError)
    } catch { setAboutError(t.aboutLinkError) }
  }
  useNow(1000)

  React.useEffect(() => {
    let alive = true
    void rased.getDiagnostics(20).then((d) => alive && setDiag(d)).catch(() => alive && setSaveError(true))
    void rased.getAppInfo().then((a) => alive && setAppInfo(a)).catch(() => alive && setAboutError(t.aboutLinkError))
    return () => {
      alive = false
    }
  }, [])

  const dndActive = settings.doNotDisturbUntil && Date.parse(settings.doNotDisturbUntil) > Date.now()
  const setDndMinutes = (m: number): void => {
    void rased.setDnd(m === 0 ? null : new Date(Date.now() + m * 60_000).toISOString()).catch(() => setSaveError(true))
  }

  return (
    <div className="settings">
      <div className="settings-inner settings-layout">
        <nav className="settings-nav" aria-label={t.navSettings}>
          {SECTIONS.map((s, index) => (
            <React.Fragment key={s}>
            {[0,2,3,5,8].includes(index) && <span className="settings-nav-heading">{({0:lang==='ar'?'الرصد والتنبيهات':'Monitoring',2:lang==='ar'?'المظهر':'Appearance',3:lang==='ar'?'العروض':'Proposals',5:lang==='ar'?'إدارة التطبيق':'App management',8:lang==='ar'?'المساعدة والمعلومات':'Help and information'} as Record<number,string>)[index]}</span>}
            <button
              aria-current={active === s ? 'page' : undefined}
              className={active === s ? 'settings-nav-item active' : 'settings-nav-item'}
              onClick={() => onSection(s)}
            >
              {sectionTitle(s, lang)}
            </button></React.Fragment>
          ))}
        </nav>
        <div className="settings-content">
        {saveError && <p className="field-err" role="alert">{lang === 'ar' ? 'تعذر حفظ الإعداد. حاول مرة أخرى؛ القيمة المحفوظة لم تتغير.' : 'Could not save the setting. Retry; the saved value has not changed.'}</p>}

        {active === 'watching' && (
          <>
            <SourceMonitoringSettings lang={lang} settings={settings} health={{ mostaql: health, khamsat: khamsatHealth, nafezly: nafezlyHealth, kaf: kafHealth }} patchSettings={patchSettings} />
          <div className="set-group">
            <h2>{lang === 'ar' ? 'تشغيل راصد' : 'RASED behavior'}</h2>
            <div className="set-row">
              <label>{t.settingsStartup}</label>
              <Toggle checked={settings.runAtStartup} onChange={(v) => void patchSettings({ runAtStartup: v })} label={t.settingsStartup} />
            </div>
            <div className="set-row">
              <label htmlFor="settings-field-3">{t.closeBehavior}</label>
              <select id="settings-field-3"
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
          </>
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
                  disabled={dataBusy}
                  onClick={() => {
                    setTestMsg(null)
                    void rased.testNotification().then((r) => setTestMsg(r.ok ? t.testNotificationBtn + ' ✓' : t.testNotificationBtn + ' ✗'))
                  }}
                >
                  {t.testNotificationBtn}
                </button>
                <button
                  className="btn sm"
                  disabled={dataBusy}
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
                <input id="khamsat-any" disabled={keywordBusy} className="input" value={khamsatAny} onChange={e => setKhamsatAny(e.target.value)} placeholder={lang === 'ar' ? 'مثال: React، تصميم، برمجة' : 'React, design, development'} />
              </div>
              <div className="set-row">
                <label htmlFor="khamsat-exclude">{lang === 'ar' ? 'استبعاد كلمات' : 'Exclude keywords'}</label>
                <input id="khamsat-exclude" disabled={keywordBusy} className="input" value={khamsatExclude} onChange={e => setKhamsatExclude(e.target.value)} />
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
                <input id="nafezly-any" disabled={keywordBusy} className="input" value={nafezlyAny} onChange={e => setNafezlyAny(e.target.value)} placeholder={lang === 'ar' ? 'مثال: React، تصميم، برمجة' : 'React, design, development'} />
              </div>
              <div className="set-row">
                <label htmlFor="nafezly-exclude">{lang === 'ar' ? 'استبعاد كلمات' : 'Exclude keywords'}</label>
                <input id="nafezly-exclude" disabled={keywordBusy} className="input" value={nafezlyExclude} onChange={e => setNafezlyExclude(e.target.value)} />
              </div>
              <p className="hint">{lang === 'ar' ? 'تُطبّق الكلمات على عنوان المشروع والوصف الكامل الوارد في RSS. اترك «أي كلمة» فارغًا للتنبيه بكل المشاريع.' : 'Keywords match the project title and full RSS description. Leave “Any keyword” blank for all projects.'}</p>
            </div>
            <div className="set-group">
              <h2>{lang === 'ar' ? 'تنبيهات كاف' : 'Kaf notifications'}</h2>
              <div className="set-row">
                <label>{lang === 'ar' ? 'تنبيهات المشاريع الجديدة' : 'New project alerts'}</label>
                <Toggle checked={settings.kafNotificationsEnabled} onChange={(v) => void patchSettings({ kafNotificationsEnabled: v })} label={lang === 'ar' ? 'تفعيل تنبيهات كاف' : 'Enable Kaf alerts'} />
              </div>
              <div className="set-row">
                <label htmlFor="kaf-any">{lang === 'ar' ? 'أي كلمة من' : 'Any keyword'}</label>
                <input id="kaf-any" disabled={keywordBusy} className="input" value={kafAny} onChange={e => setKafAny(e.target.value)} placeholder={lang === 'ar' ? 'مثال: React، تصميم، برمجة' : 'React, design, development'} />
              </div>
              <div className="set-row">
                <label htmlFor="kaf-exclude">{lang === 'ar' ? 'استبعاد كلمات' : 'Exclude keywords'}</label>
                <input id="kaf-exclude" disabled={keywordBusy} className="input" value={kafExclude} onChange={e => setKafExclude(e.target.value)} />
              </div>
              <p className="hint">{lang === 'ar' ? 'تُطبّق الكلمات على عنوان المشروع ومقتطف القائمة، والتنبيهات للمشاريع المفتوحة فقط. اترك «أي كلمة» فارغًا للتنبيه بكل الفرص المفتوحة الجديدة.' : 'Keywords match the title and list excerpt. Only open projects trigger alerts. Leave “Any keyword” blank for all newly detected open opportunities.'}</p>
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
              <div className="set-row">
                <span>{lang === 'ar' ? 'تنبيهات مشاريع مستقل' : 'Mostaql project alerts'}</span>
                <Toggle checked={settings.mostaqlNotificationsEnabled} onChange={on => void patchSettings({ mostaqlNotificationsEnabled: on })} label={lang === 'ar' ? 'تفعيل تنبيهات مستقل' : 'Enable Mostaql alerts'} />
              </div>
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
            <div className="set-group"><p className="hint">{lang === 'ar' ? 'كلمات خمسات ونفذلي وكاف لا تتغير إلا عند الحفظ. خيارات التبديل الأخرى تحفظ فورًا.' : 'Khamsat, Nafezly and KAF keywords change only when saved. Other switches save immediately.'}</p><button className="btn primary" disabled={keywordBusy || !keywordDirty} onClick={()=>void saveKeywords()}>{lang === 'ar' ? 'حفظ كلمات التنبيهات' : 'Save alert keywords'}</button></div>
          </>
        )}

        {active === 'appearance'  && (
          <div className="set-group">
            <h2>{t.settingsAppearance}</h2>
            <div className="set-row">
              <label htmlFor="settings-field-4">{t.settingsLanguage}</label>
              <select id="settings-field-4" className="select" value={settings.language} onChange={(e) => void patchSettings({ language: e.target.value === 'en' ? 'en' : 'ar' })}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="set-row">
              <label htmlFor="settings-field-5">{t.themeTitle}</label>
              <select id="settings-field-5" className="select" value={settings.ui.theme} onChange={(e) => void patchSettings({ ui: { ...settings.ui, theme: e.target.value === 'light' ? 'light' : 'dark' } })}>
                <option value="dark">{t.themeDark}</option>
                <option value="light">{t.themeLight}</option>
              </select>
            </div>
            <div className="set-row">
              <label htmlFor="settings-field-6">{t.textScaleTitle}</label>
              <select id="settings-field-6"
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
              <label htmlFor="settings-field-7">{t.densityTitle}</label>
              <select id="settings-field-7"
                className="select"
                value={settings.ui.density}
                onChange={(e) => void patchSettings({ ui: { ...settings.ui, density: e.target.value === 'compact' ? 'compact' : 'comfortable' } })}
              >
                <option value="comfortable">{t.densityComfortable}</option>
                <option value="compact">{t.densityCompact}</option>
              </select>
            </div>
            <div className="set-row">
              <label htmlFor="settings-field-8">{t.sidebarTitle}</label>
              <select id="settings-field-8"
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
              <h2>{t.exportSettings} / {t.importSettings}</h2><p className="hint">{lang === 'ar' ? 'يشمل إعدادات المنصات الأربع والكلمات والفلاتر والقالب والملف المهني واختيارات موفر الذكاء الاصطناعي والموديلات. الملف غير مشفّر وقد يتضمن بيانات شخصية. لا يشمل المشاريع أو الملاحظات أو المسودات أو المفاتيح أو جلسات المتصفح أو رموز الربط أو عدم الإزعاج المؤقت أو موضع النافذة أو جدولة النسخ المحلية.' : 'Includes all four source preferences, keywords, filters, template, professional profile and AI provider/model choices. The file is unencrypted and may contain personal data. Projects, notes, drafts, keys, browser sessions, pairing tokens, temporary DND, window position and local backup scheduling are excluded.'}</p>
              <div className="set-row">
                <button
                  className="btn sm"
                  disabled={dataBusy}
                  onClick={() => {
                    setExportMsg(null)
                    setDataBusy(true)
                    void rased.exportSettings().then((r) => {
                      if (r.ok) setExportMsg(r.path ?? t.exportSettings + ' ✓')
                      else if (r.error) setExportMsg(dataErrorText(r.error, lang === 'ar'))
                    }).catch(() => setExportMsg(lang === 'ar' ? 'تعذر التصدير. أعد المحاولة.' : 'Export failed. Retry.')).finally(() => setDataBusy(false))
                  }}
                >
                  {t.exportSettings}
                </button>
                <button
                  className="btn sm"
                  disabled={dataBusy}
                  onClick={() => {
                    setImportMsg(null)
                    setImportSummary(null)
                    setDataBusy(true)
                    void rased.validateImport().then((s) => {
                      if (!s.ok && !s.error) return // user cancelled the dialog
                      if (!s.ok) {
                        setImportMsg(dataErrorText(s.error, lang === 'ar'))
                        return
                      }
                      setImportSummary(s)
                      setImportStartup(false)
                    }).catch(() => setImportMsg(lang === 'ar' ? 'تعذر قراءة ملف الإعدادات.' : 'Could not read the settings file.')).finally(() => setDataBusy(false))
                  }}
                >
                  {t.importSettings}
                </button>
              </div>
              {exportMsg && <div className="meta"><span dir="auto">{exportMsg}</span></div>}
              {importMsg && <FieldError message={importMsg} />}
              {importSummary?.ok && (
                <div className="set-group">
                  <div className="meta"><span>{t.importSummarySettings}: </span><span>{importSummary.settingsKeys?.length ?? 0}</span></div>
                  <p className="hint">{lang === 'ar' ? `الملف المهني: ${importSummary.profileIncluded ? 'سيُستبدل' : 'لن يتغير'} · اختيارات الموديلات: ${importSummary.aiIncluded ? 'ستُستبدل' : 'لن تتغير'}` : `Professional profile: ${importSummary.profileIncluded ? 'replace' : 'unchanged'} · Model choices: ${importSummary.aiIncluded ? 'replace' : 'unchanged'}`}</p>
                  {importSummary.legacy && <p className="hint">{lang === 'ar' ? 'ملف قديم؛ تُنقل البيانات الموجودة فيه فقط وتبقى الإعدادات غير المشمولة كما هي.' : 'Legacy export: only included preferences will change; missing preferences stay as they are.'}</p>}
                  <div className="meta"><span>{t.importSummaryAdded}: </span><span className="num">{importSummary.filtersAdded ?? 0}</span></div>
                  <div className="meta"><span>{t.importSummaryReplaced}: </span><span className="num">{importSummary.filtersReplaced ?? 0}</span></div>
                  {importSummary.startupIncluded && (
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
                  <p className="hint">{lang === 'ar' ? 'اختيار الدمج أو الاستبدال يخص الفلاتر المحفوظة. تفضيلات الإعدادات الموجودة في الملف ستُستبدل في الحالتين؛ ما ليس موجودًا لن يتغير.' : 'Merge or replace applies to saved filters. Included preferences are overwritten in either mode; missing preferences stay unchanged.'}</p>
                  <div className="row-actions">
                    <button
                      className="btn primary sm"
                      disabled={dataBusy}
                      onClick={() => {
                        setDataBusy(true)
                    void rased.applyImport(importMode, importStartup).then((r) => {
                          if (r.ok) {
                            setImportSummary(null)
                            setImportMsg(t.importConfirm + ' ✓')
                          } else if (r.error) setImportMsg(dataErrorText(r.error, lang === 'ar'))
                        }).catch(() => setImportMsg(lang === 'ar' ? 'تعذر الاستيراد. أعد المحاولة.' : 'Import failed. Retry.')).finally(() => setDataBusy(false))
                      }}
                    >
                      {t.importConfirm}
                    </button>
                    <button className="btn sm" disabled={dataBusy} onClick={() => setImportSummary(null)}>{t.cancel}</button>
                  </div>
                </div>
              )}
            </div>
            <BackupSettings lang={lang} busy={dataBusy} setBusy={setDataBusy} />
            <div className="set-group">
              <h2>{t.purgeTitle}</h2>
              <p className="desc">{t.purgeDesc}</p>
              <div className="set-row">
                <label htmlFor="settings-field-9">{t.purgeCutoff}</label>
                <select disabled={dataBusy} id="settings-field-9" className="select" value={purgeDays} onChange={(e) => { setPurgeDays(Number(e.target.value)); setPurgeCount(null) }}>
                  <option value={7}>7</option>
                  <option value={30}>30</option>
                  <option value={90}>90</option>
                  <option value={180}>180</option>
                </select>
                <button
                  className="btn sm"
                  disabled={dataBusy}
                  onClick={() => {
                    const iso = new Date(Date.now() - purgeDays * 86400_000).toISOString()
                    setDataBusy(true)
                    void rased.purgeHistoryPreview(iso).then((r) => {
                      if (r.ok) setPurgeCount(r.affected ?? 0)
                      else setPurgeMsg(r.error ?? '?')
                    }).catch(() => setPurgeMsg(lang === 'ar' ? 'تعذرت معاينة عدد الفرص.' : 'Could not preview the opportunity count.')).finally(() => setDataBusy(false))
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
                <button className="btn danger sm" disabled={dataBusy || purgeCount === null || purgeCount === 0} onClick={() => setPurgeConfirm(true)}>
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
        {active === 'analytics' && <AnalyticsSettings lang={lang} />}

        {active === 'about' && (
          <div className="about-page">
            <section className="set-group about-hero" aria-label={t.settingsAbout}>
              <img src={logo} className="about-logo" alt="" />
              <div>
                <h2 dir="ltr">RASED <span className="about-arabic" lang="ar">راصد</span></h2>
                <p className="muted">{t.aboutDescription}</p>
                <div className="meta about-version"><span>{t.aboutVersion}</span><strong className="tag num" dir="ltr">{appInfo?.version ?? '…'}</strong></div>
                {onWhatsNew && <button className="btn" onClick={onWhatsNew}>{lang === 'ar' ? 'ما الجديد' : "What's new"}</button>}
              </div>
            </section>
            <section className="set-group about-developer" aria-labelledby="developer-name">
              <div className="about-developer-header">
                <div className="about-monogram" aria-hidden="true">da</div>
                <div className="about-developer-info">
                  <p className="small muted">{t.aboutDeveloperIntro}</p>
                  <h3 id="developer-name"><bdi dir="ltr">{DEVELOPER_NAME}</bdi></h3>
                  <p className="about-developer-role">{t.aboutDeveloper}</p>
                </div>
              </div>
              <p className="about-bio">{t.aboutDeveloperBio}</p>
              <div className="about-links">
                <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('linkedin')}>LinkedIn <Icon name="external" size={14} /></button>
                <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('github')}>GitHub <Icon name="external" size={14} /></button>
              </div>
            </section>
            <section className="set-group about-story" aria-labelledby="about-story-title">
              <h3 id="about-story-title">{t.aboutStoryTitle}</h3>
              <p>{t.aboutStoryStart}</p>
              <p>{t.aboutStoryNow}</p>
            </section>
            <section className="set-group" aria-labelledby="about-capabilities-title">
              <h3 id="about-capabilities-title">{t.aboutCapabilitiesTitle}</h3>
              <dl className="about-capabilities">
                {[
                  { title: t.aboutPlatformsTitle, body: t.aboutPlatformsBody },
                  { title: t.aboutLanguagesTitle, body: t.aboutLanguagesBody },
                  { title: t.aboutAiTitle, body: t.aboutAiBody },
                  { title: t.aboutLocalTitle, body: t.aboutLocalBody }
                ].map(({ title, body }) => (
                  <div className="about-capability" key={title}>
                    <dt>{title}</dt>
                    <dd>{body}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="set-group" aria-labelledby="about-progress-title">
              <h3 id="about-progress-title">{t.aboutProgressTitle}</h3>
              <p className="muted">{t.aboutProgressBody}</p>
              <div className="about-links">
                <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('releases')}>{t.aboutViewReleases} <Icon name="external" size={14} /></button>
                <button className="btn" title={t.aboutBrowserHint} onClick={() => void openAboutLink('issues')}>{t.aboutFeedback} <Icon name="external" size={14} /></button>
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
              {SOURCES.map(source => <div className="meta" key={source.id}><span>{source[lang]}: <bdi>{source.transport} · {source.endpoint}</bdi></span></div>)}
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
        {keywordDialog}
      </div>

      {purgeConfirm && (
        <ConfirmDialog
          lang={lang}
          busy={dataBusy}
          title={t.purgeConfirm}
          body={`${t.purgeConfirmBody} (${t.purgeAffected}: ${purgeCount ?? 0})`}
          danger
          confirmLabel={t.purgeApplyBtn}
          onConfirm={() => {
            const iso = new Date(Date.now() - purgeDays * 86400_000).toISOString()
            setDataBusy(true)
                    void rased.purgeHistoryApply(iso).then((r) => {
              setPurgeConfirm(false)
              if (r.ok) {
                setPurgeCount(null)
                setPurgeMsg(`${t.purgeApplyBtn} ✓ (${r.deleted ?? 0})`)
              } else if (r.error) setPurgeMsg(r.error)
            }).catch(() => setPurgeMsg(lang === 'ar' ? 'تعذر حذف السجل.' : 'Could not remove history.')).finally(() => setDataBusy(false))
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
