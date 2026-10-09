import { describe, expect, it, vi } from 'vitest'
import { generateAiJson, listProviderModels, modelCapabilities, readBoundedJson } from '../src/main/ai/providers.js'
import { normalizeModel, retryAfter, sanitizeAiSettings, sanitizeSelection, type AiProviderId } from '../src/shared/ai.js'

const draft = { proposal: 'عرض واضح / focused proposal', assumptions: ['Scope'], questions: ['Deadline?'] }
const text = JSON.stringify(draft)
function output(provider: AiProviderId, answer = text): unknown {
  return provider === 'gemini' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private reasoning' }, { text: answer }] } }] } : provider === 'openai' ? { status: 'completed', output: [{ type: 'reasoning', content: [{ text: 'ignore' }] }, { type: 'message', content: [{ type: 'output_text', text: answer }] }] } : { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'ignore' }, { type: 'text', text: answer }] }
}
function transport(data: unknown, status = 200): typeof fetch { return vi.fn(async () => new Response(JSON.stringify(data), { status })) as typeof fetch }
const models = { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini', anthropic: 'claude-sonnet-4-5' }
const signal = (): AbortSignal => new AbortController().signal
describe('AI provider REST contracts', () => {
  for (const provider of ['gemini', 'openai', 'anthropic'] as const) {
    it(`${provider}: builds the official request and extracts final text only`, async () => {
      const selection = { provider, model: models[provider] }
      const mock = transport(output(provider))
      expect(await generateAiJson(selection, `fake-${provider}-key`, 'Approved prompt', modelCapabilities(selection), signal(), mock)).toEqual(draft)
      const [url, init] = vi.mocked(mock).mock.calls[0]!
      const body = JSON.parse(String(init?.body))
      expect(init?.redirect).toBe('error')
      expect(init?.method).toBe('POST')
      expect(JSON.stringify(body)).not.toContain(`fake-${provider}-key`)
      expect(init?.headers).toEqual(expect.objectContaining(provider === 'gemini' ? { 'x-goog-api-key': 'fake-gemini-key' } : provider === 'openai' ? { Authorization: 'Bearer fake-openai-key' } : { 'x-api-key': 'fake-anthropic-key', 'anthropic-version': '2023-06-01' }))
      expect(Object.keys(init!.headers!)).not.toContain(provider === 'openai' ? 'x-goog-api-key' : 'Authorization')
      if (provider === 'gemini') { expect(String(url)).toContain('generativelanguage.googleapis.com'); expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 }); expect(body.generationConfig.responseJsonSchema.required).toHaveLength(3) }
      if (provider === 'openai') { expect(url).toBe('https://api.openai.com/v1/responses'); expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true); expect(body.temperature).toBeUndefined() }
      if (provider === 'anthropic') { expect(url).toBe('https://api.anthropic.com/v1/messages'); expect(body.output_config.format.type).toBe('json_schema'); expect(body.thinking).toBeUndefined() }
    })
    it(`${provider}: accepts one JSON fence and never retries an invalid answer`, async () => {
      const selection = { provider, model: models[provider] }
      expect(await generateAiJson(selection, 'fake-key', 'prompt', modelCapabilities(selection), signal(), transport(output(provider, '```json\n' + text + '\n```')))).toEqual(draft)
      const bad = transport(output(provider, 'prefix ' + text))
      await expect(generateAiJson(selection, 'fake-key', 'prompt', modelCapabilities(selection), signal(), bad)).rejects.toThrow('invalid-response')
      expect(bad).toHaveBeenCalledTimes(1)
    })
    it(`${provider}: unknown models omit unverified optional parameters`, async () => {
      const selection = { provider, model: 'future-model' }
      const mock = transport(output(provider))
      await generateAiJson(selection, 'fake-key', 'prompt', modelCapabilities(selection), signal(), mock)
      const body = JSON.parse(String(vi.mocked(mock).mock.calls[0]![1]?.body))
      expect(body.text).toBeUndefined(); expect(body.output_config).toBeUndefined()
      expect(body.generationConfig?.thinkingConfig).toBeUndefined(); expect(body.generationConfig?.responseJsonSchema).toBeUndefined()
    })
  }
  it.each([
    [401, {}, 'auth-rejected'], [403, {}, 'access-denied'], [404, {}, 'model-unavailable'],
    [400, {}, 'invalid-request'], [429, { error: { code: 'insufficient_quota' } }, 'quota-exceeded'],
    [429, { error: { type: 'rate_limit_error' } }, 'rate-limited'], [503, {}, 'provider-unavailable']
  ])('maps HTTP %s without leaking the body', async (status, data, code) => {
    const selection = { provider: 'openai' as const, model: models.openai }
    await expect(generateAiJson(selection, 'fake-key', 'prompt', modelCapabilities(selection), signal(), transport(data, status))).rejects.toThrow(String(code))
  })
  it.each([
    ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'output-truncated'],
    ['gemini', { promptFeedback: { blockReason: 'SAFETY' } }, 'response-blocked'],
    ['openai', { status: 'incomplete', output: [] }, 'output-truncated'],
    ['openai', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, 'response-blocked'],
    ['anthropic', { stop_reason: 'max_tokens' }, 'output-truncated'],
    ['anthropic', { stop_reason: 'refusal' }, 'response-blocked']
  ])('%s distinguishes truncation/refusal', async (p, data, code) => {
    const selection = { provider: p as AiProviderId, model: models[p as AiProviderId] }
    await expect(generateAiJson(selection, 'fake-key', 'prompt', modelCapabilities(selection), signal(), transport(data))).rejects.toThrow(code)
  })
  it('rejects non-text models before any network request', async () => {
    const selection = { provider: 'openai' as const, model: 'text-embedding-3-small' }
    const mock = transport({})
    await expect(generateAiJson(selection, 'fake', 'prompt', modelCapabilities(selection), signal(), mock)).rejects.toThrow('unsupported-model')
    expect(mock).not.toHaveBeenCalled()
  })
  it('retains a bounded Retry-After hint without retrying automatically', async () => {
    const selection = { provider: 'openai' as const, model: models.openai }
    const mock = vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } })) as typeof fetch
    let failure: unknown
    try { await generateAiJson(selection, 'fake', 'prompt', modelCapabilities(selection), signal(), mock) } catch (error) { failure = error }
    expect(retryAfter(failure)).toBe(30)
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('bounds response bytes and observes cancellation', async () => {
    await expect(readBoundedJson(new Response('x'.repeat(2 * 1024 * 1024 + 1)), signal())).rejects.toThrow('response-too-large')
    const controller = new AbortController(); controller.abort()
    const selection = { provider: 'openai' as const, model: models.openai }
    const mock = transport({})
    await expect(generateAiJson(selection, 'fake', 'prompt', modelCapabilities(selection), controller.signal, mock)).rejects.toThrow('cancelled')
    expect(mock).not.toHaveBeenCalled()
  })
})
describe('model catalogs and validation', () => {
  it('normalizes Gemini IDs but rejects URLs, path traversal and invalid settings', () => {
    expect(normalizeModel('gemini', 'models/gemini-2.5-flash')).toBe(models.gemini)
    for (const id of ['../model', 'https://evil.test', 'model?key=secret', 'a\nb']) expect(sanitizeSelection({ provider: 'gemini', model: id })).toBeNull()
    expect(sanitizeSelection({ provider: 'evil', model: 'test' })).toBeNull()
    expect(sanitizeAiSettings({ schemaVersion: 1, activeProvider: 'gemini', modelByProvider: { gemini: models.gemini } })).toBeNull()
  })
  it('paginates Gemini and filters unsupported generation methods', async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }))).mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/future-text-model', supportedGenerationMethods: ['generateContent'] }] })))
    const rows = await listProviderModels('gemini', 'fake', signal(), mock as typeof fetch)
    expect(rows.map(m => m.id)).toEqual(['future-text-model', models.gemini]); expect(String(mock.mock.calls[1]![0])).toContain('pageToken=next')
  })
  it('uses Claude capability metadata and its pagination cursor', async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude-new', capabilities: { structured_outputs: { supported: true } } }], has_more: true, last_id: 'claude-new' }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [], has_more: false })))
    const rows = await listProviderModels('anthropic', 'fake', signal(), mock as typeof fetch)
    expect(rows[0]?.structured).toBe(true); expect(String(mock.mock.calls[1]![0])).toContain('after_id=claude-new')
    expect(modelCapabilities({ provider: 'anthropic', model: 'claude-new' }, rows[0]).structured).toBe(true)
  })
  it('filters OpenAI non-text catalog entries and leaves unknown IDs unverified', async () => {
    const rows = await listProviderModels('openai', 'fake', signal(), transport({ data: [{ id: 'gpt-4.1-mini' }, { id: 'text-embedding-3-small' }, { id: 'future-model' }] }))
    expect(rows).toHaveLength(2); expect(rows.find(m => m.id === 'future-model')?.compatibility).toBe('unknown')
  })
  it('rejects repeated pagination and preserves explicitly disabled structured output', async () => {
    await expect(listProviderModels('gemini', 'fake', signal(), transport({ models: [], nextPageToken: 'repeat' }))).rejects.toThrow('invalid-response')
    expect(modelCapabilities({ provider: 'anthropic', model: models.anthropic }, { id: models.anthropic, displayName: 'test', compatibility: 'supported', structured: false }).structured).toBe(false)
  })
})
