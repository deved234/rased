// RASED main process: lifecycle, collector loop, IPC, tray, notifications.
// The collector lives here (outside React). Renderer is display-only.

import { randomUUID } from 'node:crypto'
import { release as osRelease } from 'node:os'
import { NsisUpdater } from 'electron-updater'
import { UpdateController } from './updates.js'
import { testUpdater } from './testHarness.js'
import { version as APP_VERSION } from '../../package.json'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { ABOUT_LINKS, type AboutLink } from '../shared/about.js'
import {
  defaultSettings,
  sanitizeFilterDefinition,
  sanitizeSavedFilter,
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
import { openDatabase, closeDatabase, type Db } from '../storage/db.js'
import {
  countProjects,
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
  listProjects,
  listSavedFilters,
  markAllRead,
  markEnrichmentPending,
  markEvents,
  purgeHistory,
  queryProjectsPage,
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
import { DetailBudget } from '../collector/detailBudget.js'
import { mergeSettings, notificationsAllowed, pickLatestProjectId } from './policies.js'
import { isolatedTestHarness } from './testHarness.js'
import { evaluateFilter, toFilterable } from '../shared/filters.js'
import { dispatchPending, recoverPreviousSession, type SinglePayload, type SummaryPayload } from './notifier.js'
import { isAllowedProjectUrl, isAllowedTestUrl, MOSTAQL_PROJECTS_URL, resolveProjectUrl } from './links.js'
import { browserToastXml, supportsUrgentToasts } from './toast.js'

app.setAppUserModelId('com.rased.app')

const sessionId = randomUUID()
const runId = randomUUID()
let db: Db | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
/** compact follower window (Phase 6); null until opened */
let compactWin: BrowserWindow | null = null
let settings: AppSettings = defaultSettings()
let sched: SchedulerState = initialSchedulerState()
let paused = false
let inFlight = false
let lastStartMs: number | null = null
let lastFinishMs: number | null = null
let nextAttemptAtMs: number | null = null
let firstCycleOfRun = true
let lastRecovering = false
let lastDurationMs: number | null = null
let lastItemCount: number | null = null
let timer: NodeJS.Timeout | null = null
let enrichTimer: NodeJS.Timeout | null = null
let quitRequested = false
let episode = 0
let hintShown = false
const uncertainWaits = new Map<number, number>()
let activeRss: AbortController | null = null
let flushing: Promise<void> | null = null
const detailBudget = new DetailBudget()
const work = new Set<Promise<unknown>>()
let shutdownWork: Promise<void> | null = null
let quitComplete = false
let updates: UpdateController | null = null
let updateInstallRequested = false
let updateStartupTimer: NodeJS.Timeout | null = null
let updateTimer: NodeJS.Timeout | null = null
const testHarness = isolatedTestHarness(app.getPath('userData'), process.argv)

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
  return notificationsAllowed(settings, Date.now(), quitRequested)
}

const singleInstance = app.requestSingleInstanceLock()

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
  settings = s
  if (db) setSettingRaw(db, 'app', JSON.stringify(s))
  applyAutoStart()
  broadcast(IPC.settingsChanged, s)
  updateTray()
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
  let state: SourceHealth['state'] = 'initializing'
  if (paused) state = 'paused'
  else if (sched.needsReview) state = 'needs-review'
  else if (isBackingOff(sched, Date.now())) state = 'backing-off'
  else if (st && st.consecutiveFailures >= 2 && (st.lastError === 'network' || st.lastError === 'timeout')) state = 'offline'
  else if (st && st.consecutiveFailures > 0) state = 'error'
  else if (st && st.lastSuccessAt) state = 'watching'
  return {
    state,
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
    paused
  }
}

function emitHealth(): void {
  broadcast(IPC.healthChanged, snapshotHealth())
  updateTray()
}

function emitProjects(newIds: number[], changedIds: number[] = []): void {
  episode++
  const summary = db ? countProjects(db, {}) : null
  win?.webContents.send(IPC.projectsChanged, { episode, newIds, changedIds, summary })
  compactWin?.webContents.send(IPC.projectsChanged, { episode, newIds, changedIds, summary })
}

function emitDetails(projectIds: number[]): void {
  win?.webContents.send(IPC.detailsChanged, { projectIds })
  compactWin?.webContents.send(IPC.detailsChanged, { projectIds })
}

// ---------------------------------------------------------------- notifications (OS)

function projectLine(p: { title: string }): string {
  return p.title.length > 90 ? `${p.title.slice(0, 90)}…` : p.title
}

// Keep native notification objects alive until Windows closes or activates them.
const activeNotifications = new Set<Notification>()

function showToast(title: string, body: string, onClick: () => void, url: string): Promise<boolean> {
  const toastXml = process.platform === 'win32'
    ? browserToastXml(title, body, url, app.isPackaged ? join(process.resourcesPath, 'branding', 'icon.png') : iconPath('icon.png'), supportsUrgentToasts(process.platform, osRelease()))
    : undefined
  if (testHarness) {
    testHarness.record('toast', { title, body, toastXml, urgency: 'critical' })
    // Simulate the OS protocol destination, not a native Windows mouse click.
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
      n.on('show', () => finish(true))
      n.on('failed', (_event, error: string) => {
        auditUi(`notification-failed ${String(error)}`)
        activeNotifications.delete(n)
        finish(false)
      })
      n.on('close', () => activeNotifications.delete(n))
      n.once('click', () => {
        activeNotifications.delete(n)
        // Protocol activation opens the browser in Windows. Calling shell here
        // as well would open a second tab; no instance callback is required.
        if (!toastXml) onClick()
      })
      n.show()
      setTimeout(() => finish(true), 2000)
    } catch {
      finish(false)
    }
  })
}

async function sendSingle(p: SinglePayload): Promise<boolean> {
  const lang = settings.language
  const tags: string[] = []
  if (p.project.discoveryKind === 'recovered') tags.push(lang === 'ar' ? 'فائت' : 'catch-up')
  if (p.uncertain) tags.push(lang === 'ar' ? 'تصنيف غير مؤكد' : 'uncertain category')
  const title = tags.length > 0 ? `${projectLine(p.project)} (${tags.join('، ')})` : projectLine(p.project)
  const body = p.project.descriptionExcerpt.slice(0, 180)
  const { id, url } = p.project
  return showToast(title, body, () => {
    void openProjectById(id, true, url).then(result => {
      if (!result.ok) auditUi(`notification-browser-failed id=${id} ${result.error}`)
    })
  }, url)
}

async function sendSummary(p: SummaryPayload, latestId: number | null): Promise<boolean> {
  const lang = settings.language
  const n = p.projects.length
  const title =
    lang === 'ar'
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
  }, latestUrl ?? MOSTAQL_PROJECTS_URL)
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
        const v = evaluateFilter(toFilterable(p), settings.notifyFilter)
        return v === 'match' || (!p.categoryConfirmed && settings.notifyUncertainCategory && v === 'uncertain')
      },
      onBeep: () => { if (notificationAllowed() && settings.soundEnabled) { testHarness?.record('beep', true); win?.webContents.send(IPC.playBeep) } }
    }
  )
  if (out.singles > 0 || out.summaries > 0 || out.skipped > 0) emitProjects([], [])
}

// ---------------------------------------------------------------- collector loop

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
  if (settings.notifyUncertainCategory && settings.notificationsEnabled) {
    for (const pid of expired) {
      const p = getProjectById(db, pid)
      if (p && !p.categoryConfirmed && !getUserState(db, pid).hiddenAt && evaluateFilter(toFilterable(p), settings.notifyFilter) === 'uncertain') toNotify.push(pid)
    }
    if (toNotify.length > 0) createPendingEvents(db, toNotify, 'new_project', new Date().toISOString())
  }
  return toNotify
}

async function runCycle(): Promise<RefreshResult> {
  if (quitRequested) return { ok: false, started: false, reason: 'paused' }
  if (!db) return { ok: false, started: false, reason: 'no-db' }
  if (paused) return { ok: false, started: false, reason: 'paused' }
  if (inFlight) return { ok: false, started: false, reason: 'busy' }
  if (isBackingOff(sched, Date.now())) return { ok: false, started: false, reason: 'backoff' }
  inFlight = true
  lastStartMs = Date.now()
  activeRss = new AbortController()
  emitHealth()
  try {
    const res = await fetchRss(RSS_URL, { signal: activeRss.signal, fetchImpl: testHarness?.fetchImpl })
    if (paused || quitRequested || (!res.ok && res.kind === 'cancelled')) return { ok: false, started: true, reason: 'paused' }
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
  }
}

function scheduleNext(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (paused || quitRequested || !db) {
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
  gateOpen: () => !paused && !quitRequested && !inFlight && !isBackingOff(sched, Date.now()),
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
  gateOpen: () => !paused && !quitRequested && !inFlight && !isBackingOff(sched, Date.now()) && db !== null,
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

// ---------------------------------------------------------------- open project

async function openProjectById(id: number, fromNotification: boolean, notificationUrl?: string): Promise<{ ok: boolean; error?: string }> {
  if (quitRequested) return { ok: false, error: 'quitting' }
  const openedDb = db
  // Native toast closures carry their original URL even if history was purged.
  // IPC callers never supply this argument; all destinations still pass the allow-list.
  const url = notificationUrl ?? (openedDb ? resolveProjectUrl(openedDb, id) : null)
  if (!url || !isAllowedProjectUrl(url)) return { ok: false, error: 'bad-url' }
  try {
    if (testHarness) testHarness.record('open-external', url)
    else await shell.openExternal(url)
  } catch {
    return { ok: false, error: 'open-failed' }
  }
  if (!quitRequested && openedDb && db === openedDb && openedDb.isOpen && getProjectById(openedDb, id)) setReadState(openedDb, id, true)
  auditUi(`open-project id=${id}${fromNotification ? ' via-notification' : ''}`)
  emitProjects([], [id])
  return { ok: true }
}

// ---------------------------------------------------------------- window/tray

function iconPath(name: string): string {
  if (app.isPackaged && name === 'icon.ico') return join(process.resourcesPath, 'branding', name)
  return join(app.getAppPath(), 'resources', name)
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
  window.setAppDetails({ appId: 'com.rased.app', appIconPath: iconPath('icon.ico'), appIconIndex: 0, relaunchDisplayName: 'RASED' })
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
    win?.show()
    win?.focus()
  })
  win.on('close', (e) => {
    testHarness?.record('native-close', { quitRequested, tray: !!tray })
    if (quitRequested || !tray) return
    e.preventDefault()
    // closeBehavior 'quit' ends the app; default 'tray' hides to background.
    if (settings.ui.closeBehavior === 'quit') {
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
  const h = snapshotHealth()
  const state = ar
    ? { watching: 'تتم المتابعة', paused: 'متوقف', 'backing-off': 'تهدئة وإعادة', error: 'خطأ', offline: 'غير متصل', 'needs-review': 'يحتاج مراجعة', initializing: 'يبدأ…' }[h.state]
    : { watching: 'Watching', paused: 'Paused', 'backing-off': 'Backing off', error: 'Error', offline: 'Offline', 'needs-review': 'Needs review', initializing: 'Starting…' }[h.state]
  return `RASED — ${state}`
}

function updateTray(): void {
  if (!tray) return
  tray.setToolTip(trayLabel())
  const ar = settings.language === 'ar'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: ar ? 'فتح راصد' : 'Open RASED', click: () => win?.show() },
      { type: 'separator' },
      paused
        ? { label: ar ? 'استئناف المتابعة' : 'Resume watching', click: () => void doResume() }
        : { label: ar ? 'إيقاف المتابعة' : 'Pause watching', click: () => void doPause() },
      {
        label: settings.soundEnabled ? (ar ? 'كتم الصوت' : 'Mute sound') : ar ? 'تفعيل الصوت' : 'Enable sound',
        click: () => saveSettings({ ...settings, soundEnabled: !settings.soundEnabled })
      },
      { label: ar ? 'الإعدادات' : 'Settings', click: () => { win?.show(); win?.webContents.send('rased:open-settings') } },
      { type: 'separator' },
      { label: ar ? 'خروج' : 'Quit', click: () => doQuit() }
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

function doQuit(): void {
  if (quitRequested) return
  if (win && !win.isDestroyed()) win.webContents.send(IPC.requestClose, { quit: true })
  else void shutdown()
}

async function shutdown(): Promise<void> {
  if (shutdownWork) return shutdownWork
  quitRequested = true
  paused = true
  activeRss?.abort()
  enrichQueue.abortActive()
  detailsFetcher.abortActive()
  if (timer) clearTimeout(timer)
  if (enrichTimer) clearInterval(enrichTimer)
  if (updateStartupTimer) clearTimeout(updateStartupTimer)
  if (updateTimer) clearInterval(updateTimer)
  updates?.dispose()
  shutdownWork = (async () => {
  try {
    while (work.size) await Promise.allSettled([...work])
    if (flushing) await Promise.allSettled([flushing])
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
  const mainSender = (event: Electron.IpcMainInvokeEvent): boolean => event.sender === win?.webContents && !quitRequested
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
    if (v.quit === true) return shutdown()
    win?.hide()
    if (!hintShown) {
      hintShown = true
      tray?.displayBalloon({
        title: 'RASED',
        content: settings.language === 'ar' ? 'راصد مستمر في الخلفية. الخروج الكامل من قائمة الأيقونة.' : 'RASED keeps watching in the background. Quit from the tray menu.'
      })
    }
  })
  ipcMain.handle(IPC.getProjects, (_e, q: ProjectQuery) => {
    if (!db) return []
    const limit = Math.min(200, Math.max(1, Math.floor(q.limit) || 50))
    const offset = Math.max(0, Math.floor(q.offset) || 0)
    const categories = Array.isArray(q.categories) ? q.categories.filter((c): c is string => typeof c === 'string').slice(0, 20) : undefined
    const rows = listProjects(db, {
      limit,
      offset,
      unreadOnly: q.unreadOnly === true,
      search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
      categories,
      displayFilter: settings.displayFilter
    })
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
    return rows
  })
  ipcMain.handle(IPC.getProjectCount, (_e, q: Omit<ProjectQuery, 'limit' | 'offset'>) => {
    if (!db) return { total: 0, unread: 0 }
    return countProjects(db, {
      unreadOnly: q.unreadOnly === true,
      search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
      categories: Array.isArray(q.categories) ? q.categories.filter((c): c is string => typeof c === 'string').slice(0, 20) : undefined,
      displayFilter: settings.displayFilter
    })
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
    const p = (patch ?? {}) as Partial<AppSettings>
    const next = mergeSettings(settings, p)
    const intervalChanged = next.pollIntervalMs !== settings.pollIntervalMs
    saveSettings(next)
    compactWin?.setAlwaysOnTop(next.ui.compactAlwaysOnTop)
    if (intervalChanged) scheduleNext()
    emitHealth()
    return next
  })
  ipcMain.handle(IPC.getHealth, () => snapshotHealth())
  ipcMain.handle(IPC.pause, () => doPause())
  ipcMain.handle(IPC.resume, () => doResume())
  ipcMain.handle(IPC.refresh, () => trackWork(runCycle()))
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
  ipcMain.handle(IPC.requestProjectDetails, (_e, v: { id: number; force?: boolean }) => {
    if (!db || !Number.isInteger(v.id)) return null
    const p = getProjectById(db, v.id)
    if (!p) return null
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
    if (!db) return { total: 0, unread: 0 }
    const def = sanitizeFilterDefinition(v.definition)
    const { total, unread } = queryProjectsPage(db, def, { limit: 0, offset: 0 })
    return { total, unread }
  })
  ipcMain.handle(IPC.queryProjectsPage, (_e, v: { definition: unknown; limit: unknown; offset: unknown }) => {
    if (!db) return { rows: [], total: 0, unread: 0 }
    const def = sanitizeFilterDefinition(v.definition)
    const limit = Math.min(200, Math.max(1, Math.floor(v.limit as number) || 50))
    const offset = Math.max(0, Math.floor(v.offset as number) || 0)
    if (def.categoryFilter.mode === 'selected' || def.budgetMin !== null || def.budgetMax !== null || !def.includeUnknownBudget) {
      const ids = getUnenrichedNewIds(db, 50).slice(0, 5)
      markEnrichmentPending(db, ids)
      for (const id of ids) { const p = getProjectById(db, id); if (p) enrichQueue.enqueue(id, p.url) }
      void trackWork(enrichQueue.pump())
    }
    return queryProjectsPage(db, def, { limit, offset })
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
  ipcMain.handle(IPC.exportSettings, () => {
    if (!win) return { ok: false, error: 'no-window' }
    const chosen = dialog.showSaveDialogSync(win, {
      defaultPath: 'rased-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!chosen) return { ok: false }
    try {
      writeFileSync(chosen, JSON.stringify(settingsExportPayload(), null, 2), 'utf-8')
    } catch {
      return { ok: false, error: 'write-failed' }
    }
    auditUi('settings-export')
    return { ok: true, path: chosen }
  })
  ipcMain.handle(IPC.validateImport, () => validateSettingsImport())
  ipcMain.handle(IPC.applyImport, (_e, v: { mode: unknown; applyStartup: unknown }) => applySettingsImport(v.mode, v.applyStartup === true))
  ipcMain.handle(IPC.purgeHistoryPreview, (_e, v: { cutoffIso: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' } satisfies PurgePreview
    if (typeof v.cutoffIso !== 'string' || Number.isNaN(Date.parse(v.cutoffIso))) {
      return { ok: false, error: 'bad-cutoff' } satisfies PurgePreview
    }
    return { ok: true, affected: countPurgeable(db, new Date(v.cutoffIso).toISOString(), PURGE_KINDS) } satisfies PurgePreview
  })
  ipcMain.handle(IPC.purgeHistoryApply, (_e, v: { cutoffIso: unknown }) => {
    if (!db) return { ok: false, error: 'no-db' } satisfies PurgePreview
    if (typeof v.cutoffIso !== 'string' || Number.isNaN(Date.parse(v.cutoffIso))) {
      return { ok: false, error: 'bad-cutoff' } satisfies PurgePreview
    }
    const d: Db = db
    const backupDir = join(app.getPath('userData'), 'backups')
    const backupPath = join(backupDir, `rased-backup-${Date.now()}.db`)
    try {
      mkdirSync(backupDir, { recursive: true })
      // VACUUM INTO is an online, consistent backup — never copy a live WAL file.
      d.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
    } catch {
      return { ok: false, error: 'backup-failed' } satisfies PurgePreview
    }
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

async function boot(): Promise<void> {
  if (!singleInstance) {
    app.quit()
    return
  }
  await app.whenReady()
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  db = openDatabase(join(app.getPath('userData'), 'rased.db'))
  settings = loadSettings()
  if (testHarness) paused = true
  const savedState = getSourceState(db, SOURCE)
  const savedBackoff = savedState.backoffUntil ? Date.parse(savedState.backoffUntil) : NaN
  if (Number.isFinite(savedBackoff) && savedBackoff > Date.now()) {
    sched = { ...sched, backoffUntilMs: savedBackoff, consecutiveFailures: savedState.consecutiveFailures, needsReview: savedState.lastError === 'forbidden' || savedState.lastError === 'http-403' || savedState.lastError === 'http-401' }
  }
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
  const updatePort = testHarness ? testUpdater(app.getPath('userData'), testHarness.record) : app.isPackaged && process.platform === 'win32' ? new NsisUpdater() : null
  updates = new UpdateController(updatePort, APP_VERSION, state => broadcast(IPC.updateState, state), error => auditUi(`update-error ${String(error).slice(0, 200)}`))
  if (updatePort && !testHarness) {
    updateStartupTimer = setTimeout(() => { if (!quitRequested) void updates?.check() }, 10_000)
    updateTimer = setInterval(() => { if (!quitRequested) void updates?.check() }, 6 * 60 * 60 * 1000)
    updateTimer.unref()
  }
  registerIpc()
  createWindow()
  createTray()
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
    activeRss?.abort()
    enrichQueue.abortActive()
    detailsFetcher.abortActive()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })
  powerMonitor.on('resume', () => {
    if (paused) return
    lastRecovering = true
    setTimeout(() => void trackWork(runCycle()), 2000)
    scheduleNext()
  })

  enrichTimer = setInterval(() => {
    if (paused) return
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

const SETTINGS_EXPORT_VERSION = 1
const MAX_IMPORT_BYTES = 1024 * 1024
const PURGE_KINDS = ['initial', 'live', 'recovered']

/** Whitelisted settings keys that may cross the export boundary. */
function settingsExportPayload(): {
  format: string
  version: number
  settings: Record<string, unknown>
  savedFilters: SavedFilter[]
} {
  return {
    format: 'rased-settings',
    version: SETTINGS_EXPORT_VERSION,
    settings: {
      language: settings.language,
      pollIntervalMs: settings.pollIntervalMs,
      notificationsEnabled: settings.notificationsEnabled,
      soundEnabled: settings.soundEnabled,
      runAtStartup: settings.runAtStartup,
      notifyFilter: settings.notifyFilter,
      displayFilter: settings.displayFilter,
      displayQuery: settings.displayQuery,
      linkDisplayAndNotifyFilters: settings.linkDisplayAndNotifyFilters,
      notifyUncertainCategory: settings.notifyUncertainCategory,
      showUnreadOnly: settings.showUnreadOnly,
      ui: settings.ui
    },
    savedFilters: db ? listSavedFilters(db) : []
  }
}

let pendingImport: { settings: Partial<AppSettings>; filters: SavedFilter[] } | null = null

function validateSettingsImport(): ImportSummary {
  pendingImport = null
  if (!win || !db) return { ok: false, error: 'no-window' }
  const chosen = dialog.showOpenDialogSync(win, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!chosen || chosen.length === 0) return { ok: false }
  const path = chosen[0] as string
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
  if (typeof doc !== 'object' || doc === null) return { ok: false, error: 'bad-schema' }
  const o = doc as Record<string, unknown>
  if (o['format'] !== 'rased-settings' || o['version'] !== SETTINGS_EXPORT_VERSION) return { ok: false, error: 'bad-schema' }
  if (o['settings'] !== undefined && (typeof o['settings'] !== 'object' || o['settings'] === null)) {
    return { ok: false, error: 'bad-schema' }
  }
  if (!Array.isArray(o['savedFilters'])) return { ok: false, error: 'bad-schema' }
  const full = sanitizeSettings(o['settings'] ?? {})
  const present = typeof o['settings'] === 'object' && o['settings'] !== null ? Object.keys(o['settings'] as object) : []
  const allowed: (keyof AppSettings)[] = [
    'language',
    'pollIntervalMs',
    'notificationsEnabled',
    'soundEnabled',
    'runAtStartup',
    'notifyFilter',
    'displayFilter',
    'displayQuery',
    'linkDisplayAndNotifyFilters',
    'notifyUncertainCategory',
    'showUnreadOnly',
    'ui'
  ]
  const partial: Partial<AppSettings> = {}
  const settingsKeys: string[] = []
  for (const k of allowed) {
    if (present.includes(k)) {
      ;(partial as Record<string, unknown>)[k] = full[k]
      settingsKeys.push(k)
    }
  }
  const filters: SavedFilter[] = []
  for (const entry of o['savedFilters'] as unknown[]) {
    const f = sanitizeSavedFilter(entry)
    if (!f) return { ok: false, error: 'bad-filter' }
    filters.push(f)
  }
  const currentIds = new Set(listSavedFilters(db as Db).map((f) => f.id))
  pendingImport = { settings: partial, filters }
  return {
    ok: true,
    settingsKeys,
    filtersAdded: filters.filter((f) => !currentIds.has(f.id)).length,
    filtersReplaced: filters.filter((f) => currentIds.has(f.id)).length,
    startupRequested: (partial as { runAtStartup?: boolean }).runAtStartup === true
  }
}

function applySettingsImport(mode: unknown, applyStartup: boolean): ImportSummary {
  const cached = pendingImport
  pendingImport = null
  if (!cached || !db) return { ok: false, error: 'no-validated-import' }
  if (mode !== 'merge' && mode !== 'replace') return { ok: false, error: 'bad-mode' }
  const d: Db = db
  const partial = { ...cached.settings }
  // runAtStartup needs an explicit opt-in at import time; never implied.
  if (!applyStartup) delete partial.runAtStartup
  const next = sanitizeSettings({ ...settings, ...partial, doNotDisturbUntil: null })
  if (next.linkDisplayAndNotifyFilters) next.notifyFilter = next.displayQuery.categoryFilter
  next.displayFilter = next.displayQuery.categoryFilter
  const currentIds = new Set(listSavedFilters(d).map((f) => f.id))
  runInTransaction(d, () => {
    saveSettings(next)
    if (mode === 'replace') {
      d.exec('DELETE FROM saved_filters;')
    }
    for (const f of cached.filters) saveSavedFilterRow(d, f)
  })
  auditUi(`settings-import mode=${mode} filters=${cached.filters.length}`)
  return {
    ok: true,
    settingsKeys: Object.keys(partial),
    filtersAdded: cached.filters.filter((f) => !currentIds.has(f.id)).length,
    filtersReplaced: mode === 'merge' ? cached.filters.filter((f) => currentIds.has(f.id)).length : 0
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

void boot()
