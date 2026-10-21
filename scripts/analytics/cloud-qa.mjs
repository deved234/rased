// Explicit maintainer-only cloud QA. Not part of CI or the distributed app.
// Only a distinct, reviewed QA project may receive these synthetic fixtures.
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TELEMETRY_DISCLOSURE } from '../../src/shared/telemetry.ts'
import { assertReviewedIngest } from './destinations.mjs'

export function verifyQaDestination(project, details, token) {
  if (!/^\d{1,12}$/.test(project ?? '') || project === '670811' || String(details?.id) !== project || details?.api_token !== token || !/^phc_[A-Za-z0-9_-]{10,200}$/.test(token ?? '')) throw Error('QA destination mismatch; refusing capture')
}
export async function verifyQaMetrics(client, reference, eventRows = 18) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(reference ?? '')) throw Error('Invalid synthetic reference')
  const filter = `raw.distinct_id='${reference}' AND raw.properties.environment='qa' AND raw.properties.record_type='app' AND raw.timestamp>=now()-INTERVAL 1 DAY`
  const events = `(SELECT raw.uuid AS uuid,argMax(raw.event,raw.timestamp) AS event,argMax(raw.properties,raw.timestamp) AS properties,argMax(raw.distinct_id,raw.timestamp) AS distinct_id FROM events AS raw WHERE ${filter} GROUP BY raw.uuid)`
  const query = async sql => {
    const result = await client('/query/', 'POST', { query: { kind: 'HogQLQuery', query: sql }, refresh: 'force_blocking' })
    if (!Array.isArray(result?.results)) throw Error('Cloud query is incomplete')
    return result.results
  }
  const totals = await query(`SELECT event,count(),sum(toInt(properties.event_count)) FROM ${events} GROUP BY event ORDER BY event`)
  if (![18,50].includes(eventRows)) throw Error('Invalid QA fixture size')
  const expected = { analytics_enrolled: 1, version_first_seen: 1, started: 1, active_daily: 2, project_open_result: 1, quick_apply_result: 2, proposal_result: 3, feature_used: 4 + eventRows - 18, update_download_result: 1, monitoring_hourly: 1, notification_summary: 1 }
  assert.equal(totals.length, Object.keys(expected).length)
  for (const [event, rows, count] of totals) { const n = expected[event.replace('rased.app.', '')]; assert.ok(n); assert.equal(Number(rows), n); assert.equal(Number(count), n) }
  const sources = ['mostaql','khamsat','nafezly','kaf']
  const counters = await query(`SELECT ${sources.map(s => `sum(coalesce(toInt(properties.${s}_success),0))`).join(',')} FROM ${events} WHERE event='rased.app.monitoring_hourly'`)
  assert.deepEqual(counters.map(row => row.map(Number)), [[3,3,3,3]])
  const notifications = await query(`SELECT sum(coalesce(toInt(properties.mostaql_shown),0)),sum(coalesce(toInt(properties.mostaql_activated),0)) FROM ${events} WHERE event='rased.app.notification_summary'`)
  assert.deepEqual(notifications.map(row => row.map(Number)), [[1,1]])
  const active = await query(`SELECT uniqExact(distinct_id) FROM ${events} WHERE event='rased.app.active_daily'`)
  assert.deepEqual(active.map(row => row.map(Number)), [[1]])
  return { eventRows, activeInstallations: 1, sourceSuccesses: [3,3,3,3], notificationShown: 1, notificationActivated: 1, metricsVerified: true }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
export function verifyReviewedQaToken(project, token) {
  assertReviewedIngest(project, 'qa', token)
}
export async function runCloudQa(client, project, token, eventRows = 18, captureOnly = false) {
  if (![18,50].includes(eventRows)) throw Error('Invalid QA fixture size')
  if (captureOnly) verifyReviewedQaToken(project, token)
  else verifyQaDestination(project, await client('/'), token)
  const root = mkdtempSync(join(tmpdir(), 'rased-test-cloud-qa-')), directory = join(root, 'telemetry')
  mkdirSync(directory)
  writeFileSync(join(root, '.rased-test-profile'), 'Synthetic PostHog cloud QA only')
  const reference = randomUUID(), version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const consent = { state: 'enabled', identity: reference, disclosure: TELEMETRY_DISCLOSURE, generation: 1, prompted: true }
  const data = { directory, consent, config: { host: 'https://us.i.posthog.com', environment: 'qa', token }, context: { appVersion: version, environment: 'qa', language: 'en', windowsFamily: '10' } }
  const entry = resolve('out/main/telemetryWorker.js')
  let worker, messages = [], request = 0, error
  const until = async (condition, timeout = 10000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (error) throw Error('Cloud QA worker failed'); const value = condition(); if (value) return value; await wait(50) }
    throw Error('Cloud QA timed out; production remains gated')
  }
  const boot = replay => {
    messages = []; error = null
    worker = new Worker(`
      const {parentPort}=require('node:worker_threads'); const original=fetch; let lost=false;
      globalThis.fetch=async(url,init)=>{
        const response=await original(url,init);
        parentPort.postMessage({type:'qa-http',ids:JSON.parse(init.body).batch.map(e=>e.uuid)});
        if (${replay} && response.ok && !lost) { lost=true; parentPort.postMessage({type:'qa-lost-ack'}); throw Error('Synthetic lost acknowledgement') }
        return response;
      };
      require(${JSON.stringify(entry)});
    `, { eval: true, workerData: data })
    worker.on('message', message => messages.push(message))
    worker.on('error', () => { error = true })
  }
  const command = async message => {
    const id = ++request
    worker.postMessage({ ...message, request: id })
    return until(() => messages.find(m => m.type === 'status' && m.request === id))
  }
  const stop = async () => {
    const closing = worker
    if (!closing) return
    worker = null
    closing.postMessage({ type: 'close' })
    await new Promise(resolve => { const timer = setTimeout(() => { void closing.terminate().then(resolve) }, 1000); closing.once('exit', () => { clearTimeout(timer); resolve() }) })
  }
  try {
    boot(false); await until(() => messages.some(m => m.type === 'status'))
    const record = (name, properties, once) => worker.postMessage({ type: 'record', generation: 1, name, properties, once })
    record('started', { launch_kind: 'normal' })
    for (let n = 0; n < 2; n++) record('active_daily', { activity_kind: 'interface' }, 'active:cloud-qa:interface')
    record('active_daily', { activity_kind: 'monitoring' }, 'active:cloud-qa:monitoring')
    record('project_open_result', { source: 'mostaql', entry: 'notification', launch: 'accepted', foreground: 'confirmed', duration: 'under_100ms' })
    for (const source of ['mostaql','nafezly']) record('quick_apply_result', { source, outcome: 'success', error: 'none', duration: '100_500ms' })
    for (const provider of ['gemini','openai','anthropic']) record('proposal_result', { provider, outcome: 'success', error: 'none', duration: '500ms_2s' })
    for (const feature of ['bookmark','saved_filter','backup_created','restore_requested']) record('feature_used', { feature, outcome: 'success' })
    for (let n = 18; n < eventRows; n++) record('feature_used', { feature: 'bookmark', outcome: 'success' })
    record('update_download_result', { target_version: version, outcome: 'success', error: 'none' })
    for (const source of ['mostaql','khamsat','nafezly','kaf']) for (let n = 0; n < 3; n++) worker.postMessage({ type: 'counter', generation: 1, name: 'monitoring_hourly', field: source + '_success' })
    for (const kind of ['requested','shown','activated']) worker.postMessage({ type: 'counter', generation: 1, name: 'notification_summary', field: 'mostaql_' + kind })
    // Closing seals the actual worker's current-hour buckets before sending.
    await stop()
    const db = new DatabaseSync(join(directory, 'queue.sqlite'))
    const expected = db.prepare('SELECT body FROM queue').all().map(row => JSON.parse(row.body)); db.close()
    writeFileSync(join(root, 'cloud-qa-expected.json'), JSON.stringify(expected, null, 2))
    assert.equal(expected.length, eventRows)
    boot(true); await until(() => messages.some(m => m.type === 'status'))
    await command({ type: 'flush' })
    await until(() => messages.some(m => m.type === 'qa-lost-ack'))
    const deadline = Date.now() + 60000
    while (Date.now() < deadline && !messages.some(m => m.type === 'status' && m.queued === 0)) { await wait(1000); await command({ type: 'flush' }) }
    assert.ok(messages.some(m => m.type === 'status' && m.queued === 0), 'Cloud retry was not acknowledged')
    const calls = messages.filter(m => m.type === 'qa-http')
    assert.ok(calls.length >= 2, 'Retry must actually reach the ingest API')
    assert.deepEqual(calls[0].ids, calls[1].ids)
    await command({ type: 'consent', consent: { ...consent, state: 'disabled', generation: 2 } })
    const before = calls.length
    record('feature_used', { feature: 'bookmark', outcome: 'success' })
    await command({ type: 'flush' })
    assert.equal(messages.filter(m => m.type === 'qa-http').length, before)
    await stop()
    if (captureOnly) {
      const result = { project, reference, root, expectedRows: expected.length, replaySentWithSameIds: true, httpRequests: calls.length, queryVerified: false, deletionVerified: false }
      writeFileSync(join(root, 'cloud-qa-capture.json'), JSON.stringify(result, null, 2))
      return result // Querying and deletion require independent cloud evidence.
    }
    const query = async sql => {
      const result = await client('/query/', 'POST', { query: { kind: 'HogQLQuery', query: sql }, refresh: 'force_blocking' })
      if (!Array.isArray(result?.results)) throw Error('Cloud query not complete; do not infer success')
      return result.results
    }
    let rows = []
    for (let n = 0; n < 6; n++) {
      rows = await query(`SELECT uuid,argMax(event,timestamp) AS event,argMax(properties,timestamp) AS properties FROM events WHERE distinct_id='${reference}' AND timestamp>=now()-INTERVAL 1 DAY GROUP BY uuid ORDER BY event LIMIT 100`)
      if (rows.length === expected.length) break
      await wait(10000)
    }
    assert.equal(rows.length, expected.length, 'Queryable rows must match fixtures after retry deduplication')
    const expectedIds = new Map(expected.map(e => [e.eventId, e]))
    for (const [id, name, raw] of rows) {
      const original = expectedIds.get(id)
      assert.ok(original, 'Unexpected or duplicated event UUID'); expectedIds.delete(id)
      const props = typeof raw === 'string' ? JSON.parse(raw) : raw
      assert.equal(props.environment, 'qa'); assert.equal(props.record_type, 'app')
      assert.equal(name, 'rased.app.' + original.name)
      assert.equal(props.event_count, original.count)
      for (const [key, value] of Object.entries(original.properties)) assert.equal(props[key], value)
      for (const forbidden of ['$ip','$geoip_country_name','$geoip_city_name','title','url','projectId','note','apiKey','model']) assert.ok(!props[forbidden], 'Unexpected sensitive property')
    }
    assert.equal(expectedIds.size, 0)
    const people = await client(`/persons/?distinct_id=${reference}`)
    const person = people?.results?.find(p => p.distinct_ids?.length === 1 && p.distinct_ids[0] === reference)
    if (!person?.id) throw Error('No individually deletable synthetic profile was created')
    const metrics = await verifyQaMetrics(client, reference, eventRows)
    const result = { project, reference, personId: person.uuid ?? person.id, root, uniqueRows: rows.length, replaySafeQueries: true, propertyChecks: true, metrics, requestedAt: null }
    writeFileSync(join(root, 'cloud-qa-receipt.json'), JSON.stringify(result, null, 2))
    return result
  } finally { await stop() }
}
