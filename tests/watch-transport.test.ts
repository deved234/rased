import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWatchFetch } from '../src/main/watchTransport.js'

function makeStream(
  chunks: (Uint8Array | string)[],
  opts?: {
    onCancel?: () => Promise<void> | void
    delayMs?: number
  }
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const byteChunks = chunks.map(c => (typeof c === 'string' ? encoder.encode(c) : c))
  return new ReadableStream({
    async pull(controller) {
      if (opts?.delayMs) {
        await new Promise(res => setTimeout(res, opts.delayMs))
      }
      const next = byteChunks.shift()
      if (next) {
        controller.enqueue(next)
      } else {
        controller.close()
      }
    },
    cancel() {
      if (opts?.onCancel) {
        return opts.onCancel()
      }
    }
  })
}

function makeNeverEndingStream(opts?: { onCancel?: () => Promise<void> | void }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull() {
      return new Promise(() => {})
    },
    cancel() {
      if (opts?.onCancel) {
        return opts.onCancel()
      }
    }
  })
}

function makeErrorStream(error: Error, firstChunk?: Uint8Array): ReadableStream<Uint8Array> {
  let sentFirst = false
  return new ReadableStream({
    pull(controller) {
      if (firstChunk && !sentFirst) {
        sentFirst = true
        controller.enqueue(firstChunk)
        return
      }
      controller.error(error)
    }
  })
}

function timeoutRace<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    promise.then(
      val => {
        clearTimeout(timer)
        resolve(val)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

describe('watchTransport', () => {
  describe('URL validation', () => {
    it('rejects invalid Mostaql URLs without calling fetchImpl', async () => {
      const fetchImpl = vi.fn()
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const signal = new AbortController().signal

      const invalidUrls = [
        'https://user:pass@mostaql.com/project/12345',
        'http://mostaql.com/project/12345',
        'https://evil.com/project/12345',
        'https://mostaql.com/projects',
        'https://mostaql.com/project/0',
        'https://mostaql.com/project/',
        'https://mostaql.com/project/12345/offers',
        'not-a-valid-url'
      ]

      for (const url of invalidUrls) {
        const res = await fetchWatch('mostaql', url, signal)
        expect(res).toEqual({
          kind: 'http',
          status: null,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
      }
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('rejects invalid Nafezly URLs without calling fetchImpl', async () => {
      const fetchImpl = vi.fn()
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const signal = new AbortController().signal

      const invalidUrls = [
        'https://user:pass@nafezly.com/project/12345',
        'http://nafezly.com/project/12345',
        'https://other.com/project/12345',
        'https://nafezly.com/projects',
        'https://nafezly.com/project/0',
        'https://nafezly.com/project/'
      ]

      for (const url of invalidUrls) {
        const res = await fetchWatch('nafezly', url, signal)
        expect(res).toEqual({
          kind: 'http',
          status: null,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
      }
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('rejects invalid KAF URLs including query strings without calling fetchImpl', async () => {
      const fetchImpl = vi.fn()
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const signal = new AbortController().signal

      const invalidUrls = [
        'https://kafiil.com/project/12345-slug?foo=bar',
        'https://kafiil.com/project/12345-slug#hash',
        'https://user:pass@kafiil.com/project/12345-slug',
        'http://kafiil.com/project/12345-slug',
        'https://kafiil.com/projects',
        'https://mostaql.com/project/12345'
      ]

      for (const url of invalidUrls) {
        const res = await fetchWatch('kaf', url, signal)
        expect(res).toEqual({
          kind: 'http',
          status: null,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
      }
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })

  describe('redirect mode and request headers per source', () => {
    it('sets manual redirect for all sources', async () => {
      const calls: { url: string; init?: RequestInit }[] = []
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      })

      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const signal = new AbortController().signal

      await fetchWatch('mostaql', 'https://mostaql.com/project/123', signal)
      await fetchWatch('nafezly', 'https://nafezly.com/project/456', signal)
      await fetchWatch('kaf', 'https://kafiil.com/project/789-test', signal)

      expect(calls).toHaveLength(3)
      expect(calls[0]?.init?.redirect).toBe('manual')
      expect(calls[1]?.init?.redirect).toBe('manual')
      expect(calls[2]?.init?.redirect).toBe('manual')

      for (const call of calls) {
        expect(call.init?.headers).toEqual({
          'User-Agent': 'RASED/0.1 (+local Windows watcher)',
          Accept: 'text/html'
        })
      }
    })
  })

  describe('200 responses', () => {
    it('returns ok with html on complete 200 body', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response('<html><body>Project description</body></html>', { status: 200 })
      })
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'ok',
        status: 200,
        finalUrl: 'https://mostaql.com/project/123',
        html: '<html><body>Project description</body></html>',
        retryAfterMs: null
      })
    })

    it('returns too_large when 200 body exceeds 2 MiB', async () => {
      let cancelled = false
      // A trailing chunk keeps the body open, as a real oversized response would be.
      const stream = makeStream([new Uint8Array(2 * 1024 * 1024 + 10), new Uint8Array(16)], {
        onCancel: () => {
          cancelled = true
        }
      })
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'too_large',
        status: 200,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: null
      })
      // The transport cancels without awaiting, so the stream callback may run a tick later.
      await vi.waitFor(() => expect(cancelled).toBe(true))
    })

    it('returns network when 200 body stream errors', async () => {
      const stream = makeErrorStream(new Error('socket hang up'), new Uint8Array(100))
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'network',
        status: 200,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns cancelled when caller aborts mid-body on 200', async () => {
      const callerCtrl = new AbortController()
      let pullCount = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount++
          if (pullCount === 1) {
            controller.enqueue(new Uint8Array(50))
            return
          }
          callerCtrl.abort()
        }
      })

      const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', callerCtrl.signal)

      expect(res).toEqual({
        kind: 'cancelled',
        status: 200,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns timeout when internal timer expires on 200', async () => {
      const stream = makeNeverEndingStream()
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
      const fetchWatch = createWatchFetch({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 20
      })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'timeout',
        status: 200,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })
  })

  describe('cross-origin redirect and same-origin redirects', () => {
    it('returns kind http with status and null html on cross-origin redirect without reading body', async () => {
      let pullCalled = false
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('attacker content'))
        },
        pull() {
          pullCalled = true
        }
      })

      const response = new Response(stream, {
        status: 302,
        headers: { location: 'https://attacker.com/project/123' }
      })

      const fetchImpl = vi.fn(async () => response)
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 302,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
      expect(pullCalled).toBe(false)
      expect(stream.locked).toBe(false)
    })

    it('preserves same-origin redirect to /projects for Mostaql', async () => {
      const redirectResponse = new Response(null, {
        status: 302,
        headers: { location: '/projects' }
      })
      const targetResponse = new Response('<html>Projects list</html>', { status: 200 })

      let callCount = 0
      const fetchImpl = vi.fn(async (url: string) => {
        callCount++
        if (callCount === 1) {
          expect(url).toBe('https://mostaql.com/project/123')
          return redirectResponse
        }
        expect(url).toBe('https://mostaql.com/projects')
        return targetResponse
      })
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'ok',
        status: 200,
        finalUrl: 'https://mostaql.com/projects',
        html: '<html>Projects list</html>',
        retryAfterMs: null
      })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('item 5: finalUrl is the last URL actually requested and ignores res.url override', async () => {
      const response = new Response('<html>some page</html>', { status: 200 })
      Object.defineProperty(response, 'url', { value: 'https://mostaql.com/projects' })

      const fetchImpl = vi.fn(async () => response)
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res.kind).toBe('ok')
      expect(res.finalUrl).toBe('https://mostaql.com/project/123')
    })
  })

  describe('403 and 202 status handling', () => {
    it('reads nafezly 403 private fixture body', async () => {
      const fixture = readFileSync('tests/fixtures/watch/nafezly-private-403.html', 'utf8')
      const fetchImpl = vi.fn(async () => new Response(fixture, { status: 403 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('nafezly', 'https://nafezly.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://nafezly.com/project/123',
        html: fixture,
        retryAfterMs: null
      })
    })

    it('reads kaf 403 private fixture body', async () => {
      const fixture = readFileSync('tests/fixtures/watch/kaf-private-403.html', 'utf8')
      const fetchImpl = vi.fn(async () => new Response(fixture, { status: 403 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('kaf', 'https://kafiil.com/project/123-sample', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://kafiil.com/project/123-sample',
        html: fixture,
        retryAfterMs: null
      })
    })

    it('returns kind http status 403 with null html when 403 body errors', async () => {
      const stream = makeErrorStream(new Error('network error during 403 body'))
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 403 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('nafezly', 'https://nafezly.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://nafezly.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns kind http status 403 with null html when 403 body never ends until timer', async () => {
      const stream = makeNeverEndingStream()
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 403 }))
      const fetchWatch = createWatchFetch({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 25
      })
      const res = await fetchWatch('nafezly', 'https://nafezly.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://nafezly.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns kind http status 403 with null html when 403 body is cancelled by caller', async () => {
      const callerCtrl = new AbortController()
      let pulled = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!pulled) {
            pulled = true
            controller.enqueue(new Uint8Array(20))
            return
          }
          callerCtrl.abort()
        }
      })

      const fetchImpl = vi.fn(async () => new Response(stream, { status: 403 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('nafezly', 'https://nafezly.com/project/123', callerCtrl.signal)

      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://nafezly.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns kind http status 403 with null html when 403 body exceeds 512 KB', async () => {
      let cancelled = false
      // A trailing chunk keeps the body open, as a real oversized response would be.
      const stream = makeStream([new Uint8Array(512 * 1024 + 10), new Uint8Array(16)], {
        onCancel: () => {
          cancelled = true
        }
      })
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 403 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('nafezly', 'https://nafezly.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://nafezly.com/project/123',
        html: null,
        retryAfterMs: null
      })
      await vi.waitFor(() => expect(cancelled).toBe(true))
    })

    it('handles 202 empty and 202 with body', async () => {
      const fetchImplEmpty = vi.fn(async () => new Response(null, { status: 202 }))
      const fetchWatchEmpty = createWatchFetch({ fetchImpl: fetchImplEmpty as unknown as typeof fetch })
      const resEmpty = await fetchWatchEmpty('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(resEmpty.kind).toBe('http')
      expect(resEmpty.status).toBe(202)

      const fetchImplBody = vi.fn(async () => new Response('Accepted processing', { status: 202 }))
      const fetchWatchBody = createWatchFetch({ fetchImpl: fetchImplBody as unknown as typeof fetch })
      const resBody = await fetchWatchBody('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(resBody.kind).toBe('http')
      expect(resBody.status).toBe(202)
      expect(resBody.html).toBe('Accepted processing')
    })
  })

  describe('other HTTP statuses and Retry-After', () => {
    it('handles 401, 404, 410, 429, 500, 302 with status and html null without reading body', async () => {
      const statuses = [401, 404, 410, 429, 500, 302]

      for (const status of statuses) {
        let pullCalled = false
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(10))
          },
          pull() {
            pullCalled = true
          }
        })

        const fetchImpl = vi.fn(async () => new Response(stream, { status }))
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
        const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

        expect(res).toEqual({
          kind: 'http',
          status,
          finalUrl: 'https://mostaql.com/project/123',
          html: null,
          retryAfterMs: null
        })
        expect(pullCalled).toBe(false)
        expect(stream.locked).toBe(false)
      }
    })

    it('parses Retry-After in seconds', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(null, {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      })
      const fetchWatch = createWatchFetch({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => 1_000_000
      })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 429,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: 120_000
      })
    })

    it('parses Retry-After as HTTP-date', async () => {
      const nowMs = 1_700_000_000_000
      const targetDate = new Date(nowMs + 45_000).toUTCString()
      const fetchImpl = vi.fn(async () => {
        return new Response(null, {
          status: 503,
          headers: { 'retry-after': targetDate }
        })
      })
      const fetchWatch = createWatchFetch({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => nowMs
      })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'http',
        status: 503,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: 45_000
      })
    })
  })

  describe('fetchImpl throwing and caller signal state', () => {
    it('maps synchronous fetchImpl error to network', async () => {
      const fetchImpl = vi.fn(() => {
        throw new Error('sync network blowup')
      })
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'network',
        status: null,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
    })

    it('maps asynchronous fetchImpl rejection to network', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('async DNS error')
      })
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)

      expect(res).toEqual({
        kind: 'network',
        status: null,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
    })

    it('returns cancelled without calling fetch if caller signal is already aborted', async () => {
      const fetchImpl = vi.fn()
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const signal = AbortSignal.abort()
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', signal)

      expect(res).toEqual({
        kind: 'cancelled',
        status: null,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })

  describe('body cancel never settling does not block', () => {
    const neverSettleStream = (chunks: Uint8Array[] = []) => {
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          const next = chunks.shift()
          if (next) {
            controller.enqueue(next)
          } else {
            controller.close()
          }
        },
        cancel() {
          return new Promise(() => {})
        }
      })
    }

    it('returns promptly on 200 oversize even if stream.cancel() never settles', async () => {
      const stream = neverSettleStream([new Uint8Array(3 * 1024 * 1024)])
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

      const res = await timeoutRace(
        fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal),
        2000
      )
      expect(res).toEqual({
        kind: 'too_large',
        status: 200,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns promptly on 403 oversize even if stream.cancel() never settles', async () => {
      const stream = neverSettleStream([new Uint8Array(600 * 1024)])
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 403 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

      const res = await timeoutRace(
        fetchWatch('nafezly', 'https://nafezly.com/project/123', new AbortController().signal),
        2000
      )
      expect(res).toEqual({
        kind: 'http',
        status: 403,
        finalUrl: 'https://nafezly.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })

    it('returns promptly on cross-origin response even if stream.cancel() never settles', async () => {
      const stream = neverSettleStream([new Uint8Array(100)])
      const response = new Response(stream, {
        status: 302,
        headers: { location: 'https://evil.com/project/123' }
      })
      const fetchImpl = vi.fn(async () => response)
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

      const res = await timeoutRace(
        fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal),
        2000
      )
      expect(res).toEqual({
        kind: 'http',
        status: 302,
        finalUrl: null,
        html: null,
        retryAfterMs: null
      })
    })

    it('item 6: cancels unread body when caller signal is already aborted when response arrives', async () => {
      let cancelCalled = false
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('unread data'))
        },
        cancel() {
          cancelCalled = true
        }
      })
      const response = new Response(stream, { status: 200 })

      const controller = new AbortController()
      const fetchImpl = vi.fn(async () => {
        controller.abort()
        return response
      })
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })
      const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', controller.signal)

      expect(res.kind).toBe('cancelled')
      expect(cancelCalled).toBe(true)
    })

    it('returns promptly on 401 response even if stream.cancel() never settles', async () => {
      const stream = neverSettleStream([new Uint8Array(100)])
      const fetchImpl = vi.fn(async () => new Response(stream, { status: 401 }))
      const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

      const res = await timeoutRace(
        fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal),
        2000
      )
      expect(res).toEqual({
        kind: 'http',
        status: 401,
        finalUrl: 'https://mostaql.com/project/123',
        html: null,
        retryAfterMs: null
      })
    })
  })

  describe('rework items 8 & 9', () => {
    describe('item 8: manual redirect handling and cross-origin checks', () => {
      it('rejects cross-origin redirect before requesting it', async () => {
        const calls: string[] = []
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
          calls.push(String(url))
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.com/project/123' }
          })
        })
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

        const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)
        expect(res).toEqual({
          kind: 'http',
          status: 302,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
        expect(calls).toEqual(['https://mostaql.com/project/123'])
      })

      it('rejects disallowed path redirect before requesting it', async () => {
        const calls: string[] = []
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
          calls.push(String(url))
          return new Response(null, {
            status: 301,
            headers: { location: 'https://mostaql.com/login' }
          })
        })
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

        const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)
        expect(res).toEqual({
          kind: 'http',
          status: 301,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
        expect(calls).toEqual(['https://mostaql.com/project/123'])
      })

      it('rejects credentials in redirect location before requesting it', async () => {
        const calls: string[] = []
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
          calls.push(String(url))
          return new Response(null, {
            status: 302,
            headers: { location: 'https://user:pass@nafezly.com/project/123' }
          })
        })
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

        const res = await fetchWatch('nafezly', 'https://nafezly.com/project/123', new AbortController().signal)
        expect(res).toEqual({
          kind: 'http',
          status: 302,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
        expect(calls).toEqual(['https://nafezly.com/project/123'])
      })

      it('follows allowed redirects up to 3 hops', async () => {
        const calls: string[] = []
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
          const u = String(url)
          calls.push(u)
          if (u === 'https://mostaql.com/project/123') {
            return new Response(null, { status: 302, headers: { location: '/project/456-slug' } })
          }
          if (u === 'https://mostaql.com/project/456-slug') {
            return new Response(null, { status: 301, headers: { location: '/projects' } })
          }
          return new Response('<html>ok</html>', { status: 200 })
        })
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

        const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', new AbortController().signal)
        expect(res).toEqual({
          kind: 'ok',
          status: 200,
          finalUrl: 'https://mostaql.com/projects',
          html: '<html>ok</html>',
          retryAfterMs: null
        })
        expect(calls).toEqual([
          'https://mostaql.com/project/123',
          'https://mostaql.com/project/456-slug',
          'https://mostaql.com/projects'
        ])
      })

      it('rejects 4th redirect without requesting it', async () => {
        const calls: string[] = []
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
          const u = String(url)
          calls.push(u)
          if (u === 'https://mostaql.com/project/101') {
            return new Response(null, { status: 302, headers: { location: '/project/102' } })
          }
          if (u === 'https://mostaql.com/project/102') {
            return new Response(null, { status: 302, headers: { location: '/project/103' } })
          }
          if (u === 'https://mostaql.com/project/103') {
            return new Response(null, { status: 302, headers: { location: '/project/104' } })
          }
          return new Response(null, { status: 302, headers: { location: '/project/105' } })
        })
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

        const res = await fetchWatch('mostaql', 'https://mostaql.com/project/101', new AbortController().signal)
        expect(res).toEqual({
          kind: 'http',
          status: 302,
          finalUrl: null,
          html: null,
          retryAfterMs: null
        })
        expect(calls).toHaveLength(4) // 4 requests made (initial + 3 hops); 4th redirect rejected without requesting
        expect(calls).not.toContain('https://mostaql.com/project/105')
      })

      it('does not follow redirects for kaf at all', async () => {
        const calls: string[] = []
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
          calls.push(String(url))
          return new Response(null, {
            status: 302,
            headers: { location: 'https://kafiil.com/project/999-other' }
          })
        })
        const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

        const res = await fetchWatch('kaf', 'https://kafiil.com/project/123-sample', new AbortController().signal)
        expect(res).toEqual({
          kind: 'http',
          status: 302,
          finalUrl: 'https://kafiil.com/project/123-sample',
          html: null,
          retryAfterMs: null
        })
        expect(calls).toEqual(['https://kafiil.com/project/123-sample'])
      })
    })

    describe('item 9: unhandled rejection prevention', () => {
      it('never emits unhandledRejection on aborted signal with errored body stream', async () => {
        const rejections: unknown[] = []
        const onUnhandled = (reason: unknown) => {
          rejections.push(reason)
        }
        process.on('unhandledRejection', onUnhandled)

        try {
          const stream = makeErrorStream(new Error('simulated body read error'), new Uint8Array(10))
          const fetchImpl = vi.fn(async () => {
            return new Response(stream, { status: 200 })
          })
          const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

          const ctrl = new AbortController()
          const p = fetchWatch('mostaql', 'https://mostaql.com/project/123', ctrl.signal)
          ctrl.abort()

          const res = await p
          expect(res.kind).toBe('cancelled')

          await new Promise(r => setTimeout(r, 60))
          expect(rejections).toHaveLength(0)
        } finally {
          process.removeListener('unhandledRejection', onUnhandled)
        }
      })

      it('never emits unhandledRejection on 403 status when caller aborts and body stream errors', async () => {
        const rejections: unknown[] = []
        const onUnhandled = (reason: unknown) => {
          rejections.push(reason)
        }
        process.on('unhandledRejection', onUnhandled)

        try {
          const stream = makeErrorStream(new Error('simulated 403 body error'))
          const ctrl = new AbortController()
          const fetchImpl = vi.fn(async () => {
            ctrl.abort()
            return new Response(stream, { status: 403 })
          })
          const fetchWatch = createWatchFetch({ fetchImpl: fetchImpl as unknown as typeof fetch })

          const res = await fetchWatch('mostaql', 'https://mostaql.com/project/123', ctrl.signal)
          expect(res.status).toBe(403)
          expect(res.kind).toBe('cancelled')

          await new Promise(r => setTimeout(r, 60))
          expect(rejections).toHaveLength(0)
        } finally {
          process.removeListener('unhandledRejection', onUnhandled)
        }
      })
    })
  })
})
