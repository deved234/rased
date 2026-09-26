// Explicit opt-in for integration tests, isolated to a newly marked TEMP profile.
// No test channel is exposed to renderer; only network/OS boundaries are replaced.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

export function isolatedTestHarness(profile: string, argv: string[]): null | {
  fetchImpl: typeof fetch
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
    const rss = String(url).endsWith('/rss')
    return new Response(readFileSync(join(profile, rss ? 'rss-fixture.xml' : 'detail-fixture.html'), 'utf8'), { status: 200, headers: { 'content-type': rss ? 'application/rss+xml' : 'text/html' } })
  }) as typeof fetch
  return { fetchImpl, record }
}
