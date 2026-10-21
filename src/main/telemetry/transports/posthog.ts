import { validTelemetryEnvelope, type TelemetryEnvelope } from '../../../shared/telemetry.js'
import type { TelemetryConfig } from '../config.js'

export interface SendResult { kind: 'accepted' | 'retry' | 'auth' | 'poison' | 'too_large' | 'quota'; accepted: boolean; permanent: boolean; retryAfterMs?: number }
export function posthogEvent(e: TelemetryEnvelope): object {
  if (!validTelemetryEnvelope(e)) throw Error('invalid-telemetry')
  return { uuid: e.eventId, event: 'rased.app.' + e.name, timestamp: e.occurredAt, properties: {
    distinct_id: e.distinctId, ...e.properties, schema_version: e.schemaVersion, record_type: 'app',
    environment: e.environment, app_version: e.appVersion, language: e.language, windows_family: e.windowsFamily,
    event_count: e.count, $geoip_disable: true, $process_person_profile: true
  } }
}
export async function sendPosthog(config: TelemetryConfig, events: TelemetryEnvelope[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SendResult> {
  if (config.host !== 'https://us.i.posthog.com' || !events.length || events.length > 50 || events.some(e => e.environment !== config.environment)) throw Error('invalid-telemetry-destination')
  const response = await fetcher(config.host + '/batch/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: config.token, batch: events.map(posthogEvent) }), signal, redirect: 'error' })
  // The capture API acknowledges ingestion, not a queryable row. Never upload
  // response bodies to diagnostics; they may echo submitted data.
  const text = (await response.text()).slice(0, 4096)
  let accepted = false
  let limited = false
  try {
    const ack = JSON.parse(text) as { status?: unknown; quota_limited?: unknown }
    limited = Array.isArray(ack.quota_limited) ? ack.quota_limited.length > 0 : !!ack.quota_limited
    accepted = response.ok && !limited && (ack.status === 1 || ack.status === 'Ok')
  } catch { /* No success inference from HTTP alone. */ }
  const retry = response.headers.get('retry-after')
  const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0
  const kind = accepted ? 'accepted' : response.ok && limited ? 'quota' : [401, 403].includes(response.status) ? 'auth' : [400, 422].includes(response.status) ? 'poison' : response.status === 413 ? 'too_large' : 'retry'
  const ordinary4xx = response.status >= 400 && response.status < 500 && ![400,401,403,408,413,422,429].includes(response.status)
  return { kind, accepted, permanent: kind === 'auth', retryAfterMs: Math.max(Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86400000) : 0, ordinary4xx || kind === 'quota' ? 3600000 : 0) || undefined }
}
