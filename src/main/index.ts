// RASED main process: lifecycle, collector loop, IPC, tray, notifications.
// The collector lives here (outside React). Renderer is display-only.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  shell,
  ipcMain,
  powerMonitor,
  nativeImage
} from 'electron'
import { IPC } from '../shared/channels.js'
import {
  defaultSettings,
  sanitizeSettings,
  type AppSettings,
  type ProjectQuery,
  type RefreshResult,
  type SourceHealth
} from '../shared/types.js'
import { openDatabase, closeDatabase, type Db } from '../storage/db.js'
import {
  countProjects,
  createPendingEvents,
  deleteClassificationWait,
  getProjectById,
  getSettingRaw,
  getSourceState,
  getUnenrichedNewIds,
  listDiagnostics,
  listProjects,
  listClassificationWaits,
  markAllRead,
  markEnrichmentPending,
  recordDiagnostic,
  setReadState,
  setSettingRaw,
  saveSourceState,
  updateEnrichment
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
import { evaluateFilter, toFilterable } from '../collector/filters.js'
import { dispatchPending, recoverPreviousSession, type SinglePayload, type SummaryPayload } from './notifier.js'
import { isAllowedProjectUrl, resolveProjectUrl } from './links.js'

app.setAppUserModelId('com.rased.app')

const sessionId = randomUUID()
const runId = randomUUID()
let db: Db | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
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
  win?.webContents.send(IPC.settingsChanged, s)
  updateTray()
}

function applyAutoStart(): void {
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
  win?.webContents.send(IPC.healthChanged, snapshotHealth())
  updateTray()
}

function emitProjects(newIds: number[]): void {
  episode++
  const summary = db ? countProjects(db, {}) : null
  win?.webContents.send(IPC.projectsChanged, { episode, newIds, summary })
}

// ---------------------------------------------------------------- notifications (OS)

function projectLine(p: { title: string }): string {
  return p.title.length > 90 ? `${p.title.slice(0, 90)}…` : p.title
}

function showToast(title: string, body: string, onClick: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean): void => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    try {
      const n = new Notification({ title, body, silent: true })
      n.on('show', () => finish(true))
      n.on('failed', () => finish(false))
      n.on('click', () => onClick())
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
  return showToast(title, body, () => void openProjectById(p.project.id, true))
}

async function sendSummary(p: SummaryPayload): Promise<boolean> {
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
  return showToast(title, lines.join('\n'), () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

async function flushNotifications(batchKeyForGap: string | null): Promise<void> {
  if (!db) return
  if (flushing) return flushing
  flushing = flushPending(batchKeyForGap).finally(() => { flushing = null })
  return flushing
}

async function flushPending(batchKeyForGap: string | null): Promise<void> {
  if (!db) return
  const out = await dispatchPending(
    db,
    { sessionId, nowIso: new Date().toISOString(), recovering: lastRecovering, batchKey: batchKeyForGap },
    {
      sendSingle,
      sendSummary,
      shouldSend: (p) => settings.notificationsEnabled && (evaluateFilter(toFilterable(p), settings.notifyFilter) === 'match' || (!p.categoryConfirmed && settings.notifyUncertainCategory && evaluateFilter(toFilterable(p), settings.notifyFilter) === 'uncertain')),
      onBeep: () => { if (settings.soundEnabled) win?.webContents.send(IPC.playBeep) }
    }
  )
  if (out.singles > 0 || out.summaries > 0 || out.skipped > 0) emitProjects([])
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
      if (p && !p.categoryConfirmed && evaluateFilter(toFilterable(p), settings.notifyFilter) === 'uncertain') toNotify.push(pid)
    }
    if (toNotify.length > 0) createPendingEvents(db, toNotify, 'new_project', new Date().toISOString())
  }
  return toNotify
}

async function runCycle(): Promise<RefreshResult> {
  if (!db) return { ok: false, started: false, reason: 'no-db' }
  if (paused) return { ok: false, started: false, reason: 'paused' }
  if (inFlight) return { ok: false, started: false, reason: 'busy' }
  if (isBackingOff(sched, Date.now())) return { ok: false, started: false, reason: 'backoff' }
  inFlight = true
  lastStartMs = Date.now()
  activeRss = new AbortController()
  emitHealth()
  try {
    const res = await fetchRss(RSS_URL, { signal: activeRss.signal })
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
    if (out.insertedIds.length > 0 || out.updatedIds.length > 0) emitProjects(out.insertedIds)
    await flushNotifications(gapKey)
    if (swept.length > 0) emitProjects(swept)
    void enrichQueue.pump()
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
  if (paused || !db) {
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
    void runCycle()
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
  gateOpen: () => !paused && !inFlight && !isBackingOff(sched, Date.now()),
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
          void flushNotifications(null).then(() => emitProjects([projectId]))
          return
        }
      } else {
        uncertainWaits.delete(projectId)
        deleteClassificationWait(db, projectId)
      }
    }
    emitProjects([projectId])
  }
})

// ---------------------------------------------------------------- open project

async function openProjectById(id: number, fromNotification: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!db) return { ok: false, error: 'no-db' }
  const url = resolveProjectUrl(db, id)
  if (!url || !isAllowedProjectUrl(url)) return { ok: false, error: 'bad-url' }
  try {
    await shell.openExternal(url)
  } catch {
    return { ok: false, error: 'open-failed' }
  }
  setReadState(db, id, true)
  auditUi(`open-project id=${id}${fromNotification ? ' via-notification' : ''}`)
  emitProjects(fromNotification ? [id] : [])
  return { ok: true }
}

// ---------------------------------------------------------------- window/tray

function iconPath(name: string): string {
  return join(app.getAppPath(), 'resources', name)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14171c',
    autoHideMenuBar: true,
    icon: iconPath('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('close', (e) => {
    if (quitRequested || !tray) return
    e.preventDefault()
    win?.hide()
    if (!hintShown) {
      hintShown = true
      tray.displayBalloon({
        title: 'RASED',
        content: settings.language === 'ar' ? 'راصد مستمر في الخلفية. الخروج الكامل من قائمة الأيقونة.' : 'RASED keeps watching in the background. Quit from the tray menu.'
      })
    }
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

// ---------------------------------------------------------------- commands

async function doPause(): Promise<SourceHealth> {
  paused = true
  activeRss?.abort()
  enrichQueue.abortActive()
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
  quitRequested = true
  activeRss?.abort()
  enrichQueue.abortActive()
  if (timer) clearTimeout(timer)
  if (enrichTimer) clearInterval(enrichTimer)
  try {
    if (db) {
      const st = getSourceState(db, SOURCE)
      saveSourceState(db, { ...st, runId });
      closeDatabase(db)
    }
  } finally {
    db = null
    app.quit()
  }
}

// ---------------------------------------------------------------- IPC

function registerIpc(): void {
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
        void enrichQueue.pump()
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
    emitProjects([])
  })
  ipcMain.handle(IPC.markAllRead, () => {
    if (!db) return 0
    const n = markAllRead(db)
    auditUi(`mark-all-read n=${n}`)
    emitProjects([])
    return n
  })
  ipcMain.handle(IPC.getSettings, () => settings)
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<AppSettings>) => {
    const next = sanitizeSettings({ ...settings, ...patch })
    const intervalChanged = next.pollIntervalMs !== settings.pollIntervalMs
    saveSettings(next)
    if (intervalChanged) scheduleNext()
    emitHealth()
    return next
  })
  ipcMain.handle(IPC.getHealth, () => snapshotHealth())
  ipcMain.handle(IPC.pause, () => doPause())
  ipcMain.handle(IPC.resume, () => doResume())
  ipcMain.handle(IPC.refresh, () => runCycle())
  ipcMain.handle(IPC.openProject, (_e, v: { id: number }) => {
    if (!Number.isInteger(v.id)) return { ok: false, error: 'bad-id' }
    return openProjectById(v.id, false)
  })
  ipcMain.handle(IPC.getDiagnostics, (_e, v: { limit?: number }) => {
    if (!db) return []
    const limit = Math.min(200, Math.max(1, Math.floor(v?.limit ?? 50) || 50))
    return listDiagnostics(db, limit)
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

  // Optional capture harness (screenshots): env-gated, no production surface.
  const captureLang = process.env['RASED_CAPTURE_LANG']
  if (captureLang === 'ar' || captureLang === 'en') {
    if (settings.language !== captureLang) saveSettings({ ...settings, language: captureLang })
  }

  registerIpc()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
  })
  powerMonitor.on('suspend', () => {
    activeRss?.abort()
    enrichQueue.abortActive()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })
  powerMonitor.on('resume', () => {
    if (paused) return
    lastRecovering = true
    setTimeout(() => void runCycle(), 2000)
    scheduleNext()
  })

  enrichTimer = setInterval(() => {
    if (paused) return
    const swept = sweepUncertain(Date.now())
    if (swept.length > 0) {
      emitProjects(swept)
      void flushNotifications(null)
    }
    void enrichQueue.pump()
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
      endpointKind: 'ui',
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
