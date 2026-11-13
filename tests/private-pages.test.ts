import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPrivateProjectPage, parseWatchPage, PRIVATE_PAGE_MAX_CHARS, PRIVATE_PAGE_MAX_TAGS } from '../src/collector/projectWatch.js'
import { fetchDetail } from '../src/collector/enrichment.js'
import { fetchKafHtml, KafFetchError, parseKafList } from '../src/collector/kaf.js'
import { KafController } from '../src/main/kaf.js'
import { ProjectFactsFetcher } from '../src/main/projectFactsFetcher.js'
import { openDatabase, type Db } from '../src/storage/db.js'
import { projectFacts } from '../src/storage/projectFacts.js'
import { getProjectDetailsRow, getSourceState, upsertProjectsBatch, upsertProjectDetails } from '../src/storage/repositories.js'
import { applyKafCycle } from '../src/collector/kafCycle.js'
import { defaultSettings } from '../src/shared/types.js'

const nafezlyPrivate = readFileSync('tests/fixtures/watch/nafezly-private-403.html', 'utf8')
const kafPrivate = readFileSync('tests/fixtures/watch/kaf-private-403.html', 'utf8')
const kafList = readFileSync('tests/fixtures/kaf-list.html', 'utf8')

let db: Db | undefined, dir: string | undefined
function getDb(source = 'nafezly'): Db {
  dir = mkdtempSync(join(tmpdir(), 'rased-private-unit-'))
  db = openDatabase(join(dir, 'test.db'))
  if (source === 'nafezly') {
    upsertProjectsBatch(db, [{ source: 'nafezly', externalId: '123', url: 'https://nafezly.com/project/123-sample', title: 'Test', descriptionExcerpt: 'Excerpt', publishedAt: null, publishedRaw: null }], { now: new Date().toISOString(), discoveryKind: 'initial' })
  }
  return db
}

afterEach(() => {
  vi.useRealTimers()
  if (db?.isOpen) db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
  db = undefined
  dir = undefined
})

describe('Private project page detection and handling', () => {
  it('a. isPrivateProjectPage identifies fixtures and rejects challenges/generic 403', () => {
    expect(isPrivateProjectPage(nafezlyPrivate, 'nafezly')).toBe(true)
    expect(isPrivateProjectPage(nafezlyPrivate, 'kaf')).toBe(false)
    expect(isPrivateProjectPage(kafPrivate, 'kaf')).toBe(true)
    expect(isPrivateProjectPage(kafPrivate, 'nafezly')).toBe(false)

    const generic = '<h1>403</h1><p>غير مصرح لك</p>'
    expect(isPrivateProjectPage(generic, 'nafezly')).toBe(false)
    expect(isPrivateProjectPage(generic, 'kaf')).toBe(false)

    const challenge = '<title>Just a moment</title>' + kafPrivate
    expect(isPrivateProjectPage(challenge, 'kaf')).toBe(false)
    expect(isPrivateProjectPage(challenge, 'nafezly')).toBe(false)
  })

  it('b. fetchDetail classifies Nafezly private 403 and leaves Mostaql unread', async () => {
    const nafezlyUrl = 'https://nafezly.com/project/123-sample'
    const mostaqlUrl = 'https://mostaql.com/project/123'

    // Nafezly 403 + private fixture body -> { ok:false, kind:'private', status:403 }
    const resPrivate = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response(nafezlyPrivate, { status: 403 })) as typeof fetch
    })
    expect(resPrivate).toEqual({ ok: false, kind: 'private', status: 403 })

    // Nafezly 403 + empty or generic body -> kind 'http', status 403
    const resEmpty = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response('', { status: 403 })) as typeof fetch
    })
    expect(resEmpty).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    const resGeneric = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response('<h1>403</h1><p>غير مصرح لك</p>', { status: 403 })) as typeof fetch
    })
    expect(resGeneric).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    // Nafezly 403 + private markup padded beyond 512 KB -> kind 'http'
    const padded = nafezlyPrivate + '<!-- ' + 'x'.repeat(512 * 1024) + ' -->'
    const resPadded = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response(padded, { status: 403 })) as typeof fetch
    })
    expect(resPadded).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    // Mostaql 403 + the Nafezly private body -> kind 'http' and body not read
    let pullCalled = false
    const unreadStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(nafezlyPrivate))
      },
      pull() {
        pullCalled = true
      }
    })
    const stubMostaqlRes = new Response(null, { status: 403 })
    Object.defineProperty(stubMostaqlRes, 'body', { value: unreadStream })
    const resMostaql = await fetchDetail(mostaqlUrl, {
      source: 'mostaql',
      fetchImpl: (async () => stubMostaqlRes) as typeof fetch
    })
    expect(resMostaql).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })
    expect(pullCalled).toBe(false)

    // Nafezly 429 -> unchanged
    const res429 = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response('rate limit', { status: 429, headers: { 'retry-after': '30' } })) as typeof fetch
    })
    expect(res429).toEqual({ ok: false, kind: 'http', status: 429, retryAfterMs: 30000 })
  })

  it('b. 403 body inspection preserves 403 outcome on stream failure, timeout and caller abort', async () => {
    const nafezlyUrl = 'https://nafezly.com/project/123-sample'
    const kafUrl = 'https://kafiil.com/project/123-sample'

    const makeStalledResponse = (init?: RequestInit, headers: Record<string, string> = {}): Response => {
      let streamCtrl: ReadableStreamDefaultController
      const stream = new ReadableStream({
        start(c) {
          streamCtrl = c
          init?.signal?.addEventListener('abort', () => {
            try { streamCtrl.error(new DOMException('Aborted', 'AbortError')) } catch { /* ignore */ }
          })
        },
        pull() {}
      })
      return new Response(stream, { status: 403, headers: { 'content-type': 'text/html', ...headers } })
    }

    // 403 whose body never ends and the timer fires -> 403 outcome preserved
    const resStalled = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      timeoutMs: 30,
      fetchImpl: (async (_url, init) => makeStalledResponse(init)) as typeof fetch
    })
    expect(resStalled).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    const kafAbortCtrl = new AbortController()
    setTimeout(() => kafAbortCtrl.abort(), 30)
    await expect(fetchKafHtml(kafUrl, kafAbortCtrl.signal, false, async (_url, init) => makeStalledResponse(init))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })

    // 403 whose stream errors mid-body -> preserved
    const errorStreamNafezly = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      },
      pull(controller) {
        controller.error(new Error('connection reset'))
      }
    })
    const resError = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response(errorStreamNafezly, { status: 403 })) as typeof fetch
    })
    expect(resError).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    const errorStreamKaf = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      },
      pull(controller) {
        controller.error(new Error('reset'))
      }
    })
    await expect(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(errorStreamKaf, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })

    // 403 with Retry-After: 3600 and a stalled body -> retryAfterMs/retry preserved
    const resRetryNafezly = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      timeoutMs: 30,
      fetchImpl: (async (_url, init) => makeStalledResponse(init, { 'retry-after': '3600' })) as typeof fetch
    })
    expect(resRetryNafezly).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: 3600000 })

    const kafTimerCtrl = new AbortController()
    setTimeout(() => kafTimerCtrl.abort(), 30)
    await expect(fetchKafHtml(kafUrl, kafTimerCtrl.signal, false, async (_url, init) => makeStalledResponse(init, { 'retry-after': '3600' }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
      retryAfterMs: 3600000
    })

    // Caller abort during body read preserves 403 outcome in fetchDetail
    const callerCtrl = new AbortController()
    const abortStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'))
      },
      pull(controller) {
        callerCtrl.abort()
        controller.error(new DOMException('Aborted', 'AbortError'))
      }
    })
    const resAbort = await fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      signal: callerCtrl.signal,
      fetchImpl: (async () => new Response(abortStream, { status: 403 })) as typeof fetch
    })
    expect(resAbort).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })
  })

  it('c. ProjectFactsFetcher calls deps.failure on aborted 403/401/429 and suppresses on private', async () => {
    const d = getDb('nafezly')
    let failureResult: unknown = null

    // Private page -> failure NOT called
    const privateFetcher = new ProjectFactsFetcher({
      db: () => d,
      gateOpen: () => true,
      settled: () => {},
      failure: r => { failureResult = r },
      fetchImpl: (async () => new Response(nafezlyPrivate, { status: 403 })) as typeof fetch
    })
    privateFetcher.request(1)
    await privateFetcher.pump()
    expect(failureResult).toBeNull()
    expect(projectFacts(d, 1)).toMatchObject({ status: 'failed', errorCode: 'private' })
    await privateFetcher.close()

    // Generic 403 -> failure called once
    let genericCalls = 0
    const genericFetcher = new ProjectFactsFetcher({
      db: () => d,
      gateOpen: () => true,
      settled: () => {},
      failure: () => { genericCalls++ },
      fetchImpl: (async () => new Response('<h1>403</h1>', { status: 403 })) as typeof fetch
    })
    genericFetcher.request(1, true)
    await genericFetcher.pump()
    expect(genericCalls).toBe(1)
    expect(projectFacts(d, 1)).toMatchObject({ status: 'failed', errorCode: 'http-403' })
    await genericFetcher.close()

    // Caller abort on 403: deps.failure called even when aborted, facts status 'not_requested'
    let abortedFailures = 0
    const abortedFetcher = new ProjectFactsFetcher({
      db: () => d,
      gateOpen: () => true,
      settled: () => {},
      failure: () => { abortedFailures++ },
      fetchImpl: (async () => {
        abortedFetcher.abortActive()
        return new Response('', { status: 403 })
      }) as typeof fetch
    })
    abortedFetcher.request(1, true)
    await abortedFetcher.pump()
    expect(abortedFailures).toBe(1)
    expect(projectFacts(d, 1)?.status).toBe('not_requested')
    await abortedFetcher.close()

    // Caller abort on 429: deps.failure called even when aborted
    let aborted429Failures = 0
    const aborted429Fetcher = new ProjectFactsFetcher({
      db: () => d,
      gateOpen: () => true,
      settled: () => {},
      failure: () => { aborted429Failures++ },
      fetchImpl: (async () => {
        aborted429Fetcher.abortActive()
        return new Response('rate limit', { status: 429, headers: { 'retry-after': '60' } })
      }) as typeof fetch
    })
    aborted429Fetcher.request(1, true)
    await aborted429Fetcher.pump()
    expect(aborted429Failures).toBe(1)
    expect(projectFacts(d, 1)?.status).toBe('not_requested')
    await aborted429Fetcher.close()
  })

  it('d. fetchKafHtml distinguishes project 403 private from list 403, empty and oversized', async () => {
    const projectUrl = 'https://kafiil.com/project/100-sample'
    const listUrl = 'https://kafiil.com/projects?sort=latest&page=1'

    // project URL 403 + KAF private body -> KafFetchError kind 'private' status 403
    const promise = fetchKafHtml(projectUrl, new AbortController().signal, false, async () => new Response(kafPrivate, { status: 403 }))
    await expect(promise).rejects.toBeInstanceOf(KafFetchError)
    await expect(promise).rejects.toMatchObject({
      kind: 'private',
      status: 403
    })

    // list URL 403 + the same body -> 'forbidden'
    await expect(fetchKafHtml(listUrl, new AbortController().signal, false, async () => new Response(kafPrivate, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })

    // project URL 403 + empty body -> 'forbidden'
    await expect(fetchKafHtml(projectUrl, new AbortController().signal, false, async () => new Response('', { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })

    // project URL 403 + oversized body -> 'forbidden'
    const oversized = kafPrivate + '<!-- ' + 'x'.repeat(512 * 1024) + ' -->'
    await expect(fetchKafHtml(projectUrl, new AbortController().signal, false, async () => new Response(oversized, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })
  })

  it('e. KAF controller applies cooldown on aborted forbidden/rate_limited and handles private', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const d = getDb('kaf')
    applyKafCycle(d, parseKafList(kafList), {
      nowMs: 100000,
      checkpoint: null,
      settings: defaultSettings(),
      runId: 'test',
      durationMs: 30,
      firstPageIds: ['300', '299']
    })

    const initialSource = getSourceState(d, 'kaf')
    const fPrivate = vi.fn(async () => new Response(kafPrivate, { status: 403, headers: { 'content-type': 'text/html' } }))
    const c = new KafController({
      db: () => d,
      settings: defaultSettings,
      health: () => {},
      projects: () => {},
      details: () => {},
      flush: async () => {},
      runId: 'test',
      fetchImpl: fPrivate as typeof fetch,
      random: () => 0
    })

    c.requestDetails(1, false)
    await vi.advanceTimersByTimeAsync(0)
    expect(fPrivate).toHaveBeenCalledTimes(1)

    const afterPrivate = getSourceState(d, 'kaf')
    expect(afterPrivate.backoffUntil).toBe(initialSource.backoffUntil)
    expect(afterPrivate.lastError).toBe(initialSource.lastError)
    expect(c.health().state).not.toBe('needs-review')
    expect(getProjectDetailsRow(d, 1)).toMatchObject({ status: 'failed', errorCode: 'kaf-detail-private' })

    // Existing cached text case: preserves 'ready' status with errorCode 'kaf-detail-private'
    vi.setSystemTime(106000)
    upsertProjectDetails(d, 1, { text: 'Cached body', provenance: 'full', fetchedAt: new Date().toISOString(), status: 'ready', errorCode: null })
    c.requestDetails(1, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(getProjectDetailsRow(d, 1)).toMatchObject({ text: 'Cached body', status: 'ready', errorCode: 'kaf-detail-private' })
    await c.close()

    // Aborted 403 detail fetch still applies cooldown
    vi.setSystemTime(116000)
    let cAbort: KafController | null = null
    const fAbortForbidden = vi.fn(async () => {
      cAbort?.sleep()
      return new Response('', { status: 403 })
    })
    cAbort = new KafController({
      db: () => d,
      settings: defaultSettings,
      health: () => {},
      projects: () => {},
      details: () => {},
      flush: async () => {},
      runId: 'test',
      fetchImpl: fAbortForbidden as typeof fetch,
      random: () => 0
    })
    cAbort.requestDetails(1, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(getSourceState(d, 'kaf').backoffUntil).not.toBeNull()
    expect(getSourceState(d, 'kaf').lastError).toBe('kaf-forbidden-403')
    await cAbort.close()
  })

  it('2. Veto markers reject block, authentication, maintenance and captcha pages', async () => {
    const nafezlyUrl = 'https://nafezly.com/project/123-sample'
    const kafUrl = 'https://kafiil.com/project/100-sample'

    const vetoSamples = [
      // Cloudflare error block
      '<div id="cf-error-details"><h1>Access denied</h1><span class="cf-error-code">1020</span></div>',
      // Element class token families
      '<div class="cf-wrapper"></div>',
      '<div class="cf-browser-verification"></div>',
      '<div class="cf-challenge"></div>',
      '<div class="cf-turnstile"></div>',
      '<div class="challenge-stage"></div>',
      '<div class="g-recaptcha"></div>',
      '<div class="h-captcha"></div>',
      '<div class="captcha-form"></div>',
      // Password input
      '<form><input type="password" name="auth"></form>',
      // Text markers
      '<p>Error: access denied</p>',
      '<p>too many requests</p>',
      '<p>rate limit exceeded</p>',
      '<p>temporarily blocked</p>',
      '<p>site under maintenance</p>',
      '<p>الموقع في صيانة حالياً</p>',
      '<p>أنت محظور من الدخول</p>',
      '<p>تم حظر وصولك</p>',
      '<p>طلبات كثيرة من عنوانك</p>'
    ]

    for (const marker of vetoSamples) {
      const nafWithVeto = nafezlyPrivate.replace('</body>', `${marker}</body>`)
      const kafWithVeto = kafPrivate.replace('</body>', `${marker}</body>`)

      expect(parseWatchPage(nafWithVeto, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
      expect(parseWatchPage(kafWithVeto, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
      expect(isPrivateProjectPage(nafWithVeto, 'nafezly')).toBe(false)
      expect(isPrivateProjectPage(kafWithVeto, 'kaf')).toBe(false)

      const resNaf = await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(nafWithVeto, { status: 403 })) as typeof fetch })
      expect(resNaf).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

      await expect(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(kafWithVeto, { status: 403 }))).rejects.toMatchObject({
        kind: 'forbidden',
        status: 403
      })
    }

    // Both private fixtures alone remain private
    expect(isPrivateProjectPage(nafezlyPrivate, 'nafezly')).toBe(true)
    expect(isPrivateProjectPage(kafPrivate, 'kaf')).toBe(true)

    // Truncated visible text (budget exhaustion) vetoes to prevent bypass of denial text
    const spacePadding = '<p>' + ' '.repeat(200001) + '</p><h1>Access denied</h1>'
    const nafSpacePadded = nafezlyPrivate.replace('</body>', `${spacePadding}</body>`)
    const kafSpacePadded = kafPrivate.replace('</body>', `${spacePadding}</body>`)

    expect(isPrivateProjectPage(nafSpacePadded, 'nafezly')).toBe(false)
    expect(isPrivateProjectPage(kafSpacePadded, 'kaf')).toBe(false)

    const resNafSpace = await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(nafSpacePadded, { status: 403 })) as typeof fetch })
    expect(resNafSpace).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    await expect(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(kafSpacePadded, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })

    // Entity expansion exhausting raw-work budget while staying under 256 KB and 30 000 '<'
    const entityPadding = '<p>' + '&nbsp;'.repeat(40000) + '</p><h1>Access denied</h1>'
    const nafEntityPadded = nafezlyPrivate.replace('</body>', `${entityPadding}</body>`)
    const kafEntityPadded = kafPrivate.replace('</body>', `${entityPadding}</body>`)

    expect(isPrivateProjectPage(nafEntityPadded, 'nafezly')).toBe(false)
    expect(isPrivateProjectPage(kafEntityPadded, 'kaf')).toBe(false)

    const resNafEntity = await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(nafEntityPadded, { status: 403 })) as typeof fetch })
    expect(resNafEntity).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    await expect(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(kafEntityPadded, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })

    // Formatted and entity-encoded denial text vetoed
    const formattedDenial = '<h1>Access <strong>denied</strong></h1>'
    const entityDenial = '<h1>Access&#32;denied</h1>'
    for (const denial of [formattedDenial, entityDenial]) {
      const nafDenial = nafezlyPrivate.replace('</body>', `${denial}</body>`)
      const kafDenial = kafPrivate.replace('</body>', `${denial}</body>`)
      expect(isPrivateProjectPage(nafDenial, 'nafezly')).toBe(false)
      expect(isPrivateProjectPage(kafDenial, 'kaf')).toBe(false)
      expect(parseWatchPage(nafDenial, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
      expect(parseWatchPage(kafDenial, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
    }

    // Comment and script containing veto words do NOT veto a real private page
    const withComment = nafezlyPrivate.replace('</body>', '<!-- maintenance template --></body>')
    const withScript = nafezlyPrivate.replace('</body>', "<script>var s='access denied'</script></body>")
    expect(isPrivateProjectPage(withComment, 'nafezly')).toBe(true)
    expect(isPrivateProjectPage(withScript, 'nafezly')).toBe(true)

    // Arabic text marker: <p>تم حظر</p> vetoes
    const withArabicVeto = nafezlyPrivate.replace('</body>', '<p>تم حظر</p></body>')
    expect(isPrivateProjectPage(withArabicVeto, 'nafezly')).toBe(false)

    // Private fixture containing cf-beacon element remains private
    const withBeacon = nafezlyPrivate.replace('</body>', '<div class="cf-beacon"></div></body>')
    expect(isPrivateProjectPage(withBeacon, 'nafezly')).toBe(true)

    // Reproduction 1: bodyless markup with > 256 KB text exhausting budget before denial
    const repro1Suffix = '<p>' + ' '.repeat(262145) + '</p><h1>Access denied</h1>'
    const nafRepro1 = nafezlyPrivate.replace(/<\/?body\b[^>]*>/gi, '') + repro1Suffix
    const kafRepro1 = kafPrivate.replace(/<\/?body\b[^>]*>/gi, '') + repro1Suffix
    expect(parseWatchPage(nafRepro1, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(kafRepro1, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })

    // Reproduction 2: denial text outside <body>
    const nafRepro2 = nafezlyPrivate.replace('</body>', '</body><h1>Access denied</h1>')
    const kafRepro2 = kafPrivate.replace('</body>', '</body><h1>Access denied</h1>')
    expect(parseWatchPage(nafRepro2, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(kafRepro2, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
    const resNafRepro2 = await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(nafRepro2, { status: 403 })) as typeof fetch })
    expect(resNafRepro2).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })
    await expect(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(kafRepro2, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403
    })
  })

  it('3. Reader cleanup releases locks without awaiting un-settled stream cancel', async () => {
    const nafezlyUrl = 'https://nafezly.com/project/123-sample'
    const kafUrl = 'https://kafiil.com/project/100-sample'

    const timeoutRace = <T>(promise: Promise<T>, ms = 2000): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for call to settle')), ms))
      ])

    // Oversize body (> 512 KB) whose cancel() never settles
    const oversizeNeverSettleStream = () => new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(600 * 1024)) },
      cancel() { return new Promise(() => {}) }
    })

    const nafOversizeRes = await timeoutRace(fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response(oversizeNeverSettleStream(), { status: 403 })) as typeof fetch
    }))
    expect(nafOversizeRes).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    const kafOversizePromise = timeoutRace(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(oversizeNeverSettleStream(), { status: 403 })))
    await expect(kafOversizePromise).rejects.toMatchObject({ kind: 'forbidden', status: 403 })

    // Body that errors mid-stream whose cancel() never settles
    const errorNeverSettleStream = () => new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(100)) },
      pull(c) { c.error(new Error('stream error')) },
      cancel() { return new Promise(() => {}) }
    })

    const nafErrorRes = await timeoutRace(fetchDetail(nafezlyUrl, {
      source: 'nafezly',
      fetchImpl: (async () => new Response(errorNeverSettleStream(), { status: 403 })) as typeof fetch
    }))
    expect(nafErrorRes).toEqual({ ok: false, kind: 'http', status: 403, retryAfterMs: null })

    const kafErrorPromise = timeoutRace(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(errorNeverSettleStream(), { status: 403 })))
    await expect(kafErrorPromise).rejects.toMatchObject({ kind: 'forbidden', status: 403 })

    // Private read completes: lock released
    const streamPrivate = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(nafezlyPrivate)); c.close() }
    })
    await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(streamPrivate, { status: 403 })) as typeof fetch })
    expect(streamPrivate.locked).toBe(false)

    // Oversize: cancel called and lock released
    let cancelCalled = false
    const streamOversize = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(600 * 1024))
      },
      cancel() {
        cancelCalled = true
      }
    })
    await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(streamOversize, { status: 403 })) as typeof fetch })
    expect(cancelCalled).toBe(true)
    expect(streamOversize.locked).toBe(false)

    // Error: cancel called and lock released
    const streamError = new ReadableStream({
      pull(c) {
        c.error(new Error('stream error'))
      }
    })
    await fetchDetail(nafezlyUrl, { source: 'nafezly', fetchImpl: (async () => new Response(streamError, { status: 403 })) as typeof fetch })
    expect(streamError.locked).toBe(false)

    // KAF stream cleanup on oversize
    let kafCancelCalled = false
    const kafOversizeStream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(600 * 1024))
      },
      cancel() {
        kafCancelCalled = true
      }
    })
    await expect(fetchKafHtml(kafUrl, new AbortController().signal, false, async () => new Response(kafOversizeStream, { status: 403 }))).rejects.toMatchObject({
      kind: 'forbidden'
    })
    expect(kafCancelCalled).toBe(true)
    expect(kafOversizeStream.locked).toBe(false)
  })

  it('4. Tag and character bounds reject oversized markup without slow tree building', () => {
    expect(PRIVATE_PAGE_MAX_CHARS).toBe(256 * 1024)
    expect(PRIVATE_PAGE_MAX_TAGS).toBe(30_000)

    expect(isPrivateProjectPage(nafezlyPrivate, 'nafezly')).toBe(true)
    expect(isPrivateProjectPage(kafPrivate, 'kaf')).toBe(true)

    const oversizedChars = nafezlyPrivate + '<!-- ' + 'a'.repeat(256 * 1024) + ' -->'
    expect(isPrivateProjectPage(oversizedChars, 'nafezly')).toBe(false)

    // Padded with 31,000 <br> -> not private, in well under 1000 ms
    const paddedTags = nafezlyPrivate.replace('</body>', '<br>'.repeat(31_000) + '</body>')
    const start = performance.now()
    const result = isPrivateProjectPage(paddedTags, 'nafezly')
    const duration = performance.now() - start
    expect(result).toBe(false)
    expect(duration).toBeLessThan(1000)
  })
})
