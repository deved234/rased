// Collector requests through Chromium's network stack (Electron `net`), so Windows proxy, PAC and
// "system proxy" VPN settings apply exactly as in the browser. Node's global fetch ignores them,
// which made every source time out for users behind such a proxy.
//
// `net.fetch` cannot be used: with `redirect: 'manual'` it rejects ("Redirect was cancelled") instead
// of returning the 3xx, and the watcher must vet every hop itself. This adapter drives `net.request`
// in manual mode and returns a standard Response:
// - manual: the 3xx response with its Location header; nothing is followed.
// - follow: each hop is followed (max 20) and `response.url` is the final URL, like fetch.
// - error: a redirect rejects.
// Requests use a separate in-memory session (no "persist:" prefix), never send or store cookies,
// never answer auth prompts and never use the HTTP cache. Only GET and HEAD without a body.
// A body still open BODY_MAX_LIFETIME_MS after its response (a caller returned early without cancelling it,
// or the server stalled) is errored and its request aborted, so no request stays open; undici would leave
// that to garbage collection. Every collector deadline is far shorter (10-12 s).
import { net, session, type Session } from 'electron'

export const NETWORK_PARTITION = 'rased-network'
const MAX_FOLLOWED_REDIRECTS = 20
const BODY_HIGH_WATER_MARK = 256 * 1024
const BODY_MAX_LIFETIME_MS = 60_000
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

function abortReason(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

function networkError(cause: unknown): TypeError {
  return new TypeError('fetch failed', { cause })
}

function toHeaders(raw: Record<string, string | string[]>): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, String(item))
      } catch {
        // Skip a header value the Fetch API refuses; callers only read standard headers.
      }
    }
  }
  return headers
}

function withUrl(response: Response, url: string, redirected: boolean): Response {
  Object.defineProperty(response, 'url', { value: url })
  Object.defineProperty(response, 'redirected', { value: redirected })
  return response
}

export function createSystemFetch(opts: { getSession?: () => Session; bodyLifetimeMs?: number } = {}): typeof fetch {
  const getSession = opts.getSession ?? ((): Session => session.fromPartition(NETWORK_PARTITION))
  const bodyLifetimeMs = opts.bodyLifetimeMs ?? BODY_MAX_LIFETIME_MS
  const systemFetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      if (typeof input !== 'string' && !(input instanceof URL)) {
        reject(new TypeError('systemFetch accepts a URL string or URL only'))
        return
      }
      const method = (init.method ?? 'GET').toUpperCase()
      if ((method !== 'GET' && method !== 'HEAD') || init.body != null) {
        reject(new TypeError('systemFetch supports GET and HEAD without a body only'))
        return
      }
      const signal = init.signal ?? null
      if (signal?.aborted) {
        reject(abortReason(signal))
        return
      }
      const mode = init.redirect ?? 'follow'
      let currentUrl: string
      try {
        currentUrl = new URL(typeof input === 'string' ? input : input.href).href
      } catch (err) {
        reject(new TypeError('Invalid URL', { cause: err }))
        return
      }

      let request: ReturnType<typeof net.request>
      try {
        request = net.request({
          url: currentUrl,
          method,
          session: getSession(),
          redirect: 'manual',
          credentials: 'omit',
          useSessionCookies: false,
          cache: 'no-store'
        })
        new Headers(init.headers).forEach((value, name) => request.setHeader(name, value))
      } catch (err) {
        reject(networkError(err))
        return
      }

      let settled = false
      let bodyDone = false
      let redirects = 0
      let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null
      let lifetimeTimer: ReturnType<typeof setTimeout> | null = null
      const clearLifetime = (): void => {
        if (lifetimeTimer) clearTimeout(lifetimeTimer)
        lifetimeTimer = null
      }

      const stopRequest = (): void => {
        try {
          request.abort()
        } catch {
          // already finished
        }
      }
      const detach = (): void => signal?.removeEventListener('abort', onAbort)
      const fail = (err: unknown): void => {
        if (settled) return
        settled = true
        detach()
        stopRequest()
        reject(err)
      }
      const failBody = (err: unknown): void => {
        if (bodyDone) return
        bodyDone = true
        clearLifetime()
        detach()
        stopRequest()
        try {
          bodyController?.error(err)
        } catch {
          // stream already closed or cancelled
        }
      }
      function onAbort(): void {
        if (!settled) fail(abortReason(signal))
        else failBody(abortReason(signal))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      // Never answer proxy or server authentication prompts; the request then fails or returns 401/407.
      request.on('login', (_authInfo, callback) => callback())

      request.on('redirect', (status, _method, redirectUrl, responseHeaders) => {
        if (settled) return
        if (mode === 'manual') {
          const headers = toHeaders(responseHeaders)
          if (!headers.has('location')) headers.set('location', redirectUrl)
          settled = true
          detach()
          stopRequest()
          try {
            resolve(withUrl(new Response(null, { status, headers }), currentUrl, redirects > 0))
          } catch (err) {
            reject(networkError(err))
          }
          return
        }
        if (mode === 'error') {
          fail(networkError(new Error('unexpected redirect')))
          return
        }
        if (redirects >= MAX_FOLLOWED_REDIRECTS) {
          fail(networkError(new Error('redirect count exceeded')))
          return
        }
        redirects++
        currentUrl = redirectUrl
        try {
          request.followRedirect()
        } catch (err) {
          fail(networkError(err))
        }
      })

      request.on('response', response => {
        if (settled) return
        const status = response.statusCode
        const headers = toHeaders(response.headers)
        const hasBody = method !== 'HEAD' && !NULL_BODY_STATUSES.has(status)
        // Electron's IncomingMessage is a Node Readable at runtime; its typings omit pause/resume.
        const flow = response as unknown as Pick<NodeJS.ReadableStream, 'pause' | 'resume'>
        let body: ReadableStream<Uint8Array> | null = null
        if (hasBody) {
          body = new ReadableStream<Uint8Array>(
            {
              start(controller) {
                bodyController = controller
                lifetimeTimer = setTimeout(() => {
                  lifetimeTimer = null
                  failBody(new TypeError('terminated', { cause: new Error('response body still open after its lifetime') }))
                }, bodyLifetimeMs)
                response.on('data', (chunk: Buffer) => {
                  if (bodyDone) return
                  controller.enqueue(new Uint8Array(chunk))
                  if ((controller.desiredSize ?? 1) <= 0) flow.pause()
                })
                response.on('end', () => {
                  if (bodyDone) return
                  bodyDone = true
                  clearLifetime()
                  detach()
                  controller.close()
                })
                response.on('error', (err: Error) => failBody(new TypeError('terminated', { cause: err })))
                response.on('aborted', () => failBody(new TypeError('terminated')))
              },
              pull() {
                flow.resume()
              },
              cancel() {
                bodyDone = true
                clearLifetime()
                detach()
                stopRequest()
              }
            },
            { highWaterMark: BODY_HIGH_WATER_MARK, size: chunk => chunk.byteLength }
          )
        }
        let result: Response
        try {
          result = new Response(body, { status, statusText: response.statusMessage, headers })
        } catch (err) {
          fail(networkError(err))
          return
        }
        settled = true
        if (!hasBody) {
          bodyDone = true
          detach()
          stopRequest()
        }
        resolve(withUrl(result, currentUrl, redirects > 0))
      })

      request.on('error', (err: Error) => {
        if (!settled) fail(networkError(err))
        else failBody(new TypeError('terminated', { cause: err }))
      })
      request.on('abort', () => {
        if (!settled) fail(abortReason(signal))
      })

      request.end()
    })

  return systemFetch as typeof fetch
}
