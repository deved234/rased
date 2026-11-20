import { DETAIL_MAX_BYTES, DETAIL_TIMEOUT_MS } from '../collector/enrichment.js'
import { isKafProjectUrl, KAF_ORIGIN } from '../collector/kaf.js'
import { parseRetryAfterMs } from '../collector/rss.js'
import type { WatchSource } from '../shared/projectWatch.js'
import type { WatchFetchResult } from './projectWatcher.js'

const PROJECT_PATH_REGEX = /^\/project\/[1-9]\d*(?:-[^/]*)?\/?$/
// Mostaql RSS links are stored as /go/<id>; the site answers with a 301 to /project/<id>-<slug>.
// A bare /project/<id> without a slug is redirected to /projects, so it must not be built by hand.
const MOSTAQL_GO_PATH_REGEX = /^\/go\/[1-9]\d*$/
const WATCH_USER_AGENT = 'RASED/0.1 (+local Windows watcher)'
const PRIVATE_BODY_MAX_BYTES = 512 * 1024

function getExpectedOrigin(source: WatchSource): string | null {
  switch (source) {
    case 'mostaql':
      return 'https://mostaql.com'
    case 'nafezly':
      return 'https://nafezly.com'
    case 'kaf':
      return KAF_ORIGIN
    default:
      return null
  }
}

function isValidWatchUrl(source: WatchSource, rawUrl: string): boolean {
  if (source === 'kaf') {
    return isKafProjectUrl(rawUrl)
  }
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return false
  }
  if (u.username || u.password) {
    return false
  }
  if (source === 'mostaql') {
    return (
      u.origin === 'https://mostaql.com' &&
      (PROJECT_PATH_REGEX.test(u.pathname) || MOSTAQL_GO_PATH_REGEX.test(u.pathname))
    )
  }
  if (source === 'nafezly') {
    return u.origin === 'https://nafezly.com' && PROJECT_PATH_REGEX.test(u.pathname)
  }
  return false
}

interface ReadResult {
  finished: boolean
  exceeded: boolean
  html: string | null
  error: unknown
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal
): Promise<ReadResult> {
  if (!body) {
    return { finished: true, exceeded: false, html: '', error: null }
  }

  if (signal.aborted) {
    return {
      finished: false,
      exceeded: false,
      html: null,
      error: signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = body.getReader()
  } catch (err) {
    return { finished: false, exceeded: false, html: null, error: err }
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let finished = false
  let exceeded = false
  let error: unknown = null

  try {
    for (;;) {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      }
      const readPromise = reader.read()
      readPromise.catch(() => {})
      const chunk = await raceSignal(readPromise, signal)
      if (chunk.done) {
        finished = true
        break
      }
      if (chunk.value) {
        totalBytes += chunk.value.byteLength
        if (totalBytes > maxBytes) {
          exceeded = true
          break
        }
        chunks.push(chunk.value)
      }
    }
  } catch (err) {
    error = err
  } finally {
    if (!finished) {
      void reader.cancel().catch(() => {})
    }
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }

  if (exceeded) {
    return { finished: false, exceeded: true, html: null, error: null }
  }
  if (!finished) {
    return { finished: false, exceeded: false, html: null, error }
  }

  const buf = new Uint8Array(totalBytes)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  return { finished: true, exceeded: false, html, error: null }
}

export function createWatchFetch(opts?: {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => number
}): (source: WatchSource, url: string, signal: AbortSignal) => Promise<WatchFetchResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const timeoutMs = opts?.timeoutMs ?? DETAIL_TIMEOUT_MS
  const now = opts?.now ?? (() => Date.now())

  return async (source: WatchSource, url: string, signal: AbortSignal): Promise<WatchFetchResult> => {
    if (signal.aborted) {
      return { kind: 'cancelled', status: null, finalUrl: null, html: null, retryAfterMs: null }
    }

    if (!isValidWatchUrl(source, url)) {
      return { kind: 'http', status: null, finalUrl: null, html: null, retryAfterMs: null }
    }

    const expectedOrigin = getExpectedOrigin(source)
    const ctrl = new AbortController()
    let callerAborted = false
    let timedOut = false

    const onCallerAbort = (): void => {
      callerAborted = true
      ctrl.abort()
    }

    signal.addEventListener('abort', onCallerAbort, { once: true })
    if (signal.aborted) {
      callerAborted = true
      ctrl.abort()
    }

    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, timeoutMs)

    try {
      const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
      let currentUrl = url
      let hops = 0

      for (;;) {
        let res: Response
        try {
          res = await fetchImpl(currentUrl, {
            headers: {
              'User-Agent': WATCH_USER_AGENT,
              Accept: 'text/html'
            },
            redirect: 'manual',
            signal: ctrl.signal
          })
        } catch {
          const kind = callerAborted || signal.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network'
          return { kind, status: null, finalUrl: null, html: null, retryAfterMs: null }
        }

        const retryAfterHeader = res.headers?.get ? res.headers.get('retry-after') : null
        const retryAfterMs = parseRetryAfterMs(retryAfterHeader, now())

        if (callerAborted || signal.aborted) {
          void res.body?.cancel().catch(() => {})
          return { kind: 'cancelled', status: res.status, finalUrl: currentUrl, html: null, retryAfterMs }
        }

        // Check if redirect
        if (REDIRECT_STATUSES.has(res.status)) {
          if (source === 'kaf') {
            void res.body?.cancel().catch(() => {})
            return { kind: 'http', status: res.status, finalUrl: currentUrl, html: null, retryAfterMs }
          }

          const loc = res.headers?.get ? res.headers.get('location') : null
          if (!loc) {
            void res.body?.cancel().catch(() => {})
            return { kind: 'http', status: res.status, finalUrl: currentUrl, html: null, retryAfterMs }
          }

          if (hops >= 3) {
            void res.body?.cancel().catch(() => {})
            return { kind: 'http', status: res.status, finalUrl: null, html: null, retryAfterMs }
          }

          let targetUrl: URL
          try {
            targetUrl = new URL(loc, currentUrl)
          } catch {
            void res.body?.cancel().catch(() => {})
            return { kind: 'http', status: res.status, finalUrl: null, html: null, retryAfterMs }
          }

          const isAllowedOrigin = targetUrl.origin === expectedOrigin
          const hasNoCredentials = !targetUrl.username && !targetUrl.password
          let isAllowedPath = false
          if (source === 'mostaql') {
            isAllowedPath =
              PROJECT_PATH_REGEX.test(targetUrl.pathname) ||
              targetUrl.pathname === '/projects' ||
              targetUrl.pathname === '/projects/'
          } else if (source === 'nafezly') {
            isAllowedPath = PROJECT_PATH_REGEX.test(targetUrl.pathname)
          }

          if (!isAllowedOrigin || !hasNoCredentials || !isAllowedPath) {
            void res.body?.cancel().catch(() => {})
            return { kind: 'http', status: res.status, finalUrl: null, html: null, retryAfterMs }
          }

          hops++
          void res.body?.cancel().catch(() => {})
          currentUrl = targetUrl.href
          continue
        }

        const finalUrl = currentUrl

        if (res.status === 200) {
          const readResult = await readBoundedBody(res.body, DETAIL_MAX_BYTES, ctrl.signal)
          if (readResult.exceeded) {
            return { kind: 'too_large', status: 200, finalUrl, html: null, retryAfterMs }
          }
          if (readResult.finished && readResult.html !== null) {
            return { kind: 'ok', status: 200, finalUrl, html: readResult.html, retryAfterMs }
          }
          const kind = callerAborted || signal.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network'
          return { kind, status: 200, finalUrl, html: null, retryAfterMs }
        }

        if (res.status === 403 || res.status === 202) {
          const readResult = await readBoundedBody(res.body, PRIVATE_BODY_MAX_BYTES, ctrl.signal)
          const html = readResult.finished && !readResult.exceeded ? readResult.html : null
          return { kind: 'http', status: res.status, finalUrl, html, retryAfterMs }
        }

        void res.body?.cancel().catch(() => {})
        return { kind: 'http', status: res.status, finalUrl, html: null, retryAfterMs }
      }
    } catch {
      const kind = callerAborted || signal.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network'
      return { kind, status: null, finalUrl: null, html: null, retryAfterMs: null }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onCallerAbort)
    }
  }
}
