import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../src/storage/db.js'
import {
  suppressPendingWatchEvents,
  upsertProjectsBatch
} from '../src/storage/repositories.js'
import {
  finishEpisode,
  getWatch,
  saveSnapshot,
  setWatch,
  startEpisode,
  stopWatch,
  takeDueEpisode,
  WATCH_EPISODE_MS
} from '../src/storage/projectWatch.js'
import {
  dispatchWatchEpisode,
  dispatchWatchPending,
  type WatchAwayPayload,
  type WatchEpisodeDispatchDeps
} from '../src/main/watchNotifier.js'
import { watchAwayTitle } from '../src/shared/watchNotificationText.js'

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
        publishedAt: '2026-11-13T10:00:00.000Z',
        publishedRaw: null
      }
    ],
    { now: '2026-11-13T10:00:00.000Z', discoveryKind: 'live' }
  )
  return res.insertedIds[0]!
}

function initWatch(database: Db, projectId: number, now: string): void {
  setWatch(database, { projectId, want: 'on', expectVersion: null, origin: 'list', now })
  saveSnapshot(database, {
    projectId,
    generation: 1,
    snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
    now
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rased-watch-episode-'))
  db = openDatabase(join(dir, 'test.db'))
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('watch episode storage & lifecycle', () => {
  it('startEpisode with no active watch -> null, nothing inserted; with 2 active + 1 waiting -> members are only the 2 active, with their generations', () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const resEmpty = startEpisode(db, { now: t0 })
    expect(resEmpty).toEqual({ episodeId: null, created: false })
    const epCount = db.prepare('SELECT COUNT(*) AS c FROM watch_episode;').get() as { c: number }
    expect(epCount.c).toBe(0)

    // WATCH_CAP_PER_SOURCE is 10. Fill to 10 active, then 11th is waiting.
    const projects: number[] = []
    for (let i = 1; i <= 11; i++) {
      projects.push(seedProject(db, `p${i}`))
    }

    for (let i = 0; i < 11; i++) {
      setWatch(db, { projectId: projects[i]!, want: 'on', expectVersion: null, origin: 'list', now: t0 })
    }

    expect(getWatch(db, projects[10]!)?.state).toBe('waiting')

    // Stop projects[2] through projects[9] (8 active watches) with source_disabled so no waiting watch is promoted
    for (let i = 2; i <= 9; i++) {
      stopWatch(db, { projectId: projects[i]!, reason: 'source_disabled', now: t0 })
    }

    // Now we have: 2 active (projects[0], projects[1]) and 1 waiting (projects[10])
    const res = startEpisode(db, { now: t0 })
    expect(res.created).toBe(true)
    expect(typeof res.episodeId).toBe('number')

    const ep = db.prepare('SELECT * FROM watch_episode WHERE id = ?;').get(res.episodeId) as {
      id: number
      started_at: string
      deadline_at: string
      summary_state: string
    }
    expect(ep.summary_state).toBe('open')
    expect(ep.started_at).toBe(t0)
    expect(ep.deadline_at).toBe(new Date(Date.parse(t0) + WATCH_EPISODE_MS).toISOString())

    const members = db.prepare('SELECT * FROM watch_episode_member WHERE episode_id = ? ORDER BY project_id ASC;').all(res.episodeId) as {
      episode_id: number
      project_id: number
      generation: number
      observed: number
    }[]
    expect(members).toHaveLength(2)
    expect(members).toEqual([
      { episode_id: res.episodeId, project_id: projects[0]!, generation: 1, observed: 0 },
      { episode_id: res.episodeId, project_id: projects[1]!, generation: 1, observed: 0 }
    ])
  })

  it('second startEpisode while one is open -> same id, same deadline, created false', () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)

    const first = startEpisode(db, { now: t0 })
    expect(first.created).toBe(true)

    const t1 = '2026-11-13T12:05:00.000Z'
    const second = startEpisode(db, { now: t1 })
    expect(second.created).toBe(false)
    expect(second.episodeId).toBe(first.episodeId)

    const ep = db.prepare('SELECT * FROM watch_episode WHERE id = ?;').get(first.episodeId) as { deadline_at: string }
    expect(ep.deadline_at).toBe(new Date(Date.parse(t0) + WATCH_EPISODE_MS).toISOString())
  })

  it("a 'reserved' episode with pending events -> after startEpisode: 'done', events 'suppressed', and a new episode is created if there are active watches", () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)

    const ep1 = startEpisode(db, { now: t0 })
    expect(ep1.episodeId).not.toBeNull()

    // Apply snapshot change: open -> in_progress emits 1 event
    const snapRes = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })
    expect(snapRes.events).toHaveLength(1)

    // Take due episode -> reserves it
    const taken = takeDueEpisode(db, { now: new Date(Date.parse(t0) + WATCH_EPISODE_MS + 1000).toISOString() })
    expect(taken).not.toBeNull()
    expect(taken!.episodeId).toBe(ep1.episodeId)

    // Simulate crash before finish: ep1 is still 'reserved' and its event is still 'pending'
    const pendingEventsBefore = db.prepare("SELECT COUNT(*) AS c FROM notification_events WHERE episode_id = ? AND status = 'pending';").get(ep1.episodeId) as { c: number }
    expect(pendingEventsBefore.c).toBe(1)

    // Now startEpisode runs (e.g. app restart)
    const tResume = '2026-11-13T12:30:00.000Z'
    const res = startEpisode(db, { now: tResume })
    expect(res.created).toBe(true)
    expect(res.episodeId).not.toBe(ep1.episodeId)

    // Old episode is 'done'
    const oldEp = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep1.episodeId) as { summary_state: string }
    expect(oldEp.summary_state).toBe('done')

    // Old events are 'suppressed'
    const oldEvents = db.prepare('SELECT status, updated_at FROM notification_events WHERE episode_id = ?;').all(ep1.episodeId) as { status: string; updated_at: string }[]
    expect(oldEvents[0]!.status).toBe('suppressed')
    expect(oldEvents[0]!.updated_at).toBe(tResume)
  })

  it('member snapshot with a change while open -> event has episode_id and pending; member observed = 1; dispatchWatchPending does not send it', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep = startEpisode(db, { now: t0 })

    const snapRes = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })
    expect(snapRes.applied).toBe(true)
    expect(snapRes.events).toHaveLength(1)

    const ev = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snapRes.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(ev.episode_id).toBe(ep.episodeId)
    expect(ev.status).toBe('pending')

    const member = db.prepare('SELECT observed FROM watch_episode_member WHERE episode_id = ? AND project_id = ?;').get(ep.episodeId, p1) as { observed: number }
    expect(member.observed).toBe(1)

    // dispatchWatchPending should NOT send it
    let sentCount = 0
    const out = await dispatchWatchPending(
      db,
      { sessionId: 's1', nowIso: t0, lang: 'ar' },
      {
        sendSingle: async () => { sentCount++; return true },
        sendSummary: async () => { sentCount++; return true },
        eligible: () => true
      }
    )
    expect(sentCount).toBe(0)
    expect(out.results).toHaveLength(0)
  })

  it("member snapshot while 'reserved' -> event 'suppressed' with episode_id", () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep = startEpisode(db, { now: t0 })

    // Reserve episode
    db.prepare("UPDATE watch_episode SET summary_state = 'reserved' WHERE id = ?;").run(ep.episodeId)

    const snapRes = saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })
    expect(snapRes.applied).toBe(true)
    expect(snapRes.events).toHaveLength(1)

    const ev = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snapRes.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(ev.episode_id).toBe(ep.episodeId)
    expect(ev.status).toBe('suppressed')

    const member = db.prepare('SELECT observed FROM watch_episode_member WHERE episode_id = ? AND project_id = ?;').get(ep.episodeId, p1) as { observed: number }
    expect(member.observed).toBe(1)
  })

  it('non-member (watch started after the episode, or member restarted with a new generation) -> normal event (episode_id NULL)', () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    startEpisode(db, { now: t0 })

    // Project started after episode
    const p2 = seedProject(db, 'p2')
    initWatch(db, p2, t0)

    const snap2 = saveSnapshot(db, {
      projectId: p2,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })
    expect(snap2.events).toHaveLength(1)
    const ev2 = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snap2.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(ev2.episode_id).toBeNull()
    expect(ev2.status).toBe('pending')

    // Restart p1 to get generation 2
    const curP1 = getWatch(db, p1)!
    setWatch(db, { projectId: p1, want: 'off', expectVersion: curP1.version, origin: 'list', now: t0 })
    const offP1 = getWatch(db, p1)!
    setWatch(db, { projectId: p1, want: 'on', expectVersion: offP1.version, origin: 'list', now: t0 })
    // Baseline for gen 2
    saveSnapshot(db, {
      projectId: p1,
      generation: 2,
      snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    const snap1Gen2 = saveSnapshot(db, {
      projectId: p1,
      generation: 2,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })
    expect(snap1Gen2.events).toHaveLength(1)
    const ev1Gen2 = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snap1Gen2.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(ev1Gen2.episode_id).toBeNull()
    expect(ev1Gen2.status).toBe('pending')
  })

  it("Item 1 reviewer reproduction: late first snapshot after episode done stays silent; second snapshot is ordinary", async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const pA = seedProject(db, 'pA')
    const pB = seedProject(db, 'pB')
    initWatch(db, pA, t0)
    initWatch(db, pB, t0)

    // Episode starts with A and B
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    // A changes at minute 2
    const snapA = saveSnapshot(db, {
      projectId: pA,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: '2026-11-13T12:02:00.000Z'
    })
    expect(snapA.events).toHaveLength(1)

    // Summary is sent at minute 11 (after deadline of 10 min) -> episode consumed and done
    const t11 = '2026-11-13T12:11:00.000Z'
    let awaySendCalls = 0
    await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t11, silent: false },
      {
        sendAway: async () => { awaySendCalls++; return true },
        eligible: () => true
      }
    )
    expect(awaySendCalls).toBe(1)
    const epDoneRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epDoneRow.summary_state).toBe('done')

    // B's FIRST (late) snapshot with a change -> event 'suppressed' with the old episode_id
    const t15 = '2026-11-13T12:15:00.000Z'
    const snapBLate = saveSnapshot(db, {
      projectId: pB,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t15
    })
    expect(snapBLate.applied).toBe(true)
    expect(snapBLate.events).toHaveLength(1)
    const bLateEvent = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snapBLate.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(bLateEvent.episode_id).toBe(ep.episodeId)
    expect(bLateEvent.status).toBe('suppressed')

    // No OS calls from either dispatcher
    let awayCalls = 0
    await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t15, silent: false },
      {
        sendAway: async () => { awayCalls++; return true },
        eligible: () => true
      }
    )
    expect(awayCalls).toBe(0)

    let pendingSingleCalls = 0
    await dispatchWatchPending(
      db,
      { sessionId: 's1', nowIso: t15, lang: 'ar' },
      {
        sendSingle: async () => { pendingSingleCalls++; return true },
        sendSummary: async () => true,
        eligible: () => true
      }
    )
    expect(pendingSingleCalls).toBe(0)

    // B's SECOND snapshot with a change -> ordinary pending event sent by dispatchWatchPending
    const t20 = '2026-11-13T12:20:00.000Z'
    const snapBSecond = saveSnapshot(db, {
      projectId: pB,
      generation: 1,
      snapshot: { status: 'closed', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t20
    })
    expect(snapBSecond.applied).toBe(true)
    expect(snapBSecond.events).toHaveLength(1)
    const bSecondEvent = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snapBSecond.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(bSecondEvent.episode_id).toBeNull()
    expect(bSecondEvent.status).toBe('pending')

    let normalSent = 0
    const pendingOut = await dispatchWatchPending(
      db,
      { sessionId: 's1', nowIso: t20, lang: 'ar' },
      {
        sendSingle: async () => { normalSent++; return true },
        sendSummary: async () => true,
        eligible: () => true
      }
    )
    expect(normalSent).toBe(1)
    expect(pendingOut.results[0]!.result).toBe('sent')
  })

  it('Item 1: project member of old done episode (unobserved) AND new open episode -> event goes to open episode as pending, both member rows become observed', () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const pA = seedProject(db, 'pA')
    initWatch(db, pA, t0)

    // Episode 1 starts with A (unobserved)
    const ep1 = startEpisode(db, { now: t0 })
    expect(ep1.episodeId).not.toBeNull()

    // Reserve and finish ep1 without A being observed
    const t11 = '2026-11-13T12:11:00.000Z'
    takeDueEpisode(db, { now: t11 })
    finishEpisode(db, { episodeId: ep1.episodeId!, now: t11 })

    // Episode 2 starts with A (unobserved)
    const t12 = '2026-11-13T12:12:00.000Z'
    const ep2 = startEpisode(db, { now: t12 })
    expect(ep2.episodeId).not.toBeNull()
    expect(ep2.episodeId).not.toBe(ep1.episodeId)

    // A is a member of ep1 (observed 0, done) AND ep2 (observed 0, open)
    const snapA = saveSnapshot(db, {
      projectId: pA,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t12
    })
    expect(snapA.applied).toBe(true)
    expect(snapA.events).toHaveLength(1)

    // Event goes to open episode (ep2) as 'pending'
    const ev = db.prepare('SELECT * FROM notification_events WHERE id = ?;').get(snapA.events[0]!.id) as {
      episode_id: number | null
      status: string
    }
    expect(ev.episode_id).toBe(ep2.episodeId)
    expect(ev.status).toBe('pending')

    // Both member rows become observed = 1
    const m1 = db.prepare('SELECT observed FROM watch_episode_member WHERE episode_id = ? AND project_id = ?;').get(ep1.episodeId, pA) as { observed: number }
    const m2 = db.prepare('SELECT observed FROM watch_episode_member WHERE episode_id = ? AND project_id = ?;').get(ep2.episodeId, pA) as { observed: number }
    expect(m1.observed).toBe(1)
    expect(m2.observed).toBe(1)
  })

  describe('due rules', () => {
    it('not due while one member is unobserved and before deadline; due at deadline; due early when all observed; stopped or restarted member counts as finished', () => {
      const t0 = '2026-11-13T12:00:00.000Z'
      const p1 = seedProject(db, 'p1')
      const p2 = seedProject(db, 'p2')
      initWatch(db, p1, t0)
      initWatch(db, p2, t0)

      const ep = startEpisode(db, { now: t0 })
      expect(ep.episodeId).not.toBeNull()
      const tHalf = new Date(Date.parse(t0) + 5 * 60 * 1000).toISOString()

      // Neither observed, before deadline -> null
      expect(takeDueEpisode(db, { now: tHalf })).toBeNull()

      // Observe p1 only, before deadline -> null
      saveSnapshot(db, {
        projectId: p1,
        generation: 1,
        snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
        now: tHalf
      })
      expect(takeDueEpisode(db, { now: tHalf })).toBeNull()

      // Observe p2 as well -> all observed early -> due early!
      saveSnapshot(db, {
        projectId: p2,
        generation: 1,
        snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
        now: tHalf
      })
      const takenEarly = takeDueEpisode(db, { now: tHalf })
      expect(takenEarly).not.toBeNull()
      expect(takenEarly!.episodeId).toBe(ep.episodeId)
      finishEpisode(db, { episodeId: ep.episodeId!, now: tHalf })

      // Case: due at deadline even if unobserved
      const t2 = '2026-11-13T14:00:00.000Z'
      const ep2 = startEpisode(db, { now: t2 })
      expect(ep2.episodeId).not.toBeNull()
      const t2Deadline = new Date(Date.parse(t2) + WATCH_EPISODE_MS).toISOString()
      const takenAtDeadline = takeDueEpisode(db, { now: t2Deadline })
      expect(takenAtDeadline).not.toBeNull()
      expect(takenAtDeadline!.episodeId).toBe(ep2.episodeId)
      finishEpisode(db, { episodeId: ep2.episodeId!, now: t2Deadline })

      // Case: member stopped counts as finished
      const t3 = '2026-11-13T16:00:00.000Z'
      const ep3 = startEpisode(db, { now: t3 })
      expect(ep3.episodeId).not.toBeNull()
      // Observe p1
      saveSnapshot(db, {
        projectId: p1,
        generation: 1,
        snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
        now: t3
      })
      // Stop p2
      stopWatch(db, { projectId: p2, reason: 'closed', now: t3 })
      // Before deadline, p1 is observed and p2 is stopped -> due early!
      const takenStopped = takeDueEpisode(db, { now: new Date(Date.parse(t3) + 1000).toISOString() })
      expect(takenStopped).not.toBeNull()
      expect(takenStopped!.episodeId).toBe(ep3.episodeId)
      finishEpisode(db, { episodeId: ep3.episodeId!, now: t3 })

      // Case: member restarted with new generation counts as finished
      // Restart p1 so it has gen 2
      const w1 = getWatch(db, p1)!
      setWatch(db, { projectId: p1, want: 'off', expectVersion: w1.version, origin: 'list', now: t3 })
      const w1Off = getWatch(db, p1)!
      setWatch(db, { projectId: p1, want: 'on', expectVersion: w1Off.version, origin: 'list', now: t3 })
      // Restart p2 so it is active with gen 2
      const w2 = getWatch(db, p2)!
      setWatch(db, { projectId: p2, want: 'on', expectVersion: w2.version, origin: 'list', now: t3 })

      const t4 = '2026-11-13T18:00:00.000Z'
      const ep4 = startEpisode(db, { now: t4 })
      expect(ep4.episodeId).not.toBeNull()
      // Member rows in ep4 have gen 2 for p1 and p2.
      // Now observe p1
      saveSnapshot(db, {
        projectId: p1,
        generation: 2,
        snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
        now: t4
      })
      // Restart p2 to gen 3
      const curP2 = getWatch(db, p2)!
      setWatch(db, { projectId: p2, want: 'off', expectVersion: curP2.version, origin: 'list', now: t4 })
      const curP2Off = getWatch(db, p2)!
      setWatch(db, { projectId: p2, want: 'on', expectVersion: curP2Off.version, origin: 'list', now: t4 })
      // Before deadline: p1 observed, p2 current generation (3) != member generation (2) -> finished!
      const takenRestarted = takeDueEpisode(db, { now: new Date(Date.parse(t4) + 1000).toISOString() })
      expect(takenRestarted).not.toBeNull()
      expect(takenRestarted!.episodeId).toBe(ep4.episodeId)
      finishEpisode(db, { episodeId: ep4.episodeId!, now: t4 })
    })
  })
})

describe('dispatchWatchEpisode', () => {
  it('3 projects with changes (strengthened: 2 events on p1, exactly 3 distinct projects, beep called exactly 1)', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    const p2 = seedProject(db, 'p2')
    const p3 = seedProject(db, 'p3')
    initWatch(db, p1, t0)
    initWatch(db, p2, t0)
    initWatch(db, p3, t0)

    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    // p1 gets TWO events in one snapshot: status change AND contact change
    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 2, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: '2026-11-13T12:01:00.000Z'
    })
    // p2 gets status change
    saveSnapshot(db, {
      projectId: p2,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: '2026-11-13T12:02:00.000Z'
    })
    // p3 gets status change
    saveSnapshot(db, {
      projectId: p3,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: '2026-11-13T12:03:00.000Z'
    })

    let capturedPayload: WatchAwayPayload | null = null
    let beepCount = 0
    let rowsStatusInsideStub: string[] = []

    const deps: WatchEpisodeDispatchDeps = {
      sendAway: async (p) => {
        capturedPayload = p
        // Verify rows are 'dispatching' inside stub
        const rows = db.prepare('SELECT status FROM notification_events WHERE id IN (?, ?, ?, ?);').all(...p.eventIds) as { status: string }[]
        rowsStatusInsideStub = rows.map((r) => r.status)
        return true
      },
      eligible: () => true,
      onBeep: () => { beepCount++ }
    }

    const outcome = await dispatchWatchEpisode(
      db,
      { sessionId: 'sess-1', nowIso: '2026-11-13T12:04:00.000Z', silent: false },
      deps
    )

    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload!.episodeId).toBe(ep.episodeId)
    // 4 events total
    expect(capturedPayload!.eventIds).toHaveLength(4)
    // Distinct projects: exactly 3 projects, newest event first: p3, p2, p1
    expect(capturedPayload!.projects).toHaveLength(3)
    expect(capturedPayload!.projects.map((p) => p.id)).toEqual([p3, p2, p1])

    expect(rowsStatusInsideStub).toEqual(['dispatching', 'dispatching', 'dispatching', 'dispatching'])
    expect(beepCount).toBe(1)

    // Outcome results: 4 items, all batched
    expect(outcome.results).toHaveLength(4)
    expect(outcome.results.every((r) => r.result === 'batched')).toBe(true)

    // In DB: rows are 'submitted' with batch_key `watch-episode:${ep.episodeId}`
    const rowsAfter = db.prepare('SELECT status, batch_key FROM notification_events WHERE episode_id = ?;').all(ep.episodeId) as { status: string; batch_key: string }[]
    expect(rowsAfter).toHaveLength(4)
    expect(rowsAfter.every((r) => r.status === 'submitted')).toBe(true)
    expect(rowsAfter.every((r) => r.batch_key === `watch-episode:${ep.episodeId}`)).toBe(true)

    // Episode is 'done'
    const epRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epRow.summary_state).toBe('done')
  })

  it('1 project with changes -> still ONE sendAway', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    let calls = 0
    let captured: WatchAwayPayload | null = null
    const outcome = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async (p) => {
          calls++
          captured = p
          return true
        },
        eligible: () => true
      }
    )

    expect(calls).toBe(1)
    expect(captured!.projects).toHaveLength(1)
    expect(captured!.projects[0]!.id).toBe(p1)
    expect(outcome.results[0]!.result).toBe('batched')
    const epRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epRow.summary_state).toBe('done')
  })

  it('no events -> no OS call, episode done', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    // Observed with no changes (status remains open)
    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    let osCalls = 0
    const outcome = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async () => { osCalls++; return true },
        eligible: () => true
      }
    )

    expect(osCalls).toBe(0)
    expect(outcome.results).toEqual([])
    const epRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epRow.summary_state).toBe('done')
  })

  it('silent -> all suppressed, no OS call, done', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    let osCalls = 0
    const outcome = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: true },
      {
        sendAway: async () => { osCalls++; return true },
        eligible: () => true
      }
    )

    expect(osCalls).toBe(0)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]!.result).toBe('suppressed')

    const row = db.prepare('SELECT status FROM notification_events WHERE episode_id = ?;').get(ep.episodeId) as { status: string }
    expect(row.status).toBe('suppressed')

    const epRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epRow.summary_state).toBe('done')
  })

  it('ineligible/invalid mix', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    const p2 = seedProject(db, 'p2')
    initWatch(db, p1, t0)
    initWatch(db, p2, t0)
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })
    saveSnapshot(db, {
      projectId: p2,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    // Corrupt p1 event payload to make it invalid
    db.prepare("UPDATE notification_events SET payload = 'invalid json' WHERE project_id = ? AND episode_id = ?;").run(p1, ep.episodeId)

    // Mark p2 as ineligible in the eligible callback
    let osCalls = 0
    const outcome = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async () => { osCalls++; return true },
        eligible: () => false
      }
    )

    expect(osCalls).toBe(0)
    expect(outcome.results).toHaveLength(2)
    const p1Result = outcome.results.find((r) => r.projectId === p1)
    const p2Result = outcome.results.find((r) => r.projectId === p2)
    expect(p1Result!.result).toBe('failed')
    expect(p2Result!.result).toBe('suppressed')

    const epRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epRow.summary_state).toBe('done')
  })

  it('sendAway false / reject / sync throw -> failed, episode done, zero sender calls on second call', async () => {
    // 1. sendAway returns false
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep1 = startEpisode(db, { now: t0 })
    expect(ep1.episodeId).not.toBeNull()
    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    const outcome1 = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async () => false,
        eligible: () => true
      }
    )
    expect(outcome1.results[0]!.result).toBe('failed')
    const ep1Row = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep1.episodeId) as { summary_state: string }
    expect(ep1Row.summary_state).toBe('done')

    // Second call -> zero sender calls, empty results
    let secondCalls1 = 0
    const secondCall1 = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async () => { secondCalls1++; return true },
        eligible: () => true
      }
    )
    expect(secondCalls1).toBe(0)
    expect(secondCall1.results).toEqual([])

    // 2. sendAway async reject
    const t2 = '2026-11-13T14:00:00.000Z'
    stopWatch(db, { projectId: p1, reason: 'closed', now: t2 })
    const p2 = seedProject(db, 'p2')
    initWatch(db, p2, t2)
    const ep2 = startEpisode(db, { now: t2 })
    expect(ep2.episodeId).not.toBeNull()
    saveSnapshot(db, {
      projectId: p2,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t2
    })
    const outcome2 = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t2, silent: false },
      {
        sendAway: async () => Promise.reject(new Error('network-error')),
        eligible: () => true
      }
    )
    expect(outcome2.results[0]!.result).toBe('failed')
    const ep2Row = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep2.episodeId) as { summary_state: string }
    expect(ep2Row.summary_state).toBe('done')

    // Second call -> zero sender calls, empty results
    let secondCalls2 = 0
    const secondCall2 = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t2, silent: false },
      {
        sendAway: async () => { secondCalls2++; return true },
        eligible: () => true
      }
    )
    expect(secondCalls2).toBe(0)
    expect(secondCall2.results).toEqual([])

    // 3. sendAway sync throw
    const t3 = '2026-11-13T16:00:00.000Z'
    stopWatch(db, { projectId: p2, reason: 'closed', now: t3 })
    const p3 = seedProject(db, 'p3')
    initWatch(db, p3, t3)
    const ep3 = startEpisode(db, { now: t3 })
    expect(ep3.episodeId).not.toBeNull()
    saveSnapshot(db, {
      projectId: p3,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t3
    })
    const outcome3 = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t3, silent: false },
      {
        sendAway: () => { throw new Error('sync-error') },
        eligible: () => true
      }
    )
    expect(outcome3.results[0]!.result).toBe('failed')
    const ep3Row = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep3.episodeId) as { summary_state: string }
    expect(ep3Row.summary_state).toBe('done')

    // Second call -> zero sender calls, empty results
    let secondCalls3 = 0
    const secondCall3 = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t3, silent: false },
      {
        sendAway: async () => { secondCalls3++; return true },
        eligible: () => true
      }
    )
    expect(secondCalls3).toBe(0)
    expect(secondCall3.results).toEqual([])
  })

  it('Item 2: throwing eligible, throwing onBeep, parse failure, dispatching row to uncertain, finishEpisode suppressing pending', async () => {
    // A. throwing eligible -> resolves, episode done, no pending rows left, zero sender calls on second call
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep1 = startEpisode(db, { now: t0 })
    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    const outThrowEligible = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async () => true,
        eligible: () => { throw new Error('boom-eligible') }
      }
    )
    expect(outThrowEligible).toBeDefined()
    const ep1Row = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep1.episodeId) as { summary_state: string }
    expect(ep1Row.summary_state).toBe('done')
    const pendingInEp1 = db.prepare("SELECT COUNT(*) AS c FROM notification_events WHERE episode_id = ? AND status = 'pending';").get(ep1.episodeId) as { c: number }
    expect(pendingInEp1.c).toBe(0)

    let senderCalls = 0
    await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t0, silent: false },
      {
        sendAway: async () => { senderCalls++; return true },
        eligible: () => true
      }
    )
    expect(senderCalls).toBe(0)

    // B. throwing onBeep -> resolves, episode done, no pending rows left, zero sender calls on second call
    const t2 = '2026-11-13T14:00:00.000Z'
    stopWatch(db, { projectId: p1, reason: 'closed', now: t2 })
    const p2 = seedProject(db, 'p2')
    initWatch(db, p2, t2)
    const ep2 = startEpisode(db, { now: t2 })
    saveSnapshot(db, {
      projectId: p2,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t2
    })

    const outThrowBeep = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t2, silent: false },
      {
        sendAway: async () => true,
        eligible: () => true,
        onBeep: () => { throw new Error('boom-beep') }
      }
    )
    expect(outThrowBeep).toBeDefined()
    expect(outThrowBeep.results[0]!.result).toBe('batched')
    const ep2Row = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep2.episodeId) as { summary_state: string }
    expect(ep2Row.summary_state).toBe('done')

    senderCalls = 0
    await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t2, silent: false },
      {
        sendAway: async () => { senderCalls++; return true },
        eligible: () => true
      }
    )
    expect(senderCalls).toBe(0)

    // C. parse failure -> resolves, episode done, row failed, no row left pending
    const t3 = '2026-11-13T16:00:00.000Z'
    stopWatch(db, { projectId: p2, reason: 'closed', now: t3 })
    const p3 = seedProject(db, 'p3')
    initWatch(db, p3, t3)
    const ep3 = startEpisode(db, { now: t3 })
    saveSnapshot(db, {
      projectId: p3,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t3
    })
    db.prepare("UPDATE notification_events SET payload = 'invalid json' WHERE episode_id = ?;").run(ep3.episodeId)

    const outParseFail = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: t3, silent: false },
      {
        sendAway: async () => true,
        eligible: () => true
      }
    )
    expect(outParseFail.results[0]!.result).toBe('failed')
    const ep3Row = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep3.episodeId) as { summary_state: string }
    expect(ep3Row.summary_state).toBe('done')
    const pendingInEp3 = db.prepare("SELECT COUNT(*) AS c FROM notification_events WHERE episode_id = ? AND status = 'pending';").get(ep3.episodeId) as { c: number }
    expect(pendingInEp3.c).toBe(0)

    // D. row left dispatching becomes uncertain on finishEpisode
    const t4 = '2026-11-13T18:00:00.000Z'
    stopWatch(db, { projectId: p3, reason: 'closed', now: t4 })
    const p4 = seedProject(db, 'p4')
    initWatch(db, p4, t4)
    const ep4 = startEpisode(db, { now: t4 })
    saveSnapshot(db, {
      projectId: p4,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t4
    })
    takeDueEpisode(db, { now: t4 })
    db.prepare("UPDATE notification_events SET status = 'dispatching' WHERE episode_id = ?;").run(ep4.episodeId)
    finishEpisode(db, { episodeId: ep4.episodeId!, now: t4 })

    const rowUncertain = db.prepare('SELECT status FROM notification_events WHERE episode_id = ?;').get(ep4.episodeId) as { status: string }
    expect(rowUncertain.status).toBe('uncertain')

    // E. takeDueEpisode followed directly by finishEpisode -> pending rows suppressed
    const t5 = '2026-11-13T20:00:00.000Z'
    stopWatch(db, { projectId: p4, reason: 'closed', now: t5 })
    const p5 = seedProject(db, 'p5')
    initWatch(db, p5, t5)
    const ep5 = startEpisode(db, { now: t5 })
    saveSnapshot(db, {
      projectId: p5,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t5
    })
    takeDueEpisode(db, { now: t5 })
    finishEpisode(db, { episodeId: ep5.episodeId!, now: t5 })

    const rowSuppressed = db.prepare('SELECT status FROM notification_events WHERE episode_id = ?;').get(ep5.episodeId) as { status: string }
    expect(rowSuppressed.status).toBe('suppressed')
  })

  it('Item 3: DND reproduction ends with DND-period event suppressed and no OS call after DND ends', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const pA = seedProject(db, 'pA')
    const pB = seedProject(db, 'pB')
    initWatch(db, pA, t0)
    initWatch(db, pB, t0)

    // Episode open with A and B
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    // A changes during DND at minute 2
    const tDndChange = '2026-11-13T12:02:00.000Z'
    const snapA = saveSnapshot(db, {
      projectId: pA,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: tDndChange
    })
    expect(snapA.events).toHaveLength(1)

    // B is unobserved, so episode is NOT due yet
    // During DND, index.ts DND branch runs:
    suppressPendingWatchEvents(db, tDndChange)
    const silentOut = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: tDndChange, silent: true },
      {
        sendAway: async () => false,
        eligible: () => false
      }
    )
    // Episode was not due, silent dispatch returned []
    expect(silentOut.results).toEqual([])

    // A's DND-period event is now suppressed in DB!
    const evA = db.prepare('SELECT status FROM notification_events WHERE id = ?;').get(snapA.events[0]!.id) as { status: string }
    expect(evA.status).toBe('suppressed')

    // Now DND ends at minute 15. B is observed (or deadline arrives).
    const tPostDnd = '2026-11-13T12:15:00.000Z'
    saveSnapshot(db, {
      projectId: pB,
      generation: 1,
      snapshot: { status: 'open', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: tPostDnd
    })

    // Normal flush runs after DND
    let osCalls = 0
    const normalOut = await dispatchWatchEpisode(
      db,
      { sessionId: 's1', nowIso: tPostDnd, silent: false },
      {
        sendAway: async () => { osCalls++; return true },
        eligible: () => true
      }
    )

    // No OS calls! A's DND-period event was suppressed and not sent after DND!
    expect(osCalls).toBe(0)
    expect(normalOut.results).toEqual([])
    const epRow = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(epRow.summary_state).toBe('done')
  })
})

describe('crash safety', () => {
  it('reserve (takeDueEpisode) then simulate a crash (do not call finish), call startEpisode -> old episode done, its pending events suppressed, no OS call afterwards', async () => {
    const t0 = '2026-11-13T12:00:00.000Z'
    const p1 = seedProject(db, 'p1')
    initWatch(db, p1, t0)
    const ep = startEpisode(db, { now: t0 })
    expect(ep.episodeId).not.toBeNull()

    saveSnapshot(db, {
      projectId: p1,
      generation: 1,
      snapshot: { status: 'in_progress', contacts: 0, offers: 0, offersCapped: false, clientOpen: 0, clientInProgress: 0 },
      now: t0
    })

    // Take due episode -> reserves it
    const taken = takeDueEpisode(db, { now: t0 })
    expect(taken).not.toBeNull()
    expect(taken!.episodeId).toBe(ep.episodeId)

    // Simulate crash: do NOT call finishEpisode
    // On restart:
    const tRestart = '2026-11-13T12:15:00.000Z'
    startEpisode(db, { now: tRestart })

    const oldEp = db.prepare('SELECT summary_state FROM watch_episode WHERE id = ?;').get(ep.episodeId) as { summary_state: string }
    expect(oldEp.summary_state).toBe('done')

    const oldEvents = db.prepare('SELECT status FROM notification_events WHERE episode_id = ?;').all(ep.episodeId) as { status: string }[]
    expect(oldEvents[0]!.status).toBe('suppressed')

    // Subsequent dispatch should make NO OS call
    let osCalls = 0
    await dispatchWatchEpisode(
      db,
      { sessionId: 's2', nowIso: tRestart, silent: false },
      {
        sendAway: async () => { osCalls++; return true },
        eligible: () => true
      }
    )
    expect(osCalls).toBe(0)
  })
})

describe('watchAwayTitle exact strings', () => {
  it('matches exact Arabic and English titles', () => {
    expect(watchAwayTitle(1, 'ar')).toBe('حصل وأنت غايب: تغييرات في 1 مشاريع')
    expect(watchAwayTitle(1, 'en')).toBe('While you were away: changes in 1 projects')
    expect(watchAwayTitle(5, 'ar')).toBe('حصل وأنت غايب: تغييرات في 5 مشاريع')
    expect(watchAwayTitle(5, 'en')).toBe('While you were away: changes in 5 projects')
  })
})
