import { parentPort, workerData } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { TelemetryStore } from '../../storage/telemetryStore.js'
import { TELEMETRY_DISCLOSURE, validTelemetryProperties, type TelemetryEnvelope, type TelemetryName } from '../../shared/telemetry.js'
import type { TelemetryMessage, TelemetryWorkerData } from './protocol.js'
import { sendPosthog, type SendResult } from './transports/posthog.js'
import { TelemetryDelivery } from './delivery.js'

const options = workerData as TelemetryWorkerData
const store = new TelemetryStore(join(options.directory, 'queue.sqlite'))
let consent = options.consent, suspended = false, closed = false, controller: AbortController | null = null
let flight: Promise<void> | null = null
const fixtureControl = join(options.directory, '../telemetry-fixture.json')
function fixture(): { purgeFail?: boolean; purgeDelay?: number; purgeAckDelay?: number } {
  if (!options.fixture || !existsSync(fixtureControl)) return {}
  try { return JSON.parse(readFileSync(fixtureControl, 'utf8')) } catch { return {} }
}
async function purge(): Promise<void> {
  const control = fixture()
  if (control.purgeDelay) await new Promise(resolve => setTimeout(resolve, Math.min(control.purgeDelay!, 35000)))
  if (control.purgeFail) throw Error('forget-incomplete')
  store.purge()
}
if (options.purgeOnly) {
  const run = async (): Promise<void> => {
    const delay = fixture().purgeAckDelay
    if (delay) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 6000)))
    parentPort?.postMessage({ type: 'ack' })
    await purge()
  }
  void run().then(() => { store.close(); parentPort?.postMessage({ type: 'purged' }); parentPort?.close() }).catch(() => { store.close(); parentPort?.postMessage({ type: 'purge-failed' }); parentPort?.close() })
} else {
  store.bind(consent.identity, enabled())
  let delivery = new TelemetryDelivery(store, options.config, options.context.appVersion + ':1')
  const publish = (request?: number, failed = false): void => { parentPort?.postMessage({ type: 'status', request, failed, ...store.status(), transport: options.config || options.fixture ? delivery.state : 'unavailable', lastAcceptedAt: delivery.lastAccepted }) }
  function envelope(name: TelemetryName, properties: Record<string, string | number>, hour = false): TelemetryEnvelope {
    const unit = hour ? 3600000 : 60000
    return { ...options.context, schemaVersion: 1, eventId: randomUUID(), distinctId: consent.identity!, name, properties, occurredAt: new Date(Math.floor(Date.now() / unit) * unit).toISOString(), count: 1 }
  }
  function record(name: TelemetryName, properties: Record<string, string | number>, once?: string): void {
    if (enabled() && validTelemetryProperties(name, properties)) store.add(envelope(name, properties), once)
  }
  function version(): void {
    if (!enabled()) return
    record('analytics_enrolled', { disclosure: TELEMETRY_DISCLOSURE }, 'enrolled')
    const previous = store.get('last-version'), current = options.context.appVersion
    if (previous === current) return
    record('version_first_seen', { transition: previous ? current.localeCompare(previous, 'en', { numeric: true }) > 0 ? 'upgrade' : 'downgrade' : 'first_observed', ...(previous ? { previous_version: previous } : {}) })
    store.set('last-version', current)
  }
  function flush(): Promise<void> {
    if (flight) return flight
    flight = performFlush().finally(() => { flight = null })
    return flight
  }
  async function performFlush(): Promise<void> {
    if (!enabled() || suspended || controller) return
    const active = new AbortController(), epoch = consent.generation
    controller = active
    try {
      await delivery.cycle(async batch => {
        if (!enabled() || epoch !== consent.generation) { active.abort('consent'); throw Error('cancelled') }
        const request = new AbortController()
        const cancel = (): void => request.abort(active.signal.reason)
        active.signal.addEventListener('abort', cancel, { once: true })
        const timer = setTimeout(() => request.abort('timeout'), 5000)
        try {
          publish()
          if (options.fixture && !options.config) {
            // The fixture sink is not application-owned telemetry state.
            const sink = join(options.directory, '../telemetry-fixture-sink')
            mkdirSync(sink, { recursive: true })
            appendFileSync(join(sink, 'fixture-events.jsonl'), batch.map(e => JSON.stringify(e)).join('\n') + '\n')
            return { kind: 'accepted', accepted: true, permanent: false } as SendResult
          }
          return await sendPosthog(options.config!, batch, request.signal)
        } catch (error) {
          // A timeout is a failed attempt. Local cancellation is not.
          if (request.signal.reason === 'timeout') return { kind: 'retry', accepted: false, permanent: false } as SendResult
          throw error
        } finally { clearTimeout(timer); active.signal.removeEventListener('abort', cancel) }
      }, active.signal)
    } finally { if (controller === active) controller = null; if (!closed) publish() }
  }
  version()
  const interval = setInterval(() => { if (!closed) { store.seal(); void flush().catch(() => { publish() }) } }, 60000 + Math.floor(Math.random() * 10000))
  async function handle(message: TelemetryMessage): Promise<void> {
    try {
      if (message.type === 'consent') {
        controller?.abort('consent')
        await flight
        const replaced = consent.identity !== message.consent.identity
        consent = message.consent
        // Abort completion must not touch a cleared store while a new sender starts.
        store.bind(consent.identity, enabled())
        if (replaced) delivery = new TelemetryDelivery(store, options.config, options.context.appVersion + ':1')
        else if (delivery.state === 'sending') delivery.state = 'idle'
        version(); publish(message.request)
      } else if (message.type === 'purge') {
        controller?.abort('consent'); parentPort?.postMessage({ type: 'ack', request: message.request })
        void purge().then(() => publish(message.request)).catch(() => publish(message.request, true))
      } else if (message.type === 'record' && message.generation === consent.generation) record(message.name, message.properties, message.once)
      else if (message.type === 'counter' && message.generation === consent.generation && enabled()) {
        const e = envelope(message.name, { [message.field]: 1 }, true)
        store.counter(message.name, message.name + ':' + e.occurredAt, message.field, e)
      } else if (message.type === 'context') options.context.language = message.language
      else if (message.type === 'suspend') { suspended = true; controller?.abort('suspend') }
      else if (message.type === 'resume') { suspended = false; delivery.resume() }
      else if (message.type === 'reset') { controller?.abort('consent'); await flight; store.clear(); publish(message.request) }
      else if (message.type === 'flush') { void flush(); publish(message.request) }
      else if (message.type === 'close') {
        closed = true; controller?.abort('close'); clearInterval(interval); await flight; store.seal(true); store.close(); parentPort?.postMessage({ type: 'closed' }); parentPort?.close()
      }
    } catch { publish('request' in message ? message.request : undefined, true) }
  }
  parentPort?.on('message', (message: TelemetryMessage) => { void handle(message) })
  publish()
}
function enabled(): boolean { return (options.config !== null || options.fixture === true) && consent.state === 'enabled' && !consent.purgePending && consent.disclosure === TELEMETRY_DISCLOSURE && !!consent.identity && !closed }
