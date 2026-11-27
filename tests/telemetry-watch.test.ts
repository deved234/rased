import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TelemetryService } from '../src/main/telemetry/service.js'
import { TelemetryStore } from '../src/storage/telemetryStore.js'
import {
  TELEMETRY_SUMMARIES,
  validTelemetryEnvelope,
  validTelemetryProperties,
  watchSlotBucket,
  watchDailyBuckets,
  type TelemetryEnvelope
} from '../src/shared/telemetry.js'
import { WATCH_SOURCES } from '../src/shared/projectWatch.js'

const roots: string[] = [], stores: TelemetryStore[] = []
const root = (): string => { const dir = mkdtempSync(join(tmpdir(), 'rased-test-watch-')); roots.push(dir); return dir }
const event = (patch: Partial<TelemetryEnvelope> = {}): TelemetryEnvelope => ({
  eventId: randomUUID(),
  name: 'watch_started',
  occurredAt: '2026-10-17T12:00:00.000Z',
  distinctId: randomUUID(),
  schemaVersion: 2,
  environment: 'qa',
  appVersion: '0.8.1',
  language: 'ar',
  osFamily: 'windows-10',
  osMajor: 'none',
  cpuArch: 'x64',
  count: 1,
  properties: { source: 'mostaql', entry: 'list', result: 'active' },
  ...patch
} as TelemetryEnvelope)
const store = (now = () => Date.parse('2026-10-17T12:15:00Z')): TelemetryStore => {
  const value = new TelemetryStore(join(root(), 'queue.sqlite'), now)
  stores.push(value)
  return value
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('Watch telemetry contracts', () => {
  it('validates watch_started, watch_daily, watch_change, watch_stopped against strict schemas', () => {
    // watch_started
    for (const source of WATCH_SOURCES) {
      for (const entry of ['list', 'preview', 'detail', 'compact', 'watch_view', 'auto_submitted'] as const) {
        for (const result of ['active', 'waiting', 'replaced_other'] as const) {
          expect(validTelemetryProperties('watch_started', { source, entry, result })).toBe(true)
        }
      }
    }
    expect(validTelemetryProperties('watch_started', { source: 'khamsat', entry: 'list', result: 'active' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { entry: 'list', result: 'active' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', result: 'active' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', entry: 'list' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', entry: 'list', result: 'active', extra: 'bad' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 1, entry: 'list', result: 'active' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', entry: 123, result: 'active' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', entry: 'list', result: 456 })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', entry: 'unknown', result: 'active' })).toBe(false)
    expect(validTelemetryProperties('watch_started', { source: 'mostaql', entry: 'list', result: 'unknown' })).toBe(false)
    expect(validTelemetryEnvelope(event())).toBe(true)
    expect(validTelemetryEnvelope(event({ name: 'watch_daily', properties: { source: 'mostaql', watched: '0', waiting: '0' } }))).toBe(true)
    expect(validTelemetryEnvelope(event({ name: 'watch_change', properties: { source: 'mostaql', change: 'contact_sure', notified: 'sent' } }))).toBe(true)
    expect(validTelemetryEnvelope(event({ name: 'watch_stopped', properties: { source: 'mostaql', reason: 'manual' } }))).toBe(true)
    expect(validTelemetryEnvelope(event({ name: 'watch_hourly', properties: { mostaql_ok: 1, mostaql_slot: '20s' } }))).toBe(true)

    // watch_daily
    for (const source of WATCH_SOURCES) {
      for (const watched of ['0', '1_2', '3_5', '6_10'] as const) {
        for (const waiting of ['0', '1_2', '3_plus'] as const) {
          expect(validTelemetryProperties('watch_daily', { source, watched, waiting })).toBe(true)
        }
      }
    }
    expect(validTelemetryProperties('watch_daily', { source: 'khamsat', watched: '0', waiting: '0' })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { watched: '0', waiting: '0' })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', waiting: '0' })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', watched: '0' })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', watched: '0', waiting: '0', extra: 1 })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', watched: 0, waiting: '0' })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', watched: '0', waiting: 0 })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', watched: 'wrong', waiting: '0' })).toBe(false)
    expect(validTelemetryProperties('watch_daily', { source: 'mostaql', watched: '0', waiting: 'wrong' })).toBe(false)

    // watch_change
    for (const source of WATCH_SOURCES) {
      for (const change of ['contact_sure', 'contact_maybe', 'status_in_progress', 'status_closed'] as const) {
        for (const notified of ['sent', 'failed', 'suppressed', 'batched'] as const) {
          expect(validTelemetryProperties('watch_change', { source, change, notified })).toBe(true)
        }
      }
    }
    expect(validTelemetryProperties('watch_change', { source: 'khamsat', change: 'contact_sure', notified: 'sent' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { change: 'contact_sure', notified: 'sent' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', notified: 'sent' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', change: 'contact_sure' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', change: 'contact_sure', notified: 'sent', extra: 'bad' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', change: 1, notified: 'sent' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', change: 'contact_sure', notified: 1 })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', change: 'unknown', notified: 'sent' })).toBe(false)
    expect(validTelemetryProperties('watch_change', { source: 'mostaql', change: 'contact_sure', notified: 'unknown' })).toBe(false)

    // watch_stopped
    for (const source of WATCH_SOURCES) {
      for (const reason of ['manual', 'replaced', 'closed', 'expired', 'ignored', 'gone', 'source_disabled'] as const) {
        expect(validTelemetryProperties('watch_stopped', { source, reason })).toBe(true)
      }
    }
    expect(validTelemetryProperties('watch_stopped', { source: 'khamsat', reason: 'manual' })).toBe(false)
    expect(validTelemetryProperties('watch_stopped', { reason: 'manual' })).toBe(false)
    expect(validTelemetryProperties('watch_stopped', { source: 'mostaql' })).toBe(false)
    expect(validTelemetryProperties('watch_stopped', { source: 'mostaql', reason: 'manual', extra: 'bad' })).toBe(false)
    expect(validTelemetryProperties('watch_stopped', { source: 'mostaql', reason: 123 })).toBe(false)
    expect(validTelemetryProperties('watch_stopped', { source: 123, reason: 'manual' })).toBe(false)
    expect(validTelemetryProperties('watch_stopped', { source: 'mostaql', reason: 'unknown' })).toBe(false)
  })

  it('enforces watch_hourly summary rules and rejects khamsat or invalid property types', () => {
    expect(TELEMETRY_SUMMARIES).toContain('watch_hourly')

    // Partial keys allowed
    expect(validTelemetryProperties('watch_hourly', { mostaql_ok: 1 })).toBe(true)
    expect(validTelemetryProperties('watch_hourly', { nafezly_slot: '20s' })).toBe(true)
    expect(validTelemetryProperties('watch_hourly', { kaf_blocked: 5, kaf_slot: '10s' })).toBe(true)

    // 18 keys max
    const all18: Record<string, string | number> = {}
    for (const s of ['mostaql', 'nafezly', 'kaf'] as const) {
      for (const k of ['ok', 'blocked', 'failed', 'slowed', 'preempted'] as const) {
        all18[`${s}_${k}`] = 1
      }
      all18[`${s}_slot`] = '10s'
    }
    expect(Object.keys(all18)).toHaveLength(18)
    expect(validTelemetryProperties('watch_hourly', all18)).toBe(true)
    expect(validTelemetryProperties('watch_hourly', { ...all18, extra_key: 1 })).toBe(false)

    // khamsat_ok rejected
    expect(validTelemetryProperties('watch_hourly', { khamsat_ok: 1 })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { khamsat_slot: '10s' })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { khamsat_failed: 2 })).toBe(false)

    // slot rejects numbers and invalid strings
    expect(validTelemetryProperties('watch_hourly', { mostaql_slot: 10 })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { mostaql_slot: '30s' })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { mostaql_slot: 'invalid' })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { nafezly_slot: 20 })).toBe(false)

    // counters reject strings, negative numbers and non-integers
    expect(validTelemetryProperties('watch_hourly', { mostaql_ok: '1' })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { nafezly_failed: 'failed' })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { kaf_slowed: -1 })).toBe(false)
    expect(validTelemetryProperties('watch_hourly', { kaf_preempted: 1.5 })).toBe(false)
  })

  it('accepts watch_notification entry for project_open_result alongside notification and app', () => {
    const base = { source: 'mostaql' as const, launch: 'accepted' as const, foreground: 'confirmed' as const, duration: 'under_100ms' as const }
    expect(validTelemetryProperties('project_open_result', { ...base, entry: 'watch_notification' })).toBe(true)
    expect(validTelemetryProperties('project_open_result', { ...base, entry: 'notification' })).toBe(true)
    expect(validTelemetryProperties('project_open_result', { ...base, entry: 'app' })).toBe(true)
    expect(validTelemetryProperties('project_open_result', { ...base, entry: 'invalid' })).toBe(false)
  })

  it('computes watchSlotBucket and watchDailyBuckets boundaries accurately', () => {
    expect(watchSlotBucket(0)).toBe('10s')
    expect(watchSlotBucket(10000)).toBe('10s')
    expect(watchSlotBucket(10001)).toBe('20s')
    expect(watchSlotBucket(20000)).toBe('20s')
    expect(watchSlotBucket(20001)).toBe('40s')
    expect(watchSlotBucket(40000)).toBe('40s')
    expect(watchSlotBucket(40001)).toBe('80s_plus')
    expect(watchSlotBucket(80000)).toBe('80s_plus')
    expect(watchSlotBucket(300000)).toBe('80s_plus')

    expect(watchDailyBuckets(0, 0)).toEqual({ watched: '0', waiting: '0' })
    expect(watchDailyBuckets(1, 1)).toEqual({ watched: '1_2', waiting: '1_2' })
    expect(watchDailyBuckets(2, 2)).toEqual({ watched: '1_2', waiting: '1_2' })
    expect(watchDailyBuckets(3, 3)).toEqual({ watched: '3_5', waiting: '3_plus' })
    expect(watchDailyBuckets(5, 9)).toEqual({ watched: '3_5', waiting: '3_plus' })
    expect(watchDailyBuckets(6, 0)).toEqual({ watched: '6_10', waiting: '0' })
    expect(watchDailyBuckets(10, 2)).toEqual({ watched: '6_10', waiting: '1_2' })
    expect(watchDailyBuckets(11, 4)).toEqual({ watched: '6_10', waiting: '3_plus' })

    // negative and non-integer inputs treated as 0
    expect(watchDailyBuckets(-1, -1)).toEqual({ watched: '0', waiting: '0' })
    expect(watchDailyBuckets(1.5, 1.5)).toEqual({ watched: '0', waiting: '0' })
    expect(watchDailyBuckets(-1, 2)).toEqual({ watched: '0', waiting: '1_2' })
    expect(watchDailyBuckets(3, -1)).toEqual({ watched: '3_5', waiting: '0' })
    expect(watchDailyBuckets(2.5, 3)).toEqual({ watched: '0', waiting: '3_plus' })
    expect(watchDailyBuckets(4, 2.5)).toEqual({ watched: '3_5', waiting: '0' })
  })

  it('manages shared hourly bucket, keeps maximum gauge, and starts fresh across hours', () => {
    let now = Date.parse('2026-10-17T12:15:00Z')
    const s = store(() => now)
    const distinctId = randomUUID()
    const hourKey = 'watch_hourly:2026-10-17T12:00:00.000Z'
    const e1 = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T12:00:00.000Z', properties: { mostaql_ok: 1 } })
    s.counter('watch_hourly', hourKey, 'mostaql_ok', e1)

    // Counters and gauge share one hourly bucket
    const eGauge1 = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T12:00:00.000Z', properties: { mostaql_slot: '20s' } })
    s.gauge('watch_hourly', hourKey, 'mostaql_slot', '20s', eGauge1)

    // 20s then 10s -> keeps 20s
    const eGauge2 = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T12:00:00.000Z', properties: { mostaql_slot: '10s' } })
    s.gauge('watch_hourly', hourKey, 'mostaql_slot', '10s', eGauge2)

    s.seal(true)
    let batch = s.batch()
    expect(batch).toHaveLength(1)
    expect(batch[0]?.properties).toMatchObject({ mostaql_ok: 1, mostaql_slot: '20s' })
    s.acknowledge([batch[0]!.eventId])

    // 10s then 80s_plus -> 80s_plus
    const s2 = store(() => now)
    const distinctId2 = randomUUID()
    const eNafezly1 = event({ name: 'watch_hourly', distinctId: distinctId2, occurredAt: '2026-10-17T12:00:00.000Z', properties: { nafezly_slot: '10s' } })
    s2.gauge('watch_hourly', hourKey, 'nafezly_slot', '10s', eNafezly1)
    const eNafezly2 = event({ name: 'watch_hourly', distinctId: distinctId2, occurredAt: '2026-10-17T12:00:00.000Z', properties: { nafezly_slot: '80s_plus' } })
    s2.gauge('watch_hourly', hourKey, 'nafezly_slot', '80s_plus', eNafezly2)
    s2.seal(true)
    batch = s2.batch()
    expect(batch).toHaveLength(1)
    expect(batch[0]?.properties.nafezly_slot).toBe('80s_plus')

    // A new hour starts fresh
    now += 3600000 // 13:15
    const newHourKey = 'watch_hourly:2026-10-17T13:00:00.000Z'
    const eNewHour = event({ name: 'watch_hourly', distinctId: distinctId2, occurredAt: '2026-10-17T13:00:00.000Z', properties: { nafezly_slot: '10s' } })
    s2.gauge('watch_hourly', newHourKey, 'nafezly_slot', '10s', eNewHour)
    s2.seal(true)
    const newHourBatch = s2.batch().filter(b => b.occurredAt === '2026-10-17T13:00:00.000Z')
    expect(newHourBatch).toHaveLength(1)
    expect(newHourBatch[0]?.properties.nafezly_slot).toBe('10s')
  })

  it('exempts watch_hourly from rate limits while watch_change overflows after 100', () => {
    const s = store()
    const distinctId = randomUUID()

    // watch_hourly summary: 150 increments are not diverted to overflow
    for (let i = 0; i < 150; i++) {
      s.add(event({ name: 'watch_hourly', distinctId, properties: { mostaql_ok: 1 } }))
    }
    s.seal(true)
    const hourlyRows = s.db.prepare("SELECT body FROM queue WHERE body LIKE '%watch_hourly%'").all() as { body: string }[]
    expect(hourlyRows).toHaveLength(150)

    // watch_change follows normal 100/day + overflow rule
    const s2 = store()
    for (let i = 0; i < 150; i++) {
      s2.add(event({ name: 'watch_change', distinctId, properties: { source: 'mostaql', change: 'contact_sure', notified: 'sent' } }))
    }
    s2.seal(true)
    const changeRows = s2.db.prepare('SELECT body FROM queue').all() as { body: string }[]
    expect(changeRows).toHaveLength(101)
    expect(changeRows.reduce((n, row) => n + (JSON.parse(row.body) as TelemetryEnvelope).count, 0)).toBe(150)
  })

  it('expires once:watch_daily markers older than MAX_AGE while preserving fresh markers', () => {
    let now = Date.parse('2026-10-17T12:00:00Z')
    const s = store(() => now)
    const e = event({ name: 'watch_daily', properties: { source: 'mostaql', watched: '1_2', waiting: '0' } })

    // Insert an old marker
    s.add(e, 'watch_daily:2026-10-10:mostaql')
    expect(s.get('once:watch_daily:2026-10-10:mostaql')).toBe('1')

    // Advance clock past MAX_AGE (7 days = 7 * 86400000; advance by 8 days)
    now += 8 * 86400000
    // Record today's marker (triggers trim)
    s.add(e, 'watch_daily:2026-10-25:mostaql')
    expect(s.get('once:watch_daily:2026-10-25:mostaql')).toBe('1')

    // Old marker is removed by trim
    expect(s.get('once:watch_daily:2026-10-10:mostaql')).toBeNull()
    // Today's marker survives and still dedupes
    expect(s.get('once:watch_daily:2026-10-25:mostaql')).toBe('1')
    expect(s.add(e, 'watch_daily:2026-10-25:mostaql')).toBe(false)
  })

  it('replaces a damaged gauge bucket and increments dropped count', () => {
    const s = store()
    const hourKey = 'watch_hourly:2026-10-17T12:00:00.000Z'
    const e = event({ name: 'watch_hourly', occurredAt: '2026-10-17T12:00:00.000Z', properties: { mostaql_slot: '20s' } })

    // Corrupted bucket in database
    s.db.prepare('INSERT OR REPLACE INTO buckets VALUES(?,?,?,?)').run(hourKey, 'damaged_json{', 13, Date.parse('2026-10-17T12:00:00Z'))
    expect(s.status().dropped).toBe(0)

    s.gauge('watch_hourly', hourKey, 'mostaql_slot', '20s', e)
    expect(s.status().dropped).toBe(1)

    s.seal(true)
    const batch = s.batch()
    expect(batch).toHaveLength(1)
    expect(batch[0]?.properties.mostaql_slot).toBe('20s')
  })

  it('combines gauge then counter and counter then gauge in the same hour into one bucket', () => {
    const s = store()
    const distinctId = randomUUID()

    // Case A: gauge then counter
    const hourKeyA = 'watch_hourly:2026-10-17T12:00:00.000Z'
    const eGaugeA = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T12:00:00.000Z', properties: { mostaql_slot: '20s' } })
    s.gauge('watch_hourly', hourKeyA, 'mostaql_slot', '20s', eGaugeA)
    const eCounterA = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T12:00:00.000Z', properties: { mostaql_ok: 1 } })
    s.counter('watch_hourly', hourKeyA, 'mostaql_ok', eCounterA)

    // Case B: counter then gauge
    const hourKeyB = 'watch_hourly:2026-10-17T13:00:00.000Z'
    const eCounterB = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T13:00:00.000Z', properties: { nafezly_failed: 1 } })
    s.counter('watch_hourly', hourKeyB, 'nafezly_failed', eCounterB)
    const eGaugeB = event({ name: 'watch_hourly', distinctId, occurredAt: '2026-10-17T13:00:00.000Z', properties: { nafezly_slot: '40s' } })
    s.gauge('watch_hourly', hourKeyB, 'nafezly_slot', '40s', eGaugeB)

    s.seal(true)
    const batch = s.batch()
    expect(batch).toHaveLength(2)

    const bucketA = batch.find(b => b.occurredAt === '2026-10-17T12:00:00.000Z')
    expect(bucketA?.properties).toMatchObject({ mostaql_slot: '20s', mostaql_ok: 1 })

    const bucketB = batch.find(b => b.occurredAt === '2026-10-17T13:00:00.000Z')
    expect(bucketB?.properties).toMatchObject({ nafezly_failed: 1, nafezly_slot: '40s' })
  })

  it('deduplicates watchDaily once key per source per UTC day and records again on next UTC day', async () => {
    const s = store()
    const eDay1 = event({ name: 'watch_daily', occurredAt: '2026-10-17T12:00:00.000Z', properties: { source: 'mostaql', watched: '1_2', waiting: '0' } })
    expect(s.add(eDay1, 'watch_daily:2026-10-17:mostaql')).toBe(true)
    // Second call the same UTC day records nothing
    expect(s.add(eDay1, 'watch_daily:2026-10-17:mostaql')).toBe(false)
    // Different source records
    const eKaf = event({ name: 'watch_daily', occurredAt: '2026-10-17T12:00:00.000Z', properties: { source: 'kaf', watched: '0', waiting: '0' } })
    expect(s.add(eKaf, 'watch_daily:2026-10-17:kaf')).toBe(true)
    // Next UTC day records again
    const eDay2 = event({ name: 'watch_daily', occurredAt: '2026-10-18T01:00:00.000Z', properties: { source: 'mostaql', watched: '3_5', waiting: '1_2' } })
    expect(s.add(eDay2, 'watch_daily:2026-10-18:mostaql')).toBe(true)

    // Service-level watchDaily verifies key format
    const dir = root(), entry = join(dir, 'sender.cjs'), log = join(dir, 'records.jsonl')
    writeFileSync(entry, `const {parentPort}=require('node:worker_threads');const fs=require('node:fs');parentPort.on('message',m=>{
      if(m.type==='record')fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
      if(m.type==='close')parentPort.close();
      else parentPort.postMessage({type:'status',request:m.request,transport:'idle'});
    });
    parentPort.postMessage({type:'status',transport:'idle'});`)
    const service = new TelemetryService({ root: dir, entry, version: '0.8.1', language: 'en', device: { osFamily: 'windows-10', osMajor: 'none', cpuArch: 'x64' }, config: null, fixture: true, changed: () => {} })
    try {
      service.start(false)
      await service.change('enable')
      const readRecords = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
      service.watchDaily('mostaql', 2, 0)
      await vi.waitFor(() => expect(readRecords().some(r => r.name === 'watch_daily')).toBe(true))
      const dailyRec = readRecords().find(r => r.name === 'watch_daily')
      expect(dailyRec).toMatchObject({
        name: 'watch_daily',
        properties: { source: 'mostaql', watched: '1_2', waiting: '0' }
      })
      expect(dailyRec.once).toMatch(/^watch_daily:\d{4}-\d{2}-\d{2}:mostaql$/)
    } finally {
      await service.close()
    }
  })
})
