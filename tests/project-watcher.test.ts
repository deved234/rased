import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import {
  updateUserState,
  upsertProjectsBatch
} from '../src/storage/repositories.js'
import {
  getWatch,
  getWatchSourceState,
  saveWatchSourceState,
  setNextDue,
  setWatch
} from '../src/storage/projectWatch.js'
import { SourceArbiter } from '../src/collector/sourceArbiter.js'
import {
  WATCH_BLOCK_PAUSE_MS,
  WATCH_IDLE_SLOT_MS,
  WATCH_SLOT_MAX_MS,
  WATCH_SLOT_MS,
  type WatchSnapshotResult,
  type WatchSource
} from '../src/shared/projectWatch.js'
import {
  ProjectWatcher,
  type WatchCounter,
  type WatchFetchResult
} from '../src/main/projectWatcher.js'

let dir: string
let db: Db
let nowMs: number
let arbiters: Record<WatchSource, SourceArbiter>
let gateOpenState: Record<WatchSource, boolean>
let pollSuccessSinceTimes: Record<WatchSource, number>
let blockedCalls: { source: WatchSource; result: WatchFetchResult }[]
let changedCalls: number[][]
let eventsCalls: { source: WatchSource; result: WatchSnapshotResult }[]
let counterCalls: { source: WatchSource; counter: WatchCounter }[]
let stoppedCalls: { source: WatchSource; projectId: number; reason: 'gone' | 'expired' }[]
let fetchFn: (source: WatchSource, url: string, signal: AbortSignal) => Promise<WatchFetchResult>

function seedProject(database: Db, id: string, source: string = 'mostaql'): number {
  const res = upsertProjectsBatch(
    database,
    [
      {
        source,
        externalId: id,
        url: `https://${source}.com/p/${id}`,
        title: `Project ${id}`,
        descriptionExcerpt: `Excerpt ${id}`,
        publishedAt: '2026-09-24T13:00:00.000Z',
        publishedRaw: null
      }
    ],
    { now: '2026-09-24T14:00:00.000Z', discoveryKind: 'live' }
  )
  return res.insertedIds[0]!
}

const MOSTAQL_HTML_OPEN = `
<div id="project-meta-panel">
  <div class="meta-row">
    <div class="meta-label">حالة المشروع</div>
    <div class="meta-value"><span class="label-prj-open">مفتوح</span></div>
  </div>
</div>
`

const NAFEZLY_HTML_OPEN = `
<div>بطاقة المشروع</div>
<div class="col-12 row p-3">
  <div>
    <div class="col-6">حالة المشروع</div>
    <div>مفتوح</div>
  </div>
</div>
`

const MOSTAQL_HTML_IN_PROGRESS = `
<div id="project-meta-panel">
  <div class="meta-row">
    <div class="meta-label">حالة المشروع</div>
    <div class="meta-value"><span class="label-prj-processing">قيد التنفيذ</span></div>
  </div>
</div>
`

const MOSTAQL_HTML_CLOSED = `
<div id="project-meta-panel">
  <div class="meta-row">
    <div class="meta-label">حالة المشروع</div>
    <div class="meta-value"><span class="label-prj-closed">مغلق</span></div>
  </div>
</div>
`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-watcher-test-'))
  db = openDatabase(join(dir, 'test.db'))
  nowMs = 1_700_000_000_000

  arbiters = {
    mostaql: new SourceArbiter({ now: () => nowMs, minGapMs: 0 }),
    nafezly: new SourceArbiter({ now: () => nowMs, minGapMs: 0 }),
    kaf: new SourceArbiter({ now: () => nowMs, minGapMs: 0 })
  }

  gateOpenState = {
    mostaql: true,
    nafezly: true,
    kaf: true
  }

  pollSuccessSinceTimes = {
    mostaql: 0,
    nafezly: 0,
    kaf: 0
  }

  blockedCalls = []
  changedCalls = []
  eventsCalls = []
  counterCalls = []
  stoppedCalls = []

  fetchFn = async () => ({
    kind: 'ok',
    status: 200,
    finalUrl: null,
    html: MOSTAQL_HTML_OPEN,
    retryAfterMs: null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  if (db && 'isOpen' in db && db.isOpen) {
    closeDatabase(db)
  }
  rmSync(dir, { recursive: true, force: true })
})

function makeWatcher(): ProjectWatcher {
  return new ProjectWatcher({
    db: () => db,
    now: () => nowMs,
    arbiter: (source: WatchSource) => arbiters[source],
    fetch: (source: WatchSource, url: string, signal: AbortSignal) => fetchFn(source, url, signal),
    gateOpen: (source: WatchSource) => gateOpenState[source] ?? false,
    pollSucceededSince: (source: WatchSource, sinceMs: number) => (pollSuccessSinceTimes[source] ?? 0) >= sinceMs,
    onBlock: (source: WatchSource, result: WatchFetchResult) => blockedCalls.push({ source, result }),
    onChanged: (ids: number[]) => changedCalls.push(ids),
    onEvents: (source: WatchSource, result: WatchSnapshotResult) => eventsCalls.push({ source, result }),
    onCounter: (source: WatchSource, counter: WatchCounter) => counterCalls.push({ source, counter }),
    onStopped: (source: WatchSource, projectId: number, reason: 'gone' | 'expired') => stoppedCalls.push({ source, projectId, reason })
  })
}

describe('ProjectWatcher', () => {
  it('1. one check in flight per source; a second pump returns the same promise; two sources run independently', async () => {
    const watcher = makeWatcher()
    const pMostaql = seedProject(db, 'p1-mostaql', 'mostaql')
    const pNafezly = seedProject(db, 'p1-nafezly', 'nafezly')
    setWatch(db, { projectId: pMostaql, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    setWatch(db, { projectId: pNafezly, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    let resolveMostaql!: (res: WatchFetchResult) => void
    const mostaqlPromise = new Promise<WatchFetchResult>((resolve) => {
      resolveMostaql = resolve
    })
    let resolveNafezly!: (res: WatchFetchResult) => void
    const nafezlyPromise = new Promise<WatchFetchResult>((resolve) => {
      resolveNafezly = resolve
    })

    fetchFn = async (source) => {
      if (source === 'mostaql') return mostaqlPromise
      return nafezlyPromise
    }

    const pump1 = watcher.pump('mostaql')
    const pump2 = watcher.pump('mostaql')
    expect(pump2).toBe(pump1)

    const pumpNaf = watcher.pump('nafezly')
    expect(pumpNaf).not.toBe(pump1)

    resolveMostaql({
      kind: 'ok',
      status: 200,
      finalUrl: null,
      html: MOSTAQL_HTML_OPEN,
      retryAfterMs: null
    })
    resolveNafezly({
      kind: 'ok',
      status: 200,
      finalUrl: null,
      html: NAFEZLY_HTML_OPEN,
      retryAfterMs: null
    })

    await Promise.all([pump1, pumpNaf])
    expect(counterCalls.filter(c => c.source === 'mostaql' && c.counter === 'ok')).toHaveLength(1)
    expect(counterCalls.filter(c => c.source === 'nafezly' && c.counter === 'ok')).toHaveLength(1)
  })

  it('2. gate closed / paused / needsPollSuccess without a poll success -> no fetch at all; after pollSucceededSince turns true the flag is cleared and one check runs', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p2-m', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    let fetchCount = 0
    fetchFn = async () => {
      fetchCount++
      return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
    }

    // Gate closed
    gateOpenState.mostaql = false
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(0)
    gateOpenState.mostaql = true

    // Paused until future
    saveWatchSourceState(db, {
      source: 'mostaql',
      slotMs: WATCH_SLOT_MS,
      successStreak: 0,
      pausedUntil: new Date(nowMs + 60_000).toISOString(),
      blockedAt: null,
      needsPollSuccess: false
    })
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(0)

    // Unpaused, but needsPollSuccess is true and poll has not succeeded since blockedAt
    saveWatchSourceState(db, {
      source: 'mostaql',
      slotMs: WATCH_SLOT_MS,
      successStreak: 0,
      pausedUntil: null,
      blockedAt: new Date(nowMs - 1000).toISOString(),
      needsPollSuccess: true
    })
    pollSuccessSinceTimes.mostaql = nowMs - 2000
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(0)

    // Poll succeeds after blockedAt
    pollSuccessSinceTimes.mostaql = nowMs
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    const updatedState = getWatchSourceState(db, 'mostaql')
    expect(updatedState.needsPollSuccess).toBe(false)
  })

  it('3. slot spacing: no second check before slotMs; clock moving backwards does not cause a burst', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p3-m', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    let fetchCount = 0
    fetchFn = async () => {
      fetchCount++
      return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
    }

    // Check 1
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    // Call before slotMs (e.g. 5000ms later when slotMs is 10000ms)
    nowMs += 5000
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    // Clock moves backwards: T becomes new time, returns without burst
    nowMs -= 10_000
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    // Still within slotMs of the new T
    nowMs += 2000
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    // Advance past slotMs from new T
    nowMs += WATCH_SLOT_MS
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(2)
  })

  it('4. fairness: with many submitted and some other watches always due, every 4th pick is an other one; with only one class present, it is served every time', async () => {
    const watcher = makeWatcher()
    const pSub1 = seedProject(db, 'p4-sub1', 'mostaql')
    const pSub2 = seedProject(db, 'p4-sub2', 'mostaql')
    const pSub3 = seedProject(db, 'p4-sub3', 'mostaql')
    const pSub4 = seedProject(db, 'p4-sub4', 'mostaql')
    const pOth1 = seedProject(db, 'p4-oth1', 'mostaql')
    const pOth2 = seedProject(db, 'p4-oth2', 'mostaql')

    const t0 = new Date(nowMs).toISOString()
    for (const pid of [pSub1, pSub2, pSub3, pSub4, pOth1, pOth2]) {
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: t0 })
    }

    updateUserState(db, pSub1, { status: 'submitted' }, t0)
    updateUserState(db, pSub2, { status: 'submitted' }, t0)
    updateUserState(db, pSub3, { status: 'submitted' }, t0)
    updateUserState(db, pSub4, { status: 'submitted' }, t0)
    updateUserState(db, pOth1, { status: 'interested' }, t0)
    updateUserState(db, pOth2, { status: 'interested' }, t0)

    const pickedIds: number[] = []
    fetchFn = async (_source, url) => {
      const match = /\/p\/p4-(.+)$/.exec(url)
      const name = match ? match[1] : ''
      if (name?.startsWith('sub')) {
        pickedIds.push(1) // submitted
      } else {
        pickedIds.push(0) // other
      }
      return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
    }

    for (let i = 0; i < 8; i++) {
      nowMs += WATCH_SLOT_MS + 1
      for (const pid of [pSub1, pSub2, pSub3, pSub4, pOth1, pOth2]) {
        setNextDue(db, { projectId: pid, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      }
      await watcher.pump('mostaql')
    }

    // Picks 1, 2, 3 submitted (1), pick 4 other (0), picks 5, 6, 7 submitted (1), pick 8 other (0)
    expect(pickedIds).toEqual([1, 1, 1, 0, 1, 1, 1, 0])

    // With ONLY submitted present
    db.exec(`DELETE FROM project_watch WHERE project_id IN (${pOth1}, ${pOth2});`)
    const onlySubPicks: number[] = []
    for (let i = 0; i < 4; i++) {
      nowMs += WATCH_SLOT_MS + 1
      for (const pid of [pSub1, pSub2, pSub3, pSub4]) {
        setNextDue(db, { projectId: pid, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      }
      await watcher.pump('mostaql')
      onlySubPicks.push(pickedIds[pickedIds.length - 1]!)
    }
    expect(onlySubPicks).toEqual([1, 1, 1, 1])

    // With ONLY other present
    db.exec(`DELETE FROM project_watch;`)
    const pOthOnly = seedProject(db, 'p4-oth-only', 'mostaql')
    setWatch(db, { projectId: pOthOnly, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    updateUserState(db, pOthOnly, { status: 'interested' }, new Date(nowMs).toISOString())

    const onlyOthPicks: number[] = []
    for (let i = 0; i < 4; i++) {
      nowMs += WATCH_SLOT_MS + 1
      setNextDue(db, { projectId: pOthOnly, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      await watcher.pump('mostaql')
      onlyOthPicks.push(pickedIds[pickedIds.length - 1]!)
    }
    expect(onlyOthPicks).toEqual([0, 0, 0, 0])
  })

  it('5. arbiter: a watch is not started when the arbiter denies (poll active, poll due soon); a poll claimed during the fetch preempts it -> nothing written, latePreemptions increments, counter preempted; a later successful check resets it', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p5-m', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    let fetchStarted = false
    let resolveFetch!: (res: WatchFetchResult) => void
    fetchFn = () => {
      fetchStarted = true
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    }

    // 1. Arbiter denies because poll is active
    const pollClaim = arbiters.mostaql.claim('poll')
    expect(pollClaim).not.toBeNull()
    await watcher.pump('mostaql')
    expect(fetchStarted).toBe(false)
    pollClaim?.release()

    // 2. Poll claimed during fetch preempts watch
    nowMs += WATCH_SLOT_MS + 1
    const pumpPromise = watcher.pump('mostaql')
    expect(fetchStarted).toBe(true)

    // Preempt by claiming poll on arbiter
    const pollClaim2 = arbiters.mostaql.claim('poll')
    expect(pollClaim2).not.toBeNull()

    resolveFetch({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null })
    await pumpPromise

    expect(counterCalls).toEqual([{ source: 'mostaql', counter: 'preempted' }])
    expect(watcher.latePreemptions(p1)).toBe(1)
    const rowAfterPreempt = getWatch(db, p1)
    expect(rowAfterPreempt?.lastAttemptAt).toBeNull()

    pollClaim2?.release()

    // 3. A later successful check resets latePreemptions
    fetchFn = async () => ({
      kind: 'ok',
      status: 200,
      finalUrl: null,
      html: MOSTAQL_HTML_OPEN,
      retryAfterMs: null
    })
    nowMs += WATCH_SLOT_MS + 1
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')

    expect(watcher.latePreemptions(p1)).toBe(0)
    expect(counterCalls.some(c => c.counter === 'ok')).toBe(true)
  })

  it('6. each classification: 404, 410, 401, 429, 403 private, 403 other, 202 empty, challenge page, gone redirect, invalid, timeout, network, too_large, fetch throwing', async () => {
    const nafezlyPrivateHtml = readFileSync(join(__dirname, 'fixtures/watch/nafezly-private-403.html'), 'utf8')
    let watcher = makeWatcher()

    // 1. 404 -> gone
    const p404 = seedProject(db, 'p6-404', 'mostaql')
    setWatch(db, { projectId: p404, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 404, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, p404)?.state).toBe('stopped')
    expect(getWatch(db, p404)?.stopReason).toBe('gone')
    expect(changedCalls).toContainEqual([p404])

    // 2. 410 -> gone
    const p410 = seedProject(db, 'p6-410', 'mostaql')
    setWatch(db, { projectId: p410, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 410, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, p410)?.state).toBe('stopped')
    expect(getWatch(db, p410)?.stopReason).toBe('gone')

    // 3. 401 -> BLOCK
    const p401 = seedProject(db, 'p6-401', 'mostaql')
    setWatch(db, { projectId: p401, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 401, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    const preBlockNow = nowMs
    await watcher.pump('mostaql')
    expect(blockedCalls).toHaveLength(1)
    let state = getWatchSourceState(db, 'mostaql')
    expect(state.needsPollSuccess).toBe(true)
    expect(state.slotMs).toBe(20_000)
    expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'blocked' })
    expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'slowed' })
    expect(getWatch(db, p401)?.nextDueAt).toBe(new Date(preBlockNow + WATCH_BLOCK_PAUSE_MS).toISOString())

    // Clear block for next test
    saveWatchSourceState(db, { ...state, slotMs: 10_000, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()

    // 4. 429 -> BLOCK (honours retryAfterMs)
    const p429 = seedProject(db, 'p6-429', 'mostaql')
    setWatch(db, { projectId: p429, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 429, finalUrl: null, html: null, retryAfterMs: 45 * 60 * 1000 })
    nowMs += WATCH_SLOT_MS + 1
    const pre429Now = nowMs
    await watcher.pump('mostaql')
    expect(blockedCalls).toHaveLength(2)
    state = getWatchSourceState(db, 'mostaql')
    expect(state.pausedUntil).toBe(new Date(pre429Now + 45 * 60 * 1000).toISOString())
    saveWatchSourceState(db, { ...state, slotMs: 10_000, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()

    // 5. 403 private -> gone (not blocked)
    const p403Priv = seedProject(db, 'p6-403p', 'nafezly')
    setWatch(db, { projectId: p403Priv, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 403, finalUrl: null, html: nafezlyPrivateHtml, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('nafezly')
    expect(getWatch(db, p403Priv)?.state).toBe('stopped')
    expect(getWatch(db, p403Priv)?.stopReason).toBe('gone')
    expect(getWatchSourceState(db, 'nafezly').needsPollSuccess).toBe(false)

    // 6. 403 other -> BLOCK
    const p403Other = seedProject(db, 'p6-403o', 'mostaql')
    setWatch(db, { projectId: p403Other, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 403, finalUrl: null, html: '<h3>403 Forbidden</h3>', retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatchSourceState(db, 'mostaql').needsPollSuccess).toBe(true)
    saveWatchSourceState(db, { ...getWatchSourceState(db, 'mostaql'), slotMs: 10_000, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()

    // 7. 202 empty -> BLOCK
    const p202 = seedProject(db, 'p6-202', 'mostaql')
    setWatch(db, { projectId: p202, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'http', status: 202, finalUrl: null, html: '   \n ', retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatchSourceState(db, 'mostaql').needsPollSuccess).toBe(true)
    saveWatchSourceState(db, { ...getWatchSourceState(db, 'mostaql'), slotMs: 10_000, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()

    // 8. challenge page -> BLOCK
    const pChl = seedProject(db, 'p6-chl', 'mostaql')
    setWatch(db, { projectId: pChl, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: '<html><title>Just a moment...</title><body>challenge-form</body></html>', retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatchSourceState(db, 'mostaql').needsPollSuccess).toBe(true)
    saveWatchSourceState(db, { ...getWatchSourceState(db, 'mostaql'), slotMs: 10_000, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()

    // 9. gone redirect -> gone
    const pGoneRedirect = seedProject(db, 'p6-goneredir', 'mostaql')
    setWatch(db, { projectId: pGoneRedirect, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({
      kind: 'ok',
      status: 200,
      finalUrl: 'https://mostaql.com/projects',
      html: '<title>المشاريع المفتوحة - مستقل</title><div id="filter-projects"></div>',
      retryAfterMs: null
    })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pGoneRedirect)?.state).toBe('stopped')
    expect(getWatch(db, pGoneRedirect)?.stopReason).toBe('gone')

    // 10. invalid -> failure
    const pInv = seedProject(db, 'p6-inv', 'mostaql')
    setWatch(db, { projectId: pInv, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: '<div>invalid page</div>', retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pInv)?.failures).toBe(1)
    expect(getWatch(db, pInv)?.lastError).toBe('invalid')
    expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'failed' })

    // 11. timeout -> failure
    const pTime = seedProject(db, 'p6-time', 'mostaql')
    setWatch(db, { projectId: pTime, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'timeout', status: null, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pTime)?.failures).toBe(1)
    expect(getWatch(db, pTime)?.lastError).toBe('timeout')

    // 12. network -> failure
    const pNet = seedProject(db, 'p6-net', 'mostaql')
    setWatch(db, { projectId: pNet, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'network', status: null, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pNet)?.failures).toBe(1)
    expect(getWatch(db, pNet)?.lastError).toBe('network')

    // 13. too_large -> failure
    const pLarge = seedProject(db, 'p6-large', 'mostaql')
    setWatch(db, { projectId: pLarge, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => ({ kind: 'too_large', status: null, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pLarge)?.failures).toBe(1)
    expect(getWatch(db, pLarge)?.lastError).toBe('too_large')

    // 14. fetch throwing -> network failure
    const pThrow = seedProject(db, 'p6-throw', 'mostaql')
    setWatch(db, { projectId: pThrow, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    fetchFn = async () => {
      throw new Error('Connection refused')
    }
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pThrow)?.failures).toBe(1)
    expect(getWatch(db, pThrow)?.lastError).toBe('network')
  })

  it('7. block recovery: pause length honours Retry-After larger than 30 min and never shortens an existing pause; slot doubles up to 300 000 and halves after 20 consecutive successes (not below 10 000); state survives a new ProjectWatcher instance on the same database (restart)', async () => {
    let watcher = makeWatcher()
    const p1 = seedProject(db, 'p7-m', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    // Initial slot is 10_000
    expect(getWatchSourceState(db, 'mostaql').slotMs).toBe(10_000)

    // Block with 40 min retry-after
    fetchFn = async () => ({ kind: 'http', status: 429, finalUrl: null, html: null, retryAfterMs: 40 * 60 * 1000 })
    nowMs += WATCH_SLOT_MS + 1
    const tBlock1 = nowMs
    await watcher.pump('mostaql')

    let state = getWatchSourceState(db, 'mostaql')
    expect(state.slotMs).toBe(20_000)
    expect(state.pausedUntil).toBe(new Date(tBlock1 + 40 * 60 * 1000).toISOString())
    // Open screens are told so the platform pause note appears without navigation
    expect(changedCalls).toContainEqual([p1])

    // Repeated block with shorter retry-after (e.g. 5 min) does NOT shorten the existing pause
    // Simulate concurrent update during in-flight fetch:
    let resolveShortBlock!: (res: WatchFetchResult) => void
    fetchFn = () => new Promise((resolve) => {
      resolveShortBlock = resolve
    })
    nowMs += 50 * 60 * 1000 // advance past the first 40 min pause
    pollSuccessSinceTimes.mostaql = nowMs
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    const shortBlockPump = watcher.pump('mostaql')

    // While fetch is in flight, set pausedUntil to 60 min from now
    const longerPause = new Date(nowMs + 60 * 60 * 1000).toISOString()
    saveWatchSourceState(db, { ...getWatchSourceState(db, 'mostaql'), pausedUntil: longerPause, needsPollSuccess: false })

    // Fetch returns 429 with 5 min retry-after
    resolveShortBlock({ kind: 'http', status: 429, finalUrl: null, html: null, retryAfterMs: 5 * 60 * 1000 })
    await shortBlockPump

    state = getWatchSourceState(db, 'mostaql')
    expect(state.pausedUntil).toBe(longerPause) // Not shortened to nowMs + 30 min

    // Simulate doubling up to 300_000
    saveWatchSourceState(db, { ...state, slotMs: 160_000, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()
    fetchFn = async () => ({ kind: 'http', status: 429, finalUrl: null, html: null, retryAfterMs: null })
    nowMs += 200_000
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')
    state = getWatchSourceState(db, 'mostaql')
    expect(state.slotMs).toBe(WATCH_SLOT_MAX_MS) // 300_000

    // Successes: after 20 consecutive successes, slot halves
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null })
    saveWatchSourceState(db, { ...state, pausedUntil: null, needsPollSuccess: false })
    watcher = makeWatcher()

    for (let i = 0; i < 20; i++) {
      nowMs += WATCH_SLOT_MAX_MS + 1
      setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      await watcher.pump('mostaql')
    }

    state = getWatchSourceState(db, 'mostaql')
    expect(state.slotMs).toBe(150_000)
    expect(state.successStreak).toBe(0)

    // State survives a restart (new ProjectWatcher instance)
    watcher = makeWatcher()
    nowMs += 160_000
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')
    const restartState = getWatchSourceState(db, 'mostaql')
    expect(restartState.slotMs).toBe(150_000)
    expect(restartState.successStreak).toBe(1)
  })

  it('8. snapshot path: first snapshot silent; a status change produces onEvents with the storage result; a closed status stops the watch and onChanged includes the promoted waiter; a late result writes nothing', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p8-1', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    // 1. First snapshot is silent (no onEvents)
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(eventsCalls).toHaveLength(0)

    // 2. Status change produces onEvents
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_IN_PROGRESS, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')
    expect(eventsCalls).toHaveLength(1)
    expect(eventsCalls[0]?.result.events[0]?.kind).toBe('watch_status')

    // 3. Fill up to cap (10) and add a waiting watch
    for (let i = 2; i <= 10; i++) {
      const pid = seedProject(db, `p8-${i}`, 'mostaql')
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
      setNextDue(db, { projectId: pid, generation: 1, dueAt: new Date(nowMs + 100_000).toISOString() })
    }
    const pWait = seedProject(db, 'p8-wait', 'mostaql')
    setWatch(db, { projectId: pWait, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    expect(getWatch(db, pWait)?.state).toBe('waiting')

    // Closed status stops the watch and onChanged includes the promoted waiter
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_CLOSED, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    changedCalls = []
    await watcher.pump('mostaql')

    expect(getWatch(db, p1)?.state).toBe('stopped')
    expect(getWatch(db, pWait)?.state).toBe('active')
    expect(changedCalls).toContainEqual([p1, pWait])

    // 4. Late result (generation changed while fetch was in flight)
    db.exec('DELETE FROM project_watch;')
    const pLate = seedProject(db, 'p8-late', 'mostaql')
    setWatch(db, { projectId: pLate, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    let resolveLate!: (res: WatchFetchResult) => void
    fetchFn = () => new Promise((resolve) => {
      resolveLate = resolve
    })

    nowMs += WATCH_SLOT_MS + 1
    setNextDue(db, { projectId: pLate, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    const latePumpPromise = watcher.pump('mostaql')

    // Intervene: bump generation by turning off and on
    setWatch(db, { projectId: pLate, want: 'off', expectVersion: 1, origin: 'list', now: new Date(nowMs).toISOString() })
    setWatch(db, { projectId: pLate, want: 'on', expectVersion: 2, origin: 'list', now: new Date(nowMs).toISOString() })

    changedCalls = []
    eventsCalls = []
    resolveLate({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null })
    await latePumpPromise

    // Late result: nothing written
    expect(eventsCalls).toHaveLength(0)
    expect(changedCalls).toHaveLength(0)
  })

  it('9. idle scheduling: a watch unchanged for more than 24 h gets next_due = now + 10 min; a changed one gets now + slotMs', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p9-m', 'mostaql')
    const tStarted = new Date(nowMs - 25 * 60 * 60 * 1000).toISOString()
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: tStarted })

    // 1. Snapshot with NO change, unchanged for > 24h -> next_due = now + 10 min
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    const tCheck1 = nowMs
    await watcher.pump('mostaql')
    expect(getWatch(db, p1)?.nextDueAt).toBe(new Date(tCheck1 + WATCH_IDLE_SLOT_MS).toISOString())

    // 2. Snapshot WITH change (from open to in_progress) -> next_due = now + slotMs
    fetchFn = async () => ({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_IN_PROGRESS, retryAfterMs: null })
    nowMs += WATCH_SLOT_MS + 1
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    const tCheck2 = nowMs
    await watcher.pump('mostaql')
    expect(getWatch(db, p1)?.nextDueAt).toBe(new Date(tCheck2 + WATCH_SLOT_MS).toISOString())
  })

  it('10. failure back-off grows per project and caps at 30 min; the source is never blocked by these failures', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p10-m', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    fetchFn = async () => ({ kind: 'timeout', status: null, finalUrl: null, html: null, retryAfterMs: null })

    // Failure 1: slotMs * 2^1 = 20_000
    nowMs += WATCH_SLOT_MS + 1
    let tFail = nowMs
    await watcher.pump('mostaql')
    expect(getWatch(db, p1)?.failures).toBe(1)
    expect(getWatch(db, p1)?.nextDueAt).toBe(new Date(tFail + 20_000).toISOString())
    expect(getWatchSourceState(db, 'mostaql').needsPollSuccess).toBe(false)

    // Failure 2: slotMs * 2^2 = 40_000
    nowMs += 25_000
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    tFail = nowMs
    await watcher.pump('mostaql')
    expect(getWatch(db, p1)?.failures).toBe(2)
    expect(getWatch(db, p1)?.nextDueAt).toBe(new Date(tFail + 40_000).toISOString())

    // Set failures to 8: min(30 min, 10000 * 256) = 1_800_000 (30 min)
    db.prepare('UPDATE project_watch SET failures = 7 WHERE project_id = ?;').run(p1)
    nowMs += 50_000
    setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    tFail = nowMs
    await watcher.pump('mostaql')
    expect(getWatch(db, p1)?.failures).toBe(8)
    expect(getWatch(db, p1)?.nextDueAt).toBe(new Date(tFail + 30 * 60 * 1000).toISOString())
    expect(getWatchSourceState(db, 'mostaql').needsPollSuccess).toBe(false)
  })

  it('11. close(): aborts in-flight checks, awaits them, later pumps do nothing; a database closed during a fetch does not throw out of pump', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'p11-m', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    let aborted = false
    let resolveHanging!: (res: WatchFetchResult) => void
    fetchFn = (_source, _url, signal) => {
      signal.addEventListener('abort', () => {
        aborted = true
      })
      return new Promise((resolve) => {
        resolveHanging = resolve
      })
    }

    const pumpPromise = watcher.pump('mostaql')
    expect(aborted).toBe(false)

    const closePromise = watcher.close()
    expect(aborted).toBe(true)

    resolveHanging({ kind: 'cancelled', status: null, finalUrl: null, html: null, retryAfterMs: null })
    await closePromise
    await pumpPromise

    // Later pumps do nothing
    let calledAfterClose = false
    fetchFn = async () => {
      calledAfterClose = true
      return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
    }
    await watcher.pump('mostaql')
    expect(calledAfterClose).toBe(false)

    // Database closed during fetch does not throw
    const watcher2 = makeWatcher()
    let resolveDbFetch!: (res: WatchFetchResult) => void
    fetchFn = () => new Promise((resolve) => {
      resolveDbFetch = resolve
    })

    const pumpDbPromise = watcher2.pump('mostaql')
    // Close database while fetch is waiting
    closeDatabase(db)

    resolveDbFetch({ kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null })
    await expect(pumpDbPromise).resolves.toBeUndefined()
  })

  it('12. expiry runs in pump and reports expired and promoted ids through onChanged', async () => {
    const watcher = makeWatcher()
    const pOld = seedProject(db, 'p12-old', 'mostaql')
    const tOld = new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString()
    setWatch(db, { projectId: pOld, want: 'on', expectVersion: null, origin: 'list', now: tOld })

    // Fill capacity so next watch is waiting
    for (let i = 2; i <= 10; i++) {
      const pid = seedProject(db, `p12-${i}`, 'mostaql')
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    }
    const pWait = seedProject(db, 'p12-wait', 'mostaql')
    setWatch(db, { projectId: pWait, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    expect(getWatch(db, pWait)?.state).toBe('waiting')

    changedCalls = []
    await watcher.pump('mostaql')

    expect(getWatch(db, pOld)?.state).toBe('stopped')
    expect(getWatch(db, pOld)?.stopReason).toBe('expired')
    expect(getWatch(db, pWait)?.state).toBe('active')
    expect(changedCalls).toContainEqual([pOld, pWait])
  })

  it('rework 1: onBlock that throws still leaves source paused with needsPollSuccess=true and doubled slot; next pump makes no request', async () => {
    let fetchCount = 0
    fetchFn = async () => {
      fetchCount++
      return { kind: 'http', status: 429, finalUrl: null, html: null, retryAfterMs: null }
    }
    const watcher = new ProjectWatcher({
      db: () => db,
      now: () => nowMs,
      arbiter: (source) => arbiters[source],
      fetch: (source, url, signal) => fetchFn(source, url, signal),
      gateOpen: () => true,
      pollSucceededSince: () => false,
      onBlock: () => {
        throw new Error('boom onBlock')
      },
      onChanged: () => {},
      onEvents: () => {},
      onCounter: () => {}
    })

    const p1 = seedProject(db, 'prw-1', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    nowMs += WATCH_SLOT_MS + 1
    const tBlock = nowMs
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    const state = getWatchSourceState(db, 'mostaql')
    expect(state.needsPollSuccess).toBe(true)
    expect(state.slotMs).toBe(20_000)
    expect(state.pausedUntil).toBe(new Date(tBlock + WATCH_BLOCK_PAUSE_MS).toISOString())

    // Next pump makes NO request because source is paused and needsPollSuccess is true
    nowMs += 1000
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)
  })

  it('rework 2: onEvents and onChanged that throw still leave successStreak incremented and next_due_at set; onChanged that throws during expiry does not stop pick/check', async () => {
    let fetchCount = 0
    fetchFn = async () => {
      fetchCount++
      return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_IN_PROGRESS, retryAfterMs: null }
    }

    const watcher = new ProjectWatcher({
      db: () => db,
      now: () => nowMs,
      arbiter: (source) => arbiters[source],
      fetch: (source, url, signal) => fetchFn(source, url, signal),
      gateOpen: () => true,
      pollSucceededSince: () => true,
      onBlock: () => {},
      onChanged: () => {
        throw new Error('boom onChanged')
      },
      onEvents: () => {
        throw new Error('boom onEvents')
      },
      onCounter: () => {}
    })

    const p1 = seedProject(db, 'prw-2', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
    db.prepare(`UPDATE project_watch SET status = 'open' WHERE project_id = ?;`).run(p1)

    nowMs += WATCH_SLOT_MS + 1
    const tCheck = nowMs
    await watcher.pump('mostaql')
    expect(fetchCount).toBe(1)

    // Bookkeeping must be intact despite throwing callbacks
    const state = getWatchSourceState(db, 'mostaql')
    expect(state.successStreak).toBe(1)
    const row = getWatch(db, p1)
    expect(row?.status).toBe('in_progress')
    expect(row?.nextDueAt).toBe(new Date(tCheck + state.slotMs).toISOString())

    // Expiry with throwing onChanged does not stop following pick/check
    const pOld = seedProject(db, 'prw-2-old', 'mostaql')
    setWatch(db, { projectId: pOld, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString() })

    const pDue = seedProject(db, 'prw-2-due', 'mostaql')
    setWatch(db, { projectId: pDue, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    nowMs += 61_000
    setNextDue(db, { projectId: pDue, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')

    expect(getWatch(db, pOld)?.state).toBe('stopped')
    expect(getWatch(db, pOld)?.stopReason).toBe('expired')
    expect(fetchCount).toBe(2)
  })

  it('rework 3: expiry cost: expireWatches runs at most once per 60 seconds per source', async () => {
    const watcher = makeWatcher()

    // Pump 1: runs expiry immediately (first pump)
    const pOld1 = seedProject(db, 'prw-3-old1', 'mostaql')
    setWatch(db, { projectId: pOld1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString() })
    await watcher.pump('mostaql')
    expect(getWatch(db, pOld1)?.state).toBe('stopped')
    expect(getWatch(db, pOld1)?.stopReason).toBe('expired')

    // 10 seconds later, add another expired watch and a due watch
    nowMs += 10_000
    const pOld2 = seedProject(db, 'prw-3-old2', 'mostaql')
    setWatch(db, { projectId: pOld2, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString() })

    const pActive = seedProject(db, 'prw-3-act', 'mostaql')
    setWatch(db, { projectId: pActive, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    // Pump 2 (10 s after Pump 1): expiry is NOT run, pOld2 is still active
    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')
    expect(getWatch(db, pOld2)?.state).toBe('active')

    // Advance clock past 60 s from Pump 1
    nowMs += 60_000
    setNextDue(db, { projectId: pActive, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
    await watcher.pump('mostaql')
    // Pump 3 (after 60 s): expiry runs, pOld2 is now stopped
    expect(getWatch(db, pOld2)?.state).toBe('stopped')
    expect(getWatch(db, pOld2)?.stopReason).toBe('expired')
  })

  it('rework 4: 202 handling: any 202 response (empty or not) is a BLOCK, never parsed as a snapshot', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'prw-4', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    // 202 with valid project fixture body
    fetchFn = async () => ({
      kind: 'ok',
      status: 202,
      finalUrl: null,
      html: MOSTAQL_HTML_OPEN,
      retryAfterMs: null
    })

    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')

    // Assert: block handling executed, no snapshot written
    const state = getWatchSourceState(db, 'mostaql')
    expect(state.needsPollSuccess).toBe(true)
    expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'blocked' })

    const row = getWatch(db, p1)
    expect(row?.status).toBeNull() // No snapshot written
    expect(eventsCalls).toHaveLength(0)
  })

  it('rework 5: status not 200 and not handled by 10a-10c (e.g. 500) goes to failure path 10e and is never parsed as snapshot', async () => {
    const watcher = makeWatcher()
    const p1 = seedProject(db, 'prw-5', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

    // 500 with a valid fixture body
    fetchFn = async () => ({
      kind: 'ok',
      status: 500,
      finalUrl: null,
      html: MOSTAQL_HTML_OPEN,
      retryAfterMs: null
    })

    nowMs += WATCH_SLOT_MS + 1
    await watcher.pump('mostaql')

    // Assert: failure recorded, no snapshot written, source NOT blocked
    const row = getWatch(db, p1)
    expect(row?.failures).toBe(1)
    expect(row?.lastError).toBe('http-500')
    expect(row?.status).toBeNull() // No snapshot written

    const state = getWatchSourceState(db, 'mostaql')
    expect(state.needsPollSuccess).toBe(false) // Source is NOT blocked
    expect(state.pausedUntil).toBeNull()
    expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'failed' })
  })

  describe('rework items 1-7', () => {
    it('item 1: block verdict runs source-level block handling even when cancelled, but skips project-level writes', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw1', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      // Transport returns status 403 (non-private) after caller aborts
      fetchFn = async (_source, _url, signal) => {
        watcher.abort('mostaql')
        expect(signal.aborted).toBe(true)
        return {
          kind: 'http',
          status: 403,
          finalUrl: 'https://mostaql.com/project/123',
          html: '<html><body>Cloudflare Block</body></html>',
          retryAfterMs: null
        }
      }

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // SOURCE-level block handling runs:
      expect(blockedCalls).toHaveLength(1)
      expect(blockedCalls[0]?.source).toBe('mostaql')
      expect(blockedCalls[0]?.result.status).toBe(403)
      expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'blocked' })

      const state = getWatchSourceState(db, 'mostaql')
      expect(state.needsPollSuccess).toBe(true)
      expect(state.pausedUntil).not.toBeNull()

      // Project-level writes are skipped (e.g. nextDueAt is null, not set to pause length)
      const row = getWatch(db, p1)
      expect(row?.nextDueAt).toBeNull()

      // Also verify non-block result after cancellation writes nothing
      db.exec('DELETE FROM project_watch;')
      const p2 = seedProject(db, 'p-rw1-noblock', 'nafezly')
      setWatch(db, { projectId: p2, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
      blockedCalls = []
      counterCalls = []

      fetchFn = async () => {
        watcher.abort('nafezly')
        return {
          kind: 'ok',
          status: 200,
          finalUrl: 'https://nafezly.com/project/123',
          html: NAFEZLY_HTML_OPEN,
          retryAfterMs: null
        }
      }

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('nafezly')

      expect(blockedCalls).toHaveLength(0)
      const nafRow = getWatch(db, p2)
      expect(nafRow?.status).toBeNull()
      expect(getWatchSourceState(db, 'nafezly').needsPollSuccess).toBe(false)
    })

    it('item 2: block handling survives SQLite persistence failure', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw2', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      // Create a trigger that throws on watch_source_state writes
      db.exec(`
        CREATE TRIGGER test_block_fail_ins BEFORE INSERT ON watch_source_state
        BEGIN SELECT RAISE(FAIL, 'sqlite error on block state'); END;
        CREATE TRIGGER test_block_fail_upd BEFORE UPDATE ON watch_source_state
        BEGIN SELECT RAISE(FAIL, 'sqlite error on block state'); END;
      `)

      let fetchCount = 0
      fetchFn = async () => {
        fetchCount++
        return {
          kind: 'http',
          status: 429,
          finalUrl: null,
          html: null,
          retryAfterMs: 60_000
        }
      }

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // Assert onBlock was called despite persistence failure
      expect(blockedCalls).toHaveLength(1)
      expect(blockedCalls[0]?.source).toBe('mostaql')
      expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'blocked' })

      // 10 seconds later, another pump occurs: memoryPausedUntil prevents any fetch
      nowMs += 10_000
      await watcher.pump('mostaql')
      expect(fetchCount).toBe(1) // No new request!

      // After 30 min pause expires, memoryNeedsPollSuccess prevents any fetch
      nowMs += WATCH_BLOCK_PAUSE_MS + 1
      await watcher.pump('mostaql')
      expect(fetchCount).toBe(1) // Still no new request!

      // Once poll succeeds, check can run
      pollSuccessSinceTimes.mostaql = nowMs
      nowMs += WATCH_SLOT_MS + 1
      // Remove trigger so state can clear
      db.exec(`
        DROP TRIGGER test_block_fail_ins;
        DROP TRIGGER test_block_fail_upd;
      `)
      fetchFn = async () => {
        fetchCount++
        return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
      }
      await watcher.pump('mostaql')
      expect(fetchCount).toBe(2)
    })

    it('item 2b: block handling uses the longer of new pause and retained stored/memory pause for next due', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw2b', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      let fetchCount = 0
      const longerStoredPauseMs = nowMs + 60 * 60 * 1000
      const longerStoredPauseIso = new Date(longerStoredPauseMs).toISOString()

      // Exercise a block that happens while a longer stored pause already exists in DB
      fetchFn = async () => {
        fetchCount++
        saveWatchSourceState(db, {
          source: 'mostaql',
          slotMs: 10_000,
          successStreak: 0,
          pausedUntil: longerStoredPauseIso,
          blockedAt: null,
          needsPollSuccess: false
        })
        return {
          kind: 'http',
          status: 429,
          finalUrl: null,
          html: null,
          retryAfterMs: 30 * 60 * 1000 // 30 min default pause < 60 min stored pause
        }
      }

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // Assert number of fetch calls
      expect(fetchCount).toBe(1)
      // Project's next due must equal the longer deadline (60 min stored pause, not 30 min new block pause)
      expect(getWatch(db, p1)?.nextDueAt).toBe(longerStoredPauseIso)
    })

    it('item 3: lifecycle race: close() during expiry prevents fetch, re-entrant pump returns same promise', async () => {
      let pumpPromise2: Promise<void> | null = null
      let fetchCalled = false

      const pExp = seedProject(db, 'p-rw3-exp', 'mostaql')
      setWatch(db, {
        projectId: pExp,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: new Date(nowMs - 20 * 24 * 60 * 60 * 1000).toISOString()
      })
      const pActive = seedProject(db, 'p-rw3-act', 'mostaql')
      setWatch(db, {
        projectId: pActive,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: new Date(nowMs).toISOString()
      })

      fetchFn = async () => {
        fetchCalled = true
        return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
      }

      let watcherRef: ProjectWatcher | null = null
      const watcher = new ProjectWatcher({
        db: () => db,
        now: () => nowMs,
        arbiter: (source: WatchSource) => arbiters[source],
        fetch: (source: WatchSource, url: string, signal: AbortSignal) => fetchFn(source, url, signal),
        gateOpen: (source: WatchSource) => gateOpenState[source] ?? false,
        pollSucceededSince: () => true,
        onBlock: () => {},
        onChanged: () => {
          // Inside expiry onChanged callback:
          // 1. Re-entrant pump returns same promise
          if (watcherRef) {
            pumpPromise2 = watcherRef.pump('mostaql')
            // 2. Call close() before fetch starts
            void watcherRef.close()
          }
        },
        onEvents: () => {},
        onCounter: () => {}
      })
      watcherRef = watcher

      const pumpPromise1 = watcher.pump('mostaql')
      expect(pumpPromise2).toBe(pumpPromise1)

      await pumpPromise1
      expect(fetchCalled).toBe(false) // Un-aborted fetch NEVER started
    })

    it('item 4: generation guard prevents old stop from stopping new generation', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw4-gen', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      let resolveFetch!: (res: WatchFetchResult) => void
      fetchFn = () => new Promise(res => {
        resolveFetch = res
      })

      nowMs += WATCH_SLOT_MS + 1
      const pumpPromise = watcher.pump('mostaql')

      // While fetch is in-flight, stop and restart watch -> generation increments to 2
      setWatch(db, { projectId: p1, want: 'off', expectVersion: 1, origin: 'list', now: new Date(nowMs).toISOString() })
      setWatch(db, { projectId: p1, want: 'on', expectVersion: 2, origin: 'list', now: new Date(nowMs).toISOString() })
      expect(getWatch(db, p1)?.generation).toBe(2)
      expect(getWatch(db, p1)?.state).toBe('active')

      // Old fetch completes with 404
      resolveFetch({
        kind: 'http',
        status: 404,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
      await pumpPromise

      // Assert: NEW generation was NOT stopped
      const current = getWatch(db, p1)!
      expect(current.generation).toBe(2)
      expect(current.state).toBe('active')
      expect(current.stopReason).toBeNull()
    })

    it('item 5: rule 10e failure resets successStreak to 0 in source state', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw5-streak', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      // Seed state with 19 successes and slotMs 20_000
      saveWatchSourceState(db, {
        source: 'mostaql',
        slotMs: 20_000,
        successStreak: 19,
        pausedUntil: null,
        blockedAt: null,
        needsPollSuccess: false
      })

      // Network failure
      fetchFn = async () => ({
        kind: 'network',
        status: null,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // Assert: successStreak reset to 0
      const stateAfterFail = getWatchSourceState(db, 'mostaql')
      expect(stateAfterFail.successStreak).toBe(0)
      expect(stateAfterFail.slotMs).toBe(20_000)

      // Subsequent success check increments streak to 1, does NOT halve slotMs
      fetchFn = async () => ({
        kind: 'ok',
        status: 200,
        finalUrl: null,
        html: MOSTAQL_HTML_OPEN,
        retryAfterMs: null
      })
      nowMs += 20_000 + 1
      setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      await watcher.pump('mostaql')

      const stateAfterSuccess = getWatchSourceState(db, 'mostaql')
      expect(stateAfterSuccess.successStreak).toBe(1)
      expect(stateAfterSuccess.slotMs).toBe(20_000) // Not halved
    })

    it('item 6: ambiguous status (kind ok with status null) goes to failure path 10e and produces no events', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw6-ambig', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      // kind ok with status null and changed html
      fetchFn = async () => ({
        kind: 'ok',
        status: null,
        finalUrl: null,
        html: MOSTAQL_HTML_IN_PROGRESS,
        retryAfterMs: null
      })

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // Assert: NOT parsed as snapshot, NO events emitted
      expect(eventsCalls).toHaveLength(0)
      const row = getWatch(db, p1)
      expect(row?.status).toBeNull() // No snapshot applied
      expect(row?.failures).toBe(1)
      expect(row?.lastError).toBe('invalid')
      expect(counterCalls).toContainEqual({ source: 'mostaql', counter: 'failed' })
    })

    it('item 7: latePreemptions resets after every completed non-cancelled check', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw7-preempt', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      // Check 1: Arbiter preempts check
      fetchFn = async () => {
        const claim = arbiters.mostaql.claim('poll', () => {})
        claim?.release({ ok: true })
        return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
      }

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')
      expect(watcher.latePreemptions(p1)).toBe(1)

      // Check 2: Completed check that fails with 10e (e.g. timeout) - NOT cancelled
      fetchFn = async () => ({
        kind: 'timeout',
        status: null,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })

      nowMs += WATCH_SLOT_MS + 1
      setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      await watcher.pump('mostaql')

      // Assert latePreemptions was reset to 0 after completed check
      expect(watcher.latePreemptions(p1)).toBe(0)
    })

    it('item 1: in-memory block guard persists across external stored pause clear and combines effective state', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw1-memguard', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      let fetchCount = 0
      fetchFn = async () => {
        fetchCount++
        return {
          kind: 'http',
          status: 429,
          finalUrl: null,
          html: null,
          retryAfterMs: 30 * 60 * 1000
        }
      }

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')
      expect(fetchCount).toBe(1)

      // External clearing of stored pause and needsPollSuccess
      saveWatchSourceState(db, {
        source: 'mostaql',
        slotMs: 10_000,
        successStreak: 0,
        pausedUntil: null,
        blockedAt: null,
        needsPollSuccess: false
      })

      // 20s later, another pump is attempted
      nowMs += 20_000
      setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })
      await watcher.pump('mostaql')

      // Fetch is NOT called because in-memory guard is still active
      expect(fetchCount).toBe(1)
    })

    it('item 1: poll success predating newer block does not clear in-memory guard', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw1-predate', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      // Initial state: older stored block at T1
      const t1 = nowMs
      saveWatchSourceState(db, {
        source: 'mostaql',
        slotMs: 10_000,
        successStreak: 0,
        pausedUntil: new Date(t1 + 20 * 1000).toISOString(),
        blockedAt: new Date(t1).toISOString(),
        needsPollSuccess: true
      })

      // Poll succeeds at T2 (T1 < T2)
      const t2 = t1 + 30 * 1000
      pollSuccessSinceTimes.mostaql = t2

      // Newer block at T3 (T2 < T3) with failed persist
      const t3 = t1 + 50 * 1000
      nowMs = t3

      let fetchCount = 0
      fetchFn = async () => {
        fetchCount++
        // Cause handleBlock's DB persist to throw for this newer block
        db.prepare(`
          CREATE TRIGGER IF NOT EXISTS fail_save_source_state_rw1
          BEFORE UPDATE ON watch_source_state
          BEGIN
            SELECT RAISE(FAIL, 'simulated source state write failure');
          END;
        `).run()
        return {
          kind: 'http',
          status: 429,
          finalUrl: null,
          html: null,
          retryAfterMs: 30 * 60 * 1000
        }
      }

      await watcher.pump('mostaql')
      expect(fetchCount).toBe(1)

      // Drop failure trigger
      db.prepare('DROP TRIGGER IF EXISTS fail_save_source_state_rw1').run()

      // Now advance time past pause
      nowMs += 35 * 60 * 1000
      setNextDue(db, { projectId: p1, generation: 1, dueAt: new Date(nowMs - 1000).toISOString() })

      // Pump should still NOT request because poll success at T2 predates T3 block (memBlockedAt is T3)
      await watcher.pump('mostaql')
      expect(fetchCount).toBe(1)

      // Only a poll success after T3 allows recovery
      pollSuccessSinceTimes.mostaql = nowMs
      fetchFn = async () => {
        fetchCount++
        return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
      }
      await watcher.pump('mostaql')
      expect(fetchCount).toBe(2)
    })

    it('item 2: failed safety read before deps.fetch fails closed, releases claim cancelled, and does not fetch', async () => {
      const watcher = makeWatcher()
      const p1 = seedProject(db, 'p-rw2-failread', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      let fetchCalled = false
      fetchFn = async () => {
        fetchCalled = true
        return { kind: 'ok', status: 200, finalUrl: null, html: MOSTAQL_HTML_OPEN, retryAfterMs: null }
      }

      // Track claim release
      const arbiter = arbiters.mostaql
      let releasedOutcome: { ok?: boolean; cancelled?: boolean } | null = null
      const originalClaim = arbiter.claim.bind(arbiter)
      vi.spyOn(arbiter, 'claim').mockImplementation((kind, onPreempt) => {
        const claim = originalClaim(kind, onPreempt)
        if (!claim) return null
        const originalRelease = claim.release.bind(claim)
        claim.release = (outcome) => {
          releasedOutcome = outcome ?? null
          originalRelease(outcome)
        }
        return claim
      })

      // Simulate state read error right after claim (in pre-fetch re-check)
      let getWatchCount = 0
      const origPrepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('watch_source_state')) {
          getWatchCount++
          // First call is Rule 2, second call is pre-fetch re-check
          if (getWatchCount === 2) {
            throw new Error('simulated disk error during pre-fetch state read')
          }
        }
        return origPrepare(sql)
      })

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // Assert fetch was NOT called
      expect(fetchCalled).toBe(false)
      // Assert claim was released with cancelled: true
      expect(releasedOutcome).toEqual({ cancelled: true })
    })

    it('item 3: throwing blocked counter callback does not suppress slowed counter callback', async () => {
      const counters: string[] = []
      const watcher = new ProjectWatcher({
        db: () => db,
        now: () => nowMs,
        arbiter: (source) => arbiters[source],
        fetch: (source, url, signal) => fetchFn(source, url, signal),
        gateOpen: () => true,
        pollSucceededSince: (source, sinceMs) => (pollSuccessSinceTimes[source] ?? 0) >= sinceMs,
        onBlock: () => {},
        onChanged: () => {},
        onEvents: () => {},
        onCounter: (source, counter) => {
          counters.push(counter)
          if (counter === 'blocked') {
            throw new Error('boom on blocked counter')
          }
        }
      })

      const p1 = seedProject(db, 'p-rw3-counter', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      fetchFn = async () => ({
        kind: 'http',
        status: 429,
        finalUrl: null,
        html: null,
        retryAfterMs: 30 * 60 * 1000
      })

      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')

      // Both 'blocked' and 'slowed' must have been invoked
      expect(counters).toContain('blocked')
      expect(counters).toContain('slowed')
    })

    it('onStopped is called for gone/private stops and for expired watches with the right reason and id', async () => {
      const watcher = makeWatcher()
      // 1. 404 response -> gone
      const p1 = seedProject(db, 'p-gone-404', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
      fetchFn = async () => ({
        kind: 'http',
        status: 404,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('mostaql')
      expect(stoppedCalls).toContainEqual({ source: 'mostaql', projectId: p1, reason: 'gone' })

      // 2. 403 private -> gone
      stoppedCalls = []
      const p2 = seedProject(db, 'p-gone-private', 'kaf')
      setWatch(db, { projectId: p2, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
      fetchFn = async () => ({
        kind: 'http',
        status: 403,
        finalUrl: null,
        html: '<html><body><div class="help-center"><p class="about-desc">403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة</p></div></body></html>',
        retryAfterMs: null
      })
      nowMs += WATCH_SLOT_MS + 1
      await watcher.pump('kaf')
      expect(stoppedCalls).toContainEqual({ source: 'kaf', projectId: p2, reason: 'gone' })

      // 3. expired watch
      stoppedCalls = []
      const p3 = seedProject(db, 'p-expired', 'nafezly')
      setWatch(db, { projectId: p3, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
      // Advance past 14 days + expiry interval
      nowMs += 15 * 24 * 60 * 60 * 1000
      await watcher.pump('nafezly')
      expect(stoppedCalls).toContainEqual({ source: 'nafezly', projectId: p3, reason: 'expired' })
    })

    it('a throwing onStopped does not break the check', async () => {
      const watcher = new ProjectWatcher({
        db: () => db,
        now: () => nowMs,
        arbiter: source => arbiters[source],
        fetch: (source, url, signal) => fetchFn(source, url, signal),
        gateOpen: source => gateOpenState[source] ?? false,
        pollSucceededSince: (source, sinceMs) => (pollSuccessSinceTimes[source] ?? 0) >= sinceMs,
        onBlock: (source, result) => blockedCalls.push({ source, result }),
        onChanged: ids => changedCalls.push(ids),
        onEvents: (source, result) => eventsCalls.push({ source, result }),
        onStopped: () => {
          throw new Error('boom in onStopped callback')
        }
      })

      const p1 = seedProject(db, 'p-throwing-onstopped', 'mostaql')
      setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      fetchFn = async () => ({
        kind: 'http',
        status: 404,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })

      nowMs += WATCH_SLOT_MS + 1
      await expect(watcher.pump('mostaql')).resolves.toBeUndefined()
      const row = getWatch(db, p1)
      expect(row?.state).toBe('stopped')
      expect(row?.stopReason).toBe('gone')
    })

    it('abort(source) aborts only that source', async () => {
      const watcher = makeWatcher()
      const pMostaql = seedProject(db, 'p-abort-mostaql', 'mostaql')
      const pNafezly = seedProject(db, 'p-abort-nafezly', 'nafezly')
      setWatch(db, { projectId: pMostaql, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })
      setWatch(db, { projectId: pNafezly, want: 'on', expectVersion: null, origin: 'list', now: new Date(nowMs).toISOString() })

      let mostaqlAborted = false
      let nafezlyAborted = false
      let resolveMostaql!: () => void
      let resolveNafezly!: () => void

      fetchFn = async (source, _url, signal) => {
        if (source === 'mostaql') {
          signal.addEventListener('abort', () => { mostaqlAborted = true })
          return new Promise<WatchFetchResult>(resolve => {
            resolveMostaql = () => resolve({ kind: 'cancelled', status: null, finalUrl: null, html: null, retryAfterMs: null })
          })
        }
        signal.addEventListener('abort', () => { nafezlyAborted = true })
        return new Promise<WatchFetchResult>(resolve => {
          resolveNafezly = () => resolve({ kind: 'ok', status: 200, finalUrl: null, html: NAFEZLY_HTML_OPEN, retryAfterMs: null })
        })
      }

      nowMs += WATCH_SLOT_MS + 1
      const pumpM = watcher.pump('mostaql')
      const pumpN = watcher.pump('nafezly')

      // Abort only mostaql
      watcher.abort('mostaql')

      expect(mostaqlAborted).toBe(true)
      expect(nafezlyAborted).toBe(false)

      resolveMostaql()
      resolveNafezly()
      await Promise.all([pumpM, pumpN])
    })
  })
})
