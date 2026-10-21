import { recordStartupFailure } from './startupFailure.js'
import { SearchService } from './search/service.js'
import { searchReply } from '../shared/searchReply.js'
import { SearchCacheBuilder } from './search/cacheBuilder.js'
import { searchCacheReady } from '../storage/searchCache.js'
import { KafController } from './kaf.js'
import { matchesKafKeywords } from '../collector/kaf.js'
// RASED main process: lifecycle, collector loop, IPC, tray, notifications.
// The collector lives here (outside React). Renderer is display-only.

import { randomUUID } from 'node:crypto'
import { release as osRelease } from 'node:os'
import { NsisUpdater } from 'electron-updater'
import { UpdateController } from './updates.js'
import { testUpdater } from './testHarness.js'
import { version as APP_VERSION } from '../../package.json'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  shell,
  dialog,
  ipcMain,
  powerMonitor,
  nativeImage,
  screen,
  type Session
} from 'electron'
import { IPC } from '../shared/channels.js'
import { TelemetryService, telemetryWorkerEntry } from './telemetry/service.js'
import { telemetryConfig } from './telemetry/config.js'
import { ANALYTICS_SUPPORT, UI_SURFACES, durationBucket, quickApplyTelemetryError } from '../shared/telemetry.js'
import type { SourceId } from '../shared/sources.js'
import { repairLegacyDevShortcut, RASED_APP_ID, RASED_DEV_APP_ID, taskbarDetails } from './taskbar.js'
import { backupError, DataBackupManager, isCorruptDatabaseError, recoverCorruptDatabase, recoverPendingRestore } from './dataBackup.js'
import { finalizeBackupInWorker } from './backupWorkerClient.js'
import { inspectBackup } from '../storage/backups.js'
import { importSettings, parseSettingsTransfer, settingsPayload, type SettingsTransfer } from '../storage/settingsTransfer.js'
import { overallSourceState } from '../shared/sourceStatus.js'
import { SOURCES, isSourceId } from '../shared/sources.js'
import { monitoringState, monitoringReport, transportIssueCode } from '../shared/monitoring.js'
import { acknowledgeMonitoringGap, monitoringFields } from '../storage/monitoring.js'
import { ABOUT_LINKS, type AboutLink } from '../shared/about.js'
import {
  defaultSettings,
  defaultFilterDefinition,
  sanitizeFilterDefinition,
  sanitizeSettings,
  sanitizeUserStatePatch,
  type AppSettings,
  type MutationResult,
  type ProjectQuery,
  type ProjectFull,
  type RefreshResult,
  type SavedFilter,
  type SourceHealth
} from '../shared/types.js'
import type { ImportSummary, PurgePreview } from '../shared/api.js'
import { openDatabaseAtStartup, closeDatabase, type Db } from '../storage/db.js'
import {
  legacyToFilterDef,
  countPurgeable,
  createPendingEvents,
  deleteClassificationWait,
  deleteSavedFilterRow,
  getProjectById,
  getProjectDetailsRow,
  getSettingRaw,
  getSourceState,
  getUnenrichedNewIds,
  getUserState,
  listClassificationWaits,
  listDiagnostics,
  listEventsByStatus,
  listSavedFilters,
  markAllRead,
  markEnrichmentPending,
  markEvents,
  purgeHistory,
  recordDiagnostic,
  runInTransaction,
  saveSavedFilterRow,
  setReadState,
  setSettingRaw,
  saveSourceState,
  updateEnrichment,
  updateUserState
} from '../storage/repositories.js'
import { fetchRss, parseRssItems, RSS_URL } from '../collector/rss.js'
import { fetchKhamsatRequests, KHAMSAT_SOURCE, matchesKhamsatKeywords, parseKhamsatRequests } from '../collector/khamsat.js'
import { applyKhamsatCycle } from '../collector/khamsatPipeline.js'
import { fetchNafezlyFeed, matchesNafezlyKeywords, NAFEZLY_SOURCE, parseNafezlyFeed } from '../collector/nafezly.js'
import { applyNafezlyCycle } from '../collector/nafezlyPipeline.js'
import { normalizeItems, SOURCE } from '../collector/normalize.js'
import {
  delayUntilNext,
  initialSchedulerState,
  isBackingOff,
  noteFailure,
  noteSuccess,
  type FailureKind,
  type SchedulerState
} from '../collector/scheduler.js'
import { applyFailedCycle, applySuccessfulCycle, evaluateLateProject } from '../collector/pipeline.js'
import { EnrichmentQueue, type DetailFetchKind } from '../collector/enrichment.js'
import { DetailsFetcher, resetStaleLoadingDetails } from './details.js'
import { ProjectFactsFetcher } from './projectFactsFetcher.js'
import { factsNeedFetch, projectFacts, saveFetchedFacts, markFacts } from '../storage/projectFacts.js'
import type { ProjectFacts } from '../shared/projectFacts.js'
import { DetailBudget } from '../collector/detailBudget.js'
import { mergeSettings, notificationsAllowed, pickLatestProjectId } from './policies.js'
import { isolatedTestHarness } from './testHarness.js'
import { evaluateFilter, toFilterable } from '../shared/filters.js'
import { dispatchPending, recoverPreviousSession, type SinglePayload, type SummaryPayload } from './notifier.js'
import { isAllowedProjectUrl, isAllowedTestUrl, MOSTAQL_PROJECTS_URL, resolveProjectUrl } from './links.js'
import { browserToastXml, supportsUrgentToasts } from './toast.js'
import { NotificationActivationController } from './notifications/activation.js'
import { BrowserLauncher } from './notifications/browserLauncher.js'
import { ensureDevelopmentComRegistration, windowsRegistrationPort } from './notifications/developmentRegistration.js'
import { notificationActivationArguments, notificationScheme, parseNotificationActivation } from '../shared/notificationActivation.js'
import { claimNotificationActivation, cleanupNotificationActivations, issueNotificationActivation } from '../storage/notificationActivations.js'
import { getProposalProfile, saveProposalProfile } from './proposals.js'
import { AiService } from './ai/service.js'
import { saveAiSettings } from './ai/settings.js'
import { isAiProvider, sanitizeSelection } from '../shared/ai.js'
import { deleteProposalDraft, getProposalDraft, saveProposalDraft } from '../storage/proposalDrafts.js'
import type { ProposalDraft } from '../shared/proposals.js'
import { validQuickApply } from '../shared/quickApply.js'
import { retireQuickBrowser } from './retireQuickBrowser.js'
import { ExtensionBroker } from './extension/broker.js'
import { parseExtensionTicket, nonce, record, EXTENSION_VERSION, type ExtensionStatus } from '../shared/extension/protocol.js'
import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let extension:ExtensionBroker|null=null
let extensionReady=false
const pendingExtensionUrls=new Set<string>()
function extensionSnapshot():ExtensionStatus{return extension?.status()??{installed:false,registered:false,folder:join(app.getPath('userData'),'chrome-link','extension'),extensionVersion:EXTENSION_VERSION,clients:[],pairing:[],selectedId:null,lastJob:null,protocolReady:false,error:'bridge-unavailable'}}
const execChrome=promisify(execFile)
async function launchChrome(url='about:blank'):Promise<void> {
  const candidates=[join(process.env['PROGRAMFILES']??'C:\\Program Files','Google','Chrome','Application','chrome.exe'),join(process.env['PROGRAMFILES(X86)']??'C:\\Program Files (x86)','Google','Chrome','Application','chrome.exe'),join(process.env['LOCALAPPDATA']??'','Google','Chrome','Application','chrome.exe')]
  const executable=candidates.find(path=>{try{return statSync(path).isFile()}catch{return false}})
  if(!executable)throw Error('chrome-unavailable')
  // Normal installed Chrome uses its own cookies. No debugging or profile access.
  void execChrome(executable,[url],{windowsHide:true}).catch(()=>undefined)
}
async function activateExtensionUrl(raw:string):Promise<void> {
  if (!IS_PACKAGED) raw = raw.replace(/^rased-dev:/, 'rased:')
  const ticket=parseExtensionTicket(raw);if(!ticket)return
  if(!extensionReady){if(pendingExtensionUrls.size<10)pendingExtensionUrls.add(raw);return}
  if (!applicationAccessAllowed()) { win?.show(); return }
  if(!extension||!await extension.activate(ticket)){
    win?.show();win?.webContents.send(IPC.openSettings)
    if(!testHarness)void dialog.showMessageBox({type:'info',message:settings.language==='ar'?'تعذر بدء التقديم السريع. راجع ربط Chrome وإعدادات القالب، أو ابدأ من بطاقة المشروع.':'Quick Apply could not start. Check Chrome pairing and your template, or start from the project card.'})
  }
}

// Renaming the dev executable changes app.isPackaged on Windows; defaultApp
// still identifies a source launch and prevents installer paths/updates in dev.
const IS_PACKAGED=app.isPackaged && !process.defaultApp
// Notification shortcuts must use the same identity as their own windows.
// Sharing the installed ID registers Electron shortcuts that Windows can select
// instead of the installer's RASED shortcut after an update.
app.setAppUserModelId(IS_PACKAGED ? RASED_APP_ID : RASED_DEV_APP_ID)

const sessionId = randomUUID()
const runId = randomUUID()
let db: Db | null = null
let searchService: SearchService | undefined
let searchCache: SearchCacheBuilder | undefined
let dataBackup: DataBackupManager | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
/** compact follower window (Phase 6); null until opened */
let compactWin: BrowserWindow | null = null
let settings: AppSettings = defaultSettings()
let sched: SchedulerState = initialSchedulerState()
/** Temporary, session-only pause for the Mostaql collector. */
let paused = false
/** Temporary, session-only pause for the Khamsat collector. */
let khamsatPaused = false
let nafezlyPaused = false
let inFlight = false
let lastStartMs: number | null = null
let lastFinishMs: number | null = null
let nextAttemptAtMs: number | null = null
let firstCycleOfRun = true
let lastRecovering = false
let lastDurationMs: number | null = null
let lastItemCount: number | null = null
let timer: NodeJS.Timeout | null = null
let khamsatTimer: NodeJS.Timeout | null = null
let khamsatInFlight = false
let khamsatAbort: AbortController | null = null
let khamsatNextAttemptMs: number | null = null
let khamsatLastDurationMs: number | null = null
let khamsatLastItemCount: number | null = null
let nafezlyTimer: NodeJS.Timeout | null = null
let nafezlyInFlight = false
let nafezlyAbort: AbortController | null = null
let kaf: KafController | null = null
function snapshotKafHealth(): SourceHealth { return kaf?.health() ?? { state: 'initializing', paused: false, lastAttemptAt: null, lastSuccessAt: null, nextAttemptAt: null, lastError: null, consecutiveFailures: 0, lastDurationMs: null, lastItemCount: null, effectiveIntervalMs: 5500 } }
let nafezlyNextAttemptMs: number | null = null
let nafezlyLastDurationMs: number | null = null
let nafezlyLastItemCount: number | null = null
let nafezlyBaseIntervalMs = 15_000
let nafezlyRecoverySuccesses = 0
let enrichTimer: NodeJS.Timeout | null = null
let quitRequested = false
let episode = 0
let hintShown = false
const uncertainWaits = new Map<number, number>()
let activeRss: AbortController | null = null
let aiService: AiService | null = null
let flushing: Promise<void> | null = null
const detailBudget = new DetailBudget()
const work = new Set<Promise<unknown>>()
let shutdownWork: Promise<void> | null = null
let quitComplete = false
let updates: UpdateController | null = null
let updateInstallRequested = false
let updateStartupTimer: NodeJS.Timeout | null = null
let updateTimer: NodeJS.Timeout | null = null
let notificationCleanupTimer: NodeJS.Timeout | null = null
const testHarness = isolatedTestHarness(app.getPath('userData'), process.argv)
let telemetry: TelemetryService | null = null
let lastQuickTelemetry = ''
let quickTelemetryStarted = Date.now()
let quickTelemetryRequest = ''
function sourceForTelemetry(url: string): SourceId | 'unknown' {
  try {
    const host = new URL(url).hostname
    return host === 'mostaql.com' ? 'mostaql' : host === 'nafezly.com' ? 'nafezly' : host === 'khamsat.com' ? 'khamsat' : host === 'kafiil.com' ? 'kaf' : 'unknown'
  } catch { return 'unknown' }
}
function extensionChanged(): void {
  const state = extensionSnapshot()
  broadcast(IPC.extensionStatus, state)
  const job = state?.lastJob
  if (!job) return
  if (quickTelemetryRequest !== job.requestId) { quickTelemetryRequest = job.requestId; quickTelemetryStarted = Date.now() }
  if (lastQuickTelemetry === job.requestId || !['ready', 'needs-input', 'needs-login', 'draft-exists', 'failed', 'cancelled', 'expired'].includes(job.phase)) return
  lastQuickTelemetry = job.requestId
  const source = db?.isOpen ? getProjectById(db, job.projectId)?.source : null
  if (source === 'mostaql' || source === 'nafezly') telemetry?.record('quick_apply_result', { source, outcome: job.phase === 'ready' ? 'success' : job.phase === 'cancelled' ? 'cancelled' : 'failed', error: quickApplyTelemetryError(job.phase, job.error), duration: durationBucket(Date.now() - quickTelemetryStarted) })
}
const activationScheme = notificationScheme(IS_PACKAGED)
let notificationBoot = process.argv.some(arg => /^-+embedding$/i.test(arg) || !!parseNotificationActivation(arg, activationScheme))
let nativeActivationReady = false
const browserLauncher = new BrowserLauncher(url => shell.openExternal(url, { logUsage: true }))
const notificationActivation = new NotificationActivationController(activationScheme, {
  claim: token => db?.isOpen ? claimNotificationActivation(db, token) : null,
  open: async destination => {
    if (quitRequested) return { launch: 'failed', foreground: 'not-attempted', reason: 'quitting', durationMs: 0 }
    if (!applicationAccessAllowed()) { win?.show(); return { launch: 'failed', foreground: 'not-attempted', reason: 'analytics-acceptance-required', durationMs: 0 } }
    if (testHarness) {
      testHarness.record('open-external', destination.url)
      return { launch: 'accepted', foreground: 'not-attempted', durationMs: 0 }
    }
    return browserLauncher.launch(destination.url)
  },
  completed: (destination, result) => {
    if (destination.projectId !== null) {
      const source = sourceForTelemetry(destination.url)
      telemetry?.record('project_open_result', { source, entry: 'notification', launch: result.launch, foreground: result.foreground, duration: durationBucket(result.durationMs) })
      if (source !== 'unknown') telemetry?.counter('notification_summary', `${source}_activated`)
      telemetry?.activity('interface')
    }
    auditUi(`notification-open launch=${result.launch} foreground=${result.foreground} durationMs=${result.durationMs}`)
    testHarness?.record('notification-open-result', result)
    if (result.launch === 'accepted' && db?.isOpen && destination.projectId !== null && getProjectById(db, destination.projectId)) {
      setReadState(db, destination.projectId, true)
      emitProjects([], [destination.projectId])
    }
    if (result.launch !== 'accepted' && !quitRequested && !testHarness) void dialog.showMessageBox({ type: 'error', message: settings.language === 'ar' ? 'تعذّر فتح المشروع في المتصفح. يمكنك إعادة المحاولة من راصد.' : 'Could not open the project in your browser. Retry from RASED.' })
  },
  invalid: () => {
    auditUi('notification-activation-unavailable')
    if (!testHarness && !quitRequested) void dialog.showMessageBox({ type: 'info', message: settings.language === 'ar' ? 'انتهت صلاحية هذا الإشعار أو لم يعد متاحًا. افتح المشروع من راصد.' : 'This notification expired or is no longer available. Open the project from RASED.' })
  }
})

const pendingConsentActivations = new Set<string>()
function dispatchNotificationActivation(raw: string): void {
  notificationBoot = true
  if (telemetry && !applicationAccessAllowed()) {
    if (pendingConsentActivations.size < 10) pendingConsentActivations.add(raw)
    win?.show()
    return
  }
  const notification = activeNotificationActivations.get(raw)
  if (notification) { activeNotifications.delete(notification); activeNotificationActivations.delete(raw) }
  void trackWork(notificationActivation.activate(raw))
}

function trackWork<T>(p: Promise<T>): Promise<T> {
  work.add(p)
  void p.then(() => work.delete(p), (err) => {
    work.delete(p)
    auditUi(`async-failed ${String(err).slice(0, 150)}`)
  })
  return p
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of [win, compactWin]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function notificationAllowed(): boolean {
  return applicationAccessAllowed() && notificationsAllowed(settings, Date.now(), quitRequested)
}

function applicationAccessAllowed(): boolean { return telemetry?.status().accessAllowed ?? true }
let analyticsServicesReady = false
let lastAnalyticsAccess: boolean | undefined
function syncAnalyticsAccess(): void {
  if (!analyticsServicesReady || quitRequested) return
  const allowed = applicationAccessAllowed()
  if (lastAnalyticsAccess === allowed) return
  lastAnalyticsAccess = allowed
  if (!allowed) {
    activeRss?.abort(); khamsatAbort?.abort(); nafezlyAbort?.abort()
    enrichQueue.abortActive(); detailsFetcher.abortActive(); nafezlyFacts.abortActive()
    aiService?.cancel(); extension?.cancel()
    compactWin?.close()
  }
  // The access gate is separate from per-source pauses/settings/backoff.
  scheduleNext(); scheduleKhamsat(0); scheduleNafezly(0); kaf?.settingsChanged()
  if (allowed) {
    void trackWork(notificationActivation.start())
    const pending = [...pendingConsentActivations]; pendingConsentActivations.clear()
    for (const raw of pending) dispatchNotificationActivation(raw)
  }
}

const singleInstance = app.requestSingleInstanceLock()
if(singleInstance){
  app.on('second-instance',(_event,argv)=>{
    let external = argv.some(arg => /^-+embedding$/i.test(arg))
    for (const arg of argv) {
      if (parseNotificationActivation(arg, activationScheme)) { external = true; dispatchNotificationActivation(arg) }
      else if (parseExtensionTicket(IS_PACKAGED ? arg : arg.replace(/^rased-dev:/, 'rased:'))) { external = true; void activateExtensionUrl(arg) }
      else if (arg.startsWith(`${activationScheme}:`)) external = true
    }
    if (external) return
    if(win){if(win.isMinimized())win.restore();win.show();win.focus()}
  })
  app.on('open-url',(event,url)=>{event.preventDefault();if(parseNotificationActivation(url,activationScheme))dispatchNotificationActivation(url);else void activateExtensionUrl(url)})
}

// ---------------------------------------------------------------- settings

function loadSettings(): AppSettings {
  if (!db) return defaultSettings()
  const raw = getSettingRaw(db, 'app')
  if (!raw) return defaultSettings()
  try {
    return sanitizeSettings(JSON.parse(raw) as unknown)
  } catch {
    return defaultSettings()
  }
}

function saveSettings(s: AppSettings): void {
  if(s.quickApply.enabled&&!extension?.available())s={...s,quickApply:{...s.quickApply,enabled:false}}
  // Persist first: a failed write must not change live settings or cancel work.
  if (db) setSettingRaw(db, 'app', JSON.stringify(s))
  const previous = settings
  settings = s
  telemetry?.language(s.language)
  applyMonitoringSettings(previous, s)
  kaf?.settingsChanged()
  if(!s.quickApply.enabled)extension?.cancel()
  applyAutoStart()
  broadcast(IPC.settingsChanged, s)
  updateTray()
}

function applyMonitoringSettings(previous: AppSettings, next: AppSettings): void {
  if (previous.mostaqlEnabled !== next.mostaqlEnabled || previous.pollIntervalMs !== next.pollIntervalMs) {
    if (!next.mostaqlEnabled) { activeRss?.abort(); enrichQueue.abortActive(); detailsFetcher.abortActive() }
    scheduleNext()
  }
  if (previous.khamsatEnabled !== next.khamsatEnabled) {
    if (!next.khamsatEnabled) khamsatAbort?.abort()
    scheduleKhamsat(0)
  }
  if (previous.nafezlyEnabled !== next.nafezlyEnabled) {
    if (!next.nafezlyEnabled) { nafezlyAbort?.abort(); nafezlyFacts.abortActive() }
    scheduleNafezly(0)
  }
}

function applyAutoStart(): void {
  if (testHarness) return
  try {
    app.setLoginItemSettings({ openAtLogin: settings.runAtStartup })
  } catch {
    /* best effort; surfaced in README as manual fallback */
  }
}

// ---------------------------------------------------------------- health

function snapshotHealth(): SourceHealth {
  const st = db ? getSourceState(db, SOURCE) : null
  const state = monitoringState({ enabled: settings.mostaqlEnabled, paused, backoffUntil: sched.backoffUntilMs ?? 0, lastError: sched.needsReview ? 'forbidden' : st?.lastError ?? null, lastSuccessAt: st?.lastSuccessAt ?? null, failures: sched.consecutiveFailures }, Date.now())
  return {
    state,
    enabled: settings.mostaqlEnabled,
    checking: inFlight && settings.mostaqlEnabled && !paused,
    ...monitoringFields(db, 'mostaql'),
    lastAttemptAt: st?.lastAttemptAt ?? null,
    lastSuccessAt: st?.lastSuccessAt ?? null,
    nextAttemptAt: nextAttemptAtMs ? new Date(nextAttemptAtMs).toISOString() : null,
    consecutiveFailures: st?.consecutiveFailures ?? 0,
    lastError: st?.lastError ?? null,
    lastDurationMs,
    lastItemCount,
    effectiveIntervalMs:
      sched.backoffUntilMs && sched.backoffUntilMs > Date.now()
        ? Math.max(0, sched.backoffUntilMs - Date.now())
        : settings.pollIntervalMs,
    paused: paused && settings.mostaqlEnabled
  }
}

function emitHealth(): void {
  telemetry?.health('mostaql', snapshotHealth())
  broadcast(IPC.healthChanged, snapshotHealth())
  updateTray()
}

function emitProjects(newIds: number[], changedIds: number[] = []): void {
  episode++
  searchService?.invalidate()
  if (db && !quitRequested && !searchCacheReady(db)) searchCache?.start()
  const summary = null
  win?.webContents.send(IPC.projectsChanged, { episode, newIds, changedIds, summary })
  compactWin?.webContents.send(IPC.projectsChanged, { episode, newIds, changedIds, summary })
}

function emitDetails(projectIds: number[]): void {
  emitProjects([], projectIds)
  win?.webContents.send(IPC.detailsChanged, { projectIds })
  compactWin?.webContents.send(IPC.detailsChanged, { projectIds })
}

// ---------------------------------------------------------------- notifications (OS)

function projectLine(p: { title: string }): string {
  return p.title.length > 90 ? `${p.title.slice(0, 90)}…` : p.title
}

// Keep native notification objects alive until Windows closes or activates them.
const activeNotifications = new Set<Notification>()
const activeNotificationActivations = new Map<string, Notification>()

function showToast(title: string, body: string, onClick: () => void, url: string, quickLink?:string, projectId: number | null = null): Promise<boolean> {
  const measuredSource = projectId === null ? 'unknown' : sourceForTelemetry(url)
  const measure = (kind: 'requested' | 'shown' | 'failed'): void => { if (measuredSource !== 'unknown') telemetry?.counter('notification_summary', `${measuredSource}_${kind}`) }
  measure('requested')
  let activation: string | undefined
  if (process.platform === 'win32' && nativeActivationReady && db?.isOpen) {
    try { activation = notificationActivationArguments(issueNotificationActivation(db, { url, projectId })) }
    catch { auditUi('notification-ticket-unavailable') }
  }
  if (!IS_PACKAGED) quickLink = quickLink?.replace(/^rased:/, 'rased-dev:')
  const toastXml = process.platform === 'win32'
    ? browserToastXml(title, body, url, IS_PACKAGED ? join(process.resourcesPath, 'branding', 'icon.png') : iconPath('icon.png'), supportsUrgentToasts(process.platform, osRelease()),quickLink?{link:quickLink,language:settings.language}:undefined, activation)
    : undefined
  if (testHarness) {
    testHarness.record('toast', { title, body, toastXml, urgency: 'critical' })
    measure('shown') // The isolated OS fixture acknowledges a successful show.
    // Simulate the OS protocol destination, not a native Windows mouse click.
    if (activation) return notificationActivation.activate(activation).then(() => true)
    if (toastXml) testHarness.record('open-external', url)
    else onClick()
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean): void => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    try {
      const n = new Notification({ title, body, silent: true, icon: iconPath('icon.png'), toastXml, urgency: 'critical' })
      activeNotifications.add(n)
      if (activation) activeNotificationActivations.set(activation, n)
      const release = (): void => { activeNotifications.delete(n); if (activation) activeNotificationActivations.delete(activation) }
      n.once('show', () => { measure('shown'); finish(true) })
      n.on('failed', (_event, error: string) => {
        if (!done) measure('failed')
        auditUi(`notification-failed ${String(error)}`)
        release()
        finish(false)
      })
      n.on('close', release)
      n.once('click', () => {
        release()
        // The persistent activator owns foreground XML. HTTPS fallback is owned
        // by Windows. Neither may also open a URL through an instance callback.
        if (!toastXml) onClick()
      })
      n.show()
      setTimeout(() => finish(true), 2000)
    } catch {
      measure('failed')
      finish(false)
    }
  })
}

async function sendSingle(p: SinglePayload): Promise<boolean> {
  const lang = settings.language
  const tags: string[] = []
  if (p.project.discoveryKind === 'recovered') tags.push(lang === 'ar' ? 'فائت' : 'catch-up')
  if (p.uncertain && p.project.source === 'mostaql') tags.push(lang === 'ar' ? 'تصنيف غير مؤكد' : 'uncertain category')
  const platform = SOURCES.find(source => source.id === p.project.source)?.[lang] ?? 'RASED'
  const projectTitle = tags.length > 0 ? `${projectLine(p.project)} (${tags.join('، ')})` : projectLine(p.project)
  const title = `${platform} — ${projectTitle}`
  const body = p.project.source === 'kaf' ? (lang === 'ar' ? 'فرصة ظهرت على كاف — اضغط لفتح المشروع' : 'Opportunity appeared on KAF — click to open') : p.project.source === KHAMSAT_SOURCE ? (lang === 'ar' ? 'طلب خدمة جديد على خمسات — اضغط لفتح الطلب' : 'New Khamsat request — click to open') : p.project.descriptionExcerpt.slice(0, 180)
  const { id, url } = p.project
  return showToast(title, body, () => {
    void openProjectById(id, true, url).then(result => {
      if (!result.ok) auditUi(`notification-browser-failed id=${id} ${result.error}`)
    })
  }, url,extension?.protocolReady?extension.ticket(id)??undefined:undefined, id)
}

function snapshotKhamsatHealth(): SourceHealth {
  const source = db ? getSourceState(db, KHAMSAT_SOURCE) : null
  const backoff = source?.backoffUntil ? Date.parse(source.backoffUntil) : NaN
  const state = monitoringState({ enabled: settings.khamsatEnabled, paused: khamsatPaused, backoffUntil: backoff, lastError: source?.lastError ?? null, lastSuccessAt: source?.lastSuccessAt ?? null, failures: source?.consecutiveFailures ?? 0 }, Date.now())
  return { state, enabled: settings.khamsatEnabled, checking: khamsatInFlight && settings.khamsatEnabled && !khamsatPaused, ...monitoringFields(db, 'khamsat'), lastAttemptAt: source?.lastAttemptAt ?? null, lastSuccessAt: source?.lastSuccessAt ?? null, nextAttemptAt: khamsatNextAttemptMs ? new Date(khamsatNextAttemptMs).toISOString() : null, consecutiveFailures: source?.consecutiveFailures ?? 0, lastError: source?.lastError ?? null, lastDurationMs: khamsatLastDurationMs, lastItemCount: khamsatLastItemCount, effectiveIntervalMs: Number.isFinite(backoff) && backoff > Date.now() ? backoff - Date.now() : 5000, paused: state === 'paused' }
}

function emitKhamsatHealth(): void {
  telemetry?.health('khamsat', snapshotKhamsatHealth())
  broadcast(IPC.khamsatHealthChanged, snapshotKhamsatHealth())
  updateTray()
}

function snapshotNafezlyHealth(): SourceHealth {
  const source = db ? getSourceState(db, NAFEZLY_SOURCE) : null
  const backoff = source?.backoffUntil ? Date.parse(source.backoffUntil) : NaN
  const state = monitoringState({ enabled: settings.nafezlyEnabled, paused: nafezlyPaused, backoffUntil: backoff, lastError: source?.lastError ?? null, lastSuccessAt: source?.lastSuccessAt ?? null, failures: source?.consecutiveFailures ?? 0 }, Date.now())
  return { state, enabled: settings.nafezlyEnabled, checking: nafezlyInFlight && settings.nafezlyEnabled && !nafezlyPaused, ...monitoringFields(db, 'nafezly'), lastAttemptAt: source?.lastAttemptAt ?? null, lastSuccessAt: source?.lastSuccessAt ?? null, nextAttemptAt: nafezlyNextAttemptMs ? new Date(nafezlyNextAttemptMs).toISOString() : null, consecutiveFailures: source?.consecutiveFailures ?? 0, lastError: source?.lastError ?? null, lastDurationMs: nafezlyLastDurationMs, lastItemCount: nafezlyLastItemCount, effectiveIntervalMs: Number.isFinite(backoff) && backoff > Date.now() ? backoff - Date.now() : nafezlyBaseIntervalMs, paused: state === 'paused' }
}

function emitNafezlyHealth(): void {
  telemetry?.health('nafezly', snapshotNafezlyHealth())
  broadcast(IPC.nafezlyHealthChanged, snapshotNafezlyHealth())
  updateTray()
}

async function sendSummary(p: SummaryPayload, latestId: number | null): Promise<boolean> {
  const lang = settings.language
  const n = p.projects.length
  const title =
    p.projects.every(project => project.source === 'kaf') ? (lang === 'ar' ? `${n} فرص ظهرت على كاف` : `${n} opportunities appeared on KAF`) : p.projects.every(project => project.source === NAFEZLY_SOURCE)
      ? (lang === 'ar' ? `${n} مشاريع جديدة على نفذلي` : `${n} new Nafezly projects`)
      : p.projects.every(project => project.source === KHAMSAT_SOURCE)
      ? (lang === 'ar' ? `${n} طلبات جديدة على خمسات` : `${n} new Khamsat requests`)
      : p.projects.some(project => project.source === KHAMSAT_SOURCE || project.source === NAFEZLY_SOURCE || project.source === 'kaf')
      ? (lang === 'ar' ? `${n} فرص جديدة` : `${n} new opportunities`)
      : lang === 'ar'
      ? p.recovering
        ? `${n} مشاريع فائتة من مستقل`
        : `${n} مشاريع جديدة على مستقل`
      : p.recovering
        ? `${n} missed Mostaql projects`
        : `${n} new Mostaql projects`
  const lines = p.projects.slice(0, 3).map((x) => `• ${projectLine(x)}`)
  if (n > 3) lines.push(lang === 'ar' ? `و ${n - 3} أخرى…` : `and ${n - 3} more…`)
  lines.push(lang === 'ar' ? 'اضغط لفتح أحدث مشروع في المتصفح.' : 'Click to open the newest project in your browser.')
  const latestUrl = p.projects.find(project => project.id === latestId)?.url
  return showToast(title, lines.join('\n'), () => {
    if (latestId !== null) {
      void openProjectById(latestId, true, latestUrl).then(result => {
        if (!result.ok) auditUi(`notification-browser-failed id=${latestId} ${result.error}`)
      })
      return
    }
    // Even a summary without a project id stays a browser action.
    if (testHarness) testHarness.record('open-external', MOSTAQL_PROJECTS_URL)
    else void shell.openExternal(MOSTAQL_PROJECTS_URL).catch(err => auditUi(`summary-browser-failed ${String(err)}`))
  }, latestUrl ?? MOSTAQL_PROJECTS_URL, undefined, latestUrl ? latestId : null)
}

/** Tagged test toast. Opens the public projects listing; touches no project, event or read state. */
async function sendTestNotification(): Promise<{ ok: boolean }> {
  const lang = settings.language
  const title = lang === 'ar' ? 'إشعار تجريبي — راصد' : 'Test notification — RASED'
  const body =
    lang === 'ar'
      ? 'اضغط لفتح صفحة مشاريع مستقل. تجربة فقط — لا مشروع حقيقي ولا حدث اكتشاف.'
      : 'Click to open the Mostaql projects page. Test only — no real project, no discovery event.'
  const ok = await showToast(title, body, () => {
    if (isAllowedTestUrl(MOSTAQL_PROJECTS_URL)) {
      if (testHarness) testHarness.record('open-external', MOSTAQL_PROJECTS_URL)
      else void shell.openExternal(MOSTAQL_PROJECTS_URL).catch(err => auditUi(`test-browser-failed ${String(err)}`))
    }
  }, MOSTAQL_PROJECTS_URL)
  return { ok }
}

async function flushNotifications(batchKeyForGap: string | null): Promise<void> {
  if (!db) return
  if (flushing) return flushing
  flushing = flushPending(batchKeyForGap).finally(() => { flushing = null })
  return flushing
}

async function flushPending(batchKeyForGap: string | null): Promise<void> {
  if (!db) return
  const d: Db = db
  const nowIso = new Date().toISOString()
  // DND gate: absolute timestamp, survives restart via settings. Expired DND
  // clears itself and dispatch proceeds. Suppressed events are never resent.
  const until = settings.doNotDisturbUntil ? Date.parse(settings.doNotDisturbUntil) : NaN
  if (Number.isFinite(until)) {
    if (Date.now() < until) {
      const pend = listEventsByStatus(d, 'pending')
      if (pend.length > 0) {
        markEvents(d, pend.map((p) => p.id), 'suppressed', null, nowIso)
        recordDiagnostic(d, {
          at: nowIso,
          endpointKind: 'notify',
          status: 'dnd-suppressed',
          durationMs: 0,
          itemCount: pend.length,
          errorCategory: null,
          detail: `DND until ${settings.doNotDisturbUntil}`
        })
      }
      return
    }
    saveSettings({ ...settings, doNotDisturbUntil: null })
  }
  const out = await dispatchPending(
    d,
    { sessionId, nowIso, recovering: lastRecovering, batchKey: batchKeyForGap },
    {
      sendSingle,
      sendSummary: (payload) => sendSummary(payload, pickLatestProjectId(payload.projects)),
      shouldSend: (p) => {
        if (!notificationAllowed()) return false
        if (getUserState(d, p.id).hiddenAt !== null) return false
        if (p.source === 'kaf') return settings.kafEnabled && settings.kafNotificationsEnabled && !snapshotKafHealth().paused && p.platformStatus === 'open' && matchesKafKeywords(p.title, p.descriptionExcerpt, settings.kafKeywordsAny, settings.kafExcludeKeywords)
        if (p.source === KHAMSAT_SOURCE) return settings.khamsatEnabled && !khamsatPaused && settings.khamsatNotificationsEnabled && matchesKhamsatKeywords(p.title, settings.khamsatKeywordsAny, settings.khamsatExcludeKeywords)
        if (p.source === NAFEZLY_SOURCE) {
          const description = getProjectDetailsRow(d, p.id).text ?? p.descriptionExcerpt
          return settings.nafezlyEnabled && !nafezlyPaused && settings.nafezlyNotificationsEnabled && matchesNafezlyKeywords(p.title, description, settings.nafezlyKeywordsAny, settings.nafezlyExcludeKeywords)
        }
        if (!settings.mostaqlEnabled || !settings.mostaqlNotificationsEnabled || paused) return false
        const v = evaluateFilter(toFilterable(p), settings.notifyFilter)
        return v === 'match' || (!p.categoryConfirmed && settings.notifyUncertainCategory && v === 'uncertain')
      },
      onBeep: () => { if (notificationAllowed() && settings.soundEnabled) { testHarness?.record('beep', true); win?.webContents.send(IPC.playBeep) } }
    }
  )
  if (out.singles > 0 || out.summaries > 0 || out.skipped > 0) emitProjects([], [])
}

// ---------------------------------------------------------------- collector loop

function scheduleKhamsat(delayMs?: number): void {
  if (khamsatTimer) clearTimeout(khamsatTimer)
  khamsatTimer = null
  khamsatNextAttemptMs = null
  if (!applicationAccessAllowed() || !db || khamsatPaused || quitRequested || !settings.khamsatEnabled || khamsatInFlight) { emitKhamsatHealth(); return }
  const state = getSourceState(db, KHAMSAT_SOURCE)
  const backoff = state.backoffUntil ? Math.max(0, Date.parse(state.backoffUntil) - Date.now()) : 0
  const delay = Math.max(delayMs ?? 5000, backoff)
  khamsatNextAttemptMs = Date.now() + delay
  khamsatTimer = setTimeout(() => void trackWork(runKhamsatCycle()), delay)
  emitKhamsatHealth()
}

async function runKhamsatCycle(): Promise<void> {
  if (!applicationAccessAllowed() || !db || khamsatPaused || quitRequested || !settings.khamsatEnabled || khamsatInFlight) return
  const stored = getSourceState(db, KHAMSAT_SOURCE)
  if (stored.backoffUntil && Date.parse(stored.backoffUntil) > Date.now()) { scheduleKhamsat(); return }
  khamsatInFlight = true
  khamsatAbort = new AbortController()
  khamsatNextAttemptMs = null
  emitKhamsatHealth()
  try {
    saveSourceState(db, { ...stored, lastAttemptAt: new Date().toISOString() })
    const result = await fetchKhamsatRequests(khamsatAbort.signal, testHarness?.fetchImpl)
    if (!applicationAccessAllowed() || !db || khamsatPaused || quitRequested || !settings.khamsatEnabled || khamsatAbort.signal.aborted) return
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const previous = getSourceState(db, KHAMSAT_SOURCE)
    let items: ReturnType<typeof parseKhamsatRequests> | null = null
    let failure = result.ok ? null : result.error ?? 'request failed'
    if (result.ok) {
      try { items = parseKhamsatRequests(result.html ?? '') }
      catch (error) { failure = error instanceof Error ? error.message : 'parse failed' }
    }
    if (failure || !items) {
      khamsatLastDurationMs = result.durationMs
      khamsatLastItemCount = null
      const failures = previous.consecutiveFailures + 1
      const blocked = result.status === 202 || result.status === 401 || result.status === 403 || result.status === 429
      const errorCode = transportIssueCode(result)
      const backoffMs = Math.max(result.retryAfterMs ?? 0, blocked ? 15 * 60_000 : Math.min(5 * 60_000, 5000 * 2 ** Math.min(failures, 6)))
      runInTransaction(db, () => {
        saveSourceState(db!, { ...previous, lastAttemptAt: nowIso, lastError: errorCode, consecutiveFailures: failures, backoffUntil: new Date(nowMs + backoffMs).toISOString(), transportKind: 'html', runId })
        recordDiagnostic(db!, { at: nowIso, endpointKind: 'khamsat-list', status: 'failed', durationMs: result.durationMs, itemCount: null, errorCategory: failure, detail: `HTTP ${result.status ?? 'network'}; retry in ${backoffMs}ms` })
      })
      return
    }
    const { insertedIds, updatedIds, notifyIds } = applyKhamsatCycle(db, items, { nowMs, runId, durationMs: result.durationMs, settings })
    khamsatLastDurationMs = result.durationMs
    khamsatLastItemCount = items.length
    if (insertedIds.length || updatedIds.length) emitProjects(insertedIds, updatedIds)
    if (notifyIds.length) await flushNotifications(null)
  } finally {
    khamsatInFlight = false
    khamsatAbort = null
    scheduleKhamsat()
  }
}

function scheduleNafezly(delayMs?: number): void {
  if (nafezlyTimer) clearTimeout(nafezlyTimer)
  nafezlyTimer = null
  nafezlyNextAttemptMs = null
  if (!applicationAccessAllowed() || !db || nafezlyPaused || quitRequested || !settings.nafezlyEnabled || nafezlyInFlight) { emitNafezlyHealth(); return }
  const state = getSourceState(db, NAFEZLY_SOURCE)
  const backoff = state.backoffUntil ? Math.max(0, Date.parse(state.backoffUntil) - Date.now()) : 0
  const jitter = Math.floor(Math.random() * 3001)
  const delay = Math.max(delayMs ?? nafezlyBaseIntervalMs + jitter, backoff)
  nafezlyNextAttemptMs = Date.now() + delay
  nafezlyTimer = setTimeout(() => void trackWork(runNafezlyCycle()), delay)
  emitNafezlyHealth()
}

async function runNafezlyCycle(): Promise<void> {
  if (!applicationAccessAllowed() || !db || nafezlyPaused || quitRequested || !settings.nafezlyEnabled || nafezlyInFlight) return
  const stored = getSourceState(db, NAFEZLY_SOURCE)
  if (stored.backoffUntil && Date.parse(stored.backoffUntil) > Date.now()) { scheduleNafezly(); return }
  nafezlyInFlight = true
  nafezlyAbort = new AbortController()
  nafezlyNextAttemptMs = null
  emitNafezlyHealth()
  try {
    saveSourceState(db, { ...stored, lastAttemptAt: new Date().toISOString() })
    const result = await fetchNafezlyFeed(nafezlyAbort.signal, testHarness?.fetchImpl)
    if (!applicationAccessAllowed() || !db || nafezlyPaused || quitRequested || !settings.nafezlyEnabled || nafezlyAbort.signal.aborted) return
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const previous = getSourceState(db, NAFEZLY_SOURCE)
    let items: ReturnType<typeof parseNafezlyFeed> | null = null
    let failure = result.ok ? null : result.error ?? 'request failed'
    if (result.ok) {
      try { items = parseNafezlyFeed(result.xml ?? '') }
      catch (error) { failure = error instanceof Error ? error.message : 'parse failed' }
    }
    if (failure || !items) {
      nafezlyLastDurationMs = result.durationMs
      nafezlyLastItemCount = null
      nafezlyRecoverySuccesses = 0
      const failures = previous.consecutiveFailures + 1
      const blocked = result.status === 401 || result.status === 403 || result.status === 429 || result.status === 202 || failure === 'unexpected content type'
      const errorCode = transportIssueCode(result)
      if (blocked) nafezlyBaseIntervalMs = 60_000
      const backoffMs = Math.max(result.retryAfterMs ?? 0, blocked ? Math.min(2 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(failures - 1, 3)) : Math.min(5 * 60_000, 15_000 * 2 ** Math.min(failures, 5)))
      runInTransaction(db, () => {
        saveSourceState(db!, { ...previous, lastAttemptAt: nowIso, lastError: errorCode, consecutiveFailures: failures, backoffUntil: new Date(nowMs + backoffMs).toISOString(), transportKind: 'rss', runId })
        recordDiagnostic(db!, { at: nowIso, endpointKind: 'nafezly-feed', status: 'failed', durationMs: result.durationMs, itemCount: null, errorCategory: failure, detail: `HTTP ${result.status ?? 'network'}; retry in ${backoffMs}ms` })
      })
      return
    }
    const outcome = applyNafezlyCycle(db, items, { nowMs, runId, durationMs: result.durationMs, settings })
    nafezlyLastDurationMs = result.durationMs
    nafezlyLastItemCount = items.length
    if (nafezlyBaseIntervalMs > 15_000 && ++nafezlyRecoverySuccesses >= (nafezlyBaseIntervalMs === 60_000 ? 10 : 20)) {
      nafezlyBaseIntervalMs = nafezlyBaseIntervalMs === 60_000 ? 30_000 : 15_000
      nafezlyRecoverySuccesses = 0
    }
    if (outcome.insertedIds.length || outcome.updatedIds.length) emitProjects(outcome.insertedIds, outcome.updatedIds)
    if (outcome.notifyIds.length) await flushNotifications(null)
  } finally {
    nafezlyInFlight = false
    nafezlyAbort = null
    scheduleNafezly()
    void trackWork(nafezlyFacts.pump())
  }
}

function mapFetchKind(kind: string, status: number | null): FailureKind {
  if (kind === 'timeout') return 'timeout'
  if (kind === 'network') return 'network'
  if (kind === 'too_large') return 'too_large'
  if (kind === 'invalid_content') return 'invalid_content'
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 403) return 'forbidden'
  if (status !== null && status >= 500) return 'http5xx'
  return 'network'
}

function sweepUncertain(nowMs: number): number[] {
  if (!db || uncertainWaits.size === 0) return []
  const expired: number[] = []
  for (const [pid, deadline] of uncertainWaits) {
    if (nowMs >= deadline) {
      expired.push(pid)
      uncertainWaits.delete(pid)
      deleteClassificationWait(db, pid)
      enrichQueue.drop(pid)
    }
  }
  const toNotify: number[] = []
  if (settings.mostaqlEnabled && settings.mostaqlNotificationsEnabled && settings.notifyUncertainCategory && settings.notificationsEnabled) {
    for (const pid of expired) {
      const p = getProjectById(db, pid)
      if (p && !p.categoryConfirmed && !getUserState(db, pid).hiddenAt && evaluateFilter(toFilterable(p), settings.notifyFilter) === 'uncertain') toNotify.push(pid)
    }
    if (toNotify.length > 0) createPendingEvents(db, toNotify, 'new_project', new Date().toISOString())
  }
  return toNotify
}

async function runCycle(): Promise<RefreshResult> {
  if (quitRequested || !applicationAccessAllowed()) return { ok: false, started: false, reason: 'paused' }
  if (!db) return { ok: false, started: false, reason: 'no-db' }
  if (!settings.mostaqlEnabled) return { ok: false, started: false, reason: 'disabled' }
  if (paused) return { ok: false, started: false, reason: 'paused' }
  if (inFlight) return { ok: false, started: false, reason: 'busy' }
  if (isBackingOff(sched, Date.now())) return { ok: false, started: false, reason: 'backoff' }
  inFlight = true
  lastStartMs = Date.now()
  activeRss = new AbortController()
  emitHealth()
  try {
    saveSourceState(db, { ...getSourceState(db, SOURCE), lastAttemptAt: new Date(lastStartMs).toISOString() })
    const res = await fetchRss(RSS_URL, { signal: activeRss.signal, fetchImpl: testHarness?.fetchImpl })
    lastDurationMs = res.durationMs
    if (!applicationAccessAllowed() || !settings.mostaqlEnabled || activeRss.signal.aborted || paused || quitRequested || (!res.ok && res.kind === 'cancelled')) return { ok: false, started: true, reason: 'paused' }
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    if (!res.ok) {
      const kind = mapFetchKind(res.kind, res.status)
      sched = noteFailure(sched, { kind, retryAfterMs: res.retryAfterMs, nowMs })
      applyFailedCycle(db, {
        nowIso,
        errorCategory: kind === 'http5xx' || kind === 'rate_limited' ? `http-${res.status ?? 'x'}` : res.kind,
        detail: res.detail.slice(0, 200),
        durationMs: res.durationMs,
        runId
      })
      persistScheduler()
      sweepUncertain(nowMs)
      return { ok: false, started: true }
    }
    let valid: ReturnType<typeof normalizeItems>['valid']
    let invalidSingles = 0
    let itemCount = 0
    try {
      const parsed = parseRssItems(res.xml)
      itemCount = parsed.items.length
      const norm = normalizeItems(parsed.items)
      valid = norm.valid
      invalidSingles = parsed.invalidSingles + norm.invalidSingles
    } catch (err) {
      sched = noteFailure(sched, { kind: 'invalid_content', retryAfterMs: null, nowMs })
      applyFailedCycle(db, {
        nowIso,
        errorCategory: 'invalid_content',
        detail: err instanceof Error ? err.message.slice(0, 200) : 'parse failed',
        durationMs: res.durationMs,
        runId
      })
      persistScheduler()
      sweepUncertain(nowMs)
      return { ok: false, started: true }
    }
    if (valid.length === 0) {
      sched = noteFailure(sched, { kind: 'invalid_content', retryAfterMs: null, nowMs })
      applyFailedCycle(db, { nowIso, errorCategory: 'invalid_content', detail: 'zero valid items', durationMs: res.durationMs, runId })
      persistScheduler()
      sweepUncertain(nowMs)
      return { ok: false, started: true }
    }
    const out = applySuccessfulCycle(db, valid, {
      nowIso,
      nowMs,
      runId,
      settings,
      durationMs: res.durationMs,
      itemCount,
      invalidSingles,
      firstCycleOfRun
    })
    firstCycleOfRun = false
    sched = noteSuccess(sched, nowMs)
    persistScheduler()
    lastDurationMs = res.durationMs
    lastItemCount = itemCount
    lastRecovering = out.baseline ? false : out.recovering
    for (const [pid, deadline] of out.uncertainWaits) uncertainWaits.set(pid, deadline)
    for (const pid of out.enrichIds) {
      const p = getProjectById(db, pid)
      if (p) enrichQueue.enqueue(pid, p.url)
    }
    const swept = sweepUncertain(nowMs)
    const gapKey = lastRecovering ? `gap:${getSourceState(db, SOURCE).lastSuccessAt ?? nowIso}` : null
    if (out.insertedIds.length > 0 || out.updatedIds.length > 0) emitProjects(out.insertedIds, out.updatedIds)
    await flushNotifications(gapKey)
    if (swept.length > 0) emitProjects([], swept)
    void trackWork(enrichQueue.pump())
    return { ok: true, started: true }
  } finally {
    inFlight = false
    activeRss = null
    lastFinishMs = Date.now()
    emitHealth()
    scheduleNext()
    void trackWork(detailsFetcher.pump())
  }
}

function scheduleNext(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!applicationAccessAllowed() || !settings.mostaqlEnabled || paused || quitRequested || !db || inFlight) {
    nextAttemptAtMs = null
    emitHealth()
    return
  }
  const delay = delayUntilNext(sched, settings.pollIntervalMs, Date.now(), lastStartMs, lastFinishMs)
  if (delay < 0) {
    nextAttemptAtMs = null
    return
  }
  nextAttemptAtMs = Date.now() + delay
  emitHealth()
  timer = setTimeout(() => {
    lastRecovering = wasGap()
    void trackWork(runCycle())
  }, delay)
}

function wasGap(): boolean {
  if (!db) return false
  const st = getSourceState(db, SOURCE)
  if (!st.lastSuccessAt) return false
  const last = Date.parse(st.lastSuccessAt)
  if (Number.isNaN(last)) return true
  return Date.now() - last > 60_000
}

function persistScheduler(): void {
  if (!db) return
  const state = getSourceState(db, SOURCE)
  saveSourceState(db, { ...state, lastError: sched.needsReview ? 'forbidden' : state.lastError, consecutiveFailures: sched.consecutiveFailures, backoffUntil: sched.backoffUntilMs ? new Date(sched.backoffUntilMs).toISOString() : null })
}

// ---------------------------------------------------------------- enrichment

const enrichQueue = new EnrichmentQueue({
  fetchImpl: testHarness?.fetchImpl,
  budget: detailBudget,
  gateOpen: () => applicationAccessAllowed() && settings.mostaqlEnabled && !paused && !quitRequested && !inFlight && !isBackingOff(sched, Date.now()),
  onTransportFailure: (kind: DetailFetchKind | 'http5xx' | 'forbidden' | 'rate_limited', retryAfterMs: number | null) => {
    const mapped: FailureKind =
      kind === 'forbidden' ? 'forbidden' : kind === 'rate_limited' ? 'rate_limited' : kind === 'http5xx' ? 'http5xx' : kind === 'timeout' ? 'timeout' : 'network'
    sched = noteFailure(sched, { kind: mapped, retryAfterMs, nowMs: Date.now() })
    persistScheduler()
    scheduleNext()
    emitHealth()
  },
  onDone: (projectId: number, data) => {
    if (!db) return
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const current = getProjectById(db, projectId)
    if (!current) {
      uncertainWaits.delete(projectId)
      deleteClassificationWait(db, projectId)
      return
    }
    if (data) {
      updateEnrichment(
        db,
        projectId,
        {
          categorySlug: data.categorySlug ?? current.categorySlug,
          categoryName: data.categoryName ?? current.categoryName,
          categoryConfirmed: data.categoryConfirmed ? true : current.categoryConfirmed,
          skills: data.skills.length > 0 ? data.skills : current.skills,
          budgetMin: data.budgetMin ?? current.budgetMin,
          budgetMax: data.budgetMax ?? current.budgetMax,
          currency: data.currency ?? current.currency,
          budgetRaw: data.budgetRaw ?? current.budgetRaw,
          status: 'ready'
        },
        nowIso
      )
    } else {
      updateEnrichment(
        db,
        projectId,
        {
          categorySlug: current.categorySlug,
          categoryName: current.categoryName,
          categoryConfirmed: current.categoryConfirmed,
          skills: current.skills,
          budgetMin: current.budgetMin,
          budgetMax: current.budgetMax,
          currency: current.currency,
          budgetRaw: current.budgetRaw,
          status: 'failed'
        },
        nowIso
      )
    }
    if (data?.facts) saveFetchedFacts(db, projectId, data.facts, nowIso)
    else if (data) markFacts(db, projectId, 'failed', 'metadata-unavailable', nowIso)
    const deadline = uncertainWaits.get(projectId)
    if (deadline !== undefined) {
      if (nowMs <= deadline) {
        // Re-evaluate CURRENT rules; a late non-match stays silent.
        const verdict = evaluateLateProject(db, projectId, settings, nowIso)
        if (verdict === 'notify') {
          uncertainWaits.delete(projectId)
          deleteClassificationWait(db, projectId)
          lastRecovering = false
          void trackWork(flushNotifications(null).then(() => emitProjects([projectId], [projectId])))
          return
        }
      } else {
        uncertainWaits.delete(projectId)
        deleteClassificationWait(db, projectId)
      }
    }
    emitProjects([], [projectId])
  }
})

// ---------------------------------------------------------------- full details

function detailTransportFailure(kind: DetailFetchKind | 'http5xx' | 'forbidden' | 'rate_limited', retryAfterMs: number | null): void {
  const mapped: FailureKind =
    kind === 'forbidden' ? 'forbidden' : kind === 'rate_limited' ? 'rate_limited' : kind === 'http5xx' ? 'http5xx' : kind === 'timeout' ? 'timeout' : 'network'
  sched = noteFailure(sched, { kind: mapped, retryAfterMs, nowMs: Date.now() })
  persistScheduler()
  scheduleNext()
  emitHealth()
}

const detailsFetcher = new DetailsFetcher(() => db, {
  fetchImpl: testHarness?.fetchImpl,
  budget: detailBudget,
  gateOpen: () => applicationAccessAllowed() && settings.mostaqlEnabled && !paused && !quitRequested && !inFlight && !isBackingOff(sched, Date.now()) && db !== null,
  onMetadata: (projectId, data) => {
    if (!db || !getProjectById(db, projectId)) return
    const p = getProjectById(db, projectId)!
    enrichQueue.drop(projectId)
    updateEnrichment(db, projectId, {
      ...data, categoryConfirmed: data.categoryConfirmed || p.categoryConfirmed,
      categorySlug: data.categorySlug ?? p.categorySlug, categoryName: data.categoryName ?? p.categoryName,
      skills: data.skills.length ? data.skills : p.skills, budgetMin: data.budgetMin ?? p.budgetMin,
      budgetMax: data.budgetMax ?? p.budgetMax, currency: data.currency ?? p.currency,
      budgetRaw: data.budgetRaw ?? p.budgetRaw, status: 'ready'
    }, new Date().toISOString())
    emitProjects([], [projectId])
  },
  onTransportFailure: detailTransportFailure,
  onSettled: (projectId: number) => emitDetails([projectId])
})

const nafezlyFacts = new ProjectFactsFetcher({
  db: () => db, fetchImpl: testHarness?.fetchImpl,
  gateOpen: () => applicationAccessAllowed() && !!db && !quitRequested && settings.nafezlyEnabled && !nafezlyPaused && !nafezlyInFlight && !(getSourceState(db, NAFEZLY_SOURCE).backoffUntil && Date.parse(getSourceState(db, NAFEZLY_SOURCE).backoffUntil!) > Date.now()),
  settled: id => { emitProjects([], [id]); emitDetails([id]) },
  failure: result => {
    if (!db || quitRequested) return
    const previous = getSourceState(db, NAFEZLY_SOURCE), failures = previous.consecutiveFailures + 1
    const blocked = result.status === 401 || result.status === 403 || result.status === 429
    const wait = Math.max(result.retryAfterMs ?? 0, blocked ? Math.min(2 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(failures - 1, 3)) : Math.min(5 * 60_000, 15_000 * 2 ** Math.min(failures, 5)))
    if (blocked) { nafezlyBaseIntervalMs = 60_000; nafezlyRecoverySuccesses = 0; nafezlyAbort?.abort() }
    saveSourceState(db, { ...previous, lastError: result.kind === 'http' ? `http-${result.status}` : result.kind ?? 'invalid_content', consecutiveFailures: failures, backoffUntil: new Date(Math.max(Date.parse(previous.backoffUntil ?? '') || 0, Date.now() + wait)).toISOString() })
    scheduleNafezly()
  }
})

function snapshotProjectFacts(id: number): ProjectFacts | null {
  if (!db) return null
  const p = getProjectById(db, id), facts = projectFacts(db, id)
  if (!p || !facts || facts.status === 'unsupported') return facts
  const health = p.source === 'kaf' ? snapshotKafHealth() : p.source === NAFEZLY_SOURCE ? snapshotNafezlyHealth() : snapshotHealth()
  const pending = p.source === 'kaf' ? kaf?.isDetailsPending(id) : p.source === NAFEZLY_SOURCE ? nafezlyFacts.isPending(id) : detailsFetcher.isPending(id)
  if (facts.status !== 'ready' || factsNeedFetch(db, id) || pending) {
    const reason = health.enabled === false ? 'disabled' : health.paused ? 'paused' : Date.parse(getSourceState(db, p.source).backoffUntil ?? '') > Date.now() ? 'cooldown' : null
    if (reason) return { ...facts, status: 'deferred', deferredReason: reason }
  }
  return pending ? { ...facts, status: 'loading' } : facts
}

function requestFacts(id: number, force: boolean): ProjectFacts | null {
  if (!db) return null
  const p = getProjectById(db, id), facts = snapshotProjectFacts(id)
  if (!p || !facts || facts.status === 'unsupported' || facts.status === 'deferred' || !factsNeedFetch(db, id, Date.now(), force)) return facts
  const health = p.source === 'kaf' ? snapshotKafHealth() : p.source === NAFEZLY_SOURCE ? snapshotNafezlyHealth() : snapshotHealth()
  const deferredReason = health.enabled === false ? 'disabled' : health.paused ? 'paused' : Date.parse(getSourceState(db, p.source).backoffUntil ?? '') > Date.now() ? 'cooldown' : null
  if (deferredReason) return { ...facts, status: 'deferred', deferredReason }
  if (p.source === 'kaf') kaf?.requestDetails(id, true)
  else if (p.source === NAFEZLY_SOURCE) { nafezlyFacts.request(id, force); void trackWork(nafezlyFacts.pump()) }
  else { detailsFetcher.request(id, p.url, true); void trackWork(detailsFetcher.pump()) }
  return snapshotProjectFacts(id)
}

// ---------------------------------------------------------------- open project

async function openProjectById(id: number, fromNotification: boolean, notificationUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const openStarted = Date.now()
  const measureOpen = (url: string, launch: 'accepted' | 'failed'): void => {
    telemetry?.record('project_open_result', { source: sourceForTelemetry(url), entry: fromNotification ? 'notification' : 'app', launch, foreground: 'not-attempted', duration: durationBucket(Date.now() - openStarted) })
    telemetry?.activity('interface')
  }
  if (quitRequested) return { ok: false, error: 'quitting' }
  if (!applicationAccessAllowed()) { win?.show(); return { ok: false, error: 'analytics-acceptance-required' } }
  const openedDb = db
  // Native toast closures carry their original URL even if history was purged.
  // IPC callers never supply this argument; all destinations still pass the allow-list.
  const url = notificationUrl ?? (openedDb ? resolveProjectUrl(openedDb, id) : null)
  if (!url || !isAllowedProjectUrl(url)) return { ok: false, error: 'bad-url' }
  try {
    if (testHarness) testHarness.record('open-external', url)
    else await shell.openExternal(url)
  } catch {
    measureOpen(url, 'failed')
    return { ok: false, error: 'open-failed' }
  }
  if (!quitRequested && openedDb && db === openedDb && openedDb.isOpen && getProjectById(openedDb, id)) setReadState(openedDb, id, true)
  auditUi(`open-project id=${id}${fromNotification ? ' via-notification' : ''}`)
  measureOpen(url, 'accepted')
  emitProjects([], [id])
  return { ok: true }
}

// ---------------------------------------------------------------- window/tray

function iconPath(name: string): string {
  if (IS_PACKAGED) {
    if (name === 'icon.ico' || name === 'icon.png') return join(process.resourcesPath, 'branding', name)
    return join(app.getAppPath(), 'resources', name)
  }
  // electron-vite can launch out/main directly, so app.getAppPath() may point
  // there rather than at the repository root. Windows then falls back to Electron.
  return join(__dirname, '../../resources', name)
}

// Content-Security-Policy is set here per environment, not (only) via the
// HTML meta tag. Production keeps the strict policy baked into index.html
// (external .css/.js only). Development needs inline styles/scripts for
// Vite's HMR + react-refresh preamble, so it gets a relaxed policy instead.
function cspPolicy(): string {
  if (process.env['ELECTRON_RENDERER_URL']) {
    return "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self';"
  }
  return "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self';"
}

function applyCspPolicy(session: Session): void {
  const policy = cspPolicy()
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...(details.responseHeaders ?? {}), 'Content-Security-Policy': [policy] }
    })
  })
}

function attachWindowChrome(window: BrowserWindow): void {
  window.setIcon(iconPath('icon.ico'))
  if (process.platform === 'win32') window.setAppDetails(taskbarDetails(IS_PACKAGED, process.execPath, join(__dirname, 'index.js'), iconPath('icon.ico')))
  const emit = (): void => { if (!window.isDestroyed()) window.webContents.send(IPC.windowState, { maximized: window.isMaximized() }) }
  window.on('maximize', emit)
  window.on('unmaximize', emit)
}

function guardNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    const trusted = window.webContents.getURL().split('#')[0]
    if (target.split('#')[0] !== trusted) event.preventDefault()
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14171c',
    autoHideMenuBar: true,
    icon: iconPath('icon.ico'),
    frame: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  applyCspPolicy(win.webContents.session)
  guardNavigation(win)
  attachWindowChrome(win)
  win.webContents.on('will-prevent-unload', () => {
    // Preserve dirty drafts for renderer-initiated close/reload as well.
    win?.webContents.send(IPC.requestClose, { quit: settings.ui.closeBehavior === 'quit' })
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  // Bring the window forward on launch so it is not lost behind the IDE.
  win.once('ready-to-show', () => {
    if (notificationBoot && applicationAccessAllowed()) { testHarness?.record('window-launch', { notificationBoot, visible: false }); return }
    win?.show()
    win?.focus()
    testHarness?.record('window-launch', { notificationBoot, visible: win?.isVisible() ?? false })
  })
  win.on('close', (e) => {
    testHarness?.record('native-close', { quitRequested, tray: !!tray })
    if (quitRequested || !tray) return
    e.preventDefault()
    // closeBehavior 'quit' ends the app; default 'tray' hides to background.
    if (settings.ui.closeBehavior === 'quit' || !applicationAccessAllowed()) {
      win?.webContents.send(IPC.requestClose, { quit: true })
      return
    }
    win?.webContents.send(IPC.requestClose, { quit: false })

  })
  win.on('closed', () => {
    win = null
  })
}

function trayLabel(): string {
  const ar = settings.language === 'ar'
  if (!applicationAccessAllowed()) return ar ? 'RASED — في انتظار الموافقة أو الخروج' : 'RASED — acceptance required'
  const stateValue = overallSourceState([
    ...(settings.mostaqlEnabled ? [snapshotHealth()] : []),
    ...(settings.khamsatEnabled ? [snapshotKhamsatHealth()] : []),
    ...(settings.nafezlyEnabled ? [snapshotNafezlyHealth()] : []),
    ...(settings.kafEnabled ? [snapshotKafHealth()] : [])
  ])
  const state = ar
    ? { watching: 'الرصد نشط', partial: 'رصد جزئي', disabled: 'كل المنصات معطّلة', paused: 'متوقف', 'backing-off': 'تهدئة وإعادة', error: 'خطأ', offline: 'غير متصل', 'needs-review': 'يحتاج مراجعة', initializing: 'يبدأ…' }[stateValue]
    : { watching: 'Watching', partial: 'Partial monitoring', disabled: 'All platforms disabled', paused: 'Paused', 'backing-off': 'Backing off', error: 'Error', offline: 'Offline', 'needs-review': 'Needs review', initializing: 'Starting…' }[stateValue]
  return `RASED — ${state}`
}

function updateTray(): void {
  if (!tray) return
  tray.setToolTip(trayLabel())
  const ar = settings.language === 'ar'
  const sourceHealth = { mostaql: snapshotHealth(), khamsat: snapshotKhamsatHealth(), nafezly: snapshotNafezlyHealth(), kaf: snapshotKafHealth() }
  const toggleSourcePause = {
    mostaql: () => { void (paused ? doResume() : doPause()) },
    khamsat: () => { void (khamsatPaused ? doResumeKhamsat() : doPauseKhamsat()) },
    nafezly: () => { void (nafezlyPaused ? doResumeNafezly() : doPauseNafezly()) },
    kaf: () => { kaf?.setPaused(!kaf.health().paused) }
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: ar ? 'فتح راصد' : 'Open RASED', click: () => win?.show() },
      { type: 'separator' },
      ...SOURCES.filter(source => settings[source.enabledKey]).flatMap(source => [
        { label: ar ? `${sourceHealth[source.id].paused ? 'استئناف' : 'إيقاف مؤقت:'} ${source.ar}` : `${sourceHealth[source.id].paused ? 'Resume' : 'Pause'} ${source.en}`, enabled: applicationAccessAllowed(), click: toggleSourcePause[source.id] },
        { label: ar ? `كتم تنبيهات ${source.ar}` : `Mute ${source.en} alerts`, type: 'checkbox' as const, checked: !settings[source.alertsKey], click: () => saveSettings({ ...settings, [source.alertsKey]: !settings[source.alertsKey] }) }
      ]),
      {
        label: settings.soundEnabled ? (ar ? 'كتم الصوت' : 'Mute sound') : ar ? 'تفعيل الصوت' : 'Enable sound',
        click: () => saveSettings({ ...settings, soundEnabled: !settings.soundEnabled })
      },
      { label: ar ? 'الإعدادات' : 'Settings', click: () => { win?.show(); win?.webContents.send(IPC.openSettings) } },
      { type: 'separator' },
      { label: ar ? 'خروج' : 'Quit', click: () => { if (win && !win.isDestroyed()) { win.show(); win.webContents.send(IPC.requestClose, { quit: true }) } else doQuit() } }
    ])
  )
}

function createTray(): void {
  const img = nativeImage.createFromPath(iconPath('tray.png'))
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  tray.on('double-click', () => win?.show())
  updateTray()
}

// ---------------------------------------------------------------- compact follower window

/** Saved bounds are honored only when fully visible on a current display. */
function saneCompactBounds(): { x: number; y: number; width: number; height: number } | undefined {
  const b = settings.compactBounds
  if (!b) return undefined
  try {
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const visible = screen.getAllDisplays().some((d) => {
      const w = d.workArea
      return b.x >= w.x && b.y >= w.y && b.x + b.width <= w.x + w.width && b.y + b.height <= w.y + w.height && cx >= w.x && cy >= w.y
    })
    if (visible) return b
  } catch {
    /* fall through to default placement */
  }
  return undefined
}

let compactBoundsTimer: NodeJS.Timeout | null = null

function persistCompactBounds(): void {
  if (!compactWin) return
  if (compactBoundsTimer) clearTimeout(compactBoundsTimer)
  compactBoundsTimer = setTimeout(() => {
    if (!compactWin) return
    try {
      const b = compactWin.getBounds()
      saveSettings({
        ...settings,
        compactBounds: {
          x: Math.round(b.x),
          y: Math.round(b.y),
          width: Math.min(1200, Math.max(240, Math.round(b.width))),
          height: Math.min(1200, Math.max(300, Math.round(b.height)))
        }
      })
    } catch {
      /* bounds are best-effort */
    }
  }, 500)
}

function openCompact(): void {
  if (!applicationAccessAllowed()) { win?.show(); return }
  if (compactWin) {
    if (compactWin.isMinimized()) compactWin.restore()
    compactWin.show()
    compactWin.focus()
    return
  }
  const saved = saneCompactBounds()
  compactWin = new BrowserWindow({
    width: saved?.width ?? 380,
    height: saved?.height ?? 560,
    minWidth: 280,
    minHeight: 360,
    x: saved?.x,
    y: saved?.y,
    backgroundColor: settings.ui.theme === 'light' ? '#faf7f0' : '#14171c',
    autoHideMenuBar: true,
    alwaysOnTop: settings.ui.compactAlwaysOnTop,
    icon: iconPath('icon.ico'),
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (compactWin) applyCspPolicy(compactWin.webContents.session)
  guardNavigation(compactWin)
  attachWindowChrome(compactWin)
  if (process.env['ELECTRON_RENDERER_URL']) {
    void compactWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/compact`)
  } else {
    void compactWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'compact' })
  }
  compactWin.on('move', persistCompactBounds)
  compactWin.on('resize', persistCompactBounds)
  compactWin.on('closed', () => {
    compactWin = null
  })
  if (compactWin) applyCspPolicy(compactWin.webContents.session)
}

// ---------------------------------------------------------------- commands

async function doPause(): Promise<SourceHealth> {
  paused = true
  activeRss?.abort()
  enrichQueue.abortActive()
  detailsFetcher.abortActive()
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  nextAttemptAtMs = null
  emitHealth()
  return snapshotHealth()
}

async function doResume(): Promise<SourceHealth> {
  paused = false
  lastStartMs = null
  lastRecovering = wasGap()
  scheduleNext()
  emitHealth()
  return snapshotHealth()
}

async function doPauseKhamsat(): Promise<SourceHealth> {
  khamsatPaused = true
  khamsatAbort?.abort()
  if (khamsatTimer) clearTimeout(khamsatTimer)
  khamsatTimer = null
  khamsatNextAttemptMs = null
  emitKhamsatHealth()
  return snapshotKhamsatHealth()
}

async function doResumeKhamsat(): Promise<SourceHealth> {
  khamsatPaused = false
  scheduleKhamsat(0)
  return snapshotKhamsatHealth()
}

async function doPauseNafezly(): Promise<SourceHealth> {
  nafezlyPaused = true
  nafezlyFacts.abortActive()
  nafezlyAbort?.abort()
  if (nafezlyTimer) clearTimeout(nafezlyTimer)
  nafezlyTimer = null
  nafezlyNextAttemptMs = null
  emitNafezlyHealth()
  return snapshotNafezlyHealth()
}

async function doResumeNafezly(): Promise<SourceHealth> {
  nafezlyPaused = false
  scheduleNafezly(0)
  return snapshotNafezlyHealth()
}

function doQuit(): void {
  if (quitRequested) return
  if (win && !win.isDestroyed()) win.webContents.send(IPC.requestClose, { quit: true })
  else void shutdown()
}

async function shutdown(): Promise<void> {
  if (shutdownWork) return shutdownWork
  quitRequested = true
  notificationActivation.close()
  const closingTelemetry = telemetry?.close()
  paused = true
  khamsatPaused = true
  nafezlyPaused = true
  activeRss?.abort()
  khamsatAbort?.abort()
  nafezlyAbort?.abort()
  const closingKaf = kaf?.close()
  const closingFacts = nafezlyFacts.close()
  const closingAi = aiService?.close()
  const closingBackup = dataBackup?.close()
  const closingSearchCache = searchCache?.close()
  const closingSearch = searchService?.close()
  // Observe rejection immediately while waiting for the other shutdown jobs;
  // awaiting below still propagates a failure before touching the DB file.
  void closingSearch?.catch(() => {})
  void closingSearchCache?.catch(() => {})
  enrichQueue.abortActive()
  detailsFetcher.abortActive()
  if (timer) clearTimeout(timer)
  if (khamsatTimer) clearTimeout(khamsatTimer)
  if (nafezlyTimer) clearTimeout(nafezlyTimer)
  if (enrichTimer) clearInterval(enrichTimer)
  if (updateStartupTimer) clearTimeout(updateStartupTimer)
  if (updateTimer) clearInterval(updateTimer)
  if (notificationCleanupTimer) clearInterval(notificationCleanupTimer)
  updates?.dispose()
  extension?.dispose()
  shutdownWork = (async () => {
  try {
    await closingTelemetry
    while (work.size) await Promise.allSettled([...work])
    if (flushing) await Promise.allSettled([flushing])
    await closingKaf
    await closingFacts
    await closingAi
    await closingBackup
    await closingSearch
    await closingSearchCache
    if (db) {
      const st = getSourceState(db, SOURCE)
      saveSourceState(db, { ...st, runId });
      closeDatabase(db)
    }
  } finally {
    db = null
    quitComplete = true
    app.quit()
  }
  })()
  return shutdownWork
}

// ---------------------------------------------------------------- IPC

function registerIpc(): void {
  const localSender = (event: Electron.IpcMainInvokeEvent): boolean => !quitRequested && (event.sender === win?.webContents || event.sender === compactWin?.webContents)
  const mainSender = (event: Electron.IpcMainInvokeEvent, allowBlocked = false): boolean => event.sender === win?.webContents && !quitRequested && (allowBlocked || applicationAccessAllowed())
  ipcMain.handle(IPC.databaseReady, event => !!(localSender(event) && db?.prepare('SELECT id FROM projects LIMIT 1').all()))
  ipcMain.handle(IPC.getSidebarCounts, async event => {
    if (!localSender(event) || !searchService) throw new Error('search-unavailable')
    return searchReply(Promise.all([
      searchService.page(`${event.sender.id}:sidebar:all`, sanitizeFilterDefinition(legacyToFilterDef({ displayFilter: settings.displayFilter })), 0, 0),
      searchService.page(`${event.sender.id}:sidebar:saved`, { ...defaultFilterDefinition(), scope: 'saved' }, 0, 0)
    ]).then(([all, saved]) => ({ unread: all.unread, saved: saved.total })))
  })
  ipcMain.handle(IPC.matchProjectIds, (event, v) => {
    if (!localSender(event) || !searchService || !Array.isArray(v?.ids) || v.ids.length > 200 || !v.ids.every((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0)) throw new Error('bad-search-request')
    return searchReply(searchService.match(`${event.sender.id}:matches`, sanitizeFilterDefinition(v.definition), [...new Set<number>(v.ids)]))
  })
  ipcMain.handle(IPC.getAnalyticsStatus, async event => {
    if (!localSender(event)) return null
    if (testHarness && telemetry && existsSync(join(app.getPath('userData'), 'telemetry-fixture.json'))) {
      try { if (JSON.parse(readFileSync(join(app.getPath('userData'), 'telemetry-fixture.json'), 'utf8')).flush === true) await telemetry.flushFixture() } catch { /* Scoped fixture only. */ }
    }
    return telemetry?.status() ?? null
  })
  ipcMain.handle(IPC.analyticsConsent, async (event, action: unknown) => {
    if (!mainSender(event, true) || !telemetry || typeof action !== 'string' || !['enable', 'disable', 'later', 'forget'].includes(action)) return { ok: false, error: 'bad-request' }
    try { await telemetry.change(action as 'enable' | 'disable' | 'later' | 'forget'); return { ok: true } }
    catch (error) { return { ok: false, error: error instanceof Error && error.message === 'forget-incomplete' ? 'forget-incomplete' : 'analytics-unavailable' } }
  })
  ipcMain.handle(IPC.analyticsAction, async (event, action: unknown) => {
    if (!mainSender(event, true) || !telemetry) return { ok: false }
    const reference = telemetry.status().reference
    if (action === 'copy-reference' && reference) { if (testHarness) testHarness.record('analytics-copy-reference', true); else clipboard.writeText(reference); return { ok: true } }
    if (action !== 'contact' || !reference) return { ok: false }
    try { if (testHarness) testHarness.record('open-external', ANALYTICS_SUPPORT); else await shell.openExternal(ANALYTICS_SUPPORT); return { ok: true } }
    catch { return { ok: false } }
  })
  ipcMain.handle(IPC.recordUiUsage, (event, surface: unknown) => {
    if (mainSender(event) && typeof surface === 'string' && (UI_SURFACES as readonly string[]).includes(surface)) telemetry?.activity('interface')
  })
  const proposalId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
  const proposalNotes = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000
  ipcMain.handle(IPC.getExtensionStatus,event=>mainSender(event)?extensionSnapshot():null)
  ipcMain.handle(IPC.quickApplyProject,async(event,v:{id?:unknown})=>({ok:!!(mainSender(event)&&proposalId(v?.id)&&await extension?.quick(v.id))}))
  ipcMain.handle(IPC.extensionAction,async(event,v:unknown)=>{
    if(!mainSender(event)||!extension||!record(v))return {ok:false,error:'bad-request'}
    try{
      if(v.action==='prepare'){await extension.prepare();return {ok:true}}
      if(v.action==='folder'){const error=await shell.openPath(extension.setup.folder);return {ok:!error}}
      if(v.action==='copy-path'){clipboard.writeText(extension.setup.folder);return {ok:true}}
      if(v.action==='chrome-extensions'){await launchChrome('chrome://extensions/');return {ok:true}}
      if(v.action==='cancel'){extension.cancel();return {ok:true}}
      if(v.action==='approve'&&nonce(v.id)&&typeof v.code==='string'&&typeof v.label==='string')return {ok:extension.approve(v.id,v.code,v.label)}
      if(v.action==='select'&&nonce(v.id))return {ok:extension.select(v.id)}
      if(v.action==='revoke'&&nonce(v.id)){const ok=extension.revoke(v.id);if(!extension.available())saveSettings({...settings,quickApply:{...settings.quickApply,enabled:false}});return {ok}}
      return {ok:false,error:'bad-request'}
    }catch{return {ok:false,error:'extension-action-failed'}}
  })
  ipcMain.handle(IPC.getProposalSetup, event => {
    if (!mainSender(event) || !db || !aiService) return null
    const setup = aiService.setup()
    return { hasKey: setup.providers[setup.settings.activeProvider].hasKey, profile: getProposalProfile(db) }
  })
  ipcMain.handle(IPC.getAiSetup, event => mainSender(event) ? aiService?.setup() : null)
  ipcMain.handle(IPC.saveAiSettings, (event, v) => ({ ok: !!(mainSender(event) && db && saveAiSettings(db, v?.settings)) }))
  ipcMain.handle(IPC.saveAiKey, (event, v) => {
    const ok = !!(mainSender(event) && isAiProvider(v?.provider) && aiService?.saveKey(v.provider, v?.key))
    return { ok, error: ok ? undefined : 'key-save-failed' }
  })
  ipcMain.handle(IPC.deleteAiKey, (event, v) => {
    const ok = !!(mainSender(event) && isAiProvider(v?.provider) && aiService?.deleteKey(v.provider))
    return { ok, error: ok ? undefined : 'key-save-failed' }
  })
  ipcMain.handle(IPC.listAiModels, (event, v) => mainSender(event) && isAiProvider(v?.provider) && aiService ? aiService.listModels(v.provider) : { ok: false, error: 'bad-request' })
  ipcMain.handle(IPC.testAiModel, (event, v) => {
    const selection = sanitizeSelection(v?.selection)
    return mainSender(event) && selection && aiService ? aiService.test(selection) : { ok: false, error: 'bad-request' }
  })
  ipcMain.handle(IPC.saveProposalProfile, (event, v: { profile?: unknown }) => ({ ok: !!(mainSender(event) && db && saveProposalProfile(db, v?.profile)) }))
  const selectionFor = (value: unknown) => {
    if (value !== undefined) return sanitizeSelection(value)
    const setup = aiService?.setup()
    return setup ? sanitizeSelection({ provider: setup.settings.activeProvider, model: setup.settings.modelByProvider[setup.settings.activeProvider] }) : null
  }
  ipcMain.handle(IPC.getProposalPreview, (event, v) => {
    const selection = selectionFor(v?.selection)
    return mainSender(event) && proposalId(v?.id) && proposalNotes(v?.projectNotes) && selection ? aiService?.preview(v.id, v.projectNotes, selection) : null
  })
  ipcMain.handle(IPC.generateProposal, async (event, v) => {
    const selection = selectionFor(v?.selection)
    if (!(mainSender(event) && proposalId(v?.id) && proposalNotes(v?.projectNotes) && typeof v?.fingerprint === 'string' && v.fingerprint.length === 64 && selection && aiService)) return { ok: false, error: 'bad-request' }
    const result = await aiService.generate(v.id, v.projectNotes, v.fingerprint, selection)
    if (result.ok) emitProjects([], [v.id])
    return result
  })
  ipcMain.handle(IPC.cancelProposal, event => { if (mainSender(event)) aiService?.cancel() })
  ipcMain.handle(IPC.getProposalDraft, (event, v: { id?: unknown }) => mainSender(event) && db && proposalId(v?.id) ? getProposalDraft(db, v.id) : null)
  ipcMain.handle(IPC.saveProposalDraft, (event, v: { draft?: ProposalDraft }) => {
    const draft = v?.draft
    if (!mainSender(event) || !db || !draft || !proposalId(draft.projectId) || !getProjectById(db, draft.projectId) || typeof draft.proposal !== 'string' || draft.proposal.length > 12000 || !Array.isArray(draft.assumptions) || !Array.isArray(draft.questions)) return { ok: false, error: 'bad-draft' }
    const existing = getProposalDraft(db, draft.projectId)
    saveProposalDraft(db, { provider: existing?.provider, model: existing?.model, promptVersion: existing?.promptVersion, generatedAt: existing?.generatedAt, projectId: draft.projectId, proposal: draft.proposal, assumptions: draft.assumptions.filter(x => typeof x === 'string').slice(0, 8).map(x => x.slice(0, 400)), questions: draft.questions.filter(x => typeof x === 'string').slice(0, 8).map(x => x.slice(0, 400)), updatedAt: new Date().toISOString() })
    emitProjects([], [draft.projectId])
    return { ok: true }
  })
  ipcMain.handle(IPC.deleteProposalDraft, (event, v: { id?: unknown }) => { if (!mainSender(event) || !db || !proposalId(v?.id)) return { ok: false }; deleteProposalDraft(db, v.id); emitProjects([], [v.id]); return { ok: true } })
  ipcMain.handle(IPC.getUpdateState, () => updates?.snapshot())
  ipcMain.handle(IPC.checkUpdate, event => mainSender(event) ? updates?.check() : { ok: false, error: 'not-main' })
  ipcMain.handle(IPC.downloadUpdate, event => mainSender(event) ? updates?.download() : { ok: false, error: 'not-main' })
  ipcMain.handle(IPC.installUpdate, event => {
    if (!mainSender(event) || updates?.snapshot().phase !== 'downloaded') return { ok: false, error: 'not-downloaded' }
    updateInstallRequested = true
    win?.webContents.send(IPC.requestUpdateInstall)
    return { ok: true }
  })
  ipcMain.handle(IPC.confirmUpdateInstall, event => {
    if (!mainSender(event) || !updateInstallRequested) return { ok: false, error: 'not-requested' }
    updateInstallRequested = false
    return updates?.install()
  })
  ipcMain.handle(IPC.confirmClose, (event, v: { quit: boolean }) => {
    if (event.sender !== win?.webContents) return
    if (v.quit === true || !applicationAccessAllowed()) return shutdown()
    win?.hide()
    if (!hintShown) {
      hintShown = true
      tray?.displayBalloon({
        title: 'RASED',
        content: settings.language === 'ar' ? 'راصد مستمر في الخلفية. الخروج الكامل من قائمة الأيقونة.' : 'RASED keeps watching in the background. Quit from the tray menu.'
      })
    }
  })
  ipcMain.handle(IPC.getProjects, async (_e, q: ProjectQuery) => {
    if (!localSender(_e) || !db || !searchService) throw new Error('search-unavailable')
    const limit = Math.min(200, Math.max(1, Math.floor(q.limit) || 50))
    const offset = Math.min(10_000_000, Math.max(0, Math.floor(q.offset) || 0))
    const categories = Array.isArray(q.categories) ? q.categories.filter((c): c is string => typeof c === 'string').slice(0, 20) : undefined
    const definition = sanitizeFilterDefinition(legacyToFilterDef({
      unreadOnly: q.unreadOnly === true,
      search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
      categories,
      displayFilter: settings.displayFilter
    }))
    // Display on demand: when the user explicitly filters by category,
    // gradually enrich unconfirmed projects (bounded; claimed as pending
    // so repeated queries never re-enqueue). Baseline lists stay untouched.
    if (categories && categories.length > 0) {
      const ids = getUnenrichedNewIds(db, 50).slice(0, 5)
      if (ids.length > 0) {
        markEnrichmentPending(db, ids)
        for (const id of ids) {
          const p = getProjectById(db, id)
          if (p) enrichQueue.enqueue(id, p.url)
        }
        void trackWork(enrichQueue.pump())
      }
    }
    return (await searchService.page(`${_e.sender.id}:legacy`, definition, limit, offset)).rows
  })
  ipcMain.handle(IPC.getProjectCount, (_e, q: Omit<ProjectQuery, 'limit' | 'offset'>) => {
    if (!localSender(_e) || !searchService) throw new Error('search-unavailable')
    const definition = sanitizeFilterDefinition(legacyToFilterDef({
      unreadOnly: q.unreadOnly === true,
      search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
      categories: Array.isArray(q.categories) ? q.categories.filter((c): c is string => typeof c === 'string').slice(0, 20) : undefined,
      displayFilter: settings.displayFilter
    }))
    return searchService.page(`${_e.sender.id}:counts`, definition, 0, 0).then(({ total, unread }) => ({ total, unread }))
  })
  ipcMain.handle(IPC.setReadState, (_e, v: { id: number; read: boolean }) => {
    if (!db || !Number.isInteger(v.id) || typeof v.read !== 'boolean') return
    setReadState(db, v.id, v.read)
    auditUi(`set-read id=${v.id} read=${v.read}`)
    emitProjects([], [v.id])
  })
  ipcMain.handle(IPC.markAllRead, () => {
    if (!db) return 0
    const changed = (db.prepare('SELECT id FROM projects WHERE read_at IS NULL').all() as unknown as { id: number }[]).map(p => p.id)
    const n = markAllRead(db)
    auditUi(`mark-all-read n=${n}`)
    emitProjects([], changed)
    return n
  })
  ipcMain.handle(IPC.getSettings, () => settings)
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<AppSettings>) => {
    if (!localSender(_e)) throw new Error('untrusted-sender')
    if (patch?.quickApply !== undefined && !validQuickApply(patch.quickApply)) throw new Error('invalid-quick-apply-settings')
    if(patch?.quickApply?.enabled&&!extension?.available())throw Error('extension-not-paired')
    const p = (patch ?? {}) as Partial<AppSettings>
    const next = mergeSettings(settings, p)
    saveSettings(next)
    compactWin?.setAlwaysOnTop(next.ui.compactAlwaysOnTop)
    emitHealth()
    return next
  })
  ipcMain.handle(IPC.getHealth, () => snapshotHealth())
  ipcMain.handle(IPC.getKhamsatHealth, () => snapshotKhamsatHealth())
  ipcMain.handle(IPC.getNafezlyHealth, () => snapshotNafezlyHealth())
  ipcMain.handle(IPC.getKafHealth, () => snapshotKafHealth())
  ipcMain.handle(IPC.acknowledgeSourceGap, (e, source: unknown) => {
    if (!localSender(e) || !isSourceId(source) || !db) return { ok: false, error: 'bad-source' }
    acknowledgeMonitoringGap(db, source)
    emitHealth(); emitKhamsatHealth(); emitNafezlyHealth()
    broadcast(IPC.kafHealthChanged, snapshotKafHealth())
    return { ok: true }
  })
  ipcMain.handle(IPC.copyMonitoringReport, e => {
    if (!localSender(e)) return { ok: false, error: 'untrusted-sender' }
    const health = { mostaql: snapshotHealth(), khamsat: snapshotKhamsatHealth(), nafezly: snapshotNafezlyHealth(), kaf: snapshotKafHealth() }
    const report = monitoringReport(APP_VERSION, SOURCES.map(source => ({ id: source.id, health: health[source.id] })))
    if (testHarness) testHarness.record('monitoring-report', report)
    else clipboard.writeText(report)
    return { ok: true }
  })
  ipcMain.handle(IPC.pauseKaf, e => { if (!localSender(e)) throw Error('untrusted-sender'); return kaf?.setPaused(true) })
  ipcMain.handle(IPC.resumeKaf, e => { if (!localSender(e)) throw Error('untrusted-sender'); return kaf?.setPaused(false) })
  ipcMain.handle(IPC.pause, () => doPause())
  ipcMain.handle(IPC.resume, () => doResume())
  ipcMain.handle(IPC.pauseKhamsat, () => doPauseKhamsat())
  ipcMain.handle(IPC.resumeKhamsat, () => doResumeKhamsat())
  ipcMain.handle(IPC.pauseNafezly, () => doPauseNafezly())
  ipcMain.handle(IPC.resumeNafezly, () => doResumeNafezly())
  ipcMain.handle(IPC.refresh, () => {
    void kaf?.poll()
    void trackWork(runKhamsatCycle())
    void trackWork(runNafezlyCycle())
    return trackWork(runCycle())
  })
  ipcMain.handle(IPC.openProject, (_e, v: { id: number }) => {
    if (!Number.isInteger(v.id)) return { ok: false, error: 'bad-id' }
    return openProjectById(v.id, false)
  })
  ipcMain.handle(IPC.openProjectExternal, (_e, v: { id: number }) => {
    if (!v || !Number.isSafeInteger(v.id) || v.id <= 0) return { ok: false, error: 'bad-id' }
    return openProjectById(v.id, false)
  })
  ipcMain.handle(IPC.getDiagnostics, (_e, v: { limit?: number }) => {
    if (!db) return []
    const limit = Math.min(200, Math.max(1, Math.floor(v?.limit ?? 50) || 50))
    return listDiagnostics(db, limit)
  })

  // ---- v2: personal data, details, saved filters, DND, data management ----
  ipcMain.handle(IPC.getProject, (_e, v: { id: number }) => {
    if (!db || !Number.isInteger(v.id)) return null
    const p = getProjectById(db, v.id)
    if (!p) return null
    const u = getUserState(db, v.id)
    const out: ProjectFull = {
      ...p,
      saved: u.savedAt !== null,
      hidden: u.hiddenAt !== null,
      personalStatus: u.status,
      hasNote: u.note !== '',
      note: u.note
    }
    return out
  })
  ipcMain.handle(IPC.getProjectDetails, (_e, v: { id: number }) => {
    if (!db || !Number.isInteger(v.id)) return null
    if (!getProjectById(db, v.id)) return null
    return getProjectDetailsRow(db, v.id)
  })
  ipcMain.handle(IPC.getProjectFacts, (event, v: { id?: unknown }) => localSender(event) && Number.isSafeInteger(v?.id) ? snapshotProjectFacts(v.id as number) : null)
  ipcMain.handle(IPC.requestProjectFacts, (event, v: { id?: unknown; force?: unknown }) => localSender(event) && Number.isSafeInteger(v?.id) ? requestFacts(v.id as number, v.force === true) : null)
  ipcMain.handle(IPC.requestProjectDetails, (_e, v: { id: number; force?: boolean }) => {
    if (!db || !Number.isInteger(v.id)) return null
    const p = getProjectById(db, v.id)
    if (!p) return null
    if (p.source === 'kaf') return kaf?.requestDetails(v.id, v.force === true) ?? getProjectDetailsRow(db, v.id)
    if (p.source === KHAMSAT_SOURCE || p.source === NAFEZLY_SOURCE) return getProjectDetailsRow(db, v.id)
    const row = detailsFetcher.request(v.id, p.url, v.force === true)
    void trackWork(detailsFetcher.pump())
    return row
  })
  ipcMain.handle(IPC.updateProjectUserState, (_e, v: { id: number; patch: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' } satisfies MutationResult
    if (!Number.isInteger(v.id)) return { ok: false, error: 'bad-id' } satisfies MutationResult
    const patch = sanitizeUserStatePatch(v.patch)
    if (!patch || Object.keys(patch).length === 0) return { ok: false, error: 'bad-patch' } satisfies MutationResult
    const d: Db = db
    const applied = runInTransaction(d, () => updateUserState(d, v.id, patch))
    if (!applied) return { ok: false, error: 'unknown-project' } satisfies MutationResult
    if ('saved' in patch && patch.saved) telemetry?.record('feature_used', { feature: 'bookmark', outcome: 'success' })
    auditUi(`user-state id=${v.id} ${Object.keys(patch).join(',')}`)
    emitProjects([], [v.id])
    return { ok: true } satisfies MutationResult
  })
  ipcMain.handle(IPC.getSavedFilters, () => (db ? listSavedFilters(db) : []))
  ipcMain.handle(IPC.createSavedFilter, (_e, v: { name: unknown; definition: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' }
    if (typeof v.name !== 'string' || v.name.trim().length === 0 || v.name.trim().length > 80) {
      return { ok: false, error: 'bad-name' }
    }
    const def = sanitizeFilterDefinition(v.definition)
    const now = new Date().toISOString()
    const taken = new Set(listSavedFilters(db).map((f) => f.id))
    let id = `sf_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    while (taken.has(id)) id = `sf_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const row: SavedFilter = { id, name: v.name.trim(), definition: def, createdAt: now, updatedAt: now }
    saveSavedFilterRow(db, row)
    telemetry?.record('feature_used', { feature: 'saved_filter', outcome: 'success' })
    auditUi(`filter-create ${id}`)
    return { ok: true, id }
  })
  ipcMain.handle(IPC.updateSavedFilter, (_e, v: { id: unknown; name: unknown; definition: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' }
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v.id)) return { ok: false, error: 'bad-id' }
    if (typeof v.name !== 'string' || v.name.trim().length === 0 || v.name.trim().length > 80) {
      return { ok: false, error: 'bad-name' }
    }
    const existing = listSavedFilters(db).find((f) => f.id === v.id)
    if (!existing) return { ok: false, error: 'not-found' }
    saveSavedFilterRow(db, {
      id: v.id,
      name: v.name.trim(),
      definition: sanitizeFilterDefinition(v.definition),
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    })
    auditUi(`filter-update ${v.id}`)
    return { ok: true }
  })
  ipcMain.handle(IPC.deleteSavedFilter, (_e, v: { id: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' }
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v.id)) return { ok: false, error: 'bad-id' }
    if (!deleteSavedFilterRow(db, v.id)) return { ok: false, error: 'not-found' }
    auditUi(`filter-delete ${v.id}`)
    return { ok: true }
  })
  ipcMain.handle(IPC.previewFilterCount, (_e, v: { definition: unknown }) => {
    if (!localSender(_e) || !searchService) throw new Error('search-unavailable')
    const def = sanitizeFilterDefinition(v.definition)
    return searchReply(searchService.page(`${_e.sender.id}:preview:${def.scope}`, def, 0, 0).then(({ total, unread }) => ({ total, unread })))
  })
  ipcMain.handle(IPC.queryProjectsPage, (_e, v: { definition: unknown; limit: unknown; offset: unknown; window?: { ceilingId?: unknown } }) => {
    if (!localSender(_e) || !db || !searchService) throw new Error('search-unavailable')
    const def = sanitizeFilterDefinition(v.definition)
    const limit = Math.min(200, Math.max(1, Math.floor(v.limit as number) || 50))
    const offset = Math.min(10_000_000, Math.max(0, Math.floor(Number(v.offset)) || 0))
    const ceilingId = Number.isSafeInteger(v.window?.ceilingId) && Number(v.window?.ceilingId) >= 0 ? Number(v.window?.ceilingId) : undefined
    if (def.categoryFilter.mode === 'selected' || def.budgetMin !== null || def.budgetMax !== null || !def.includeUnknownBudget) {
      const ids = getUnenrichedNewIds(db, 50).slice(0, 5)
      markEnrichmentPending(db, ids)
      for (const id of ids) { const p = getProjectById(db, id); if (p) enrichQueue.enqueue(id, p.url) }
      void trackWork(enrichQueue.pump())
    }
    return searchReply(searchService.page(`${_e.sender.id}:page:${def.scope}`, def, limit, offset, { ceilingId }))
  })
  ipcMain.handle(IPC.testNotification, () => sendTestNotification())
  ipcMain.handle(IPC.openWindowsNotificationSettings, async event => {
    if (!mainSender(event) || process.platform !== 'win32') return { ok: false, error: 'unavailable' }
    try {
      if (testHarness) testHarness.record('open-system-settings', 'ms-settings:quiethours')
      else await shell.openExternal('ms-settings:quiethours')
      return { ok: true }
    } catch {
      return { ok: false, error: 'open-failed' }
    }
  })
  ipcMain.handle(IPC.testSound, () => {
    win?.webContents.send(IPC.playBeep)
  })
  ipcMain.handle(IPC.setDnd, (_e, v: { untilIso: unknown }) => {
    let until: string | null = null
    if (typeof v.untilIso === 'string' && v.untilIso.length <= 40) {
      const t = Date.parse(v.untilIso)
      if (!Number.isNaN(t) && t > Date.now()) until = new Date(t).toISOString()
    }
    saveSettings({ ...settings, doNotDisturbUntil: until })
    auditUi(until ? `dnd-until ${until}` : 'dnd-off')
    emitHealth()
    return settings
  })
  ipcMain.handle(IPC.openDataFolder, () => {
    void shell.openPath(app.getPath('userData')).then((err) => {
      if (err && db) {
        recordDiagnostic(db, {
          at: new Date().toISOString(),
          endpointKind: 'app',
          status: 'open-data-folder-failed',
          durationMs: 0,
          itemCount: null,
          errorCategory: 'os',
          detail: err.slice(0, 200)
        })
      }
    })
    return { ok: true } satisfies MutationResult
  })
  ipcMain.handle(IPC.getDataStatus, event => mainSender(event) ? dataBackup?.status() : null)
  ipcMain.handle(IPC.setBackupPreferences, (event, value) => ({ ok: !!(mainSender(event) && dataBackup?.preferences(value?.preferences)) }))
  ipcMain.handle(IPC.createBackup, async event => {
    if (!mainSender(event) || !dataBackup || quitRequested) return { ok: false, error: 'busy' }
    let chosen: string | null
    try { chosen = await chooseDataFile('save-backup') } catch (error) { return { ok: false, error: backupError(error, 'write-failed') } }
    if (!chosen) return { ok: false }
    try { await dataBackup.create(chosen); telemetry?.record('feature_used', { feature: 'backup_created', outcome: 'success' }); auditUi('backup-created'); return { ok: true, path: chosen } }
    catch (error) { telemetry?.record('feature_used', { feature: 'backup_created', outcome: 'failed' }); return { ok: false, error: backupError(error, 'write-failed') } }
  })
  ipcMain.handle(IPC.validateRestore, async event => {
    if (!mainSender(event) || !dataBackup || quitRequested) return { ok: false, error: 'busy' }
    let chosen: string | null
    try { chosen = await chooseDataFile('open-backup') } catch (error) { return { ok: false, error: backupError(error, 'read-failed') } }
    if (!chosen) return { ok: false }
    try { return await dataBackup.validate(chosen) } catch (error) { return { ok: false, error: backupError(error) } }
  })
  ipcMain.handle(IPC.cancelRestore, event => { if (mainSender(event)) dataBackup?.discard() })
  ipcMain.handle(IPC.applyRestore, async (event, value) => {
    if (!mainSender(event) || !dataBackup || quitRequested || typeof value?.token !== 'string' || typeof value?.applyStartup !== 'boolean') return { ok: false, error: 'bad-request' }
    try {
      await dataBackup.stage(value.token, value.applyStartup)
      await telemetry?.reset()
        telemetry?.record('feature_used', { feature: 'restore_requested', outcome: 'success' })
      setTimeout(() => {
        if (testHarness) testHarness.record('restore-restart', true)
        else app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== '--updated' && !arg.startsWith('rased:')) })
        doQuit()
      }, 150)
      return { ok: true }
    } catch (error) { return { ok: false, error: backupError(error) } }
  })
  ipcMain.handle(IPC.openBackupFolder, async event => {
    if (!mainSender(event)) return { ok: false }
    const folder = join(app.getPath('userData'), 'backups')
    mkdirSync(folder, { recursive: true })
    if (testHarness) { testHarness.record('open-backup-folder', folder); return { ok: true } }
    return { ok: !(await shell.openPath(folder)) }
  })
  ipcMain.handle(IPC.exportSettings, async event => {
    if (!mainSender(event) || !db || quitRequested) return { ok: false, error: 'no-window' }
    let chosen: string | null
    try { chosen = await chooseDataFile('save-settings') } catch (error) { return { ok: false, error: backupError(error, 'write-failed') } }
    if (!chosen) return { ok: false }
    try {
      if (quitRequested || !db) return { ok: false, error: 'busy' }
      const text = JSON.stringify(settingsPayload(db, settings), null, 2)
      if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) return { ok: false, error: 'too-large' }
      const temporary = chosen + '.' + randomUUID() + '.tmp'
      try { writeFileSync(temporary, text, 'utf-8'); renameSync(temporary, chosen) }
      finally { rmSync(temporary, { force: true }) }
    } catch {
      return { ok: false, error: 'write-failed' }
    }
    auditUi('settings-export')
    return { ok: true, path: chosen }
  })
  ipcMain.handle(IPC.validateImport, event => mainSender(event) ? validateSettingsImport() : { ok: false, error: 'bad-request' })
  ipcMain.handle(IPC.applyImport, (event, v: { mode: unknown; applyStartup: unknown }) => mainSender(event) ? applySettingsImport(v?.mode, v?.applyStartup === true) : { ok: false, error: 'bad-request' })
  ipcMain.handle(IPC.purgeHistoryPreview, (_e, v: { cutoffIso: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' } satisfies PurgePreview
    if (typeof v.cutoffIso !== 'string' || Number.isNaN(Date.parse(v.cutoffIso))) {
      return { ok: false, error: 'bad-cutoff' } satisfies PurgePreview
    }
    return { ok: true, affected: countPurgeable(db, new Date(v.cutoffIso).toISOString(), PURGE_KINDS) } satisfies PurgePreview
  })
  ipcMain.handle(IPC.purgeHistoryApply, async (_e, v: { cutoffIso: unknown }) => {
    if (!db || !dataBackup || quitRequested) return { ok: false, error: 'no-db' } satisfies PurgePreview
    if (typeof v.cutoffIso !== 'string' || Number.isNaN(Date.parse(v.cutoffIso))) {
      return { ok: false, error: 'bad-cutoff' } satisfies PurgePreview
    }
    const d: Db = db
    const backupDir = join(app.getPath('userData'), 'backups')
    const backupPath = join(backupDir, `rased-before-purge-${Date.now()}.rased-backup`)
    try {
      await dataBackup.create(backupPath)
    } catch {
      return { ok: false, error: 'backup-failed' } satisfies PurgePreview
    }
    if (quitRequested || !db) return { ok: false, error: 'busy' }
    const iso = new Date(v.cutoffIso).toISOString()
    const victims = d.prepare(`SELECT p.id FROM projects p LEFT JOIN project_user_state u ON u.project_id=p.id WHERE p.first_seen_at < ? AND u.saved_at IS NULL AND COALESCE(u.note,'')='' AND COALESCE(u.personal_status,'none') NOT IN ('interested','submitted')`).all(iso) as unknown as { id: number }[]
    for (const { id } of victims) { detailsFetcher.drop(id); enrichQueue.drop(id); uncertainWaits.delete(id) }
    const { deleted } = runInTransaction(d, () => purgeHistory(d, iso, PURGE_KINDS))
    auditUi(`purge deleted=${deleted} backup=${backupPath}`)
    recordDiagnostic(d, {
      at: new Date().toISOString(),
      endpointKind: 'app',
      status: 'purge',
      durationMs: 0,
      itemCount: deleted,
      errorCategory: null,
      detail: backupPath.slice(-120)
    })
    emitProjects([], victims.map(p => p.id))
    return { ok: true, affected: deleted, deleted, backupPath } satisfies PurgePreview & { deleted?: number }
  })
  ipcMain.handle(IPC.windowControl, (event, value: { action?: unknown } | null) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || (target !== win && target !== compactWin)) return
    if (value?.action === 'minimize') target.minimize()
    else if (value?.action === 'maximize') { if (target.isMaximized()) target.unmaximize(); else target.maximize() }
    else if (value?.action === 'close') target.close() // existing draft guard/tray policy remains authoritative
  })
  ipcMain.handle(IPC.getWindowState, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    return { maximized: target?.isMaximized() ?? false, minimized: target?.isMinimized() ?? false }
  })
  ipcMain.handle(IPC.openAboutLink, async (_event, value: unknown): Promise<MutationResult> => {
    const link = value && typeof value === 'object' ? (value as { link?: unknown }).link : null
    if (typeof link !== 'string' || !Object.hasOwn(ABOUT_LINKS, link)) return { ok: false, error: 'bad-link' }
    try {
      const url = ABOUT_LINKS[link as AboutLink]
      if (testHarness) testHarness.record('open-external', url)
      else await shell.openExternal(url)
      return { ok: true }
    } catch { return { ok: false, error: 'open-failed' } }
  })
  ipcMain.handle(IPC.getAppInfo, () => ({ version: APP_VERSION, platform: process.platform, arch: process.arch }))
  ipcMain.handle(IPC.openCompact, () => {
    openCompact()
  })
  ipcMain.handle(IPC.closeCompact, () => {
    compactWin?.close()
  })
  ipcMain.handle(IPC.setAlwaysOnTop, (_e, v: { on: unknown }) => {
    const on = v.on === true
    saveSettings({ ...settings, ui: { ...settings.ui, compactAlwaysOnTop: on } })
    compactWin?.setAlwaysOnTop(on)
  })
  ipcMain.handle(IPC.showProjectInMain, (_e, v: { id: number }) => {
    if (!Number.isInteger(v.id)) return
    // Compact never navigates itself: the main window owns the route.
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    win?.webContents.send(IPC.navigate, { hash: `#/project/${v.id}` })
  })
}

// ---------------------------------------------------------------- boot

let startupStage: 'database' | 'later' = 'database'
async function boot(): Promise<void> {
  if (!singleInstance) {
    app.quit()
    return
  }
  await app.whenReady()

  if (process.platform === 'win32') {
    if (testHarness) nativeActivationReady = true
    else {
      // Match the distinct EXE ProductName set by run-desktop.mjs. Electron's
      // native shortcut name comes from that metadata, not app.name itself.
      if (!IS_PACKAGED) {
        const userData = app.getPath('userData')
        app.setName('RASED Development')
        app.setPath('userData', userData)
      }
      try {
        // The presenter registers the COM class used by a cold toast launch.
        // handleActivation alone only installs the JS callback in Electron 44.
        if (!Notification.isSupported()) throw Error('notifications-unavailable')
        Notification.handleActivation(details => {
          if (parseNotificationActivation(details.arguments, activationScheme)) dispatchNotificationActivation(details.arguments)
        })
        if (!IS_PACKAGED) {
          await ensureDevelopmentComRegistration({ version: 1, executable: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData'), appId: RASED_DEV_APP_ID, relay: join(__dirname, 'developmentRelay.js') }, join(app.getPath('userData'), 'notifications', 'development-activation.json'), join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), windowsRegistrationPort(() => app.toastActivatorCLSID, path => shell.readShortcutLink(path)))
        }
        nativeActivationReady = true
      } catch { auditUi('native-notification-activation-unavailable') }
    }
  }

  if (process.platform === 'win32' && !testHarness) {
    const windowsShortcuts = join(app.getPath('appData'), 'Microsoft', 'Windows')
    for (const folder of [join(windowsShortcuts, 'Start Menu', 'Programs'), join(windowsShortcuts, 'Start Menu', 'Programs', 'RASED'), join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')]) {
      try {
        for (const entry of readdirSync(folder)) {
          if (entry.toLowerCase().endsWith('.lnk')) repairLegacyDevShortcut(join(folder, entry), shell)
        }
      } catch { /* A missing shortcut folder is normal on a fresh installation. */ }
    }
  }

  try { db = await openDatabaseAtStartup(join(app.getPath('userData'), 'rased.db'), undefined, undefined, process.platform, (code, attempt) => testHarness?.record('startup-db-retry', { code, attempt })) }
  catch (error) {
    if (!isCorruptDatabaseError(error)) throw error
    let archive: string | null = null
    if (testHarness) archive = await chooseDataFile('open-backup')
    else {
      const answer = await dialog.showMessageBox({ type: 'error', title: 'RASED — استعادة البيانات / Data recovery', message: 'تعذر قراءة قاعدة البيانات. يمكنك اختيار نسخة راصد احتياطية لاستعادتها. ستُحفظ الملفات القديمة دون حذف.\nThe database cannot be read. Choose a RASED backup to recover. Original files will be preserved.', buttons: ['اختيار نسخة / Choose backup', 'إغلاق / Close'], defaultId: 1, cancelId: 1, noLink: true })
      if (answer.response === 0) {
        const chosen = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'RASED backup', extensions: ['rased-backup'] }] })
        archive = chosen.canceled ? null : chosen.filePaths[0] ?? null
      }
    }
    if (!archive) { app.quit(); return }
    try {
      const info = inspectBackup(archive)
      if (!testHarness) {
        const answer = await dialog.showMessageBox({ type: 'warning', title: 'RASED — تأكيد الاستعادة / Confirm recovery', message: `المشاريع: ${info.counts.projects} · الملاحظات: ${info.counts.notes} · المسودات: ${info.counts.drafts}\n${info.manifest.createdAt}\nسيُستعاد الأرشيف والإعدادات مع حفظ الملفات التالفة دون حذف.\nRestore this archive and settings? Original damaged files will be preserved.`, buttons: ['استعادة / Restore', 'إلغاء / Cancel'], defaultId: 1, cancelId: 1, noLink: true })
        if (answer.response !== 0) { app.quit(); return }
      }
      db = await recoverCorruptDatabase(app.getPath('userData'), archive)
    }
    catch {
      if (!testHarness) await dialog.showMessageBox({ type: 'error', title: 'RASED', message: 'تعذرت الاستعادة. الملفات القديمة لم تُحذف. اختر نسخة سليمة وأعد المحاولة.\nRecovery failed. Original files were kept. Choose a valid backup and retry.' })
      app.quit(); return
    }
  }
  startupStage = 'later'
  await recoverPendingRestore(db, app.getPath('userData'), APP_VERSION, finalizeBackupInWorker)
  const searchPath = join(app.getPath('userData'), 'rased.db')
  searchService = new SearchService(searchPath, join(__dirname, 'searchReader.js'), () => !!db && !searchCacheReady(db))
  searchCache = new SearchCacheBuilder(searchPath, join(__dirname, 'searchCacheWriter.js'), () => !!db && !quitRequested && !searchCacheReady(db))
  searchCache.start()
  dataBackup = new DataBackupManager(db, app.getPath('userData'), APP_VERSION, Date.now, finalizeBackupInWorker)
  dataBackup.start()
  settings = loadSettings()
  startupStage = 'later'
  if (testHarness && existsSync(join(app.getPath('userData'), 'startup-failure.json'))) throw Error('synthetic startup failure')
  telemetry = new TelemetryService({ root: app.getPath('userData'), entry: telemetryWorkerEntry(__dirname), version: APP_VERSION, language: settings.language, windowsFamily: Number(osRelease().split('.')[2]) >= 22000 ? '11' : process.platform === 'win32' ? '10' : 'other', config: telemetryConfig(IS_PACKAGED, !!testHarness), fixture: !!testHarness && existsSync(join(app.getPath('userData'), 'telemetry-fixture.json')), changed: () => { if (telemetry && !quitRequested) { syncAnalyticsAccess(); broadcast(IPC.analyticsChanged, telemetry.status()) } } })
  telemetry.start(notificationBoot)
  aiService = new AiService(db, app.getPath('userData'), testHarness?.aiFetchImpl, auditUi, result => telemetry?.record('proposal_result', result))
  cleanupNotificationActivations(db)
  notificationCleanupTimer = setInterval(() => { if (!quitRequested && db?.isOpen) cleanupNotificationActivations(db) }, 60 * 60 * 1000)
  notificationCleanupTimer.unref()
  if (!testHarness) await browserLauncher.prepare()
  if (applicationAccessAllowed()) await notificationActivation.start()
  for (const arg of process.argv) if (parseNotificationActivation(arg, activationScheme)) dispatchNotificationActivation(arg)
  // Retire only the old embedded-browser profiles, leaving all other app data intact.
  try {
    await retireQuickBrowser(app.getPath('userData'))
    db.exec('DELETE FROM quick_apply_tickets')
  } catch {
    recordDiagnostic(db, { at: new Date().toISOString(), endpointKind: 'quick-apply', status: 'retirement-failed', durationMs: 0, itemCount: null, errorCategory: 'legacy-browser-cleanup-failed', detail: null })
  }
  try{
    extension=new ExtensionBroker(db,join(app.getPath('userData'),'chrome-link'),IS_PACKAGED?process.resourcesPath:join(__dirname,'../../resources'),()=>applicationAccessAllowed() ? settings : { ...settings, quickApply: { ...settings.quickApply, enabled: false } },extensionChanged,()=>launchChrome(),testHarness?'com.rased.quick_apply_integration':undefined)
    await extension.start()
  }catch{extension?.dispose();extension=null;auditUi('extension-bridge-unavailable')}
  if(settings.quickApply.enabled&&!extension?.available())saveSettings({...settings,quickApply:{...settings.quickApply,enabled:false}})
  if(!testHarness){
    const protocolReady=IS_PACKAGED?app.setAsDefaultProtocolClient(activationScheme):app.setAsDefaultProtocolClient(activationScheme,process.execPath,[app.getAppPath()])
    if (extension) extension.protocolReady = protocolReady
  }
  if (testHarness) { paused = true; khamsatPaused = true; nafezlyPaused = true }
  const savedState = getSourceState(db, SOURCE)
  const savedBackoff = savedState.backoffUntil ? Date.parse(savedState.backoffUntil) : NaN
  if (Number.isFinite(savedBackoff) && savedBackoff > Date.now()) {
    sched = { ...sched, backoffUntilMs: savedBackoff, consecutiveFailures: savedState.consecutiveFailures, needsReview: savedState.lastError === 'forbidden' || savedState.lastError === 'http-403' || savedState.lastError === 'http-401' }
  }
  const nafezlyState = getSourceState(db, NAFEZLY_SOURCE)
  if (nafezlyState.lastError && /(?:403|429|content type)/i.test(nafezlyState.lastError)) nafezlyBaseIntervalMs = 60_000
  for (const [id, deadline] of listClassificationWaits(db)) uncertainWaits.set(id, deadline)
  for (const [id, deadline] of uncertainWaits) {
    if (deadline > Date.now()) {
      const p = getProjectById(db, id)
      if (p && !p.categoryConfirmed) enrichQueue.enqueue(id, p.url)
    }
  }
  if (!getSettingRaw(db, 'app')) saveSettings(settings)
  applyAutoStart()

  // Crash recovery for notification bookkeeping (never auto-resends).
  recordDiagnosticSafe()
  recoverPreviousSession(db, sessionId, new Date().toISOString())
  // Rows stuck in details-loading can never complete; make them retryable.
  resetStaleLoadingDetails(db)

  // Optional capture harness (screenshots): env-gated, no production surface.
  const captureLang = process.env['RASED_CAPTURE_LANG']
  if (captureLang === 'ar' || captureLang === 'en') {
    if (settings.language !== captureLang) saveSettings({ ...settings, language: captureLang })
  }

  // Development never installs updates over a working checkout. Test mode
  // replaces only the updater boundary inside the explicitly marked profile.
  const updatePort = testHarness ? testUpdater(app.getPath('userData'), testHarness.record) : IS_PACKAGED && process.platform === 'win32' ? new NsisUpdater() : null
  let lastUpdateTelemetry = ''
  updates = new UpdateController(updatePort, APP_VERSION, state => {
    broadcast(IPC.updateState, state)
    if (state.phase === 'downloading') lastUpdateTelemetry = ''
    const result = state.phase === 'downloaded' ? 'success' : state.phase === 'error' && state.error === 'download' ? 'failed' : null
    if (result && state.version && `${state.version}:${result}` !== lastUpdateTelemetry) {
      lastUpdateTelemetry = `${state.version}:${result}`
      telemetry?.record('update_download_result', { target_version: state.version, outcome: result, error: result === 'success' ? 'none' : 'other' })
    }
  }, error => auditUi(`update-error ${String(error).slice(0, 200)}`))
  if (updatePort && !testHarness) {
    updateStartupTimer = setTimeout(() => { if (!quitRequested) void updates?.check() }, 10_000)
    updateTimer = setInterval(() => { if (!quitRequested) void updates?.check() }, 6 * 60 * 60 * 1000)
    updateTimer.unref()
  }
  kaf = new KafController({
    db: () => db, settings: () => settings, accessAllowed: applicationAccessAllowed, runId, fetchImpl: testHarness?.fetchImpl,
    health: h => { telemetry?.health('kaf', h); broadcast(IPC.kafHealthChanged, h); updateTray() },
    projects: emitProjects, details: id => emitDetails([id]), flush: () => flushNotifications(null).then(() => undefined)
  })
  registerIpc()
  kaf.start(!!testHarness)
  createWindow()
  createTray()
  analyticsServicesReady = true
  syncAnalyticsAccess()
  extensionReady=true
  for(const url of pendingExtensionUrls)void activateExtensionUrl(url)
  pendingExtensionUrls.clear()
  for(const arg of process.argv)if(parseExtensionTicket(IS_PACKAGED ? arg : arg.replace(/^rased-dev:/, 'rased:')))void activateExtensionUrl(arg)
  app.on('before-quit', (event) => {
    if (quitComplete) return
    event.preventDefault()
    if (updates?.snapshot().phase === 'installing') { void shutdown(); return }
    doQuit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
  })
  powerMonitor.on('suspend', () => {
    searchCache?.suspend(true)
    telemetry?.suspend()
    nafezlyFacts.abortActive()
    kaf?.sleep()
    activeRss?.abort()
    khamsatAbort?.abort()
    nafezlyAbort?.abort()
    if (khamsatTimer) clearTimeout(khamsatTimer)
    khamsatTimer = null
    if (nafezlyTimer) clearTimeout(nafezlyTimer)
    nafezlyTimer = null
    enrichQueue.abortActive()
    detailsFetcher.abortActive()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })
  powerMonitor.on('resume', () => {
    searchCache?.suspend(false)
    telemetry?.resume()
    kaf?.wake()
    if (settings.mostaqlEnabled && !paused) {
      lastRecovering = true
      setTimeout(() => void trackWork(runCycle()), 2000)
      scheduleNext()
    }
    if (!khamsatPaused) scheduleKhamsat(2000)
    if (!nafezlyPaused) scheduleNafezly(2000)
  })

  enrichTimer = setInterval(() => {
    void trackWork(nafezlyFacts.pump())
    if (!applicationAccessAllowed() || !settings.mostaqlEnabled || paused) return
    const swept = sweepUncertain(Date.now())
    if (swept.length > 0) {
      // Expired uncertain waits that just became notifiable: new to attention.
      emitProjects(swept, swept)
      void trackWork(flushNotifications(null))
    }
    void trackWork(detailsFetcher.pump())
    void trackWork(enrichQueue.pump())
  }, 2500)
  enrichTimer.unref?.()

  lastRecovering = wasGap()
  scheduleNext()
  scheduleKhamsat(0)
  scheduleNafezly(0)
  // First cycle starts immediately through the scheduler.
  if (process.env['RASED_CAPTURE_PATH']) captureWhenSettled(process.env['RASED_CAPTURE_PATH'])
}

// Audit trail for user-initiated writes (read state, opens). Lets any
// reviewer attribute every read_at change to an explicit action.
function auditUi(detail: string): void {
  if (!db) return
  try {
    recordDiagnostic(db, {
      at: new Date().toISOString(),
      endpointKind: 'app',
      status: 'action',
      durationMs: 0,
      itemCount: null,
      errorCategory: null,
      detail: detail.slice(0, 200)
    })
  } catch {
    /* audit must never break the action */
  }
}

// ---- settings export/import (validated, versioned, no secrets) -----------

const MAX_IMPORT_BYTES = 1024 * 1024
const PURGE_KINDS = ['initial', 'live', 'recovered']

async function chooseDataFile(kind: 'save-settings' | 'open-settings' | 'save-backup' | 'open-backup'): Promise<string | null> {
  if (quitRequested) return null
  if (testHarness) {
    // Only an explicitly marked TEMP profile can substitute the OS file picker.
    const fixture = JSON.parse(readFileSync(join(app.getPath('userData'), 'data-dialog.json'), 'utf8')) as Record<string, unknown>
    const selected = fixture[kind]
    if (selected === null || selected === undefined) return null
    if (typeof selected !== 'string') throw Error('bad-schema')
    const path = resolve(app.getPath('userData'), selected), rel = relative(app.getPath('userData'), path)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('protected-location')
    testHarness.record('data-dialog', kind)
    return path
  }
  if (!win) return null
  const settingsFile = kind.endsWith('settings')
  const filters = [{ name: settingsFile ? 'RASED settings' : 'RASED backup', extensions: [settingsFile ? 'json' : 'rased-backup'] }]
  if (kind.startsWith('save')) {
    const result = await dialog.showSaveDialog(win, { defaultPath: settingsFile ? 'rased-settings.json' : `rased-${new Date().toISOString().slice(0, 10)}.rased-backup`, filters })
    const path = result.filePath
    if (!path || result.canceled) return null
    const rel = relative(app.getPath('userData'), resolve(path))
    if (!rel || !rel.startsWith('..') && !isAbsolute(rel)) throw Error('protected-location')
    return path
  }
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  return result.canceled ? null : result.filePaths[0] ?? null
}

let pendingImport: SettingsTransfer | null = null

async function validateSettingsImport(): Promise<ImportSummary> {
  pendingImport = null
  if (!win || !db) return { ok: false, error: 'no-window' }
  let path: string | null
  try { path = await chooseDataFile('open-settings') } catch (error) { return { ok: false, error: backupError(error, 'read-failed') } }
  if (!path) return { ok: false }
  if (quitRequested || !db) return { ok: false, error: 'busy' }
  let raw: Buffer
  try {
    if (statSync(path).size > MAX_IMPORT_BYTES) return { ok: false, error: 'too-large' }
    raw = readFileSync(path)
  } catch {
    return { ok: false, error: 'read-failed' }
  }
  let doc: unknown
  try {
    doc = JSON.parse(raw.toString('utf-8')) as unknown
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  let payload: SettingsTransfer
  try { payload = parseSettingsTransfer(doc) } catch { return { ok: false, error: 'bad-schema' } }
  const currentIds = new Set(listSavedFilters(db as Db).map((f) => f.id))
  pendingImport = payload
  return {
    ok: true,
    settingsKeys: Object.keys(payload.settings),
    filtersAdded: payload.savedFilters.filter((f) => !currentIds.has(f.id)).length,
    filtersReplaced: payload.savedFilters.filter((f) => currentIds.has(f.id)).length,
    startupRequested: payload.settings.runAtStartup === true,
    startupIncluded: payload.settings.runAtStartup !== undefined,
    profileIncluded: !!payload.proposalProfile, aiIncluded: !!payload.aiSettings, legacy: payload.version === 1
  }
}

function applySettingsImport(mode: unknown, applyStartup: boolean): ImportSummary {
  const cached = pendingImport
  if (!cached || !db) return { ok: false, error: 'no-validated-import' }
  if (mode !== 'merge' && mode !== 'replace') return { ok: false, error: 'bad-mode' }
  const d: Db = db
  const currentIds = new Set(listSavedFilters(d).map((f) => f.id))
  const transfer = { ...cached, settings: { ...cached.settings } }
  if (transfer.settings.quickApply?.enabled && !extension?.available()) transfer.settings.quickApply = { ...transfer.settings.quickApply, enabled: false }
  let next: AppSettings
  try { next = importSettings(d, settings, transfer, mode, applyStartup) } catch { return { ok: false, error: 'write-failed' } }
  pendingImport = null
  // Publish side effects only after the entire import committed successfully.
  const previous = settings
  settings = next
  applyMonitoringSettings(previous, next)
  kaf?.settingsChanged()
  if (!next.quickApply.enabled) extension?.cancel()
  applyAutoStart()
  broadcast(IPC.settingsChanged, next)
  broadcast(IPC.settingsImported, next)
  updateTray()
  compactWin?.setAlwaysOnTop(next.ui.compactAlwaysOnTop)
  emitHealth()
  auditUi(`settings-import mode=${mode} filters=${cached.savedFilters.length}`)
  return {
    ok: true,
    settingsKeys: Object.keys(cached.settings).filter(key => applyStartup || key !== 'runAtStartup'),
    filtersAdded: cached.savedFilters.filter((f) => !currentIds.has(f.id)).length,
    filtersReplaced: mode === 'merge' ? cached.savedFilters.filter((f) => currentIds.has(f.id)).length : 0
  }
}

function recordDiagnosticSafe(): void {
  if (!db) return
  try {
    recordDiagnostic(db, { at: new Date().toISOString(), endpointKind: 'app', status: 'boot', durationMs: 0, itemCount: null, errorCategory: null, detail: `run ${runId.slice(0, 8)}` })
  } catch {
    /* diagnostics must never break boot */
  }
}

function captureWhenSettled(outPath: string): void {
  const started = Date.now()
  const iv = setInterval(() => {
    const st = db ? getSourceState(db, SOURCE) : null
    const settled = (st && st.lastSuccessAt) || Date.now() - started > 45_000
    if (!settled) return
    clearInterval(iv)
    if (process.env['RASED_CAPTURE_TAB'] === 'settings' && win) {
      win.webContents.send('rased:open-settings')
    }
    setTimeout(() => {
      void (async () => {
        try {
          if (win) {
            const img = await win.capturePage()
            const { writeFileSync } = await import('node:fs')
            writeFileSync(outPath, img.toPNG())
            console.log(`RASED_CAPTURE_OK ${outPath}`)
          }
        } catch (err) {
          console.log(`RASED_CAPTURE_FAIL ${err instanceof Error ? err.message : err}`)
        } finally {
          doQuit()
        }
      })()
    }, 2500)
  }, 1000)
}

process.on('uncaughtException', (err) => {
  try {
    if (db) {
      recordDiagnostic(db, {
        at: new Date().toISOString(),
        endpointKind: 'app',
        status: 'uncaught',
        durationMs: 0,
        itemCount: null,
        errorCategory: 'exception',
        detail: String(err).slice(0, 300)
      })
    }
  } catch {
    /* last resort: never throw in the handler */
  }
})

void boot().catch(async (error: unknown) => {
  // Startup failures can happen before a window or diagnostics DB exists.
  // Surface them and exit instead of leaving an invisible, unusable process.
  const failure = recordStartupFailure(app.getPath('userData'), startupStage, error)
  console.error('RASED startup failed', failure)
  const code = error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) : null
  if (testHarness) testHarness.record('boot-failed', { ...failure, sqliteCode: code })
  else {
    try { await dialog.showMessageBox({ type: 'error', title: 'RASED', message: startupStage === 'later' ? 'تعذر إكمال بدء راصد. أعد المحاولة أو تواصل مع المطور. لم يتم حذف بياناتك.\nRASED could not finish starting. Retry or contact the developer. Your data was not deleted.' : 'تعذر بدء راصد. تأكد من توفر مساحة وصلاحية الوصول إلى بيانات التطبيق، ثم أعد المحاولة. لم يتم حذف بياناتك.\nRASED could not start. Check free disk space and access to the app data folder, then retry. Your data was not deleted.' }) } catch { /* Exit even when the OS cannot display a dialog. */ }
  }
  try { await telemetry?.close() } catch { /* Best effort after failed boot. */ }
  try { if (db?.isOpen) closeDatabase(db) } catch { /* Preserve the original files. */ }
  quitRequested = true
  quitComplete = true
  app.quit()
})
