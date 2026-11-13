import type { Db } from '../storage/db.js'
import { parseWatchPage } from '../collector/projectWatch.js'
import { getProjectById } from '../storage/repositories.js'
import {
  expireWatches,
  getWatch,
  getWatchSourceState,
  pickDueWatch,
  recordWatchFailure,
  saveSnapshot,
  saveWatchSourceState,
  setNextDue,
  stopWatch
} from '../storage/projectWatch.js'
import {
  WATCH_BLOCK_PAUSE_MS,
  WATCH_IDLE_AFTER_MS,
  WATCH_IDLE_SLOT_MS,
  WATCH_SLOT_MAX_MS,
  WATCH_SLOT_MS,
  type WatchPage,
  type WatchPickPreference,
  type WatchRow,
  type WatchSnapshotResult,
  type WatchSource,
  type WatchSourceState
} from '../shared/projectWatch.js'

export interface WatchFetchResult {
  kind: 'ok' | 'http' | 'timeout' | 'network' | 'too_large' | 'cancelled'
  status: number | null // HTTP status when known
  finalUrl: string | null // URL after redirects when known
  html: string | null // body when read (ok responses; may also be present for 403/202)
  retryAfterMs: number | null
}

export type WatchCounter = 'ok' | 'blocked' | 'failed' | 'slowed' | 'preempted'

export interface WatchSlot { release(outcome?: { ok?: boolean; cancelled?: boolean }): void }
export interface WatchSlotProvider { claim(priority: 'watch', onPreempt?: () => void): WatchSlot | null }

export interface ProjectWatcherDeps {
  db: () => Db | null
  now: () => number
  arbiter: (source: WatchSource) => WatchSlotProvider
  fetch: (source: WatchSource, url: string, signal: AbortSignal) => Promise<WatchFetchResult>
  gateOpen: (source: WatchSource) => boolean // source enabled, not paused, access allowed, not quitting, not in the SOURCE's own cooldown
  pollSucceededSince: (source: WatchSource, sinceMs: number) => boolean
  onBlock: (source: WatchSource, result: WatchFetchResult) => void // main applies the existing source cooldown
  onChanged: (projectIds: number[]) => void
  onEvents: (source: WatchSource, result: WatchSnapshotResult) => void
  onCounter?: (source: WatchSource, counter: WatchCounter) => void
}

const EXPIRY_INTERVAL_MS = 60_000

export class ProjectWatcher {
  private readonly deps: ProjectWatcherDeps
  private isClosed = false
  private readonly inFlight = new Map<WatchSource, Promise<void>>()
  private readonly controllers = new Map<WatchSource, AbortController>()
  private readonly lastStartedAt = new Map<WatchSource, number>()
  private readonly lastExpiryAt = new Map<WatchSource, number>()
  private readonly submittedStreaks = new Map<WatchSource, number>()
  private readonly preemptions = new Map<number, number>()
  private readonly memPausedUntilMs = new Map<WatchSource, number | null>()
  private readonly memBlockedAtMs = new Map<WatchSource, number | null>()
  private readonly memNeedsPoll = new Map<WatchSource, boolean>()
  private readonly memSlotMs = new Map<WatchSource, number | null>()

  constructor(deps: ProjectWatcherDeps) {
    this.deps = deps
  }

  latePreemptions(projectId: number): number {
    return this.preemptions.get(projectId) ?? 0
  }

  abort(source?: WatchSource): void {
    if (source !== undefined) {
      const controller = this.controllers.get(source)
      if (controller) {
        controller.abort()
      }
    } else {
      for (const controller of this.controllers.values()) {
        controller.abort()
      }
    }
  }

  async close(): Promise<void> {
    this.isClosed = true
    this.abort()
    const active = Array.from(this.inFlight.values())
    if (active.length > 0) {
      await Promise.all(active)
    }
  }

  pump(source: WatchSource): Promise<void> {
    if (this.isClosed) {
      return Promise.resolve()
    }
    const existing = this.inFlight.get(source)
    if (existing) {
      return existing
    }
    if (!this.deps.gateOpen(source)) {
      return Promise.resolve()
    }
    const db = this.deps.db()
    if (!db || (('isOpen' in db) && !db.isOpen)) {
      return Promise.resolve()
    }

    const controller = new AbortController()
    this.controllers.set(source, controller)

    let resolveInFlight!: () => void
    const inFlightPromise = new Promise<void>(res => {
      resolveInFlight = res
    })
    this.inFlight.set(source, inFlightPromise)

    void this._pumpSource(source, db, controller).finally(() => {
      if (this.inFlight.get(source) === inFlightPromise) {
        this.inFlight.delete(source)
      }
      if (this.controllers.get(source) === controller) {
        this.controllers.delete(source)
      }
      resolveInFlight()
    })
    return inFlightPromise
  }

  private emitChanged(ids: number[]): void {
    try {
      this.deps.onChanged(ids)
    } catch {
      // Callbacks must never break bookkeeping
    }
  }

  private emitEvents(source: WatchSource, result: WatchSnapshotResult): void {
    try {
      this.deps.onEvents(source, result)
    } catch {
      // Callbacks must never break bookkeeping
    }
  }

  private emitCounter(source: WatchSource, counter: WatchCounter): void {
    try {
      this.deps.onCounter?.(source, counter)
    } catch {
      // Callbacks must never break bookkeeping
    }
  }

  private handleBlock(
    source: WatchSource,
    fetchResult: WatchFetchResult,
    picked: { row: WatchRow; submitted: boolean },
    db: Db | null,
    stepNowMs: number,
    cancelled: boolean
  ): void {
    let storedPausedUntilMs = 0
    let storedSlotMs = WATCH_SLOT_MS
    if (db) {
      try {
        const storedState = getWatchSourceState(db, source)
        if (storedState.pausedUntil !== null) {
          const storedMs = Date.parse(storedState.pausedUntil)
          if (!Number.isNaN(storedMs)) {
            storedPausedUntilMs = storedMs
          }
        }
        storedSlotMs = storedState.slotMs
      } catch {
        // ignore
      }
    }

    const pauseMs = Math.max(WATCH_BLOCK_PAUSE_MS, fetchResult.retryAfterMs ?? 0)
    const existingMemPause = this.memPausedUntilMs.get(source) ?? 0
    const newPauseUntil = stepNowMs + pauseMs
    const targetPausedUntilMs = Math.max(existingMemPause, newPauseUntil, storedPausedUntilMs)

    const currentEffectiveSlot = Math.max(storedSlotMs, this.memSlotMs.get(source) ?? 0)
    const newSlotMs = Math.min(currentEffectiveSlot * 2, WATCH_SLOT_MAX_MS)

    // 1. In-memory per-source fields set FIRST
    this.memPausedUntilMs.set(source, targetPausedUntilMs)
    this.memBlockedAtMs.set(source, stepNowMs)
    this.memNeedsPoll.set(source, true)
    this.memSlotMs.set(source, newSlotMs)

    const stepNowIso = new Date(stepNowMs).toISOString()
    const pausedUntilIso = new Date(targetPausedUntilMs).toISOString()

    // 2. Try to persist source state (own try/catch)
    if (db) {
      try {
        saveWatchSourceState(db, {
          source,
          slotMs: newSlotMs,
          successStreak: 0,
          pausedUntil: pausedUntilIso,
          blockedAt: stepNowIso,
          needsPollSuccess: true
        })
      } catch {
        // persistence failed; memory fields still guard next pump
      }
    }

    // 3. Try setNextDue (own try/catch, only when not cancelled)
    if (!cancelled && db) {
      try {
        setNextDue(db, {
          projectId: picked.row.projectId,
          generation: picked.row.generation,
          dueAt: pausedUntilIso
        })
      } catch {
        // ignore
      }
    }

    // 4. Call onBlock (own try/catch) — onBlock is called even if persistence failed
    try {
      this.deps.onBlock(source, fetchResult)
    } catch {
      // ignore
    }

    // 5. Counters: each in its own try/catch (Item 3)
    try {
      this.deps.onCounter?.(source, 'blocked')
    } catch {
      // ignore
    }
    try {
      if (newSlotMs > currentEffectiveSlot) {
        this.deps.onCounter?.(source, 'slowed')
      }
    } catch {
      // ignore
    }
  }

  private async _pumpSource(source: WatchSource, db: Db, controller: AbortController): Promise<void> {
    try {
      if (this.isClosed || controller.signal.aborted) {
        return
      }
      if (!this.deps.gateOpen(source)) {
        return
      }
      const curDb = this.deps.db()
      if (!curDb || curDb !== db || (('isOpen' in curDb) && !curDb.isOpen)) {
        return
      }

      // 2. Source state
      const nowMs = this.deps.now()

      let state: WatchSourceState
      try {
        state = getWatchSourceState(db, source)
      } catch {
        return
      }

      let storedPausedUntilMs = 0
      if (state.pausedUntil !== null) {
        const parsed = Date.parse(state.pausedUntil)
        if (!Number.isNaN(parsed)) {
          storedPausedUntilMs = parsed
        }
      }
      const memPausedUntilMs = this.memPausedUntilMs.get(source) ?? 0
      const effectivePausedUntilMs = Math.max(storedPausedUntilMs, memPausedUntilMs)

      const memNeedsPoll = this.memNeedsPoll.get(source) ?? false
      const effectiveNeedsPoll = Boolean(state.needsPollSuccess || memNeedsPoll)

      let storedBlockedAtMs = 0
      if (state.blockedAt !== null) {
        const parsed = Date.parse(state.blockedAt)
        if (!Number.isNaN(parsed)) {
          storedBlockedAtMs = parsed
        }
      }
      const memBlockedAtMs = this.memBlockedAtMs.get(source) ?? 0
      const effectiveBlockedAtMs = Math.max(storedBlockedAtMs, memBlockedAtMs)

      const memSlotMs = this.memSlotMs.get(source) ?? 0
      const effectiveSlotMs = Math.max(state.slotMs, memSlotMs)

      if (effectivePausedUntilMs > 0 && nowMs < effectivePausedUntilMs) {
        return
      }

      if (effectiveNeedsPoll) {
        if (
          (effectivePausedUntilMs > 0 && nowMs < effectivePausedUntilMs) ||
          !this.deps.pollSucceededSince(source, effectiveBlockedAtMs)
        ) {
          return
        }

        const pausedUntilIso = effectivePausedUntilMs > 0 ? new Date(effectivePausedUntilMs).toISOString() : null
        const blockedAtIso = effectiveBlockedAtMs > 0 ? new Date(effectiveBlockedAtMs).toISOString() : null

        try {
          saveWatchSourceState(db, {
            source,
            slotMs: effectiveSlotMs,
            successStreak: 0,
            pausedUntil: pausedUntilIso,
            blockedAt: blockedAtIso,
            needsPollSuccess: false
          })
          this.memPausedUntilMs.delete(source)
          this.memBlockedAtMs.delete(source)
          this.memNeedsPoll.delete(source)
          this.memSlotMs.delete(source)
          state = {
            ...state,
            slotMs: effectiveSlotMs,
            successStreak: 0,
            pausedUntil: pausedUntilIso,
            blockedAt: blockedAtIso,
            needsPollSuccess: false
          }
        } catch {
          return
        }
      }

      // 3. Expire (at most once per 60 seconds per source)
      const lastExp = this.lastExpiryAt.get(source)
      if (lastExp === undefined || (nowMs - lastExp >= EXPIRY_INTERVAL_MS) || nowMs < lastExp) {
        this.lastExpiryAt.set(source, nowMs)
        const nowIso = new Date(nowMs).toISOString()
        let expireRes: { expired: number[]; promoted: number[] } | null = null
        try {
          expireRes = expireWatches(db, { source, now: nowIso })
        } catch {
          // ignore
        }
        if (expireRes) {
          const expiredOrPromoted = [...expireRes.expired, ...expireRes.promoted]
          if (expiredOrPromoted.length > 0) {
            this.emitChanged([...new Set(expiredOrPromoted)])
          }
        }
      }

      // 4. Slot
      const lastT = this.lastStartedAt.get(source)
      if (lastT !== undefined) {
        if (nowMs < lastT) {
          this.lastStartedAt.set(source, nowMs)
          return
        }
        if (nowMs - lastT < effectiveSlotMs) {
          return
        }
      }

      // 5. Pick
      const nowIso = new Date(nowMs).toISOString()
      const streak = this.submittedStreaks.get(source) ?? 0
      const prefer: WatchPickPreference = streak >= 3 ? 'other' : 'submitted'
      let picked: { row: WatchRow; submitted: boolean } | null = null
      try {
        picked = pickDueWatch(db, { source, now: nowIso, prefer })
      } catch {
        return
      }
      if (!picked) {
        return
      }

      // 6. Claim
      let preempted = false
      const onPreempt = () => {
        preempted = true
        controller.abort()
      }

      const arbiter = this.deps.arbiter(source)
      const claim = arbiter.claim('watch', onPreempt)
      if (!claim) {
        return
      }

      if (picked.submitted) {
        this.submittedStreaks.set(source, streak + 1)
      } else {
        this.submittedStreaks.set(source, 0)
      }

      let claimReleased = false
      const releaseClaim = (outcome?: { ok?: boolean; cancelled?: boolean }) => {
        if (!claimReleased) {
          claimReleased = true
          claim.release(outcome)
        }
      }

      try {
        // 7. Record T = now for slot
        const startMs = this.deps.now()
        this.lastStartedAt.set(source, startMs)

        let project: ReturnType<typeof getProjectById> = null
        try {
          project = getProjectById(db, picked.row.projectId)
        } catch {
          releaseClaim({ cancelled: true })
          return
        }
        if (!project) {
          releaseClaim({ ok: false })
          return
        }

        // Re-check immediately before calling deps.fetch (Item 2 & Item 3)
        const checkDb = this.deps.db()
        if (
          !checkDb ||
          checkDb !== db ||
          (('isOpen' in checkDb) && !checkDb.isOpen) ||
          this.isClosed ||
          controller.signal.aborted ||
          !this.deps.gateOpen(source)
        ) {
          releaseClaim({ cancelled: true })
          if (preempted) {
            this.preemptions.set(
              picked.row.projectId,
              (this.preemptions.get(picked.row.projectId) ?? 0) + 1
            )
            this.emitCounter(source, 'preempted')
          }
          return
        }

        let st: WatchSourceState
        try {
          st = getWatchSourceState(db, source)
        } catch {
          releaseClaim({ cancelled: true })
          return
        }

        let currentWatch: WatchRow | null
        try {
          currentWatch = getWatch(db, picked.row.projectId)
        } catch {
          releaseClaim({ cancelled: true })
          return
        }

        if (
          !currentWatch ||
          currentWatch.generation !== picked.row.generation ||
          currentWatch.state !== 'active'
        ) {
          releaseClaim({ cancelled: true })
          return
        }

        const checkNow = this.deps.now()
        let checkStoredPausedUntilMs = 0
        if (st.pausedUntil !== null) {
          const p = Date.parse(st.pausedUntil)
          if (!Number.isNaN(p)) checkStoredPausedUntilMs = p
        }
        const checkEffectivePausedUntilMs = Math.max(
          checkStoredPausedUntilMs,
          this.memPausedUntilMs.get(source) ?? 0
        )
        const isPaused = checkEffectivePausedUntilMs > 0 && checkNow < checkEffectivePausedUntilMs
        const isNeedsPoll = Boolean(st.needsPollSuccess || (this.memNeedsPoll.get(source) ?? false))

        if (isPaused || isNeedsPoll) {
          releaseClaim({ cancelled: true })
          if (preempted) {
            this.preemptions.set(
              picked.row.projectId,
              (this.preemptions.get(picked.row.projectId) ?? 0) + 1
            )
            this.emitCounter(source, 'preempted')
          }
          return
        }

        // 8. Fetch
        let fetchResult: WatchFetchResult
        try {
          fetchResult = await this.deps.fetch(source, project.url, controller.signal)
        } catch {
          fetchResult = {
            kind: 'network',
            status: null,
            finalUrl: null,
            html: null,
            retryAfterMs: null
          }
        }

        // Post-fetch checks
        const postDb = this.deps.db()
        const postDbInvalid = !postDb || postDb !== db || (('isOpen' in postDb) && !postDb.isOpen)
        const wasCancelled = preempted || controller.signal.aborted || this.isClosed || postDbInvalid

        const stepNowMs = this.deps.now()
        const stepNowIso = new Date(stepNowMs).toISOString()
        const status = fetchResult.status
        const html = fetchResult.html ?? ''

        // Check for block verdict (Item 1 & Item 6)
        let isBlock = false
        let parsedFor403: WatchPage | null = null
        if (status === 401 || status === 429 || status === 202) {
          isBlock = true
        } else if (status === 403) {
          parsedFor403 = parseWatchPage(html, source, {
            status: 403,
            finalUrl: fetchResult.finalUrl ?? undefined
          })
          if (parsedFor403.kind !== 'private') {
            isBlock = true
          }
        } else if (fetchResult.kind === 'ok' && status === 200) {
          const parsed = parseWatchPage(html, source, {
            status: 200,
            finalUrl: fetchResult.finalUrl ?? undefined
          })
          if (parsed.kind === 'challenge') {
            isBlock = true
          }
        }

        if (wasCancelled) {
          if (isBlock) {
            // SOURCE-level block handling runs even when check was preempted/aborted/closed/db changed (Item 1)
            this.handleBlock(source, fetchResult, picked, postDbInvalid ? null : db, stepNowMs, true)
          }
          releaseClaim({ cancelled: true })
          if (preempted) {
            this.preemptions.set(
              picked.row.projectId,
              (this.preemptions.get(picked.row.projectId) ?? 0) + 1
            )
            this.emitCounter(source, 'preempted')
          }
          return
        }

        // Item 7: latePreemptions resets after every completed (non-cancelled) check
        this.preemptions.delete(picked.row.projectId)

        // 10a. 404 or 410 -> gone
        if (status === 404 || status === 410) {
          releaseClaim({ ok: false })
          const res = stopWatch(db, {
            projectId: picked.row.projectId,
            generation: picked.row.generation,
            reason: 'gone',
            now: stepNowIso
          })
          if (res.changed) {
            const ids = [picked.row.projectId]
            if (res.promoted !== null) ids.push(res.promoted)
            this.emitChanged(ids)
          }
          return
        }

        // 10b. BLOCK (non-cancelled)
        if (isBlock) {
          releaseClaim({ ok: false })
          this.handleBlock(source, fetchResult, picked, db, stepNowMs, false)
          return
        }

        // 10c. 403 private or page gone
        let isGone = false
        if (status === 403 && parsedFor403?.kind === 'private') {
          isGone = true
        } else if (fetchResult.kind === 'ok' && status === 200) {
          const parsed = parseWatchPage(html, source, {
            status: 200,
            finalUrl: fetchResult.finalUrl ?? undefined
          })
          if (parsed.kind === 'gone') {
            isGone = true
          }
        }

        if (isGone) {
          releaseClaim({ ok: false })
          const res = stopWatch(db, {
            projectId: picked.row.projectId,
            generation: picked.row.generation,
            reason: 'gone',
            now: stepNowIso
          })
          if (res.changed) {
            const ids = [picked.row.projectId]
            if (res.promoted !== null) ids.push(res.promoted)
            this.emitChanged(ids)
          }
          return
        }

        // 10d. ok response with snapshot (strictly fetchResult.kind === 'ok' && status === 200)
        if (fetchResult.kind === 'ok' && status === 200) {
          const parsed = parseWatchPage(html, source, {
            status: 200,
            finalUrl: fetchResult.finalUrl ?? undefined
          })
          if (parsed.kind === 'snapshot') {
            releaseClaim({ ok: true })
            const snapResult = saveSnapshot(db, {
              projectId: picked.row.projectId,
              generation: picked.row.generation,
              snapshot: parsed.snapshot,
              now: stepNowIso
            })

            if (snapResult.applied) {
              // 1. Source state (successStreak and slotMs)
              const storedState = getWatchSourceState(db, source)
              let newSuccessStreak = storedState.successStreak + 1
              let newSlotMs = storedState.slotMs
              if (newSuccessStreak >= 20 && newSlotMs > WATCH_SLOT_MS) {
                newSlotMs = Math.max(WATCH_SLOT_MS, Math.round(newSlotMs / 2))
                newSuccessStreak = 0
              }
              saveWatchSourceState(db, {
                ...storedState,
                slotMs: newSlotMs,
                successStreak: newSuccessStreak
              })

              // 2. Next due
              if (snapResult.row && snapResult.row.state === 'active') {
                const refTimeStr = snapResult.row.lastChangedAt ?? snapResult.row.startedAt
                const refTimeMs = refTimeStr !== null ? Date.parse(refTimeStr) : stepNowMs
                const isIdle = stepNowMs - refTimeMs > WATCH_IDLE_AFTER_MS
                const delayMs = isIdle ? WATCH_IDLE_SLOT_MS : newSlotMs
                setNextDue(db, {
                  projectId: picked.row.projectId,
                  generation: picked.row.generation,
                  dueAt: new Date(stepNowMs + delayMs).toISOString()
                })
              }

              // 3. Callbacks AFTER all DB writes
              if (snapResult.events.length > 0 || snapResult.stopped !== null) {
                this.emitEvents(source, snapResult)
              }
              const ids = [picked.row.projectId]
              if (snapResult.promoted !== null) ids.push(snapResult.promoted)
              this.emitChanged(ids)

              this.emitCounter(source, 'ok')
            }
            return
          }
        }

        // 10e. ok invalid, timeout, network, too_large, or any other status
        releaseClaim({ ok: false })
        let errorCode: string
        if (fetchResult.kind === 'timeout') {
          errorCode = 'timeout'
        } else if (fetchResult.kind === 'network') {
          errorCode = 'network'
        } else if (fetchResult.kind === 'too_large') {
          errorCode = 'too_large'
        } else if (fetchResult.kind === 'cancelled') {
          errorCode = 'cancelled'
        } else if (status !== null && (status < 200 || status >= 300)) {
          errorCode = `http-${status}`
        } else {
          errorCode = 'invalid'
        }

        // Item 5: every completed check that is not a snapshot success resets successStreak to 0 in persisted source state
        try {
          const storedState = getWatchSourceState(db, source)
          if (storedState.successStreak !== 0) {
            saveWatchSourceState(db, {
              ...storedState,
              successStreak: 0
            })
          }
        } catch {
          // ignore
        }

        // 1. Record failure
        recordWatchFailure(db, {
          projectId: picked.row.projectId,
          generation: picked.row.generation,
          error: errorCode,
          now: stepNowIso
        })

        // 2. Next due
        const storedState = getWatchSourceState(db, source)
        const updatedWatch = getWatch(db, picked.row.projectId)
        const failures = updatedWatch ? updatedWatch.failures : picked.row.failures + 1
        const THIRTY_MIN_MS = 30 * 60 * 1000
        const backoffMs = Math.min(THIRTY_MIN_MS, storedState.slotMs * (2 ** Math.min(failures, 8)))
        setNextDue(db, {
          projectId: picked.row.projectId,
          generation: picked.row.generation,
          dueAt: new Date(stepNowMs + backoffMs).toISOString()
        })

        // 3. Counter callback AFTER all DB writes
        this.emitCounter(source, 'failed')
      } finally {
        releaseClaim({ ok: false, cancelled: true })
      }
    } catch {
      // Abort quietly per Rule 12
    }
  }
}
