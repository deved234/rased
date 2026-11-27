import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Worker } from 'node:worker_threads'
import { ConsentStore } from '../src/main/telemetry/consent.js'
import { TelemetryService } from '../src/main/telemetry/service.js'
import type { SourceHealth } from '../src/shared/types.js'
import { telemetryConfig } from '../src/main/telemetry/config.js'
import { posthogEvent, sendPosthog } from '../src/main/telemetry/transports/posthog.js'
import { TelemetryStore } from '../src/storage/telemetryStore.js'
import { TELEMETRY_DISCLOSURE, deviceContext, validTelemetryEnvelope, validTelemetryProperties, durationBucket, telemetryError, type TelemetryEnvelope } from '../src/shared/telemetry.js'

const roots: string[] = [], stores: TelemetryStore[] = []
const root = (): string => { const dir = mkdtempSync(join(tmpdir(), 'rased-test-analytics-')); roots.push(dir); return dir }
const event = (patch: Partial<TelemetryEnvelope> = {}): TelemetryEnvelope => ({ eventId: randomUUID(), name: 'feature_used', occurredAt: '2026-10-17T12:00:00.000Z', distinctId: randomUUID(), schemaVersion: 2, environment: 'qa', appVersion: '0.8.1', language: 'ar', osFamily: 'windows-10', osMajor: 'none', cpuArch: 'x64', count: 1, properties: { feature: 'bookmark', outcome: 'success' }, ...patch } as TelemetryEnvelope)
const store = (now = () => Date.parse('2026-10-17T12:15:00Z')): TelemetryStore => { const value = new TelemetryStore(join(root(), 'queue.sqlite'), now); stores.push(value); return value }
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe('Analytics consent and identity', () => {
  it('requires acceptance only in configured builds and does not lock accepted use on a transport outage', async () => {
    const dir = root(), consent = new ConsentStore(dir)
    const options = { root: dir, entry: 'not started', version: '0.9.1', language: 'en' as const, device: { osFamily: 'windows-10', osMajor: 'none', cpuArch: 'x64' } as const, config: null, changed: () => {} }
    const dev = new TelemetryService(options)
    const configured = new TelemetryService({ ...options, fixture: true })
    expect(dev.status()).toMatchObject({ available: false, accessAllowed: true })
    expect(configured.status()).toMatchObject({ available: true, accessAllowed: false })
    consent.change('enable')
    const accepted = new TelemetryService({ ...options, fixture: true })
    expect(accepted.status()).toMatchObject({ accessAllowed: true, transport: 'unavailable' })
    consent.change('disable')
    expect(new TelemetryService({ ...options, fixture: true }).status().accessAllowed).toBe(false)
    consent.change('enable')
    const file = join(dir, 'telemetry/consent.json')
    writeFileSync(file, JSON.stringify({ ...consent.snapshot(), disclosure: '2026-10-21-v3' }))
    const upgraded = new TelemetryService({ ...options, fixture: true })
    expect(upgraded.status()).toMatchObject({ state: 'unknown', accessAllowed: false })
    await Promise.all([dev.close(), configured.close(), accepted.close(), upgraded.close()])
  })
  it('terminates the old sender after a failed consent write and cannot revive it on wake', async () => {
    const dir = root(), entry = join(dir, 'worker.cjs')
    writeFileSync(entry, `const {parentPort}=require('node:worker_threads'); parentPort.on('message',m=>parentPort.postMessage({type:'status',request:m.request,transport:'idle'})); parentPort.postMessage({type:'status',transport:'idle'});`)
    const service = new TelemetryService({ root: dir, entry, version: '0.8.1', language: 'en', device: { osFamily: 'windows-10', osMajor: 'none', cpuArch: 'x64' }, config: null, fixture: true, changed: () => {} })
    const internals = service as unknown as { consent: ConsentStore; worker: Worker | null }
    try {
      service.start(false)
      await vi.waitFor(() => expect(service.status().transport).toBe('idle'))
      await service.change('enable')
      const oldWorker = internals.worker!
      const fail = vi.spyOn(internals.consent, 'change').mockImplementation(() => { throw Error('disk unavailable') })
      await expect(service.change('disable')).rejects.toThrow('analytics-write-failed')
      service.resume()
      service.record('feature_used', { feature: 'bookmark', outcome: 'success' })
      expect(internals.worker).toBeNull()
      expect(oldWorker.threadId).toBe(-1)
      expect(service.status().transport).toBe('unavailable')
      fail.mockRestore()
      await service.change('disable')
      await vi.waitFor(() => expect(service.status().transport).toBe('idle'))
      expect(service.status().state).toBe('disabled')
    } finally { await service.close() }
  })
  it('creates no identity before consent and preserves identity across restart and ordinary disabling', () => {
    const dir = root(), consent = new ConsentStore(dir)
    expect(consent.snapshot()).toMatchObject({ state: 'unknown', identity: null })
    const enabled = consent.change('enable')
    expect(enabled.identity).toMatch(/^[a-f0-9-]{36}$/)
    expect(new ConsentStore(dir).snapshot()).toEqual(enabled)
    expect(consent.change('disable').identity).toBe(enabled.identity)
    expect(consent.change('enable').identity).toBe(enabled.identity)
    expect(consent.change('forget')).toMatchObject({ state: 'disabled', identity: null })
    consent.completePurge()
    expect(consent.change('enable').identity).not.toBe(enabled.identity)
  })
  it('stores decline and not-now without inventing an identity', () => {
    const c = new ConsentStore(root())
    expect(c.change('later')).toMatchObject({ prompted: true, state: 'unknown', identity: null })
    expect(c.change('disable')).toMatchObject({ state: 'disabled', identity: null })
  })
  it('fails closed on corrupt consent or a changed disclosure', () => {
    const dir = root(), c = new ConsentStore(dir), granted = c.change('enable')
    const file = join(dir, 'telemetry/consent.json')
    writeFileSync(file, JSON.stringify({ ...granted, disclosure: 'old' }))
    expect(new ConsentStore(dir).snapshot()).toMatchObject({ state: 'unknown', identity: granted.identity, disclosure: TELEMETRY_DISCLOSURE })
    writeFileSync(file, 'invalid')
    expect(new ConsentStore(dir).snapshot()).toMatchObject({ state: 'unknown', identity: null })
  })
  it('requires fresh consent when the former 90-day disclosure changes to the requested-retention policy', () => {
    const dir = root(), consent = new ConsentStore(dir), granted = consent.change('enable')
    writeFileSync(join(dir, 'telemetry/consent.json'), JSON.stringify({ ...granted, disclosure: '2026-10-17-v1' }))
    const upgraded = new ConsentStore(dir)
    expect(upgraded.snapshot()).toMatchObject({ state: 'unknown', prompted: false, identity: granted.identity, generation: granted.generation + 1 })
    expect(upgraded.change('enable')).toMatchObject({ state: 'enabled', disclosure: TELEMETRY_DISCLOSURE, identity: granted.identity })
    expect(validTelemetryProperties('analytics_enrolled', { disclosure: '2026-10-17-v1' })).toBe(false)
  })
  it('re-prompts enabled v5 consent and preserves disabled v5 consent under v6', () => {
    const dir = root(), consent = new ConsentStore(dir), enabled = consent.change('enable')
    writeFileSync(join(dir, 'telemetry/consent.json'), JSON.stringify({ ...enabled, disclosure: '2026-11-15-v5' }))
    expect(new ConsentStore(dir).snapshot()).toMatchObject({ state: 'unknown', prompted: false, identity: enabled.identity, disclosure: TELEMETRY_DISCLOSURE, generation: enabled.generation + 1 })
    const dir2 = root(), consent2 = new ConsentStore(dir2), disabled = consent2.change('disable')
    writeFileSync(join(dir2, 'telemetry/consent.json'), JSON.stringify({ ...disabled, disclosure: '2026-11-15-v5' }))
    expect(new ConsentStore(dir2).snapshot()).toMatchObject({ state: 'disabled', prompted: true, identity: disabled.identity, disclosure: TELEMETRY_DISCLOSURE, generation: disabled.generation })
  })
  it('blocks dev and isolated fixtures even with production build settings', () => {
    vi.stubEnv('RASED_ANALYTICS_BUILD_TOKEN', 'phc_synthetic_fixture_never_usable')
    vi.stubEnv('RASED_ANALYTICS_BUILD_READY', 'true')
    vi.stubEnv('RASED_ANALYTICS_BUILD_ENVIRONMENT', 'production')
    expect(telemetryConfig(false, false)).toBeNull()
    expect(telemetryConfig(true, true)).toBeNull()
    expect(telemetryConfig(true, false)?.environment).toBe('production')
    vi.stubEnv('RASED_ANALYTICS_BUILD_ENVIRONMENT', 'qa')
    expect(telemetryConfig(true, false)?.environment).toBe('qa')
    vi.stubEnv('RASED_ANALYTICS_BUILD_ENVIRONMENT', 'invalid')
    expect(telemetryConfig(true, false)).toBeNull()
    vi.stubEnv('RASED_ANALYTICS_BUILD_READY', 'false')
    expect(telemetryConfig(true, false)).toBeNull()
  })
})
describe('Explicit event contracts', () => {
  it('counts new completed checks once and distinguishes pause/disable/cooldown from failures', () => {
    const service = new TelemetryService({ root: root(), entry: 'unused', version: '0.8.1', language: 'en', device: { osFamily: 'windows-10', osMajor: 'none', cpuArch: 'x64' }, config: null, changed: () => {} })
    const counter = vi.spyOn(service, 'counter').mockImplementation(() => {})
    const activity = vi.spyOn(service, 'activity').mockImplementation(() => {})
    const h: SourceHealth = { state: 'watching', paused: false, enabled: true, lastAttemptAt: null, lastSuccessAt: null, nextAttemptAt: null, consecutiveFailures: 0, lastError: null, lastDurationMs: null, lastItemCount: null, effectiveIntervalMs: 5000 }
    service.health('mostaql', h)
    service.health('mostaql', { ...h, checking: true, lastAttemptAt: '2026-10-17T12:00:00Z' })
    expect(counter).not.toHaveBeenCalled()
    const succeeded = { ...h, lastAttemptAt: '2026-10-17T12:00:00Z', lastSuccessAt: '2026-10-17T12:00:01Z' }
    service.health('mostaql', succeeded); service.health('mostaql', succeeded)
    expect(counter.mock.calls).toEqual([['monitoring_hourly', 'mostaql_success']])
    expect(activity).toHaveBeenCalledWith('monitoring')
    service.health('mostaql', { ...succeeded, state: 'backing-off', lastAttemptAt: '2026-10-17T12:00:05Z', lastError: 'network' })
    expect(counter).toHaveBeenCalledWith('monitoring_hourly', 'mostaql_failure')
    expect(counter).toHaveBeenCalledWith('monitoring_hourly', 'mostaql_cooldown')
    service.health('mostaql', { ...succeeded, state: 'paused', paused: true })
    service.health('mostaql', { ...succeeded, state: 'disabled', enabled: false })
    expect(counter).toHaveBeenCalledWith('monitoring_hourly', 'mostaql_paused')
    expect(counter).toHaveBeenCalledWith('monitoring_hourly', 'mostaql_disabled')
    expect(counter.mock.calls.filter(c => c[1] === 'mostaql_failure')).toHaveLength(1)
  })
  it('rejects secret/content canaries, free text and unexpected fields at both boundaries', () => {
    const e = event()
    expect(validTelemetryEnvelope(e)).toBe(true)
    for (const key of ['title', 'url', 'apiKey', 'note', 'model', 'path', 'token']) {
      expect(validTelemetryProperties(e.name, { ...e.properties, [key]: 'PRIVATE_CANARY' })).toBe(false)
      expect(validTelemetryEnvelope({ ...e, [key]: 'PRIVATE_CANARY' })).toBe(false)
    }
    expect(validTelemetryProperties('unknown', e.properties)).toBe(false)
    expect(validTelemetryProperties('proposal_result', { provider: 'custom', outcome: 'failed', error: 'PRIVATE_CANARY', duration: 'over_10s' })).toBe(false)
    expect(validTelemetryProperties('monitoring_hourly', { mostaql_success: -1 })).toBe(false)
    expect(validTelemetryProperties('feature_used', { feature: 'bookmark' })).toBe(false)
    expect(validTelemetryProperties('feature_used', { feature: 'community_channel', outcome: 'success' })).toBe(true)
    expect(validTelemetryProperties('feature_used', { feature: 'community_group', outcome: 'failed' })).toBe(true)
    expect(validTelemetryProperties('feature_used', { feature: 'community_channel' })).toBe(false)
    expect(validTelemetryProperties('feature_used', { feature: 'telegram', outcome: 'success' })).toBe(false)
  })
  it('uses fixed duration and error buckets without serializing raw errors', () => {
    expect([99, 100, 500, 2000, 10000].map(durationBucket)).toEqual(['under_100ms', '100_500ms', '500ms_2s', '2_10s', 'over_10s'])
    expect(telemetryError('network PRIVATE_CANARY')).toBe('network')
    expect(telemetryError('unknown PRIVATE_CANARY')).toBe('other')
  })
  it('maps only approved fields, a stable event UUID and IP suppression to PostHog', () => {
    const e = event(), mapped = posthogEvent(e) as { uuid: string; event: string; properties: Record<string, unknown> }
    expect(mapped.uuid).toBe(e.eventId)
    expect(mapped.event).toBe('rased.app.feature_used')
    expect(mapped.properties).toMatchObject({ record_type: 'app', environment: 'qa', $geoip_disable: true })
    expect(mapped.properties).not.toHaveProperty('$ip')
    expect(() => posthogEvent({ ...e, properties: { ...e.properties, title: 'PRIVATE_CANARY' } })).toThrow()
  })
})
describe('Device context and envelope schema v2', () => {
  it('computes deviceContext across platforms and architectures', () => {
    expect(deviceContext('win32', '10.0.19045', '10.0.19045', 'x64')).toEqual({ osFamily: 'windows-10', osMajor: 'none', cpuArch: 'x64' })
    expect(deviceContext('win32', '10.0.22000', '10.0.22000', 'arm64')).toEqual({ osFamily: 'windows-11', osMajor: 'none', cpuArch: 'arm64' })
    expect(deviceContext('win32', '10.0.26100', '10.0.26100', 'x64')).toEqual({ osFamily: 'windows-11', osMajor: 'none', cpuArch: 'x64' })
    expect(deviceContext('darwin', '24.0.0', '15.1.0', 'arm64')).toEqual({ osFamily: 'macos', osMajor: '15', cpuArch: 'arm64' })
    expect(deviceContext('darwin', '25.0.0', '26.0', 'x64')).toEqual({ osFamily: 'macos', osMajor: '26', cpuArch: 'x64' })
    expect(deviceContext('darwin', '24.0.0', 'garbage', 'arm64')).toEqual({ osFamily: 'macos', osMajor: 'none', cpuArch: 'arm64' })
    expect(deviceContext('linux', '6.8.0', '6.8.0', 'x64')).toEqual({ osFamily: 'linux', osMajor: 'none', cpuArch: 'x64' })
    expect(deviceContext('freebsd', '14.0', '14.0', 'ia32')).toEqual({ osFamily: 'other', osMajor: 'none', cpuArch: 'other' })
  })
  it('validates v2 envelopes and rejects bad values and extra keys', () => {
    const v2 = event()
    expect(validTelemetryEnvelope(v2)).toBe(true)
    expect(validTelemetryEnvelope({ ...v2, osFamily: 'windows' })).toBe(false)
    expect(validTelemetryEnvelope({ ...v2, osMajor: '15.1' })).toBe(false)
    expect(validTelemetryEnvelope({ ...v2, cpuArch: 'ia32' })).toBe(false)
    expect(validTelemetryEnvelope({ ...v2, extra: 'nope' })).toBe(false)
    expect(validTelemetryEnvelope({ ...v2, osFamily: 'linux', osMajor: '6' })).toBe(false)
    // An unreadable macOS version must not silently drop every event from that Mac.
    expect(validTelemetryEnvelope({ ...v2, osFamily: 'macos', osMajor: 'none' })).toBe(true)
    for (const [platform, release, version, arch] of [['win32', '10.0.19045', '', 'x64'], ['win32', '10.0.26100', '', 'arm64'], ['darwin', '24.0.0', '15.1.0', 'arm64'], ['darwin', '24.0.0', 'garbage', 'x64'], ['linux', '6.8.0', '', 'x64'], ['freebsd', '14.0', '', 'ia32']] as const)
      expect(validTelemetryEnvelope({ ...v2, ...deviceContext(platform, release, version, arch) })).toBe(true)
  })
  it('still accepts queued v1 envelopes', () => {
    const v1: TelemetryEnvelope = { eventId: randomUUID(), name: 'feature_used', occurredAt: '2026-10-17T12:00:00.000Z', distinctId: randomUUID(), schemaVersion: 1, environment: 'qa', appVersion: '0.8.1', language: 'ar', windowsFamily: '11', count: 1, properties: { feature: 'bookmark', outcome: 'success' } }
    expect(validTelemetryEnvelope(v1)).toBe(true)
    expect(validTelemetryEnvelope({ ...v1, windowsFamily: '12' })).toBe(false)
    expect(validTelemetryEnvelope({ ...v1, extra: 'nope' })).toBe(false)
  })
  it('maps posthog properties for v1 and v2 envelopes', () => {
    const v2 = event({ osFamily: 'windows-11', osMajor: 'none', cpuArch: 'arm64' })
    const p2 = (posthogEvent(v2) as { properties: Record<string, unknown> }).properties
    expect(p2.schema_version).toBe(2)
    expect(p2.os_family).toBe('windows-11')
    expect(p2.os_major).toBe('none')
    expect(p2.cpu_arch).toBe('arm64')
    expect(p2.windows_family).toBe('11')
    const v1: TelemetryEnvelope = { eventId: randomUUID(), name: 'feature_used', occurredAt: '2026-10-17T12:00:00.000Z', distinctId: randomUUID(), schemaVersion: 1, environment: 'qa', appVersion: '0.8.1', language: 'ar', windowsFamily: '10', count: 1, properties: { feature: 'bookmark', outcome: 'success' } }
    const p1 = (posthogEvent(v1) as { properties: Record<string, unknown> }).properties
    expect(p1.schema_version).toBe(1)
    expect(p1.windows_family).toBe('10')
    expect(p1.os_family).toBe('windows-10')
    expect(p1).not.toHaveProperty('os_major')
    expect(p1).not.toHaveProperty('cpu_arch')
  })
})
describe('Separate bounded persistent queue', () => {
  it('replaces a corrupted active bucket without losing subsequent source counters', () => {
    const s = store(), e = event({ name: 'monitoring_hourly', properties: { mostaql_success: 1 } })
    s.counter('monitoring_hourly', 'hour', 'mostaql_success', e)
    s.db.prepare('UPDATE buckets SET body=? WHERE key=?').run('damaged', 'hour')
    expect(() => s.counter('monitoring_hourly', 'hour', 'mostaql_success', e)).not.toThrow()
    s.counter('monitoring_hourly', 'hour', 'mostaql_success', e)
    s.seal(true)
    expect(s.batch()[0]?.properties.mostaql_success).toBe(2)
    expect(s.status().dropped).toBe(1)
  })
  it('keeps event IDs across retries and atomically removes only acknowledged events', () => {
    const s = store(), e = event()
    s.add(e)
    expect(s.batch()[0]?.eventId).toBe(e.eventId)
    expect(s.batch()[0]?.eventId).toBe(e.eventId)
    s.acknowledge(['unrelated'])
    expect(s.status().queued).toBe(1)
    s.acknowledge([e.eventId])
    expect(s.status().queued).toBe(0)
  })
  it('rolls back a daily marker if the event write fails', () => {
    const s = store()
    s.db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT,'fixture write failure'); END")
    expect(() => s.add(event(), 'active:fixture:interface')).toThrow()
    expect(s.get('once:active:fixture:interface')).toBeNull()
    s.db.exec('DROP TRIGGER reject_event')
    expect(s.add(event(), 'active:fixture:interface')).toBe(true)
  })
  it('removes malformed telemetry rows without blocking valid queued events', () => {
    const s = store()
    s.db.prepare('INSERT INTO queue VALUES(?,?,?,?)').run(randomUUID(), 'broken', 6, Date.parse('2026-10-17T12:00:00Z'))
    const e = event(); s.add(e)
    expect(s.batch().map(row => row.eventId)).toEqual([e.eventId])
    expect(s.status().dropped).toBe(1)
  })
  it('deduplicates daily markers across a real database reopen', () => {
    const dir = root(), file = join(dir, 'queue.sqlite'), e = event()
    const first = new TelemetryStore(file)
    expect(first.add({ ...e, occurredAt: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString() }, 'day:interface')).toBe(true)
    first.close()
    const reopened = new TelemetryStore(file); stores.push(reopened)
    expect(reopened.add(e, 'day:interface')).toBe(false)
    expect(reopened.status().queued).toBe(1)
  })
  it('combines source counters into one hour and does not reseal the same data', () => {
    let now = Date.parse('2026-10-17T12:15:00Z')
    const s = store(() => now), e = event({ name: 'monitoring_hourly', properties: { mostaql_success: 1 } })
    for (let i = 0; i < 20; i++) s.counter('monitoring_hourly', 'hour', 'mostaql_success', e)
    expect(s.batch()).toEqual([])
    now += 3600000
    expect(s.batch()[0]?.properties.mostaql_success).toBe(20)
    expect(s.batch()).toHaveLength(1)
  })
  it('aggregates heavy interaction volume instead of dropping results silently', () => {
    const s = store(), distinctId = randomUUID()
    for (let i = 0; i < 150; i++) s.add(event({ distinctId }))
    s.seal(true)
    const rows = s.db.prepare('SELECT body FROM queue').all() as { body: string }[]
    expect(rows).toHaveLength(101)
    expect(rows.reduce((n, row) => n + (JSON.parse(row.body) as TelemetryEnvelope).count, 0)).toBe(150)
  })
  it('bounds the queue and expires old events', () => {
    let now = Date.parse('2026-10-17T12:15:00Z')
    const s = store(() => now)
    for (let i = 0; i < 1005; i++) s.aggregate('bucket:' + i, event({ name: 'monitoring_hourly', properties: { kaf_failure: 1 } }))
    expect(s.status().queued).toBeLessThanOrEqual(1000)
    expect(s.status().dropped).toBeGreaterThan(0)
    now += 8 * 86400000; s.bind(null, false)
    expect(s.status().queued).toBe(0)
    // Exercise the real queue limit; hosted Windows disks need a larger budget.
  }, 90_000)
  it('clears pending data on revoke or identity replacement', () => {
    const s = store(), id = randomUUID()
    s.bind(id, true); s.add(event({ distinctId: id }))
    s.bind(id, false); expect(s.status().queued).toBe(0)
    s.add(event({ distinctId: id })); s.bind(randomUUID(), true)
    expect(s.status().queued).toBe(0)
  })
})
describe('Bounded HTTP transport', () => {
  const config = { host: 'https://us.i.posthog.com' as const, environment: 'qa' as const, token: 'synthetic-not-a-real-key' }
  it('requires the capture acknowledgement, not a generic successful web page', async () => {
    const fake = vi.fn(async () => new Response('{"status":1}'))
    expect((await sendPosthog(config, [event()], new AbortController().signal, fake as typeof fetch)).accepted).toBe(true)
    const body = JSON.parse(String((fake.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.batch).toHaveLength(1)
    expect((await sendPosthog(config, [event()], new AbortController().signal, (async () => new Response('<html>ok</html>')) as typeof fetch)).accepted).toBe(false)
    expect((await sendPosthog(config, [event()], new AbortController().signal, (async () => new Response('{"status":"Ok"}')) as typeof fetch)).accepted).toBe(true)
    expect((await sendPosthog(config, [event()], new AbortController().signal, (async () => new Response('{"status":"Ok","quota_limited":["events"]}')) as typeof fetch)).accepted).toBe(false)
  })
  it('honors retry-after and treats ordinary 4xx as permanent', async () => {
    const result = await sendPosthog(config, [event()], new AbortController().signal, (async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } })) as typeof fetch)
    expect(result).toMatchObject({ accepted: false, permanent: false, retryAfterMs: 120000 })
    expect((await sendPosthog(config, [event()], new AbortController().signal, (async () => new Response('{}', { status: 401 })) as typeof fetch)).permanent).toBe(true)
  })
  it('never mixes production with QA or follows redirects', async () => {
    const fake = vi.fn(async () => new Response('{"status":1}'))
    await expect(sendPosthog(config, [event({ environment: 'production' })], new AbortController().signal, fake as typeof fetch)).rejects.toThrow()
    expect(fake).not.toHaveBeenCalled()
    await sendPosthog(config, [event()], new AbortController().signal, fake as typeof fetch)
    expect((fake.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('error')
  })
})
