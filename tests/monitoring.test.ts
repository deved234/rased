import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../src/storage/db.js'
import { getSourceState, saveSourceState, getSettingRaw, setSettingRaw, listEventsByStatus } from '../src/storage/repositories.js'
import { recordMonitoringSuccess, readMonitoring, monitoringFields, acknowledgeMonitoringGap } from '../src/storage/monitoring.js'
import { monitoringIssue, monitoringState, monitoringReport, transportIssueCode } from '../src/shared/monitoring.js'
import { SOURCES, isSourceId, sourceEnabled } from '../src/shared/sources.js'
import { defaultSettings, sanitizeSettings, type SourceHealth } from '../src/shared/types.js'
import { overallSourceState } from '../src/shared/sourceStatus.js'
import { importSettings, parseSettingsTransfer, settingsPayload } from '../src/storage/settingsTransfer.js'
import { applySuccessfulCycle, evaluateLateProject } from '../src/collector/pipeline.js'
import { RSS_URL } from '../src/collector/rss.js'
import { KHAMSAT_REQUESTS_URL } from '../src/collector/khamsat.js'
import { NAFEZLY_FEED_URL } from '../src/collector/nafezly.js'

let db: Db | undefined, folder: string | undefined
const now = '2026-10-15T10:00:00.000Z'
const later = '2026-10-15T10:05:00.000Z'
function database(): Db { folder = mkdtempSync(join(tmpdir(), 'rased-monitoring-unit-')); return db = openDatabase(join(folder, 'rased.db')) }
afterEach(() => { if (db?.isOpen) db.close(); if (folder) rmSync(folder, { recursive: true, force: true }); db = undefined; folder = undefined })
function success(db: Db, ids: string[], time = now, inserted = 0): void {
  recordMonitoringSuccess(db, 'nafezly', ids, inserted, time)
  saveSourceState(db, { ...getSourceState(db, 'nafezly'), baselineComplete: true, lastSuccessAt: time })
}
const health = (state: SourceHealth['state']): SourceHealth => ({ state, enabled: state !== 'disabled', paused: state === 'paused', lastAttemptAt: null, lastSuccessAt: null, nextAttemptAt: null, lastError: null, lastDurationMs: null, lastItemCount: null, effectiveIntervalMs: 5000, consecutiveFailures: 0 })

describe('Monitoring state and source capabilities', () => {
  it('defaults old installs to Mostaql enabled and carries its independent flags through settings transfer', () => {
    const db = database()
    expect(sanitizeSettings({}).mostaqlEnabled).toBe(true)
    const settings = { ...defaultSettings(), mostaqlEnabled: false, mostaqlNotificationsEnabled: false }
    const next = importSettings(db, defaultSettings(), parseSettingsTransfer(settingsPayload(db, settings)), 'merge', false)
    expect(next.mostaqlEnabled).toBe(false)
    expect(next.mostaqlNotificationsEnabled).toBe(false)
    expect(next.nafezlyEnabled).toBe(true)
    expect(() => parseSettingsTransfer({ ...settingsPayload(db), settings: { mostaqlEnabled: 'false' } })).toThrow('bad-schema')
  })

  it('uses actual collector endpoints and keeps unsupported actions explicit', () => {
    expect(SOURCES.map(source => source.endpoint).slice(0, 3)).toEqual([RSS_URL, KHAMSAT_REQUESTS_URL, NAFEZLY_FEED_URL])
    expect(SOURCES.filter(source => source.capabilities.quickApply).map(source => source.id)).toEqual(['mostaql', 'nafezly'])
    expect(SOURCES.filter(source => source.capabilities.ai).map(source => source.id)).toEqual(['mostaql'])
    expect(isSourceId('__proto__')).toBe(false)
    expect(isSourceId('kaf')).toBe(true)
    expect(sourceEnabled({ ...defaultSettings(), mostaqlEnabled: false }, 'mostaql')).toBe(false)
  })

  it('keeps disabled, temporary pause, restriction and cooldown distinct', () => {
    const input = { enabled: true, paused: false, backoffUntil: 2000, lastError: 'http-429', lastSuccessAt: now, failures: 2 }
    expect(monitoringState({ ...input, enabled: false }, 1000)).toBe('disabled')
    expect(monitoringState({ ...input, paused: true }, 1000)).toBe('paused')
    expect(monitoringState(input, 1000)).toBe('backing-off')
    expect(monitoringState({ ...input, lastError: 'http-403' }, 1000)).toBe('needs-review')
    expect(monitoringState({ ...input, lastError: 'timeout' }, 3000)).toBe('offline')
    expect(monitoringState({ ...input, lastError: 'catch-up-incomplete' }, 3000)).toBe('watching')
  })

  it('keeps an all-disabled app distinct and surfaces partial coverage', () => {
    expect(overallSourceState([health('disabled'), health('disabled')])).toBe('disabled')
    expect(overallSourceState([health('disabled'), health('watching')])).toBe('watching')
    expect(overallSourceState([{ ...health('watching'), coverageGap: { since: now, detectedAt: later, reason: 'no-overlap' } }])).toBe('partial')
    expect(overallSourceState([{ ...health('watching'), recovering: true }, health('watching')])).toBe('partial')
  })

  it('normalizes transport errors and never copies private error bodies into support reports', () => {
    expect(transportIssueCode({ ok: false, status: null, error: 'TypeError' })).toBe('network')
    expect(transportIssueCode({ ok: false, status: null, error: 'AbortError' })).toBe('timeout')
    expect(transportIssueCode({ ok: true, status: 200 })).toBe('invalid_content')
    expect(transportIssueCode({ ok: false, status: 403 })).toBe('http-403')
    expect(monitoringIssue('HTTP 429')).toBe('rate-limited')
    const report = monitoringReport('0.7.0', [{ id: 'nafezly', health: { ...health('error'), lastError: 'SECRET_API_KEY private note C:/Users/private browser-cookie' } }], now)
    expect(report).not.toMatch(/SECRET_API_KEY|private note|Users|browser-cookie/)
    expect(JSON.parse(report).sources[0].issue).toBe('unknown')
  })
})

describe('Persistent coverage metadata', () => {
  it('keeps baseline silent and only updates discovery time for actual inserts', () => {
    const db = database()
    success(db, ['1', '2'], now, 2)
    expect(readMonitoring(db, 'nafezly').gap).toBeNull()
    success(db, ['1', '2'], '2026-10-15T10:00:15.000Z')
    expect(readMonitoring(db, 'nafezly').lastDiscoveryAt).toBe(now)
  })

  it('persists a no-overlap warning through successful polls and reopening until acknowledged', () => {
    const db = database()
    success(db, ['1', '2'])
    success(db, ['4', '3'], '2026-10-15T10:00:15.000Z', 2)
    const gap = readMonitoring(db, 'nafezly').gap
    expect(gap?.reason).toBe('no-overlap')
    success(db, ['4', '3'], '2026-10-15T10:00:30.000Z')
    expect(readMonitoring(db, 'nafezly').gap).toEqual(gap)
    db.close(); const reopened = openDatabase(join(folder!, 'rased.db'))
    try {
      expect(readMonitoring(reopened, 'nafezly').gap).toEqual(gap)
      acknowledgeMonitoringGap(reopened, 'nafezly')
      success(reopened, ['4', '3'], '2026-10-15T10:00:45.000Z')
      expect(readMonitoring(reopened, 'nafezly').gap).toBeNull()
      success(reopened, ['6', '5'], '2026-10-15T10:01:00.000Z')
      expect(readMonitoring(reopened, 'nafezly').gap?.detectedAt).toBe('2026-10-15T10:01:00.000Z')
    } finally { reopened.close() }
  })

  it('warns after a long interruption without claiming projects were definitely missed', () => {
    const db = database()
    success(db, ['1', '2'])
    success(db, ['1', '2'], later)
    expect(readMonitoring(db, 'nafezly').gap).toEqual({ since: now, detectedAt: later, reason: 'interrupted' })
  })

  it('bridges pre-upgrade Nafezly checkpoints and handles corrupt metadata', () => {
    const db = database()
    setSettingRaw(db, 'monitoring:nafezly', '{bad-json')
    saveSourceState(db, { ...getSourceState(db, 'nafezly'), baselineComplete: true, lastSuccessAt: now })
    recordMonitoringSuccess(db, 'nafezly', ['20'], 1, '2026-10-15T10:00:15.000Z', { previousIds: ['10'] })
    expect(readMonitoring(db, 'nafezly').gap?.reason).toBe('no-overlap')
  })

  it('only resolves a KAF warning when pagination explicitly proves coverage', () => {
    const db = database()
    recordMonitoringSuccess(db, 'kaf', ['1'], 1, now)
    saveSourceState(db, { ...getSourceState(db, 'kaf'), baselineComplete: true, lastSuccessAt: now })
    setSettingRaw(db, 'kaf:checkpoint', JSON.stringify({ anchorIds: ['1'], cursor: 4 }))
    recordMonitoringSuccess(db, 'kaf', ['50'], 2, later)
    expect(monitoringFields(db, 'kaf').recovering).toBe(true)
    expect(monitoringFields(db, 'kaf').coverageGap).not.toBeNull()
    recordMonitoringSuccess(db, 'kaf', ['50'], 0, later, { recoveredAll: true })
    setSettingRaw(db, 'kaf:checkpoint', 'null')
    expect(monitoringFields(db, 'kaf')).toMatchObject({ recovering: false, coverageGap: null })
    expect(getSettingRaw(db, 'monitoring:kaf')).not.toBeNull()
  })

  it('does not create Mostaql events from a muted source or late enrichment', () => {
    const db = database(), settings = { ...defaultSettings(), mostaqlNotificationsEnabled: false }
    const item = { invalid: false as const, source: 'mostaql', externalId: '1', url: 'https://mostaql.com/go/1', title: 'React work', descriptionExcerpt: 'Description', publishedAt: now, publishedRaw: now }
    const context = { nowIso: now, nowMs: Date.parse(now), runId: 'test', settings, durationMs: 1, itemCount: 1, invalidSingles: 0, firstCycleOfRun: false }
    applySuccessfulCycle(db, [item], context)
    applySuccessfulCycle(db, [{ ...item, externalId: '2', url: 'https://mostaql.com/go/2' }], context)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(0)
    expect(evaluateLateProject(db, 2, settings, now)).toBe('silent')
    expect(evaluateLateProject(db, 2, { ...settings, mostaqlNotificationsEnabled: true, mostaqlEnabled: false }, now)).toBe('silent')
  })
})
