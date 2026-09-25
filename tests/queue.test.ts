import { describe, expect, it } from 'vitest'
import { EnrichmentQueue, DETAIL_MIN_GAP_MS } from '../src/collector/enrichment.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(__dirname, 'fixtures', 'detail-sample.html'), 'utf-8')

function okFetch(htmlBody: string) {
  return async () =>
    new Response(htmlBody, { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response
}

describe('EnrichmentQueue', () => {
  it('dedupes, parses, and reports done', async () => {
    const now = 100_000
    const done: [number, boolean][] = []
    const q = new EnrichmentQueue({
      fetchImpl: okFetch(html) as unknown as typeof fetch,
      nowMs: () => now,
      onDone: (id, data) => done.push([id, data?.categorySlug === 'support'])
    })
    q.enqueue(1, 'https://mostaql.com/go/1')
    q.enqueue(1, 'https://mostaql.com/go/1')
    expect(q.size).toBe(1)
    expect(await q.pump()).toBe(true)
    expect(done).toEqual([[1, true]])
  })

  it('enforces the minimum gap between detail fetches', async () => {
    let now = 100_000
    let calls = 0
    const q = new EnrichmentQueue({
      fetchImpl: (async () => {
        calls++
        return new Response(html, { status: 200 }) as unknown as Response
      }) as unknown as typeof fetch,
      nowMs: () => now
    })
    q.enqueue(1, 'https://mostaql.com/go/1')
    q.enqueue(2, 'https://mostaql.com/go/2')
    expect(await q.pump()).toBe(true)
    expect(calls).toBe(1)
    expect(await q.pump()).toBe(false) // gap not elapsed
    now += DETAIL_MIN_GAP_MS
    expect(await q.pump()).toBe(true)
    expect(calls).toBe(2)
  })

  it('pauses on gate close and surfaces transport failures without dropping the project', async () => {
    const now = 100_000
    let open = true
    const failures: string[] = []
    const done: number[] = []
    const q = new EnrichmentQueue({
      fetchImpl: (async () => new Response('x', { status: 503 }) as unknown as Response) as unknown as typeof fetch,
      nowMs: () => now,
      gateOpen: () => open,
      onTransportFailure: (k) => failures.push(k),
      onDone: (id) => done.push(id)
    })
    q.enqueue(9, 'https://mostaql.com/go/9')
    open = false
    expect(await q.pump()).toBe(false)
    open = true
    expect(await q.pump()).toBe(true)
    expect(failures).toEqual(['http5xx'])
    expect(done).toEqual([9]) // null data -> caller marks enrichment failed, keeps project
  })

  it('rejects off-host detail urls without fetching', async () => {
    let calls = 0
    const done: number[] = []
    const q = new EnrichmentQueue({
      fetchImpl: (async () => {
        calls++
        return new Response(html, { status: 200 }) as unknown as Response
      }) as unknown as typeof fetch,
      nowMs: () => 100_000,
      onDone: (id) => done.push(id)
    })
    q.enqueue(3, 'https://evil.com/go/3')
    expect(await q.pump()).toBe(true)
    expect(calls).toBe(0)
    expect(done).toEqual([3])
  })
})
