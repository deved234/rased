// Explicit opt-in for integration tests, isolated to a newly marked TEMP profile.
// No test channel is exposed to renderer; only network/OS boundaries are replaced.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import type { UpdaterPort } from './updates.js'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

export function isolatedTestHarness(profile: string, argv: string[]): null | {
  fetchImpl: typeof fetch
  aiFetchImpl: typeof fetch
  record: (kind: string, data: unknown) => void
} {
  const rel = relative(resolve(tmpdir()), resolve(profile))
  if (!argv.includes('--rased-test') || rel.startsWith('..') || isAbsolute(rel) || rel === '' || !basename(profile).startsWith('rased-test-')) return null
  const marker = join(profile, '.rased-test-profile')
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== 'RASED isolated integration test') return null
  const record = (kind: string, data: unknown): void => {
    appendFileSync(join(profile, 'test-trace.jsonl'), JSON.stringify({ kind, data }) + '\n')
  }
  const fetchImpl = (async (url, options) => {
    record('fetch', String(url))
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (String(url) === 'https://khamsat.com/community/requests') return new Response(readFileSync(join(profile, 'khamsat-fixture.html'), 'utf8'), { status: 200, headers: { 'content-type': 'text/html' } })
    if (String(url) === 'https://nafezly.com/feed') return new Response(readFileSync(join(profile, 'nafezly-fixture.xml'), 'utf8'), { status: 200, headers: { 'content-type': 'text/xml' } })
    const rss = String(url).endsWith('/rss')
    return new Response(readFileSync(join(profile, rss ? 'rss-fixture.xml' : 'detail-fixture.html'), 'utf8'), { status: 200, headers: { 'content-type': rss ? 'application/rss+xml' : 'text/html' } })
  }) as typeof fetch
  const aiFetchImpl = (async (input, options) => {
    const url = new URL(String(input))
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const provider = url.hostname === 'generativelanguage.googleapis.com' ? 'gemini' : url.hostname === 'api.openai.com' ? 'openai' : url.hostname === 'api.anthropic.com' ? 'anthropic' : null
    if (!provider) throw Error('Unexpected test destination')
    const configPath = join(profile, 'ai-fixture.json')
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) as { delay?: number; status?: number } : {}
    if (config.delay) await new Promise<void>((resolve, reject) => {
      const abort = (): void => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
      const timer = setTimeout(() => { options?.signal?.removeEventListener('abort', abort); resolve() }, config.delay)
      options?.signal?.addEventListener('abort', abort, { once: true })
    })
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : null
    record('ai-request', { provider, method: options?.method, model: body?.model ?? url.pathname.split('/').at(-1)?.split(':')[0], synthetic: JSON.stringify(body).includes('Synthetic test profile only') })
    if (config.status) return new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), { status: config.status })
    if (options?.method === 'GET') {
      const data = provider === 'gemini' ? { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }] } : provider === 'openai' ? { data: [{ id: 'gpt-4.1-mini' }] } : { data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', capabilities: { structured_outputs: { supported: true } } }], has_more: false }
      return new Response(JSON.stringify(data))
    }
    if (provider === 'gemini') record('gemini-generate', String(input))
    const text = JSON.stringify({ proposal: 'A focused proposal for the review project.', assumptions: ['Confirm scope'], questions: ['What is the deadline?'] })
    const data = provider === 'gemini' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] } : provider === 'openai' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text }] }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, aiFetchImpl, record }
}

/** Only constructed after isolatedTestHarness validated the opt-in TEMP marker. */
export function testUpdater(profile: string, record: (kind: string, data: unknown) => void): UpdaterPort {
  class FixtureUpdater extends EventEmitter implements UpdaterPort {
    autoDownload = false
    autoInstallOnAppQuit = false
    allowPrerelease = false
    allowDowngrade = false
    private info(): { version: string; releaseNotes: string; error?: string } | null {
      const file = join(profile, 'update-fixture.json')
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { version: string; releaseNotes: string; error?: string } : null
    }
    async checkForUpdates(): Promise<void> {
      record('update-check', true); this.emit('checking-for-update')
      await new Promise(resolve => setTimeout(resolve, 100))
      const info = this.info()
      if (info?.error === 'check') throw Error('Fixture network unavailable')
      this.emit(info ? 'update-available' : 'update-not-available', info)
    }
    async downloadUpdate(): Promise<void> {
      record('update-download', true)
      await new Promise(resolve => setTimeout(resolve, 100))
      this.emit('download-progress', { percent: 42, transferred: 42, total: 100 })
      await new Promise(resolve => setTimeout(resolve, 400))
      const info = this.info()
      if (info?.error === 'download') throw Error('Fixture download failed')
      this.emit('update-downloaded', info)
    }
    quitAndInstall(silent: boolean, relaunch: boolean): void { record('update-install', { silent, relaunch }) }
  }
  return new FixtureUpdater()
}
