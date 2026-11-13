import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import {
  runInTransaction,
  updateUserState,
  upsertProjectsBatch
} from '../src/storage/repositories.js'
import {
  autoStartOnSubmitted,
  autoStartOnSubmittedTx,
  countActiveWatches,
  expireWatches,
  expireWatchesTx,
  getWatch,
  getWatchSourceState,
  listWatches,
  pickDueWatch,
  recordWatchFailure,
  replaceWatch,
  saveSnapshot,
  saveWatchSourceState,
  saveWatchSourceStateTx,
  setNextDue,
  setNextDueTx,
  setWatch,
  setWatchTx,
  stopSource,
  stopWatch
} from '../src/storage/projectWatch.js'
import {
  WATCH_EXPIRE_MS,
  WATCH_SLOT_MS,
  type WatchOrigin,
  type WatchSnapshot,
  type WatchSourceState,
  type WatchStopReason
} from '../src/shared/projectWatch.js'

let dir = ''
let db: Db

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-watch-test-'))
  db = openDatabase(join(dir, 'test.db'))
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('project watch storage', () => {
  it('1. on: first watch active with generation 1; handles unsupported-source, unknown-project, bad-origin', () => {
    const p1 = seedProject(db, 'p1', 'mostaql')
    const t0 = '2026-10-01T10:00:00.000Z'
    const res = setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: t0
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changed).toBe(true)
    expect(res.promoted).toBeNull()
    expect(res.row).toEqual({
      projectId: p1,
      state: 'active',
      origin: 'list',
      version: 1,
      generation: 1,
      revision: 0,
      waitingSince: null,
      startedAt: t0,
      stoppedAt: null,
      stopReason: null,
      autoStartBlocked: false,
      status: null,
      offers: null,
      offersCapped: false,
      contacts: null,
      clientOpen: null,
      clientInProgress: null,
      statusSeenAt: null,
      detailSeenAt: null,
      lastAttemptAt: null,
      lastChangedAt: null,
      nextDueAt: null,
      failures: 0,
      lastError: null
    })

    const pKhamsat = seedProject(db, 'pkh', 'khamsat')
    const rKhamsat = setWatch(db, {
      projectId: pKhamsat,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: t0
    })
    expect(rKhamsat).toEqual({ ok: false, error: 'unsupported-source' })

    const rMissing = setWatch(db, {
      projectId: 999999,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: t0
    })
    expect(rMissing).toEqual({ ok: false, error: 'unknown-project' })

    const rBadOrigin = setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: 1,
      origin: 'bogus_origin' as WatchOrigin,
      now: t0
    })
    expect(rBadOrigin).toEqual({ ok: false, error: 'bad-origin' })
  })

  it('2. cap: 10 active per source, the 11th is waiting with startedAt null; another source is independent', () => {
    const mostaqlIds: number[] = []
    for (let i = 1; i <= 11; i++) {
      mostaqlIds.push(seedProject(db, `m-${i}`, 'mostaql'))
    }
    const nafezlyId = seedProject(db, 'n-1', 'nafezly')

    for (let i = 0; i < 10; i++) {
      const res = setWatch(db, {
        projectId: mostaqlIds[i]!,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: `2026-10-01T10:00:0${i}.000Z`
      })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.row?.state).toBe('active')
        expect(res.row?.startedAt).not.toBeNull()
        expect(res.row?.waitingSince).toBeNull()
        expect(res.row?.generation).toBe(1)
      }
    }

    const waitRes = setWatch(db, {
      projectId: mostaqlIds[10]!,
      want: 'on',
      expectVersion: null,
      origin: 'detail',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(waitRes.ok).toBe(true)
    if (waitRes.ok) {
      expect(waitRes.row?.state).toBe('waiting')
      expect(waitRes.row?.startedAt).toBeNull()
      expect(waitRes.row?.waitingSince).toBe('2026-10-01T10:00:10.000Z')
      expect(waitRes.row?.generation).toBe(0)
    }

    const nafRes = setWatch(db, {
      projectId: nafezlyId,
      want: 'on',
      expectVersion: null,
      origin: 'preview',
      now: '2026-10-01T10:00:11.000Z'
    })
    expect(nafRes.ok).toBe(true)
    if (nafRes.ok) {
      expect(nafRes.row?.state).toBe('active')
      expect(nafRes.row?.generation).toBe(1)
    }

    expect(countActiveWatches(db, 'mostaql')).toBe(10)
    expect(countActiveWatches(db, 'nafezly')).toBe(1)
  })

  it('3. expectVersion: stale number, null-but-exists, number-but-missing -> stale and no change; repeated on changes nothing', () => {
    const p1 = seedProject(db, 'p3-1', 'mostaql')
    const t0 = '2026-10-01T10:00:00.000Z'
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: t0 })

    const rStaleNum = setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: 99,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(rStaleNum).toEqual({ ok: false, error: 'stale' })
    expect(getWatch(db, p1)?.version).toBe(1)

    const rNullExists = setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rNullExists).toEqual({ ok: false, error: 'stale' })

    const p2 = seedProject(db, 'p3-2', 'mostaql')
    const rMissingNum = setWatch(db, {
      projectId: p2,
      want: 'on',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:03.000Z'
    })
    expect(rMissingNum).toEqual({ ok: false, error: 'stale' })
    expect(getWatch(db, p2)).toBeNull()

    const beforeActive = getWatch(db, p1)!
    const rRepeatActive = setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: 1,
      origin: 'detail',
      now: '2026-10-01T10:00:04.000Z'
    })
    expect(rRepeatActive.ok).toBe(true)
    if (rRepeatActive.ok) {
      expect(rRepeatActive.changed).toBe(false)
      expect(rRepeatActive.row).toEqual(beforeActive)
    }

    for (let i = 1; i <= 9; i++) {
      const pid = seedProject(db, `m-fill-${i}`, 'mostaql')
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: t0 })
    }
    const pWait = seedProject(db, 'p3-wait', 'mostaql')
    const rWait = setWatch(db, {
      projectId: pWait,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:05.000Z'
    })
    expect(rWait.ok).toBe(true)
    const beforeWait = getWatch(db, pWait)!
    expect(beforeWait.state).toBe('waiting')

    const rRepeatWait = setWatch(db, {
      projectId: pWait,
      want: 'on',
      expectVersion: 1,
      origin: 'compact',
      now: '2026-10-01T10:00:06.000Z'
    })
    expect(rRepeatWait.ok).toBe(true)
    if (rRepeatWait.ok) {
      expect(rRepeatWait.changed).toBe(false)
      expect(rRepeatWait.row).toEqual(beforeWait)
    }
  })

  it('4. off: active -> stopped manual, autoStartBlocked true, oldest eligible waiter promoted; waiter off stops without promotion; off on missing returns null row', () => {
    const activeIds: number[] = []
    for (let i = 1; i <= 10; i++) {
      const pid = seedProject(db, `p4-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: `2026-10-01T10:00:0${i - 1}.000Z`
      })
      activeIds.push(pid)
    }

    const waiter1 = seedProject(db, 'p4-w1', 'mostaql')
    const waiter2 = seedProject(db, 'p4-w2', 'mostaql')
    setWatch(db, {
      projectId: waiter1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    setWatch(db, {
      projectId: waiter2,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })

    const offTime = '2026-10-01T10:00:20.000Z'
    const offRes = setWatch(db, {
      projectId: activeIds[0]!,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: offTime
    })
    expect(offRes.ok).toBe(true)
    if (offRes.ok) {
      expect(offRes.changed).toBe(true)
      expect(offRes.row?.state).toBe('stopped')
      expect(offRes.row?.stopReason).toBe('manual')
      expect(offRes.row?.autoStartBlocked).toBe(true)
      expect(offRes.row?.stoppedAt).toBe(offTime)
      expect(offRes.row?.version).toBe(2)
      expect(offRes.promoted).toBe(waiter1)
    }

    const promotedRow = getWatch(db, waiter1)!
    expect(promotedRow.state).toBe('active')
    expect(promotedRow.generation).toBe(1)
    expect(promotedRow.startedAt).toBe(offTime)
    expect(promotedRow.waitingSince).toBeNull()

    const offWaiterRes = setWatch(db, {
      projectId: waiter2,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:21.000Z'
    })
    expect(offWaiterRes.ok).toBe(true)
    if (offWaiterRes.ok) {
      expect(offWaiterRes.changed).toBe(true)
      expect(offWaiterRes.row?.state).toBe('stopped')
      expect(offWaiterRes.promoted).toBeNull()
    }

    const offStoppedRes = setWatch(db, {
      projectId: waiter2,
      want: 'off',
      expectVersion: 2,
      origin: 'list',
      now: '2026-10-01T10:00:22.000Z'
    })
    expect(offStoppedRes.ok).toBe(true)
    if (offStoppedRes.ok) {
      expect(offStoppedRes.changed).toBe(false)
      expect(offStoppedRes.promoted).toBeNull()
    }

    const pUnwatched = seedProject(db, 'p4-unwatched', 'mostaql')
    const offNoRowRes = setWatch(db, {
      projectId: pUnwatched,
      want: 'off',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:23.000Z'
    })
    expect(offNoRowRes.ok).toBe(true)
    if (offNoRowRes.ok) {
      expect(offNoRowRes.changed).toBe(false)
      expect(offNoRowRes.row).toBeNull()
      expect(offNoRowRes.promoted).toBeNull()
      expect(getWatch(db, pUnwatched)).toBeNull()
    }
  })

  it('5. promotion skips a hidden waiter and an ignored waiter and takes the next eligible one; with no eligible waiter promoted is null', () => {
    const activeIds: number[] = []
    for (let i = 1; i <= 10; i++) {
      const pid = seedProject(db, `p5-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:00.000Z'
      })
      activeIds.push(pid)
    }

    const wHidden = seedProject(db, 'p5-w-hidden', 'mostaql')
    const wIgnored = seedProject(db, 'p5-w-ignored', 'mostaql')
    const wEligible = seedProject(db, 'p5-w-eligible', 'mostaql')

    setWatch(db, {
      projectId: wHidden,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })
    setWatch(db, {
      projectId: wIgnored,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:02.000Z'
    })
    setWatch(db, {
      projectId: wEligible,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:03.000Z'
    })

    updateUserState(db, wHidden, { hidden: true }, '2026-10-01T10:00:04.000Z')
    updateUserState(db, wIgnored, { status: 'ignored' }, '2026-10-01T10:00:04.000Z')

    const r1 = setWatch(db, {
      projectId: activeIds[0]!,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.promoted).toBe(wEligible)
    }

    expect(getWatch(db, wHidden)?.state).toBe('waiting')
    expect(getWatch(db, wIgnored)?.state).toBe('waiting')
    expect(getWatch(db, wEligible)?.state).toBe('active')

    const r2 = setWatch(db, {
      projectId: activeIds[1]!,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:20.000Z'
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.promoted).toBeNull()
    }
  })

  it('6. on after manual off: clears autoStartBlocked in BOTH branches (slot free -> active with generation + 1 and cleared baseline; at capacity -> waiting)', () => {
    const p1 = seedProject(db, 'p6-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 5,
        offersCapped: false,
        contacts: 2,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:05.000Z'
    })

    setWatch(db, {
      projectId: p1,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    const stoppedRow = getWatch(db, p1)!
    expect(stoppedRow.state).toBe('stopped')
    expect(stoppedRow.autoStartBlocked).toBe(true)
    expect(stoppedRow.version).toBe(2)

    const rSlotFree = setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: 2,
      origin: 'detail',
      now: '2026-10-01T10:00:20.000Z'
    })
    expect(rSlotFree.ok).toBe(true)
    if (rSlotFree.ok) {
      expect(rSlotFree.row?.state).toBe('active')
      expect(rSlotFree.row?.autoStartBlocked).toBe(false)
      expect(rSlotFree.row?.generation).toBe(2)
      expect(rSlotFree.row?.revision).toBe(0)
      expect(rSlotFree.row?.version).toBe(3)
      expect(rSlotFree.row?.status).toBeNull()
      expect(rSlotFree.row?.offers).toBeNull()
      expect(rSlotFree.row?.contacts).toBeNull()
    }

    const extraIds: number[] = []
    for (let i = 1; i <= 9; i++) {
      const pid = seedProject(db, `p6-extra-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:30.000Z'
      })
      extraIds.push(pid)
    }
    expect(countActiveWatches(db, 'mostaql')).toBe(10)

    const pAtCap = seedProject(db, 'p6-cap', 'mostaql')
    setWatch(db, {
      projectId: pAtCap,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:31.000Z'
    })
    const waitRow = getWatch(db, pAtCap)!
    expect(waitRow.state).toBe('waiting')

    setWatch(db, {
      projectId: pAtCap,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:32.000Z'
    })
    expect(getWatch(db, pAtCap)?.autoStartBlocked).toBe(true)

    const rAtCap = setWatch(db, {
      projectId: pAtCap,
      want: 'on',
      expectVersion: 2,
      origin: 'compact',
      now: '2026-10-01T10:00:35.000Z'
    })
    expect(rAtCap.ok).toBe(true)
    if (rAtCap.ok) {
      expect(rAtCap.row?.state).toBe('waiting')
      expect(rAtCap.row?.autoStartBlocked).toBe(false)
      expect(rAtCap.row?.version).toBe(3)
    }
  })

  it('7. autoStartOnSubmitted: new project -> active with origin auto_submitted; at capacity -> waiting; no-op when autoStartBlocked; no-op when active/waiting; khamsat -> ok:false', () => {
    const p1 = seedProject(db, 'p7-1', 'mostaql')
    const rNew = autoStartOnSubmitted(db, p1, '2026-10-01T10:00:00.000Z')
    expect(rNew.ok).toBe(true)
    if (rNew.ok) {
      expect(rNew.row?.state).toBe('active')
      expect(rNew.row?.origin).toBe('auto_submitted')
      expect(rNew.row?.generation).toBe(1)
    }

    const rActiveRepeat = autoStartOnSubmitted(db, p1, '2026-10-01T10:00:01.000Z')
    expect(rActiveRepeat.ok).toBe(true)
    if (rActiveRepeat.ok) {
      expect(rActiveRepeat.changed).toBe(false)
    }

    for (let i = 2; i <= 10; i++) {
      const pid = seedProject(db, `p7-${i}`, 'mostaql')
      autoStartOnSubmitted(db, pid, '2026-10-01T10:00:02.000Z')
    }
    expect(countActiveWatches(db, 'mostaql')).toBe(10)

    const pCap = seedProject(db, 'p7-11', 'mostaql')
    const rCap = autoStartOnSubmitted(db, pCap, '2026-10-01T10:00:03.000Z')
    expect(rCap.ok).toBe(true)
    if (rCap.ok) {
      expect(rCap.row?.state).toBe('waiting')
      expect(rCap.row?.origin).toBe('auto_submitted')
    }

    const rWaitRepeat = autoStartOnSubmitted(db, pCap, '2026-10-01T10:00:04.000Z')
    expect(rWaitRepeat.ok).toBe(true)
    if (rWaitRepeat.ok) {
      expect(rWaitRepeat.changed).toBe(false)
    }

    const pBlocked = seedProject(db, 'p7-blocked', 'mostaql')
    setWatch(db, {
      projectId: pBlocked,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:05.000Z'
    })
    setWatch(db, {
      projectId: pBlocked,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:06.000Z'
    })
    expect(getWatch(db, pBlocked)?.autoStartBlocked).toBe(true)

    const rBlocked = autoStartOnSubmitted(db, pBlocked, '2026-10-01T10:00:07.000Z')
    expect(rBlocked.ok).toBe(true)
    if (rBlocked.ok) {
      expect(rBlocked.changed).toBe(false)
      expect(rBlocked.row?.state).toBe('stopped')
    }

    const pKhamsat = seedProject(db, 'p7-kh', 'khamsat')
    const rKh = autoStartOnSubmitted(db, pKhamsat, '2026-10-01T10:00:08.000Z')
    expect(rKh.ok).toBe(false)
    if (!rKh.ok) {
      expect(rKh.error).toBe('unsupported-source')
    }
  })

  it('8. replace: happy path; error cases leave both rows untouched; waiting/stopped destination activated', () => {
    const vId = seedProject(db, 'p8-v', 'mostaql')
    const dId = seedProject(db, 'p8-d', 'mostaql')
    const wId = seedProject(db, 'p8-w', 'mostaql')

    setWatch(db, {
      projectId: vId,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })
    const fillIds: number[] = []
    for (let i = 1; i <= 9; i++) {
      const pid = seedProject(db, `p8-fill-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:00.000Z'
      })
      fillIds.push(pid)
    }
    setWatch(db, {
      projectId: wId,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(getWatch(db, wId)?.state).toBe('waiting')

    const rSame = replaceWatch(db, {
      projectId: vId,
      victimId: vId,
      expectVersion: 1,
      expectVictimVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rSame).toEqual({ ok: false, error: 'same-project' })

    const dNaf = seedProject(db, 'p8-d-naf', 'nafezly')
    const rDiffSrc = replaceWatch(db, {
      projectId: dNaf,
      victimId: vId,
      expectVersion: null,
      expectVictimVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rDiffSrc).toEqual({ ok: false, error: 'different-source' })

    const dKhamsat = seedProject(db, 'p8-d-kh', 'khamsat')
    const rUnsup = replaceWatch(db, {
      projectId: dKhamsat,
      victimId: vId,
      expectVersion: null,
      expectVictimVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rUnsup).toEqual({ ok: false, error: 'unsupported-source' })

    const rVictimNotActive = replaceWatch(db, {
      projectId: dId,
      victimId: wId,
      expectVersion: null,
      expectVictimVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rVictimNotActive).toEqual({ ok: false, error: 'victim-not-active' })

    const rStaleVictim = replaceWatch(db, {
      projectId: dId,
      victimId: vId,
      expectVersion: null,
      expectVictimVersion: 99,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rStaleVictim).toEqual({ ok: false, error: 'stale' })

    const rStaleDest = replaceWatch(db, {
      projectId: dId,
      victimId: vId,
      expectVersion: 1,
      expectVictimVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rStaleDest).toEqual({ ok: false, error: 'stale' })

    const rAlready = replaceWatch(db, {
      projectId: fillIds[0]!,
      victimId: vId,
      expectVersion: 1,
      expectVictimVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rAlready).toEqual({ ok: false, error: 'already-watching' })

    const vBefore = getWatch(db, vId)!
    expect(getWatch(db, dId)).toBeNull()

    const rHappy = replaceWatch(db, {
      projectId: dId,
      victimId: vId,
      expectVersion: null,
      expectVictimVersion: 1,
      origin: 'preview',
      now: '2026-10-01T10:00:15.000Z'
    })
    expect(rHappy.ok).toBe(true)
    if (rHappy.ok) {
      expect(rHappy.victim.state).toBe('stopped')
      expect(rHappy.victim.stopReason).toBe('replaced')
      expect(rHappy.victim.version).toBe(vBefore.version + 1)
      expect(rHappy.row.state).toBe('active')
      expect(rHappy.row.origin).toBe('preview')
      expect(rHappy.row.generation).toBe(1)
    }

    expect(countActiveWatches(db, 'mostaql')).toBe(10)
    expect(getWatch(db, wId)?.state).toBe('waiting')

    const rReplaceWait = replaceWatch(db, {
      projectId: wId,
      victimId: dId,
      expectVersion: 1,
      expectVictimVersion: 1,
      origin: 'compact',
      now: '2026-10-01T10:00:20.000Z'
    })
    expect(rReplaceWait.ok).toBe(true)
    if (rReplaceWait.ok) {
      expect(rReplaceWait.victim.state).toBe('stopped')
      expect(rReplaceWait.row.state).toBe('active')
      expect(rReplaceWait.row.generation).toBe(1)
    }
  })

  it('9. stopWatch for each reason; promotion on closed/expired/ignored/gone and not source_disabled; stopSource', () => {
    const reasons: Exclude<WatchStopReason, 'manual' | 'replaced'>[] = [
      'closed',
      'expired',
      'ignored',
      'gone',
      'source_disabled'
    ]

    for (const reason of reasons) {
      db.exec('DELETE FROM project_watch; DELETE FROM notification_events;')
      for (let i = 1; i <= 10; i++) {
        const pid = seedProject(db, `p9-${reason}-${i}`, 'mostaql')
        setWatch(db, {
          projectId: pid,
          want: 'on',
          expectVersion: null,
          origin: 'list',
          now: '2026-10-01T10:00:00.000Z'
        })
      }
      const waiter = seedProject(db, `p9-${reason}-wait`, 'mostaql')
      setWatch(db, {
        projectId: waiter,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:01.000Z'
      })

      const target = seedProject(db, `p9-${reason}-target`, 'mostaql')
      setWatch(db, {
        projectId: target,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:02.000Z'
      })
      expect(getWatch(db, target)?.state).toBe('waiting')

      const activeList = listWatches(db, { source: 'mostaql', state: 'active' }).rows
      const victim = activeList[0]!

      const res = stopWatch(db, {
        projectId: victim.projectId,
        reason,
        now: '2026-10-01T10:00:10.000Z'
      })
      expect(res.changed).toBe(true)
      expect(getWatch(db, victim.projectId)?.stopReason).toBe(reason)

      if (reason === 'source_disabled') {
        expect(res.promoted).toBeNull()
      } else {
        expect(res.promoted).toBe(waiter)
      }
    }

    const nActive = seedProject(db, 'p9-naf-act', 'nafezly')
    const nWait = seedProject(db, 'p9-naf-wait', 'nafezly')
    setWatch(db, {
      projectId: nActive,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })
    for (let i = 1; i <= 9; i++) {
      const pid = seedProject(db, `p9-naf-fill-${i}`, 'nafezly')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:00.000Z'
      })
    }
    setWatch(db, {
      projectId: nWait,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })

    const stoppedCount = stopSource(db, { source: 'nafezly', now: '2026-10-01T10:00:20.000Z' })
    expect(stoppedCount).toBe(11)
    expect(countActiveWatches(db, 'nafezly')).toBe(0)
    expect(getWatch(db, nActive)?.stopReason).toBe('source_disabled')
    expect(getWatch(db, nWait)?.stopReason).toBe('source_disabled')
  })

  it('9b. stopWatch generation guard: wrong generation -> no change; correct -> stopped; omitted -> current behaviour', () => {
    const p1 = seedProject(db, 'p9b-gen-guard', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })
    const cur = getWatch(db, p1)!
    expect(cur.state).toBe('active')
    expect(cur.generation).toBe(1)

    // 1. Wrong generation -> no change, returns changed: false, promoted: null
    const resWrong = stopWatch(db, {
      projectId: p1,
      reason: 'gone',
      now: '2026-10-01T10:00:10.000Z',
      generation: 999
    })
    expect(resWrong).toEqual({ changed: false, promoted: null })
    const rowAfterWrong = getWatch(db, p1)!
    expect(rowAfterWrong.state).toBe('active')
    expect(rowAfterWrong.generation).toBe(1)
    expect(rowAfterWrong.stopReason).toBeNull()

    // 2. Correct generation -> stopped, returns changed: true
    const resCorrect = stopWatch(db, {
      projectId: p1,
      reason: 'gone',
      now: '2026-10-01T10:00:11.000Z',
      generation: 1
    })
    expect(resCorrect.changed).toBe(true)
    const rowAfterCorrect = getWatch(db, p1)!
    expect(rowAfterCorrect.state).toBe('stopped')
    expect(rowAfterCorrect.stopReason).toBe('gone')

    // 3. Restart watch to get generation 2, then test omitted generation -> current behaviour (stopped)
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: rowAfterCorrect.version,
      origin: 'list',
      now: '2026-10-01T10:00:20.000Z'
    })
    const restarted = getWatch(db, p1)!
    expect(restarted.state).toBe('active')
    expect(restarted.generation).toBe(2)

    const resOmitted = stopWatch(db, {
      projectId: p1,
      reason: 'closed',
      now: '2026-10-01T10:00:30.000Z'
    })
    expect(resOmitted.changed).toBe(true)
    const rowAfterOmitted = getWatch(db, p1)!
    expect(rowAfterOmitted.state).toBe('stopped')
    expect(rowAfterOmitted.stopReason).toBe('closed')
  })

  it('10. saveSnapshot: first snapshot silent (including closed); status transitions; unknown/null rules', () => {
    const p1 = seedProject(db, 'p10-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    const rFirst = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 3,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(rFirst.applied).toBe(true)
    expect(rFirst.events).toEqual([])
    expect(rFirst.stopped).toBeNull()
    expect(rFirst.row?.status).toBe('open')
    expect(rFirst.row?.contacts).toBe(5)
    expect(rFirst.row?.revision).toBe(0)

    const rProg = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'in_progress',
        offers: 3,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rProg.events).toHaveLength(1)
    expect(rProg.events[0]?.kind).toBe('watch_status')
    expect(rProg.row?.revision).toBe(1)
    expect(rProg.row?.status).toBe('in_progress')

    expect(rProg.events[0]).toBeDefined()
    const evRow = db
      .prepare('SELECT dedupe_key, payload FROM notification_events WHERE id = ?;')
      .get(rProg.events[0]!.id) as { dedupe_key: string; payload: string }
    expect(evRow.dedupe_key).toBe('1:1')
    expect(JSON.parse(evRow.payload)).toEqual({ v: 1, from: 'open', to: 'in_progress' })

    const rBackToOpen = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 3,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:03.000Z'
    })
    expect(rBackToOpen.events).toHaveLength(0)
    expect(rBackToOpen.row?.status).toBe('open')
    expect(rBackToOpen.row?.revision).toBe(1)

    const seenBefore = rBackToOpen.row?.statusSeenAt
    const rUnknown = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'unknown',
        offers: 3,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:04.000Z'
    })
    expect(rUnknown.events).toHaveLength(0)
    expect(rUnknown.row?.status).toBe('open')
    expect(rUnknown.row?.statusSeenAt).toBe('2026-10-01T10:00:04.000Z')
    expect(rUnknown.row?.statusSeenAt).not.toBe(seenBefore)

    const rNull = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: null,
        offers: 3,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:05.000Z'
    })
    expect(rNull.row?.status).toBe('open')
    expect(rNull.row?.statusSeenAt).toBe('2026-10-01T10:00:04.000Z')

    for (let i = 1; i <= 9; i++) {
      const pid = seedProject(db, `p10-fill-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:00.000Z'
      })
    }
    const pWait = seedProject(db, 'p10-wait', 'mostaql')
    setWatch(db, {
      projectId: pWait,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })

    const rClosed = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'closed',
        offers: 3,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:06.000Z'
    })
    expect(rClosed.events).toHaveLength(1)
    expect(rClosed.stopped).toBe('closed')
    expect(rClosed.promoted).toBe(pWait)
    expect(rClosed.row?.state).toBe('stopped')
    expect(rClosed.row?.stopReason).toBe('closed')

    setWatch(db, {
      projectId: pWait,
      want: 'off',
      expectVersion: 2,
      origin: 'list',
      now: '2026-10-01T10:00:09.000Z'
    })

    const pSilentClose = seedProject(db, 'p10-silent-close', 'mostaql')
    setWatch(db, {
      projectId: pSilentClose,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    const rFirstClose = saveSnapshot(db, {
      projectId: pSilentClose,
      generation: 1,
      snapshot: {
        status: 'closed',
        offers: 2,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:11.000Z'
    })
    expect(rFirstClose.events).toEqual([])
    expect(rFirstClose.stopped).toBe('closed')
    expect(rFirstClose.row?.state).toBe('stopped')
  })

  it('11. contacts: attribution sure vs maybe; baseline drops; ignored for non-mostaql; field appearing later is silent', () => {
    const p1 = seedProject(db, 'p11-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: null,
        offersCapped: false,
        contacts: null,
        clientOpen: null,
        clientInProgress: null
      },
      now: '2026-10-01T10:00:01.000Z'
    })

    const rFirstContact = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: null,
        offersCapped: false,
        contacts: 2,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rFirstContact.events).toHaveLength(0)
    expect(rFirstContact.row?.contacts).toBe(2)

    const rSure = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: null,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:03.000Z'
    })
    expect(rSure.events).toHaveLength(1)
    expect(rSure.events[0]).toBeDefined()
    const evSure = db
      .prepare('SELECT payload FROM notification_events WHERE id = ?;')
      .get(rSure.events[0]!.id) as { payload: string }
    expect(JSON.parse(evSure.payload)).toEqual({
      v: 1,
      from: 2,
      to: 5,
      attribution: 'sure',
      clientOpen: 1
    })

    const rDrop = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: null,
        offersCapped: false,
        contacts: 3,
        clientOpen: 2,
        clientInProgress: 1
      },
      now: '2026-10-01T10:00:04.000Z'
    })
    expect(rDrop.events).toHaveLength(0)
    expect(rDrop.row?.contacts).toBe(3)

    const rMaybe = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: null,
        offersCapped: false,
        contacts: 4,
        clientOpen: 2,
        clientInProgress: 1
      },
      now: '2026-10-01T10:00:05.000Z'
    })
    expect(rMaybe.events).toHaveLength(1)
    expect(rMaybe.events[0]).toBeDefined()
    const evMaybe = db
      .prepare('SELECT payload FROM notification_events WHERE id = ?;')
      .get(rMaybe.events[0]!.id) as { payload: string }
    expect(JSON.parse(evMaybe.payload)).toEqual({
      v: 1,
      from: 3,
      to: 4,
      attribution: 'maybe',
      clientOpen: 2
    })

    const pNaf = seedProject(db, 'p11-naf', 'nafezly')
    setWatch(db, {
      projectId: pNaf,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })
    saveSnapshot(db, {
      projectId: pNaf,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 1,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:01.000Z'
    })
    const rNafIncrease = saveSnapshot(db, {
      projectId: pNaf,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 1,
        offersCapped: false,
        contacts: 10,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rNafIncrease.events).toHaveLength(0)
    expect(rNafIncrease.row?.contacts).toBeNull()
  })

  it('12. offers changes never create events and do not touch lastChangedAt; multi-event snapshot shares revision', () => {
    const p1 = seedProject(db, 'p12-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 5,
        offersCapped: false,
        contacts: 1,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(getWatch(db, p1)?.lastChangedAt).toBeNull()

    const rOffers = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 15,
        offersCapped: true,
        contacts: 1,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rOffers.events).toHaveLength(0)
    expect(rOffers.row?.offers).toBe(15)
    expect(rOffers.row?.offersCapped).toBe(true)
    expect(rOffers.row?.lastChangedAt).toBeNull()

    const rMulti = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'in_progress',
        offers: 15,
        offersCapped: true,
        contacts: 4,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:03.000Z'
    })
    expect(rMulti.events).toHaveLength(2)
    expect(rMulti.row?.revision).toBe(1)
    expect(rMulti.row?.lastChangedAt).toBe('2026-10-01T10:00:03.000Z')

    const evRows = db
      .prepare('SELECT kind, dedupe_key FROM notification_events ORDER BY id ASC;')
      .all() as { kind: string; dedupe_key: string }[]
    expect(evRows).toHaveLength(2)
    expect(evRows[0]?.dedupe_key).toBe('1:1')
    expect(evRows[1]?.dedupe_key).toBe('1:1')
    expect(new Set(evRows.map((e) => e.kind))).toEqual(new Set(['watch_status', 'watch_contact']))

    const rNext = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'in_progress',
        offers: 15,
        offersCapped: true,
        contacts: 6,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:04.000Z'
    })
    expect(rNext.events).toHaveLength(1)
    expect(rNext.row?.revision).toBe(2)
    expect(rNext.events[0]).toBeDefined()
    const ev3 = db
      .prepare('SELECT dedupe_key FROM notification_events WHERE id = ?;')
      .get(rNext.events[0]!.id) as { dedupe_key: string }
    expect(ev3.dedupe_key).toBe('1:2')
  })

  it('13. late-result guard: wrong generation, stopped, waiting, missing -> applied false; recordWatchFailure behavior', () => {
    const p1 = seedProject(db, 'p13-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    const sampleSnap: WatchSnapshot = {
      status: 'open',
      offers: 1,
      offersCapped: false,
      contacts: 1,
      clientOpen: 1,
      clientInProgress: 0
    }

    const rGenMismatch = saveSnapshot(db, {
      projectId: p1,
      generation: 99,
      snapshot: sampleSnap,
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(rGenMismatch.applied).toBe(false)
    expect(getWatch(db, p1)?.lastAttemptAt).toBeNull()

    const rMissing = saveSnapshot(db, {
      projectId: 88888,
      generation: 1,
      snapshot: sampleSnap,
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rMissing.applied).toBe(false)

    setWatch(db, {
      projectId: p1,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:03.000Z'
    })
    const rStopped = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: sampleSnap,
      now: '2026-10-01T10:00:04.000Z'
    })
    expect(rStopped.applied).toBe(false)

    expect(
      recordWatchFailure(db, {
        projectId: p1,
        generation: 1,
        error: 'err',
        now: '2026-10-01T10:00:05.000Z'
      })
    ).toBe(false)

    const pActive = seedProject(db, 'p13-act', 'mostaql')
    setWatch(db, {
      projectId: pActive,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:06.000Z'
    })

    const longError = 'x'.repeat(300)
    const f1 = recordWatchFailure(db, {
      projectId: pActive,
      generation: 1,
      error: longError,
      now: '2026-10-01T10:00:07.000Z'
    })
    expect(f1).toBe(true)
    const afterF1 = getWatch(db, pActive)!
    expect(afterF1.failures).toBe(1)
    expect(afterF1.lastError).toHaveLength(200)
    expect(afterF1.lastAttemptAt).toBe('2026-10-01T10:00:07.000Z')

    recordWatchFailure(db, {
      projectId: pActive,
      generation: 1,
      error: 'err2',
      now: '2026-10-01T10:00:08.000Z'
    })
    expect(getWatch(db, pActive)?.failures).toBe(2)

    saveSnapshot(db, {
      projectId: pActive,
      generation: 1,
      snapshot: sampleSnap,
      now: '2026-10-01T10:00:09.000Z'
    })
    const afterSuccess = getWatch(db, pActive)!
    expect(afterSuccess.failures).toBe(0)
    expect(afterSuccess.lastError).toBeNull()
  })

  it('14. atomicity: second event insert failure rolls back all changes; terminal snapshot promotion failure rolls back', () => {
    // Case 1: snapshot produces status + contact change. Second insert fails.
    const p1 = seedProject(db, 'p14-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 1,
        offersCapped: false,
        contacts: 1,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:01.000Z'
    })

    const before = getWatch(db, p1)!
    expect(before.revision).toBe(0)

    // Pre-insert a colliding notification_events row for the SECOND event: kind 'watch_contact' with dedupe_key '1:1'
    db.prepare(`
      INSERT INTO notification_events (project_id, kind, status, dedupe_key, created_at, updated_at)
      VALUES (?, 'watch_contact', 'pending', '1:1', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z');
    `).run(p1)

    // Snapshot produces status change (open -> in_progress) AND contact increase (1 -> 4).
    // Event 1 (watch_status) inserts first; event 2 (watch_contact) collides and throws.
    expect(() =>
      saveSnapshot(db, {
        projectId: p1,
        generation: 1,
        snapshot: {
          status: 'in_progress',
          offers: 1,
          offersCapped: false,
          contacts: 4,
          clientOpen: 1,
          clientInProgress: 0
        },
        now: '2026-10-01T10:00:05.000Z'
      })
    ).toThrow()

    // Assert: no new watch_status event exists
    const statusEv = db
      .prepare("SELECT 1 FROM notification_events WHERE project_id = ? AND kind = 'watch_status';")
      .get(p1)
    expect(statusEv).toBeUndefined()

    // Assert: project_watch row is unchanged
    const after = getWatch(db, p1)!
    expect(after.status).toBe(before.status)
    expect(after.contacts).toBe(before.contacts)
    expect(after.revision).toBe(before.revision)
    expect(after.lastAttemptAt).toBe(before.lastAttemptAt)
    expect(after.state).toBe('active')

    // Case 2: terminal snapshot's promotion step fails via trigger
    const pTerm = seedProject(db, 'p14-term', 'mostaql')
    const pWait = seedProject(db, 'p14-wait', 'mostaql')
    setWatch(db, {
      projectId: pTerm,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    for (let i = 1; i <= 9; i++) {
      const pid = seedProject(db, `p14-fill-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:10.000Z'
      })
    }
    setWatch(db, {
      projectId: pWait,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:11.000Z'
    })
    expect(getWatch(db, pWait)?.state).toBe('waiting')

    // Initial snapshot on pTerm so it has status 'open'
    saveSnapshot(db, {
      projectId: pTerm,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 1,
        offersCapped: false,
        contacts: 1,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:12.000Z'
    })

    // Create trigger that fails whenever any waiter is promoted (updated from waiting)
    db.exec(`
      CREATE TRIGGER fail_promo BEFORE UPDATE ON project_watch
      WHEN OLD.state = 'waiting'
      BEGIN
        SELECT RAISE(ABORT, 'promo failed');
      END;
    `)

    expect(() =>
      saveSnapshot(db, {
        projectId: pTerm,
        generation: 1,
        snapshot: {
          status: 'closed',
          offers: 1,
          offersCapped: false,
          contacts: 1,
          clientOpen: 1,
          clientInProgress: 0
        },
        now: '2026-10-01T10:00:15.000Z'
      })
    ).toThrow(/promo failed/)

    db.exec('DROP TRIGGER IF EXISTS fail_promo;')

    // pTerm is still active and no event was written
    expect(getWatch(db, pTerm)?.state).toBe('active')
    const termEvs = db
      .prepare('SELECT 1 FROM notification_events WHERE project_id = ?;')
      .all(pTerm)
    expect(termEvs).toHaveLength(0)
  })

  it('15. Tx variants work inside outer runInTransaction and rollback on exception', () => {
    const p1 = seedProject(db, 'p15-1', 'mostaql')
    const p2 = seedProject(db, 'p15-2', 'mostaql')

    runInTransaction(db, () => {
      setWatchTx(db, {
        projectId: p1,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:00.000Z'
      })
      autoStartOnSubmittedTx(db, p2, '2026-10-01T10:00:00.000Z')
    })

    expect(getWatch(db, p1)?.state).toBe('active')
    expect(getWatch(db, p2)?.state).toBe('active')

    const p3 = seedProject(db, 'p15-3', 'mostaql')
    expect(() =>
      runInTransaction(db, () => {
        setWatchTx(db, {
          projectId: p3,
          want: 'on',
          expectVersion: null,
          origin: 'list',
          now: '2026-10-01T10:00:01.000Z'
        })
        throw new Error('boom')
      })
    ).toThrow('boom')

    expect(getWatch(db, p3)).toBeNull()
  })

  it('16. deleting a project removes its watch row; listWatches order; countActiveWatches per source', () => {
    const pActive1 = seedProject(db, 'p16-act1', 'mostaql')
    const pActive2 = seedProject(db, 'p16-act2', 'mostaql')
    const pWait1 = seedProject(db, 'p16-wait1', 'mostaql')
    const pWait2 = seedProject(db, 'p16-wait2', 'mostaql')

    setWatch(db, {
      projectId: pActive1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })
    setWatch(db, {
      projectId: pActive2,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:05.000Z'
    })

    for (let i = 1; i <= 8; i++) {
      const pid = seedProject(db, `p16-fill-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:02.000Z'
      })
    }

    setWatch(db, {
      projectId: pWait1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:10.000Z'
    })
    setWatch(db, {
      projectId: pWait2,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:20.000Z'
    })

    const pToStop = seedProject(db, 'p16-tostop', 'mostaql')
    setWatch(db, {
      projectId: pToStop,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:03.000Z'
    })
    setWatch(db, {
      projectId: pToStop,
      want: 'off',
      expectVersion: 1,
      origin: 'list',
      now: '2026-10-01T10:00:30.000Z'
    })

    const pNaf = seedProject(db, 'p16-naf', 'nafezly')
    setWatch(db, {
      projectId: pNaf,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    expect(countActiveWatches(db, 'mostaql')).toBe(10)
    expect(countActiveWatches(db, 'nafezly')).toBe(1)
    expect(countActiveWatches(db, 'kaf')).toBe(0)

    const listMostaql = listWatches(db, { source: 'mostaql' })
    expect(listMostaql.total).toBeGreaterThanOrEqual(13)
    expect(listMostaql.rows.length).toBeGreaterThanOrEqual(13)

    const states = listMostaql.rows.map((w) => w.state)
    const firstWait = states.indexOf('waiting')
    const firstStop = states.indexOf('stopped')
    expect(firstWait).toBeGreaterThan(0)
    expect(firstStop).toBeGreaterThan(firstWait)

    // Active rows are ordered by started_at DESC
    const activeRows = listMostaql.rows.filter((w) => w.state === 'active')
    for (let i = 0; i < activeRows.length - 1; i++) {
      expect(activeRows[i]!.startedAt! >= activeRows[i + 1]!.startedAt!).toBe(true)
    }

    // Waiting rows are ordered by waiting_since ASC, then project_id ASC
    const waitingRows = listMostaql.rows.filter((w) => w.state === 'waiting')
    for (let i = 0; i < waitingRows.length - 1; i++) {
      const a = waitingRows[i]!
      const b = waitingRows[i + 1]!
      if (a.waitingSince === b.waitingSince) {
        expect(a.projectId <= b.projectId).toBe(true)
      } else {
        expect(a.waitingSince! <= b.waitingSince!).toBe(true)
      }
    }

    // Cascade delete on project removes project_watch
    expect(getWatch(db, pActive1)).not.toBeNull()
    db.prepare('DELETE FROM projects WHERE id = ?;').run(pActive1)
    expect(getWatch(db, pActive1)).toBeNull()
  })

  it('17. rework item 1: manual off on stopped row blocks auto-start; missing off returns null row; off on blocked row is idempotent', () => {
    // Sequence b: setWatch(on, null) -> stopWatch(expired) -> setWatch(off, expectVersion: 2) -> autoStartOnSubmitted is no-op
    const pSeqB = seedProject(db, 'p-seq-b', 'mostaql')
    setWatch(db, {
      projectId: pSeqB,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })
    stopWatch(db, {
      projectId: pSeqB,
      reason: 'expired',
      now: '2026-10-01T10:00:01.000Z'
    })
    const stoppedBefore = getWatch(db, pSeqB)!
    expect(stoppedBefore.state).toBe('stopped')
    expect(stoppedBefore.stopReason).toBe('expired')
    expect(stoppedBefore.autoStartBlocked).toBe(false)
    expect(stoppedBefore.version).toBe(2)

    const rOff = setWatch(db, {
      projectId: pSeqB,
      want: 'off',
      expectVersion: 2,
      origin: 'list',
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rOff.ok).toBe(true)
    if (rOff.ok) {
      expect(rOff.changed).toBe(true)
      expect(rOff.row?.autoStartBlocked).toBe(true)
      expect(rOff.row?.version).toBe(3)
      expect(rOff.row?.stopReason).toBe('expired')
      expect(rOff.row?.state).toBe('stopped')
    }

    // autoStartOnSubmitted is a no-op
    const rAuto = autoStartOnSubmitted(db, pSeqB, '2026-10-01T10:00:03.000Z')
    expect(rAuto.ok).toBe(true)
    if (rAuto.ok) {
      expect(rAuto.changed).toBe(false)
      expect(rAuto.row?.state).toBe('stopped')
      expect(rAuto.row?.autoStartBlocked).toBe(true)
    }

    // 'off' twice on blocked row does not change version
    const rOffSecond = setWatch(db, {
      projectId: pSeqB,
      want: 'off',
      expectVersion: 3,
      origin: 'list',
      now: '2026-10-01T10:00:04.000Z'
    })
    expect(rOffSecond.ok).toBe(true)
    if (rOffSecond.ok) {
      expect(rOffSecond.changed).toBe(false)
      expect(rOffSecond.row?.version).toBe(3)
    }

    // 'off' on missing row returns row null and the following setWatch(on, expectVersion: null) succeeds
    const pMiss = seedProject(db, 'p-miss', 'mostaql')
    const rOffMiss = setWatch(db, {
      projectId: pMiss,
      want: 'off',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:05.000Z'
    })
    expect(rOffMiss).toEqual({ ok: true, row: null, changed: false, promoted: null })

    const rOnAfterMiss = setWatch(db, {
      projectId: pMiss,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:06.000Z'
    })
    expect(rOnAfterMiss.ok).toBe(true)
    if (rOnAfterMiss.ok) {
      expect(rOnAfterMiss.row?.state).toBe('active')
      expect(rOnAfterMiss.row?.version).toBe(1)
    }
  })

  it('18. rework item 2: saveSnapshot resolves source internally and rejects contacts for nafezly/kaf', () => {
    const pNaf = seedProject(db, 'p18-naf', 'nafezly')
    setWatch(db, {
      projectId: pNaf,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    // Snapshot has contacts 2 then 5; for nafezly no contacts events should ever be produced
    saveSnapshot(db, {
      projectId: pNaf,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 1,
        offersCapped: false,
        contacts: 2,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:01.000Z'
    })

    const rNafIncrease = saveSnapshot(db, {
      projectId: pNaf,
      generation: 1,
      snapshot: {
        status: 'open',
        offers: 1,
        offersCapped: false,
        contacts: 5,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rNafIncrease.events).toEqual([])
    expect(rNafIncrease.row?.contacts).toBeNull()

    // Mostaql watch with waiter: terminal snapshot promotes the Mostaql waiter
    for (let i = 1; i <= 10; i++) {
      const pid = seedProject(db, `p18-m-${i}`, 'mostaql')
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: '2026-10-01T10:00:00.000Z'
      })
    }
    const mWait = seedProject(db, 'p18-m-wait', 'mostaql')
    setWatch(db, {
      projectId: mWait,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(getWatch(db, mWait)?.state).toBe('waiting')

    const activeMostaql = listWatches(db, { source: 'mostaql', state: 'active' }).rows[0]!
    const rTerm = saveSnapshot(db, {
      projectId: activeMostaql.projectId,
      generation: 1,
      snapshot: {
        status: 'closed',
        offers: 1,
        offersCapped: false,
        contacts: 1,
        clientOpen: 1,
        clientInProgress: 0
      },
      now: '2026-10-01T10:00:10.000Z'
    })
    expect(rTerm.stopped).toBe('closed')
    expect(rTerm.promoted).toBe(mWait)
    expect(getWatch(db, mWait)?.state).toBe('active')
  })

  it('19. rework item 3: listWatches pagination with 12 rows across three pages and state filter', () => {
    db.exec('DELETE FROM project_watch; DELETE FROM notification_events;')
    const pids: number[] = []
    for (let i = 1; i <= 12; i++) {
      const pid = seedProject(db, `p19-${i}`, 'mostaql')
      pids.push(pid)
      setWatch(db, {
        projectId: pid,
        want: 'on',
        expectVersion: null,
        origin: 'list',
        now: `2026-10-01T10:00:${i < 10 ? '0' + i : i}.000Z`
      })
    }
    expect(countActiveWatches(db, 'mostaql')).toBe(10)

    const page1 = listWatches(db, { source: 'mostaql', limit: 5, offset: 0 })
    expect(page1.total).toBe(12)
    expect(page1.rows).toHaveLength(5)

    const page2 = listWatches(db, { source: 'mostaql', limit: 5, offset: 5 })
    expect(page2.total).toBe(12)
    expect(page2.rows).toHaveLength(5)

    const page3 = listWatches(db, { source: 'mostaql', limit: 5, offset: 10 })
    expect(page3.total).toBe(12)
    expect(page3.rows).toHaveLength(2)

    const allPids = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.projectId)
    expect(new Set(allPids)).toEqual(new Set(pids))

    const waitOnly = listWatches(db, { source: 'mostaql', state: 'waiting' })
    expect(waitOnly.total).toBe(2)
    expect(waitOnly.rows).toHaveLength(2)
    expect(waitOnly.rows.every((r) => r.state === 'waiting')).toBe(true)
  })

  it('20. EXPLAIN QUERY PLAN captures actual prepared SQL and verifies index use and only SEARCH on projects', () => {
    const p1 = seedProject(db, 'p20-1', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:00.000Z' })

    const captured: string[] = []
    const originalPrepare = db.prepare.bind(db)
    db.prepare = function (sql: string, ...rest: unknown[]) {
      captured.push(sql)
      return (originalPrepare as (...args: unknown[]) => unknown)(sql, ...rest)
    } as typeof db.prepare

    try {
      pickDueWatch(db, { source: 'mostaql', now: '2026-10-01T12:00:00.000Z', prefer: 'submitted' })
      listWatches(db, { source: 'mostaql' })
      stopSource(db, { source: 'mostaql', now: '2026-10-01T12:00:00.000Z' })
    } finally {
      db.prepare = originalPrepare
    }

    expect(captured.length).toBeGreaterThanOrEqual(3)

    const pickSql = captured.find((s) => s.includes('SELECT pw.*') && s.includes('personal_status = \'submitted\''))
    expect(pickSql).toBeDefined()
    const pickPlan = db.prepare(`EXPLAIN QUERY PLAN ${pickSql}`).all('mostaql', '2026-10-01T12:00:00.000Z', 1) as { detail: string }[]
    const pickDetails = pickPlan.map((p) => p.detail)

    const listSql = captured.find((s) => s.includes('SELECT pw.*') && s.includes('ORDER BY') && s.includes('LIMIT ? OFFSET ?'))
    expect(listSql).toBeDefined()
    const listPlan = db.prepare(`EXPLAIN QUERY PLAN ${listSql}`).all('mostaql', 100, 0) as { detail: string }[]
    const listDetails = listPlan.map((p) => p.detail)

    const stopSql = captured.find((s) => s.includes('UPDATE project_watch') && s.includes('source_disabled'))
    expect(stopSql).toBeDefined()
    const stopPlan = db.prepare(`EXPLAIN QUERY PLAN ${stopSql}`).all('2026-10-01T12:00:00.000Z', 'mostaql') as { detail: string }[]
    const stopDetails = stopPlan.map((p) => p.detail)

    for (const details of [pickDetails, listDetails, stopDetails]) {
      for (const d of details) {
        expect(d).not.toMatch(/SCAN (p|projects)\b/)
      }
      const projLines = details.filter((d) => /\b(p|projects)\b/.test(d))
      expect(projLines.length).toBeGreaterThan(0)
      for (const pl of projLines) {
        expect(pl).toMatch(/SEARCH (p|projects) USING (INTEGER PRIMARY KEY|rowid)/)
      }
    }

    expect(pickDetails.some((d) => /SEARCH (pw|project_watch) USING INDEX idx_project_watch_state/.test(d))).toBe(true)
  })

  it('21. rework item 5: stored status unknown treated as absent baseline (next known status silent, then transitions emit)', () => {
    const p1 = seedProject(db, 'p21-1', 'mostaql')
    setWatch(db, {
      projectId: p1,
      want: 'on',
      expectVersion: null,
      origin: 'list',
      now: '2026-10-01T10:00:00.000Z'
    })

    // Write status 'unknown' directly with SQL
    db.prepare("UPDATE project_watch SET status = 'unknown' WHERE project_id = ?;").run(p1)
    expect(getWatch(db, p1)?.status).toBe('unknown')

    // Snapshot with 'in_progress': treated as absent baseline -> stored silently, no event
    const rProg = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'in_progress',
        offers: null,
        offersCapped: false,
        contacts: null,
        clientOpen: null,
        clientInProgress: null
      },
      now: '2026-10-01T10:00:01.000Z'
    })
    expect(rProg.events).toEqual([])
    expect(rProg.row?.status).toBe('in_progress')

    // Next snapshot with 'closed': from known baseline 'in_progress' to 'closed' -> emits event and stops
    const rClosed = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: {
        status: 'closed',
        offers: null,
        offersCapped: false,
        contacts: null,
        clientOpen: null,
        clientInProgress: null
      },
      now: '2026-10-01T10:00:02.000Z'
    })
    expect(rClosed.events).toHaveLength(1)
    expect(rClosed.events[0]?.kind).toBe('watch_status')
    expect(rClosed.events[0]).toBeDefined()
    const ev = db
      .prepare('SELECT payload FROM notification_events WHERE id = ?;')
      .get(rClosed.events[0]!.id) as { payload: string }
    expect(JSON.parse(ev.payload)).toEqual({ v: 1, from: 'in_progress', to: 'closed' })
    expect(rClosed.stopped).toBe('closed')
    expect(rClosed.row?.state).toBe('stopped')
  })

  it('22. pickDueWatch: due vs not due, null nextDueAt first, ordering ties, preference classes, other sources/states excluded', () => {
    const tNow = '2026-10-01T12:00:00.000Z'
    const tPast = '2026-10-01T11:00:00.000Z'
    const tFuture = '2026-10-01T13:00:00.000Z'

    // 1. Due vs not due
    const pDue = seedProject(db, 'p22-due', 'mostaql')
    const pNotDue = seedProject(db, 'p22-notdue', 'mostaql')
    setWatch(db, { projectId: pDue, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setWatch(db, { projectId: pNotDue, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setNextDue(db, { projectId: pDue, generation: 1, dueAt: tPast })
    setNextDue(db, { projectId: pNotDue, generation: 1, dueAt: tFuture })

    const pick1 = pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })
    expect(pick1).not.toBeNull()
    expect(pick1?.row.projectId).toBe(pDue)
    expect(pick1?.submitted).toBe(false)

    // Another source's rows never returned
    const pNafDue = seedProject(db, 'p22-naf-due', 'nafezly')
    setWatch(db, { projectId: pNafDue, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setNextDue(db, { projectId: pNafDue, generation: 1, dueAt: tPast })
    const pickKaf = pickDueWatch(db, { source: 'kaf', now: tNow, prefer: 'other' })
    expect(pickKaf).toBeNull()

    // Waiting and stopped rows never returned
    const pWait = seedProject(db, 'p22-wait', 'mostaql')
    for (let i = 1; i <= 8; i++) {
      const pid = seedProject(db, `p22-fill-${i}`, 'mostaql')
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: tPast })
      setNextDue(db, { projectId: pid, generation: 1, dueAt: tFuture })
    }
    setWatch(db, { projectId: pWait, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    expect(getWatch(db, pWait)?.state).toBe('waiting')
    db.prepare('UPDATE project_watch SET next_due_at = ? WHERE project_id = ?;').run(tPast, pWait)

    const pStopped = seedProject(db, 'p22-stop', 'mostaql')
    setWatch(db, { projectId: pStopped, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    stopWatch(db, { projectId: pStopped, reason: 'closed', now: tPast })
    db.prepare('UPDATE project_watch SET next_due_at = ? WHERE project_id = ?;').run(tPast, pStopped)

    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })?.row.projectId).toBe(pDue)

    // Reset project_watch for clean ordering test
    db.exec('DELETE FROM project_watch;')

    // 2. NULL next_due_at first
    const pNullDue = seedProject(db, 'p22-null-due', 'mostaql')
    const pPastDue = seedProject(db, 'p22-past-due', 'mostaql')
    setWatch(db, { projectId: pNullDue, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setWatch(db, { projectId: pPastDue, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setNextDue(db, { projectId: pPastDue, generation: 1, dueAt: tPast })
    expect(getWatch(db, pNullDue)?.nextDueAt).toBeNull()

    const pickNullFirst = pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })
    expect(pickNullFirst?.row.projectId).toBe(pNullDue)

    // 3. Ordering ties inside class:
    // next_due_at IS NULL first, then next_due_at ASC,
    // then last_attempt_at IS NULL first, then last_attempt_at ASC,
    // then project_id ASC
    db.exec('DELETE FROM project_watch;')
    const pA = seedProject(db, 'p22-a', 'mostaql')
    const pB = seedProject(db, 'p22-b', 'mostaql')
    setWatch(db, { projectId: pA, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setWatch(db, { projectId: pB, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setNextDue(db, { projectId: pA, generation: 1, dueAt: '2026-10-01T10:00:00.000Z' })
    setNextDue(db, { projectId: pB, generation: 1, dueAt: '2026-10-01T10:30:00.000Z' })
    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })?.row.projectId).toBe(pA)

    // When next_due_at are equal: last_attempt_at NULL first
    setNextDue(db, { projectId: pB, generation: 1, dueAt: '2026-10-01T10:00:00.000Z' })
    db.prepare('UPDATE project_watch SET last_attempt_at = ? WHERE project_id = ?;').run('2026-10-01T09:00:00.000Z', pA)
    // pB has last_attempt_at NULL, pA has non-null -> pB comes first
    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })?.row.projectId).toBe(pB)

    // When last_attempt_at both non-null: earlier last_attempt_at first
    db.prepare('UPDATE project_watch SET last_attempt_at = ? WHERE project_id = ?;').run('2026-10-01T08:00:00.000Z', pB)
    db.prepare('UPDATE project_watch SET last_attempt_at = ? WHERE project_id = ?;').run('2026-10-01T09:00:00.000Z', pA)
    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })?.row.projectId).toBe(pB)

    // When last_attempt_at equal: project_id ASC
    db.prepare('UPDATE project_watch SET last_attempt_at = ? WHERE project_id = ?;').run('2026-10-01T09:00:00.000Z', pB)
    const minId = Math.min(pA, pB)
    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })?.row.projectId).toBe(minId)

    // 4. Preferences: 'submitted' vs 'other'
    // A project with no user-state row counts as 'other'
    // A project with personal_status = 'submitted' counts as 'submitted'
    // A project with personal_status = 'interested' counts as 'other'
    db.exec('DELETE FROM project_watch;')
    const pSub = seedProject(db, 'p22-sub', 'mostaql')
    const pOth = seedProject(db, 'p22-oth', 'mostaql')
    const pNoState = seedProject(db, 'p22-nostate', 'mostaql')
    setWatch(db, { projectId: pSub, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setWatch(db, { projectId: pOth, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    setWatch(db, { projectId: pNoState, want: 'on', expectVersion: null, origin: 'list', now: tPast })

    updateUserState(db, pSub, { status: 'submitted' }, tPast)
    updateUserState(db, pOth, { status: 'interested' }, tPast)
    // pNoState has no row in project_user_state

    // Both classes present:
    const pickSub = pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'submitted' })
    expect(pickSub?.row.projectId).toBe(pSub)
    expect(pickSub?.submitted).toBe(true)

    const pickOth = pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })
    expect([pOth, pNoState]).toContain(pickOth?.row.projectId)
    expect(pickOth?.submitted).toBe(false)

    // Only submitted present:
    db.exec(`DELETE FROM project_watch WHERE project_id IN (${pOth}, ${pNoState});`)
    const pickOnlySubWithPreferOther = pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })
    expect(pickOnlySubWithPreferOther?.row.projectId).toBe(pSub)
    expect(pickOnlySubWithPreferOther?.submitted).toBe(true)

    // Only other present:
    db.exec('DELETE FROM project_watch;')
    setWatch(db, { projectId: pOth, want: 'on', expectVersion: null, origin: 'list', now: tPast })
    const pickOnlyOthWithPreferSub = pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'submitted' })
    expect(pickOnlyOthWithPreferSub?.row.projectId).toBe(pOth)
    expect(pickOnlyOthWithPreferSub?.submitted).toBe(false)

    // None present:
    db.exec('DELETE FROM project_watch;')
    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'submitted' })).toBeNull()
    expect(pickDueWatch(db, { source: 'mostaql', now: tNow, prefer: 'other' })).toBeNull()
  })

  it('23. setNextDue: applies for matching generation; does nothing for wrong gen, waiting, stopped, or missing row', () => {
    const t0 = '2026-10-01T10:00:00.000Z'
    const tDue = '2026-10-01T11:00:00.000Z'
    const p1 = seedProject(db, 'p23-1', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: t0 })
    expect(getWatch(db, p1)?.generation).toBe(1)

    // Wrong generation -> returns false, no change
    expect(setNextDue(db, { projectId: p1, generation: 99, dueAt: tDue })).toBe(false)
    expect(getWatch(db, p1)?.nextDueAt).toBeNull()

    // Matching generation -> returns true, next_due_at updated
    expect(setNextDue(db, { projectId: p1, generation: 1, dueAt: tDue })).toBe(true)
    expect(getWatch(db, p1)?.nextDueAt).toBe(tDue)
    expect(getWatch(db, p1)?.version).toBe(1)
    expect(getWatch(db, p1)?.revision).toBe(0)

    // Stopped row -> returns false
    stopWatch(db, { projectId: p1, reason: 'closed', now: t0 })
    expect(getWatch(db, p1)?.state).toBe('stopped')
    expect(setNextDue(db, { projectId: p1, generation: 1, dueAt: '2026-10-01T12:00:00.000Z' })).toBe(false)

    // Waiting row -> returns false
    for (let i = 1; i <= 10; i++) {
      const pid = seedProject(db, `p23-fill-${i}`, 'mostaql')
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: t0 })
    }
    const pWait = seedProject(db, 'p23-wait', 'mostaql')
    setWatch(db, { projectId: pWait, want: 'on', expectVersion: null, origin: 'list', now: t0 })
    expect(getWatch(db, pWait)?.state).toBe('waiting')
    expect(setNextDue(db, { projectId: pWait, generation: 0, dueAt: tDue })).toBe(false)
    expect(getWatch(db, pWait)?.nextDueAt).toBeNull()

    // Missing row -> returns false
    expect(setNextDue(db, { projectId: 999999, generation: 1, dueAt: tDue })).toBe(false)
  })

  it('24. expireWatches: boundary checks, promotion of eligible waiters, waiting rows ignored, source isolation', () => {
    const tStarted = '2026-10-01T10:00:00.000Z'
    const expireMs = WATCH_EXPIRE_MS
    const tExactBoundary = new Date(new Date(tStarted).getTime() + expireMs).toISOString()
    const tBeforeBoundary = new Date(new Date(tStarted).getTime() + expireMs - 1).toISOString()

    const pActiveExact1 = seedProject(db, 'p24-exact-1', 'mostaql')
    const pActiveExact2 = seedProject(db, 'p24-exact-2', 'mostaql')
    const pActiveLate = seedProject(db, 'p24-late', 'mostaql')
    const pActiveNaf = seedProject(db, 'p24-naf', 'nafezly')

    setWatch(db, { projectId: pActiveExact1, want: 'on', expectVersion: null, origin: 'list', now: tStarted })
    setWatch(db, { projectId: pActiveExact2, want: 'on', expectVersion: null, origin: 'list', now: tStarted })
    const tStartedPlus1 = new Date(new Date(tStarted).getTime() + 1).toISOString()
    setWatch(db, { projectId: pActiveLate, want: 'on', expectVersion: null, origin: 'list', now: tStartedPlus1 })
    setWatch(db, { projectId: pActiveNaf, want: 'on', expectVersion: null, origin: 'list', now: tStarted })

    // Before boundary -> nothing expires
    const resNone = expireWatches(db, { source: 'mostaql', now: tBeforeBoundary, expireMs })
    expect(resNone.expired).toEqual([])
    expect(resNone.promoted).toEqual([])

    // Boundary check with complete ordered result array
    const orderedExactIds = [pActiveExact1, pActiveExact2].sort((a, b) => a - b)
    const resBoundary = expireWatches(db, { source: 'mostaql', now: tExactBoundary, expireMs })
    expect(resBoundary.expired).toEqual(orderedExactIds)
    expect(resBoundary.promoted).toEqual([])

    expect(getWatch(db, pActiveExact1)?.state).toBe('stopped')
    expect(getWatch(db, pActiveExact1)?.stopReason).toBe('expired')
    expect(getWatch(db, pActiveExact2)?.state).toBe('stopped')
    expect(getWatch(db, pActiveExact2)?.stopReason).toBe('expired')
    expect(getWatch(db, pActiveLate)?.state).toBe('active')
    expect(getWatch(db, pActiveNaf)?.state).toBe('active')

    // Reset project_watch for comprehensive waiter promotion test
    db.exec('DELETE FROM project_watch;')

    // Setup 10 active watches: 3 will expire, 7 will remain active
    const pExp1 = seedProject(db, 'p24-exp-1', 'mostaql')
    const pExp2 = seedProject(db, 'p24-exp-2', 'mostaql')
    const pExp3 = seedProject(db, 'p24-exp-3', 'mostaql')
    setWatch(db, { projectId: pExp1, want: 'on', expectVersion: null, origin: 'list', now: '2026-09-01T10:00:00.000Z' })
    setWatch(db, { projectId: pExp2, want: 'on', expectVersion: null, origin: 'list', now: '2026-09-01T10:01:00.000Z' })
    setWatch(db, { projectId: pExp3, want: 'on', expectVersion: null, origin: 'list', now: '2026-09-01T10:02:00.000Z' })

    const recentStartedAt = '2026-10-15T10:00:00.000Z'
    for (let i = 1; i <= 7; i++) {
      const pid = seedProject(db, `p24-recent-${i}`, 'mostaql')
      setWatch(db, { projectId: pid, want: 'on', expectVersion: null, origin: 'list', now: recentStartedAt })
    }
    expect(countActiveWatches(db, 'mostaql')).toBe(10)

    // Several waiters: eligible, hidden, ignored, eligible...
    const wElig1 = seedProject(db, 'p24-w-elig-1', 'mostaql')
    const wHidden = seedProject(db, 'p24-w-hidden', 'mostaql')
    const wIgnored = seedProject(db, 'p24-w-ignored', 'mostaql')
    const wElig2 = seedProject(db, 'p24-w-elig-2', 'mostaql')
    const wElig3 = seedProject(db, 'p24-w-elig-3', 'mostaql')
    const wElig4 = seedProject(db, 'p24-w-elig-4', 'mostaql')

    setWatch(db, { projectId: wElig1, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:01.000Z' })
    setWatch(db, { projectId: wHidden, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:02.000Z' })
    setWatch(db, { projectId: wIgnored, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:03.000Z' })
    setWatch(db, { projectId: wElig2, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:04.000Z' })
    setWatch(db, { projectId: wElig3, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:05.000Z' })
    setWatch(db, { projectId: wElig4, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:06.000Z' })

    updateUserState(db, wHidden, { hidden: true }, '2026-10-01T10:00:02.000Z')
    updateUserState(db, wIgnored, { status: 'ignored' }, '2026-10-01T10:00:03.000Z')

    // 3 expire -> exactly 3 slots open -> wElig1, wElig2, wElig3 promoted up to cap
    const resPromote = expireWatches(db, { source: 'mostaql', now: '2026-10-15T12:00:00.000Z', expireMs })
    expect(resPromote.expired).toEqual([pExp1, pExp2, pExp3])
    expect(resPromote.promoted).toEqual([wElig1, wElig2, wElig3])

    expect(getWatch(db, wElig1)?.state).toBe('active')
    expect(getWatch(db, wHidden)?.state).toBe('waiting')
    expect(getWatch(db, wIgnored)?.state).toBe('waiting')
    expect(getWatch(db, wElig2)?.state).toBe('active')
    expect(getWatch(db, wElig3)?.state).toBe('active')
    expect(getWatch(db, wElig4)?.state).toBe('waiting')
    expect(countActiveWatches(db, 'mostaql')).toBe(10)

    // A promotion failure inside an outer transaction rolls back the expiry too
    db.exec(`
      CREATE TRIGGER fail_promo_expire BEFORE UPDATE ON project_watch
      WHEN OLD.state = 'waiting'
      BEGIN
        SELECT RAISE(ABORT, 'promo-failed');
      END;
    `)

    db.prepare('UPDATE project_watch SET started_at = ? WHERE project_id = ?;').run('2026-09-01T10:00:00.000Z', wElig1)

    expect(() =>
      expireWatches(db, { source: 'mostaql', now: '2026-10-15T12:00:00.000Z', expireMs })
    ).toThrow(/promo-failed/)

    db.exec('DROP TRIGGER IF EXISTS fail_promo_expire;')

    expect(getWatch(db, wElig1)?.state).toBe('active')
    expect(getWatch(db, wElig4)?.state).toBe('waiting')
  })

  it('25. watch source state: default when missing, round-trip, upsert overwrites, validation throws and writes nothing', () => {
    // 1. Default when missing
    const def = getWatchSourceState(db, 'mostaql')
    expect(def).toEqual({
      source: 'mostaql',
      slotMs: WATCH_SLOT_MS,
      successStreak: 0,
      pausedUntil: null,
      blockedAt: null,
      needsPollSuccess: false
    })

    // 2. Round-trip
    const state1: WatchSourceState = {
      source: 'mostaql',
      slotMs: 15_000,
      successStreak: 3,
      pausedUntil: '2026-10-01T12:00:00.000Z',
      blockedAt: '2026-10-01T11:30:00.000Z',
      needsPollSuccess: true
    }
    saveWatchSourceState(db, state1)
    expect(getWatchSourceState(db, 'mostaql')).toEqual(state1)

    // 3. Upsert overwrites
    const state2: WatchSourceState = {
      source: 'mostaql',
      slotMs: 25_000,
      successStreak: 0,
      pausedUntil: null,
      blockedAt: null,
      needsPollSuccess: false
    }
    saveWatchSourceState(db, state2)
    expect(getWatchSourceState(db, 'mostaql')).toEqual(state2)

    // 4. Validation: source must be in WATCH_SOURCES
    expect(() =>
      saveWatchSourceState(db, {
        source: 'khamsat' as unknown as WatchSourceState['source'],
        slotMs: 10_000,
        successStreak: 0,
        pausedUntil: null,
        blockedAt: null,
        needsPollSuccess: false
      })
    ).toThrow('bad-watch-source-state')

    // Validation: slotMs must be positive finite integer
    const badSlotValues = [
      0,
      -100,
      10.5,
      NaN,
      Infinity,
      -Infinity,
      null as unknown as number,
      '10000' as unknown as number
    ]
    for (const bad of badSlotValues) {
      expect(() =>
        saveWatchSourceState(db, {
          source: 'nafezly',
          slotMs: bad,
          successStreak: 0,
          pausedUntil: null,
          blockedAt: null,
          needsPollSuccess: false
        })
      ).toThrow('bad-watch-source-state')
    }

    // Nothing was written for nafezly
    expect(getWatchSourceState(db, 'nafezly')).toEqual({
      source: 'nafezly',
      slotMs: WATCH_SLOT_MS,
      successStreak: 0,
      pausedUntil: null,
      blockedAt: null,
      needsPollSuccess: false
    })
  })

  it('26. Tx variants (setNextDueTx, expireWatchesTx, saveWatchSourceStateTx) work inside outer runInTransaction and roll back', () => {
    const t0 = '2026-10-01T10:00:00.000Z'
    const p1 = seedProject(db, 'p26-1', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: t0 })

    const validState: WatchSourceState = {
      source: 'kaf',
      slotMs: 20_000,
      successStreak: 5,
      pausedUntil: null,
      blockedAt: null,
      needsPollSuccess: false
    }

    // Outer transaction succeeds
    runInTransaction(db, () => {
      const dueChanged = setNextDueTx(db, { projectId: p1, generation: 1, dueAt: '2026-10-01T11:00:00.000Z' })
      expect(dueChanged).toBe(true)
      saveWatchSourceStateTx(db, validState)
    })
    expect(getWatch(db, p1)?.nextDueAt).toBe('2026-10-01T11:00:00.000Z')
    expect(getWatchSourceState(db, 'kaf')).toEqual(validState)

    // Outer transaction rolls back
    expect(() =>
      runInTransaction(db, () => {
        setNextDueTx(db, { projectId: p1, generation: 1, dueAt: '2026-10-01T15:00:00.000Z' })
        saveWatchSourceStateTx(db, { ...validState, slotMs: 99_999 })
        expireWatchesTx(db, { source: 'mostaql', now: '2026-11-01T00:00:00.000Z' })
        throw new Error('rollback-test')
      })
    ).toThrow('rollback-test')

    // Assert: changes were rolled back
    expect(getWatch(db, p1)?.nextDueAt).toBe('2026-10-01T11:00:00.000Z')
    expect(getWatch(db, p1)?.state).toBe('active')
    expect(getWatchSourceState(db, 'kaf')?.slotMs).toBe(20_000)
  })

  it('27. canonicalTime: reproductions (pickDueWatch and expireWatches format mismatches), mixed input representations, unparseable time rejection', () => {
    const tDueNoMs = '2026-01-01T12:00:00Z'
    const tDueCanonical = '2026-01-01T12:00:00.000Z'
    const p1 = seedProject(db, 'p27-1', 'mostaql')
    setWatch(db, { projectId: p1, want: 'on', expectVersion: null, origin: 'list', now: '2026-01-01T10:00:00Z' })

    // Reproduction 1: setNextDue with '...Z' stores canonical '.000Z' so pickDueWatch at '.001Z' returns it
    setNextDue(db, { projectId: p1, generation: 1, dueAt: tDueNoMs })
    expect(getWatch(db, p1)?.nextDueAt).toBe(tDueCanonical)

    const pickDue = pickDueWatch(db, { source: 'mostaql', now: '2026-01-01T12:00:00.001Z', prefer: 'submitted' })
    expect(pickDue).not.toBeNull()
    expect(pickDue?.row.projectId).toBe(p1)

    // Reproduction 2: watch started at '...Z', expireWatches 14 days later at '...000Z' expires it
    const p2 = seedProject(db, 'p27-2', 'mostaql')
    setWatch(db, { projectId: p2, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T12:00:00Z' })
    expect(getWatch(db, p2)?.startedAt).toBe('2026-10-01T12:00:00.000Z')

    const resExpire = expireWatches(db, {
      source: 'mostaql',
      now: '2026-10-15T12:00:00.000Z',
      expireMs: WATCH_EXPIRE_MS
    })
    expect(resExpire.expired).toContain(p2)
    expect(getWatch(db, p2)?.state).toBe('stopped')
    expect(getWatch(db, p2)?.stopReason).toBe('expired')

    // Mixed inputs ('...Z', '...000Z', '+00:00' offset, '+02:00' offset meaning the exact same instant)
    const instantInputs = [
      '2026-11-01T10:00:00Z',
      '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:00:00+00:00',
      '2026-11-01T12:00:00+02:00'
    ]
    const expectedCanonical = '2026-11-01T10:00:00.000Z'

    for (let i = 0; i < instantInputs.length; i++) {
      const pMixed = seedProject(db, `p27-mixed-${i}`, 'mostaql')
      setWatch(db, { projectId: pMixed, want: 'on', expectVersion: null, origin: 'list', now: instantInputs[i]! })
      expect(getWatch(db, pMixed)?.startedAt).toBe(expectedCanonical)

      setNextDue(db, { projectId: pMixed, generation: 1, dueAt: instantInputs[i]! })
      expect(getWatch(db, pMixed)?.nextDueAt).toBe(expectedCanonical)
    }

    saveWatchSourceState(db, {
      source: 'mostaql',
      slotMs: 10_000,
      successStreak: 0,
      pausedUntil: '2026-11-01T12:00:00+02:00',
      blockedAt: '2026-11-01T10:00:00Z',
      needsPollSuccess: false
    })
    const srcState = getWatchSourceState(db, 'mostaql')
    expect(srcState.pausedUntil).toBe(expectedCanonical)
    expect(srcState.blockedAt).toBe(expectedCanonical)

    // Unparseable time throws and writes nothing
    const badTimes = ['not-a-date', '', 'invalid', '2026-99-99T99:99:99']
    for (const bad of badTimes) {
      const pBad = seedProject(db, `p27-bad-${bad.slice(0, 5)}`, 'mostaql')
      expect(() =>
        setWatch(db, { projectId: pBad, want: 'on', expectVersion: null, origin: 'list', now: bad })
      ).toThrow('bad-watch-time')
      expect(getWatch(db, pBad)).toBeNull()

      expect(() => autoStartOnSubmitted(db, pBad, bad)).toThrow('bad-watch-time')
      expect(getWatch(db, pBad)).toBeNull()

      expect(() => setNextDue(db, { projectId: p1, generation: 1, dueAt: bad })).toThrow('bad-watch-time')
      expect(() => stopWatch(db, { projectId: p1, reason: 'closed', now: bad })).toThrow('bad-watch-time')
      expect(() => stopSource(db, { source: 'mostaql', now: bad })).toThrow('bad-watch-time')
      expect(() =>
        saveSnapshot(db, {
          projectId: p1,
          generation: 1,
          snapshot: { status: 'open', offers: 1, offersCapped: false, contacts: 1, clientOpen: 1, clientInProgress: 0 },
          now: bad
        })
      ).toThrow('bad-watch-time')
      expect(() => recordWatchFailure(db, { projectId: p1, generation: 1, error: 'err', now: bad })).toThrow('bad-watch-time')
      expect(() => pickDueWatch(db, { source: 'mostaql', now: bad, prefer: 'submitted' })).toThrow('bad-watch-time')
      expect(() => expireWatches(db, { source: 'mostaql', now: bad })).toThrow('bad-watch-time')

      expect(() =>
        saveWatchSourceState(db, {
          source: 'mostaql',
          slotMs: 10_000,
          successStreak: 0,
          pausedUntil: bad,
          blockedAt: null,
          needsPollSuccess: false
        })
      ).toThrow('bad-watch-time')

      expect(() =>
        saveWatchSourceState(db, {
          source: 'mostaql',
          slotMs: 10_000,
          successStreak: 0,
          pausedUntil: null,
          blockedAt: bad,
          needsPollSuccess: false
        })
      ).toThrow('bad-watch-time')
    }
  })

  it('28. canonicalTime: extended years rejection, 0000 and 9999 acceptance, derived cutoff before year 0 rejection', () => {
    const extendedYears = [
      '+010000-01-01T00:00:00.000Z',
      '-000002-01-01T00:00:00.000Z'
    ]
    const pBase = seedProject(db, 'p28-base', 'mostaql')
    setWatch(db, { projectId: pBase, want: 'on', expectVersion: null, origin: 'list', now: '2026-10-01T10:00:00.000Z' })

    for (const ext of extendedYears) {
      const pExt = seedProject(db, `p28-ext-${ext.slice(0, 7)}`, 'mostaql')
      // setWatch throws and writes nothing
      expect(() =>
        setWatch(db, { projectId: pExt, want: 'on', expectVersion: null, origin: 'list', now: ext })
      ).toThrow('bad-watch-time')
      expect(getWatch(db, pExt)).toBeNull()

      // setNextDue throws and writes nothing
      expect(() =>
        setNextDue(db, { projectId: pBase, generation: 1, dueAt: ext })
      ).toThrow('bad-watch-time')
      expect(getWatch(db, pBase)?.nextDueAt).toBeNull()

      // pickDueWatch throws
      expect(() =>
        pickDueWatch(db, { source: 'mostaql', now: ext, prefer: 'submitted' })
      ).toThrow('bad-watch-time')

      // expireWatches throws and writes nothing
      expect(() =>
        expireWatches(db, { source: 'mostaql', now: ext })
      ).toThrow('bad-watch-time')
      expect(getWatch(db, pBase)?.state).toBe('active')
    }

    db.exec('DELETE FROM project_watch;')

    // Boundary year 9999-12-31T23:59:59.999Z (accepted)
    const t9999 = '9999-12-31T23:59:59.999Z'
    const p9999 = seedProject(db, 'p28-9999', 'mostaql')
    setWatch(db, { projectId: p9999, want: 'on', expectVersion: null, origin: 'list', now: t9999 })
    expect(getWatch(db, p9999)?.startedAt).toBe(t9999)

    expect(setNextDue(db, { projectId: p9999, generation: 1, dueAt: t9999 })).toBe(true)
    expect(getWatch(db, p9999)?.nextDueAt).toBe(t9999)

    const pick9999 = pickDueWatch(db, { source: 'mostaql', now: t9999, prefer: 'other' })
    expect(pick9999?.row.projectId).toBe(p9999)

    const expire9999 = expireWatches(db, { source: 'mostaql', now: t9999, expireMs: 0 })
    expect(expire9999.expired).toContain(p9999)
    expect(getWatch(db, p9999)?.state).toBe('stopped')

    // Boundary year 0000-01-01T00:00:00.000Z (accepted)
    const t0000 = '0000-01-01T00:00:00.000Z'
    const p0000 = seedProject(db, 'p28-0000', 'mostaql')
    setWatch(db, { projectId: p0000, want: 'on', expectVersion: null, origin: 'list', now: t0000 })
    expect(getWatch(db, p0000)?.startedAt).toBe(t0000)

    expect(setNextDue(db, { projectId: p0000, generation: 1, dueAt: t0000 })).toBe(true)
    expect(getWatch(db, p0000)?.nextDueAt).toBe(t0000)

    const pick0000 = pickDueWatch(db, { source: 'mostaql', now: t0000, prefer: 'other' })
    expect(pick0000?.row.projectId).toBe(p0000)

    // expireWatches with expireMs: 0 keeps cutoff in year 0000 and is accepted
    const expire0000Zero = expireWatches(db, { source: 'mostaql', now: t0000, expireMs: 0 })
    expect(expire0000Zero.expired).toContain(p0000)
    expect(getWatch(db, p0000)?.state).toBe('stopped')

    // expireWatches with now so early that cutoff falls before year 0 throws and writes nothing
    const pBefore0 = seedProject(db, 'p28-before0', 'mostaql')
    setWatch(db, { projectId: pBefore0, want: 'on', expectVersion: null, origin: 'list', now: t0000 })
    expect(getWatch(db, pBefore0)?.state).toBe('active')

    // default expireMs (14 days) or expireMs: 1000 from 0000-01-01T00:00:00.000Z falls into negative years
    expect(() =>
      expireWatches(db, { source: 'mostaql', now: t0000 })
    ).toThrow('bad-watch-time')
    expect(getWatch(db, pBefore0)?.state).toBe('active')

    expect(() =>
      expireWatchesTx(db, { source: 'mostaql', now: t0000, expireMs: 1_000 })
    ).toThrow('bad-watch-time')
    expect(getWatch(db, pBefore0)?.state).toBe('active')
  })
})
