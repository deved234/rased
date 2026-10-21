import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConsentStore } from '../src/main/telemetry/consent.js'
import { TelemetryStore } from '../src/storage/telemetryStore.js'
import { sendPosthog } from '../src/main/telemetry/transports/posthog.js'
import type { TelemetryEnvelope } from '../src/shared/telemetry.js'
import { quickApplyTelemetryError, validTelemetryProperties } from '../src/shared/telemetry.js'
import { TelemetryDelivery } from '../src/main/telemetry/delivery.js'
import type { SendResult } from '../src/main/telemetry/transports/posthog.js'
import { recordStartupFailure } from '../src/main/startupFailure.js'
import { TelemetryService } from '../src/main/telemetry/service.js'
import type { Worker } from 'node:worker_threads'
import { vi } from 'vitest'
const buildPath = '../scripts/analytics/build-guard.mjs'
const { analyticsBuildDefines } = await import(buildPath)
const adminPath = '../scripts/analytics/admin.mjs'
const { installDashboards } = await import(adminPath)
const dashboardsPath = '../scripts/analytics/dashboards.mjs'
const { dashboardDefinitions } = await import(dashboardsPath)

const roots: string[] = []
const root = (): string => { const p = mkdtempSync(join(tmpdir(), 'rased-test-repairs-')); roots.push(p); return p }
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })
const event = (identity = randomUUID()): TelemetryEnvelope => ({ eventId: randomUUID(), name: 'feature_used', occurredAt: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(), distinctId: identity, schemaVersion: 1, environment: 'qa', appVersion: '0.8.1', language: 'en', windowsFamily: '10', count: 1, properties: { feature: 'bookmark', outcome: 'success' } })

it('preserves a previous decline when the disclosure changes', () => {
  const p = root(), c = new ConsentStore(p), declined = c.change('disable')
  writeFileSync(join(p, 'telemetry/consent.json'), JSON.stringify({ ...declined, disclosure: 'old' }))
  expect(new ConsentStore(p).snapshot()).toMatchObject({ state: 'disabled', prompted: true })
})

it('does not leave the forgotten identity in application-owned queue bytes', () => {
  const file = join(root(), 'queue.sqlite'), id = randomUUID(), s = new TelemetryStore(file)
  s.bind(id, true)
  for (let i = 0; i < 20; i++) s.add(event(id))
  s.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  s.bind(null, false); s.close()
  for (const p of [file, file + '-wal', file + '-shm']) if (existsSync(p)) expect(readFileSync(p).includes(Buffer.from(id))).toBe(false)
})

it('does not treat a validation failure as a permanent sender shutdown', async () => {
  const r = await sendPosthog({ host: 'https://us.i.posthog.com', environment: 'qa', token: 'synthetic' }, [event()], new AbortController().signal, async () => new Response('{}', { status: 400 }))
  expect('permanent' in r ? r.permanent : false).toBe(false)
})

it('retries a purge after partial deletion and verifies a busy checkpoint', () => {
  const file = join(root(), 'queue.sqlite'), id = randomUUID(), s = new TelemetryStore(file)
  let reader: DatabaseSync | undefined
  try {
    s.bind(id, true); s.add(event(id))
    reader = new DatabaseSync(file)
    reader.exec('BEGIN'); reader.prepare('SELECT * FROM queue').all()
    expect(() => s.purge()).toThrow()
    expect(s.get('identity')).toBeNull()
    reader.exec('ROLLBACK'); reader.close(); reader = undefined
    s.purge(); s.purge()
    for (const p of [file, file + '-wal', file + '-shm']) if (existsSync(p)) expect(readFileSync(p).includes(Buffer.from(id))).toBe(false)
  } finally { reader?.close(); s.close() }
})

it('removes only owned temporary consent files and keeps pending forgetting off across restart', () => {
  const p = root(), c = new ConsentStore(p), identity = c.change('enable').identity!
  const stale = join(p, 'telemetry', `consent.json.${randomUUID()}.tmp`)
  const unrelated = join(p, 'telemetry', 'unrelated.tmp')
  writeFileSync(stale, identity); writeFileSync(unrelated, 'preserve')
  const loaded = new ConsentStore(p)
  expect(existsSync(stale)).toBe(false); expect(existsSync(unrelated)).toBe(true)
  loaded.change('forget')
  const restarted = new ConsentStore(p)
  expect(restarted.snapshot()).toMatchObject({ state: 'disabled', identity: null, purgePending: true })
  expect(() => restarted.change('enable')).toThrow('forget-incomplete')
  restarted.completePurge()
  expect(restarted.change('enable').identity).not.toBe(identity)
})

const answer = (kind: SendResult['kind'], retryAfterMs?: number): SendResult => ({ kind, accepted: kind === 'accepted', permanent: kind === 'auth', retryAfterMs })
it('classifies validation, size, credentials, quota and transient HTTP responses independently', async () => {
  for (const [status, kind] of [[400,'poison'],[422,'poison'],[413,'too_large'],[401,'auth'],[403,'auth'],[408,'retry'],[429,'retry'],[503,'retry'],[404,'retry']] as const) {
    expect((await sendPosthog({ host: 'https://us.i.posthog.com', environment: 'qa', token: 'synthetic' }, [event()], new AbortController().signal, async () => new Response('{}', { status }))).kind).toBe(kind)
  }
  expect((await sendPosthog({ host: 'https://us.i.posthog.com', environment: 'qa', token: 'synthetic' }, [event()], new AbortController().signal, async () => new Response('{"status":"Ok","quota_limited":["events"]}'))).kind).toBe('quota')
})

it('bounds split requests and makes durable progress across restart without deleting healthy UUIDs', async () => {
  let now = Date.now()
  const file = join(root(), 'queue.sqlite'), s = new TelemetryStore(file, () => now)
  try {
    const events = Array.from({ length: 50 }, () => event()), bad = new Set([events[0]!.eventId, events[19]!.eventId, events[48]!.eventId]), accepted = new Set<string>()
    events.forEach(e => s.add(e))
    let delivery = new TelemetryDelivery(s, { destination: 'fixture' }, '1', () => now)
    for (let cycle = 0; cycle < 40 && s.status().queued; cycle++) {
      let requests = 0
      await delivery.cycle(async batch => { requests++; if (batch.some(e => bad.has(e.eventId))) return answer('poison'); batch.forEach(e => accepted.add(e.eventId)); return answer('accepted') }, new AbortController().signal)
      expect(requests).toBeLessThanOrEqual(12)
      now += 7200000
      if (cycle === 1) delivery = new TelemetryDelivery(s, { destination: 'fixture' }, '1', () => now)
    }
    expect(s.status()).toMatchObject({ queued: 0, dropped: 3 }); expect(accepted.size).toBe(47)
    expect([...accepted].every(id => events.some(e => e.eventId === id) && !bad.has(id))).toBe(true)
  } finally { s.close() }
})

it('never discards a universal rejection and preserves the daily poison limit across restart', async () => {
  let now = Date.now()
  const s = new TelemetryStore(join(root(), 'queue.sqlite'), () => now)
  try {
    const events = Array.from({ length: 50 }, () => event()); events.forEach(e => s.add(e))
    let delivery = new TelemetryDelivery(s, 'fixture', '1', () => now)
    for (let i = 0; i < 3; i++) {
      let requests = 0
      await delivery.cycle(async () => { requests++; return answer('poison') }, new AbortController().signal)
      expect(requests).toBeLessThanOrEqual(12); expect(s.status()).toMatchObject({ dropped: 0, queued: 50 })
      now += 120000; delivery = new TelemetryDelivery(s, 'fixture', '1', () => now)
    }
    expect(s.dropPoison(events.slice(0,20).map(e=>e.eventId),20)).toHaveLength(20)
    delivery = new TelemetryDelivery(s, 'fixture', '2', () => now)
    expect(s.dropPoison([events[20]!.eventId],20)).toEqual([])
    expect(s.read([events[20]!.eventId])).toHaveLength(1)
  } finally { s.close() }
})

it('adapts large batches without drops and separates authentication from provider cooldowns', async () => {
  let now = Date.now()
  const s = new TelemetryStore(join(root(), 'queue.sqlite'), () => now)
  try {
    for (let i = 0; i < 12; i++) s.add(event())
    let delivery = new TelemetryDelivery(s, 'fixture', '1', () => now)
    for (let i = 0; i < 10 && s.status().queued; i++) {
      await delivery.cycle(async batch => answer(batch.length > 1 ? 'too_large' : 'accepted'), new AbortController().signal); now += 7200000
    }
    expect(s.status()).toMatchObject({ queued: 0, dropped: 0 })
    const accepted = s.get('last-accepted')
    s.add(event())
    await delivery.cycle(async () => answer('retry',3600000),new AbortController().signal)
    const deadline = s.get('retry-at')
    delivery = new TelemetryDelivery(s, 'fixture', '2', () => now)
    let requests = 0
    await delivery.cycle(async () => { requests++; return answer('accepted') },new AbortController().signal)
    expect(requests).toBe(0); expect(s.get('retry-at')).toBe(deadline); expect(delivery.lastAccepted).toBe(accepted)
    now += 3600001
    await delivery.cycle(async () => answer('auth'),new AbortController().signal)
    // Advance and reject four daily rechecks to reach a multi-day deadline.
    for (let i = 0; i < 4; i++) { now = Number(s.get('auth-next-check')) + 1; await delivery.cycle(async () => answer('auth'),new AbortController().signal) }
    const authDeadline = Number(s.get('auth-next-check'))
    delivery = new TelemetryDelivery(s, 'fixture', '2', () => now)
    expect(Number(s.get('auth-next-check'))).toBe(authDeadline)
    now += 86400001; requests = 0
    await delivery.cycle(async () => { requests++; return answer('accepted') },new AbortController().signal)
    expect(requests).toBe(0)
    delivery = new TelemetryDelivery(s, 'fixture', '3', () => now)
    await delivery.cycle(async () => { requests++; return answer('accepted') },new AbortController().signal)
    expect(requests).toBe(1)
  } finally { s.close() }
})

it('stops dropping at 20 per UTC day even while later mixed batches make progress', async () => {
  let now=Date.parse('2026-10-20T12:00:00Z')
  const s=new TelemetryStore(join(root(),'queue.sqlite'),()=>now)
  const events=Array.from({length:42},()=>event()),bad=new Set(events.filter((_,i)=>i%2===0).map(e=>e.eventId)),accepted=new Set<string>()
  try {
    events.forEach(e=>s.add(e))
    for(let cycle=0;cycle<40;cycle++){
      const d=new TelemetryDelivery(s,'fixture','1',()=>now)
      await d.cycle(async batch=>{if(batch.some(e=>bad.has(e.eventId)))return answer('poison');batch.forEach(e=>accepted.add(e.eventId));return answer('accepted')},new AbortController().signal)
      now+=60000
    }
    expect(accepted.size).toBe(21);expect(s.status()).toMatchObject({queued:1,dropped:20})
    const remaining=s.batch();expect(remaining).toHaveLength(1);expect(bad.has(remaining[0]!.eventId)).toBe(true)
  }finally{s.close()}
})

it('does not count local cancellation as a new failure or reset a previous failure', async () => {
  let now = Date.now()
  const s = new TelemetryStore(join(root(), 'queue.sqlite'), () => now)
  try {
    s.add(event()); const d = new TelemetryDelivery(s,'fixture','1',()=>now)
    await d.cycle(async()=>answer('retry'),new AbortController().signal)
    expect(s.get('failures')).toBe('1'); now+=60001
    const c = new AbortController(), before = s.get('retry-at')
    await d.cycle(async()=>{ c.abort('suspend'); throw Error('aborted') },c.signal)
    expect(s.get('failures')).toBe('1'); expect(s.get('retry-at')).toBe(before); expect(d.state).toBe('idle')
    await d.cycle(async()=>answer('retry'),new AbortController().signal)
    expect(s.get('failures')).toBe('2')
  } finally { s.close() }
})

it('prioritizes safe-stop phases and restricts their error categories to Quick Apply', () => {
  for (const [phase, expected] of [['needs-input','needs_input'],['needs-login','login_required'],['draft-exists','draft_exists'],['expired','expired']]) {
    expect(quickApplyTelemetryError(phase!, 'network PRIVATE_CANARY')).toBe(expected)
    expect(validTelemetryProperties('quick_apply_result',{ source:'mostaql',outcome:'failed',error:expected,duration:'under_100ms' })).toBe(true)
    expect(validTelemetryProperties('proposal_result',{ provider:'gemini',outcome:'failed',error:expected,duration:'under_100ms' })).toBe(false)
  }
})

it('guards both build entry points and dashboard writes against environment mismatch', async () => {
  const token = 'phc_synthetic_build_guard_fixture'
  const env = { RASED_ANALYTICS_BUILD_READY:'true', RASED_ANALYTICS_BUILD_TOKEN:token, RASED_ANALYTICS_BUILD_ENVIRONMENT:'qa' }
  const hashes = { qa: [createHash('sha256').update(token).digest('hex')], production: [] }
  expect(()=>analyticsBuildDefines(env,hashes)).toThrow('refused')
  expect(()=>analyticsBuildDefines({...env,CI:'true'},hashes)).not.toThrow()
  expect(()=>analyticsBuildDefines({...env,CI:'true',RASED_ANALYTICS_BUILD_ENVIRONMENT:'production'},hashes)).toThrow('refused')
  expect(()=>analyticsBuildDefines({...env,CI:'true'})).toThrow('refused')
  for (const [project,environment] of [['670811','qa'],['672766','production']]) {
    let writes=0
    await expect(installDashboards(async (_path: string, method='GET') => { if(method!=='GET')writes++;return {id:Number(project)} },environment,project)).rejects.toThrow('mismatch')
    expect(writes).toBe(0)
  }
  const sql = dashboardDefinitions().flatMap((d: {insights: {name:string;sql:string}[]})=>d.insights).find((i: {name:string})=>i.name==='Active in the last 1 / 7 / 30 days').sql
  expect(sql).toContain('active_last_30_complete_days'); expect(sql).toContain("toDate(toTimeZone(now(), 'UTC'))-30")
  expect(sql).not.toContain('INTERVAL'); expect(sql).not.toContain('active_24h')
})

it('records bounded startup diagnostics without raw errors or paths', () => {
  const p=root()
  for(let i=0;i<25;i++)recordStartupFailure(p,'later',new Error('PRIVATE_PATH_AND_KEY'))
  const text=readFileSync(join(p,'startup-failure.log'),'utf8')
  expect(text.trim().split('\n')).toHaveLength(20); expect(text).not.toContain('PRIVATE')
  expect(JSON.parse(text.trim().split('\n')[0]!)).toMatchObject({stage:'later',sqliteCode:null})
})

it('counts process startup once even when its telemetry worker recovers', async () => {
  const p=root(),entry=join(p,'sender.cjs'),log=join(p,'messages.jsonl')
  new ConsentStore(p).change('enable')
  writeFileSync(entry,`const {parentPort}=require('node:worker_threads');const fs=require('node:fs');parentPort.on('message',m=>{if(m.type==='record')fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');if(m.type==='close')parentPort.close();else parentPort.postMessage({type:'status',request:m.request,transport:'idle'})});parentPort.postMessage({type:'status',transport:'idle'});`)
  const service=new TelemetryService({root:p,entry,version:'0.8.1',language:'en',windowsFamily:'10',config:null,fixture:true,changed:()=>{}})
  const messages=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[]
  try {
    service.start(false)
    await vi.waitFor(()=>expect(messages().filter(m=>m.name==='started')).toHaveLength(1))
    const old=(service as unknown as {worker:Worker}).worker
    await old.terminate()
    await vi.waitFor(()=>expect((service as unknown as {worker:Worker|null}).worker?.threadId).toBeGreaterThan(0),{timeout:4000})
    service.record('feature_used',{feature:'bookmark',outcome:'success'})
    await vi.waitFor(()=>expect(messages().some(m=>m.name==='feature_used')).toBe(true))
    expect(messages().filter(m=>m.name==='started')).toHaveLength(1)
  }finally{await service.close()}
},8000)
