import { AiProviderError, normalizeModel, type AiModel, type AiProviderId, type AiSelection } from '../../shared/ai.js'

const MAX_BYTES = 2 * 1024 * 1024
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['proposal', 'assumptions', 'questions'],
  properties: { proposal: { type: 'string' }, assumptions: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } }
}
export interface ModelCapabilities { compatibility: AiModel['compatibility']; structured: boolean; disableThinking: boolean; outputTokens: number }
// Explicit families documented for text generation. Unknown IDs remain selectable,
// but receive no optional schema/thinking parameters until verified or catalogued.
export function modelCapabilities(selection: AiSelection, listed?: AiModel): ModelCapabilities {
  const { provider, model } = selection
  let compatibility: AiModel['compatibility'] = listed?.compatibility ?? 'unknown'
  let structured = listed?.structured ?? false
  if (provider === 'gemini' && /^gemini-2\.5-(flash|pro)(-|$)/.test(model)) { compatibility = 'supported'; structured = true }
  if (provider === 'openai' && /^(gpt-4o(?!-audio|-realtime)|gpt-4\.1)(-|$)/.test(model)) { compatibility = 'supported'; structured = true }
  if (provider === 'anthropic' && /^(claude-sonnet-4-5|claude-haiku-4-5|claude-opus-4-5|claude-opus-4-6)(-|$)/.test(model)) { compatibility = 'supported'; structured = true }
  if (listed?.structured !== undefined) structured = listed.structured
  if (listed?.compatibility === 'unsupported') compatibility = 'unsupported'
  if (/(embedding|imagen|image|dall-e|sora|tts|whisper|transcribe|realtime|audio|moderation|computer-use)/i.test(model)) compatibility = 'unsupported'
  return { compatibility, structured, disableThinking: provider === 'gemini' && /^gemini-2\.5-flash(?:-lite)?(?:-|$)/.test(model), outputTokens: provider === 'openai' ? 8192 : 4096 }
}
export function aiHeaders(provider: AiProviderId, key: string): Record<string, string> {
  if (provider === 'gemini') return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
  if (provider === 'openai') return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  return { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
}
function httpError(status: number, data: unknown): string {
  const error = data && typeof data === 'object' ? (data as { error?: { code?: unknown; type?: unknown; status?: unknown } }).error : undefined
  const code = [error?.code, error?.type, error?.status].filter(x => typeof x === 'string').join(' ')
  if (/insufficient_quota|billing|credit|quota_exceeded/i.test(code)) return 'quota-exceeded'
  if (status === 401 || /authentication_error|invalid_api_key/i.test(code)) return 'auth-rejected'
  if (status === 403) return 'access-denied'
  if (status === 404) return 'model-unavailable'
  if (status === 429) return 'rate-limited'
  if (status >= 500 || status === 529) return 'provider-unavailable'
  return 'invalid-request'
}
export async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('response-too-large') }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('invalid-response')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      if (signal.aborted) throw new Error('cancelled')
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > MAX_BYTES) throw new Error('response-too-large')
      chunks.push(next.value)
    }
    if (signal.aborted) throw new Error('cancelled')
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid-response') }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
async function request(url: string, options: RequestInit, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  if (signal.aborted) throw new Error('cancelled')
  let response: Response
  try { response = await fetchImpl(url, { ...options, signal, redirect: 'error' }) }
  catch { throw new Error(signal.aborted ? 'cancelled' : 'network-error') }
  let data: unknown
  try { data = await readBoundedJson(response, signal) }
  catch (error) {
    if (signal.aborted) throw new Error('cancelled', { cause: error })
    if (!response.ok && error instanceof Error && error.message === 'invalid-response') throw new Error(httpError(response.status, null), { cause: error })
    throw error
  }
  if (!response.ok) {
    const value = response.headers.get('retry-after')
    const seconds = value ? (/^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000)) : NaN
    throw new AiProviderError(httpError(response.status, data), Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? seconds : undefined)
  }
  return data
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function finalText(provider: AiProviderId, data: unknown): string {
  const v = record(data)
  if (provider === 'gemini') {
    if (record(v.promptFeedback).blockReason) throw new Error('response-blocked')
    const candidate = record(array(v.candidates)[0])
    if (candidate.finishReason === 'MAX_TOKENS') throw new Error('output-truncated')
    if (candidate.finishReason && candidate.finishReason !== 'STOP') throw new Error('response-blocked')
    return array(record(candidate.content).parts).map(record).filter(p => !p.thought).map(p => typeof p.text === 'string' ? p.text : '').join('')
  }
  if (provider === 'openai') {
    if (v.status === 'incomplete') throw new Error('output-truncated')
    if (v.status !== 'completed') throw new Error('response-blocked')
    const blocks = array(v.output).map(record).filter(o => o.type === 'message').flatMap(o => array(o.content)).map(record)
    if (blocks.some(p => p.type === 'refusal')) throw new Error('response-blocked')
    return blocks.filter(p => p.type === 'output_text').map(p => typeof p.text === 'string' ? p.text : '').join('')
  }
  if (v.stop_reason === 'max_tokens') throw new Error('output-truncated')
  if (v.stop_reason !== 'end_turn' && v.stop_reason !== 'stop_sequence') throw new Error('response-blocked')
  return array(v.content).map(record).filter(p => p.type === 'text').map(p => typeof p.text === 'string' ? p.text : '').join('')
}
export async function generateAiJson(selection: AiSelection, key: string, prompt: string, capabilities: ModelCapabilities, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (capabilities.compatibility === 'unsupported') throw new Error('unsupported-model')
  const { provider, model } = selection
  let url: string
  let body: Record<string, unknown>
  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    const config: Record<string, unknown> = { maxOutputTokens: capabilities.outputTokens }
    if (capabilities.structured) { config.responseMimeType = 'application/json'; config.responseJsonSchema = SCHEMA }
    if (capabilities.disableThinking) config.thinkingConfig = { thinkingBudget: 0 }
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: config }
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/responses'
    body = { model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], max_output_tokens: capabilities.outputTokens, store: false }
    if (capabilities.structured) body.text = { format: { type: 'json_schema', name: 'proposal_draft', schema: SCHEMA, strict: true } }
  } else {
    url = 'https://api.anthropic.com/v1/messages'
    body = { model, max_tokens: capabilities.outputTokens, messages: [{ role: 'user', content: prompt }] }
    if (capabilities.structured) body.output_config = { format: { type: 'json_schema', schema: SCHEMA } }
  }
  const data = await request(url, { method: 'POST', headers: aiHeaders(provider, key), body: JSON.stringify(body) }, signal, fetchImpl)
  const answer = finalText(provider, data).trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  try { return JSON.parse(answer) } catch { throw new Error('invalid-response') }
}
export async function listProviderModels(provider: AiProviderId, key: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<AiModel[]> {
  const models = new Map<string, AiModel>()
  const seen = new Set<string>()
  let cursor = ''
  for (let page = 0; page < 20; page++) {
    let url: URL
    if (provider === 'gemini') { url = new URL('https://generativelanguage.googleapis.com/v1beta/models'); url.searchParams.set('pageSize', '100'); if (cursor) url.searchParams.set('pageToken', cursor) }
    else if (provider === 'anthropic') { url = new URL('https://api.anthropic.com/v1/models'); url.searchParams.set('limit', '100'); if (cursor) url.searchParams.set('after_id', cursor) }
    else url = new URL('https://api.openai.com/v1/models')
    const data = record(await request(url.toString(), { method: 'GET', headers: aiHeaders(provider, key) }, signal, fetchImpl))
    const entries = provider === 'gemini' ? data.models : data.data
    if (!Array.isArray(entries)) throw new Error('invalid-response')
    for (const entry of entries) {
      const row = record(entry)
      const id = normalizeModel(provider, provider === 'gemini' ? row.name : row.id)
      if (!id) continue
      const base = modelCapabilities({ provider, model: id })
      if (provider === 'gemini' && Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes('generateContent')) continue
      const item: AiModel = { id, displayName: String(row.displayName ?? row.display_name ?? id).slice(0, 160), compatibility: base.compatibility, structured: base.structured }
      if (provider === 'anthropic') { item.compatibility = 'supported'; const schema = record(record(row.capabilities).structured_outputs).supported; if (typeof schema === 'boolean') item.structured = schema }
      if (base.compatibility === 'unsupported') continue
      models.set(id, item)
      if (models.size > 500) throw new Error('response-too-large')
    }
    const next = provider === 'gemini' ? data.nextPageToken : provider === 'anthropic' && data.has_more ? data.last_id : null
    if (!next) return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
    if (typeof next !== 'string' || next.length > 2048 || seen.has(next)) throw new Error('invalid-response')
    seen.add(next); cursor = next
  }
  throw new Error('response-too-large')
}
