// Detail-page enrichment: real category/skills/budget from the public
// project page (no login). Parsing is regex-scoped to stable anchors —
// breadcrumb category link, JSON-LD occupationalCategory, skill tag links,
// budget range — and validated. Never invents a category from keywords.
import { parseRetryAfterMs } from './rss.js'
import { DetailBudget } from './detailBudget.js'

export interface EnrichmentData {
  categorySlug: string | null
  categoryName: string | null
  categoryConfirmed: boolean
  skills: string[]
  budgetMin: number | null
  budgetMax: number | null
  currency: string | null
  budgetRaw: string | null
}

export const DETAIL_TIMEOUT_MS = 10_000
export const DETAIL_MAX_BYTES = 2 * 1024 * 1024
/** Minimum gap between two detail-fetch starts (single shared host budget). */
export const DETAIL_MIN_GAP_MS = 2_000
/** Per-project wait budget (queue + fetch) before giving up for notify purposes. */
export const ENRICHMENT_BUDGET_MS = 30_000

const CATEGORY_AR_TO_SLUG: Record<string, string> = {
  'أعمال': 'business',
  'برمجة، تطوير وبناء المواقع والتطبيقات': 'development',
  'برمجة': 'development',
  'تطوير': 'development',
  'ذكاء اصطناعي': 'ai-machine-learning',
  'هندسة، عمارة وتصميم داخلي': 'engineering-architecture',
  'هندسة وعمارة': 'engineering-architecture',
  'تصميم، فيديو وصوتيات': 'design',
  'تصميم': 'design',
  'تسويق إلكتروني ومبيعات': 'marketing',
  'تسويق': 'marketing',
  'كتابة، تحرير، ترجمة ولغات': 'writing-translation',
  'كتابة وترجمة': 'writing-translation',
  'دعم، مساعدة وإدخال بيانات': 'support',
  'تدريب وتعليم عن بعد': 'training',
  'تدريب': 'training'
}

function firstCategorySlug(html: string): string | null {
  // Breadcrumb is the authoritative in-page category anchor.
  const crumb = html.match(/breadcrumb-item"[^>]*data-index="2"[^>]*>\s*<a[^>]*href="https:\/\/mostaql\.com\/projects\/([a-z0-9-]+)"/i)
  if (crumb && crumb[1]) return crumb[1]
  const anyCat = html.match(/<a[^>]*href="https:\/\/mostaql\.com\/projects\/([a-z0-9-]+)"[^>]*class="go-back"/i)
  if (anyCat && anyCat[1]) return anyCat[1]
  return null
}

/** Parse a fetched detail body. Pure — unit-tested against fixtures. */
export function parseDetail(html: string): EnrichmentData {
  const empty: EnrichmentData = {
    categorySlug: null,
    categoryName: null,
    categoryConfirmed: false,
    skills: [],
    budgetMin: null,
    budgetMax: null,
    currency: null,
    budgetRaw: null
  }
  if (!html || html.length < 500) return empty

  const slug = firstCategorySlug(html)
  const occ = html.match(/"occupationalCategory":\s*"([^"]{1,120})"/)
  const occName = occ && occ[1] ? occ[1].trim() : null

  let categorySlug: string | null = null
  let categoryName: string | null = null
  let confirmed = false
  if (slug) {
    categorySlug = slug
    categoryName = occName
    confirmed = true
  } else if (occName) {
    const mapped = CATEGORY_AR_TO_SLUG[occName] ?? null
    categoryName = occName
    if (mapped) {
      categorySlug = mapped
      confirmed = true
    }
  }

  const skills: string[] = []
  const skillRe = /href="https:\/\/mostaql\.com\/projects\/skill\/[a-z0-9-]+"[^>]*>\s*(?:<i[^>]*><\/i>\s*)?<bdi>([^<]{1,80})<\/bdi>/gi
  let m: RegExpExecArray | null
  while ((m = skillRe.exec(html)) !== null) {
    const name = (m[1] ?? '').trim()
    if (name && !skills.includes(name)) skills.push(name)
    if (skills.length >= 30) break
  }

  let budgetMin: number | null = null
  let budgetMax: number | null = null
  let currency: string | null = null
  let budgetRaw: string | null = null
  const budgetZone = html.match(/project-budget_range[\s\S]{0,400}?<span[^>]*>([^<]{1,80})<\/span>/i)
  const budgetText = budgetZone && budgetZone[1] ? budgetZone[1].trim() : null
  if (budgetText) {
    const range = budgetText.match(/\$\s*([\d,]+(?:\.\d+)?)\s*-\s*\$\s*([\d,]+(?:\.\d+)?)/)
    if (range && range[1] && range[2]) {
      budgetMin = Number(range[1].replace(/,/g, ''))
      budgetMax = Number(range[2].replace(/,/g, ''))
      if (Number.isFinite(budgetMin) && Number.isFinite(budgetMax)) {
        currency = 'USD'
        budgetRaw = budgetText.slice(0, 80)
      } else {
        budgetMin = budgetMax = null
        currency = null
        budgetRaw = null
      }
    }
  }

  return { categorySlug, categoryName, categoryConfirmed: confirmed, skills, budgetMin, budgetMax, currency, budgetRaw }
}

export type DetailFetchKind = 'timeout' | 'cancelled' | 'http' | 'network' | 'too_large' | 'invalid_content'

export interface DetailFetchResult {
  ok: boolean
  html?: string
  kind?: DetailFetchKind
  status?: number | null
  retryAfterMs?: number | null
}

export async function fetchDetail(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<DetailFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DETAIL_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DETAIL_MAX_BYTES
  const impl = opts.fetchImpl ?? fetch
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, kind: 'invalid_content' }
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'mostaql.com') {
    return { ok: false, kind: 'invalid_content' }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const cancel = (): void => ctrl.abort()
  opts.signal?.addEventListener('abort', cancel, { once: true })
  try {
    const res = await impl(u.toString(), {
        headers: { 'User-Agent': 'RASED/0.1 (+local Windows watcher)', Accept: 'text/html' },
        redirect: 'follow',
        signal: ctrl.signal
      })
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'), Date.now())
      return { ok: false, kind: 'http', status: res.status, retryAfterMs }
    }
    const reader = res.body?.getReader()
    if (!reader) return { ok: false, kind: 'invalid_content' }
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          try {
            await reader.cancel()
          } catch {
            /* ignore */
          }
          return { ok: false, kind: 'too_large' }
        }
        chunks.push(value)
      }
    }
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      buf.set(c, off)
      off += c.byteLength
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (html.length < 500) return { ok: false, kind: 'invalid_content' }
    return { ok: true, html }
  } catch (err) {
    return { ok: false, kind: opts.signal?.aborted ? 'cancelled' : ctrl.signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

// ---- Serial queue: one job at a time, RSS keeps priority ---------------

export interface EnrichmentJob {
  projectId: number
  url: string
  enqueuedAtMs: number
}

export interface EnrichmentQueueDeps {
  budget?: DetailBudget
  fetchImpl?: typeof fetch
  nowMs?: () => number
  /** false pauses the queue (app paused, backing off) without dropping jobs */
  gateOpen?: () => boolean
  onTransportFailure?: (kind: DetailFetchKind | 'http5xx' | 'forbidden' | 'rate_limited', retryAfterMs: number | null) => void
  onDone?: (projectId: number, data: EnrichmentData | null) => void
}

export class EnrichmentQueue {
  private jobs: EnrichmentJob[] = []
  private busy = false
  private lastStartMs = 0
  private activeController: AbortController | null = null
  private activeProjectId: number | null = null
  private dropped = new Set<number>()
  private readonly deps: Required<Omit<EnrichmentQueueDeps, 'onTransportFailure' | 'onDone'>> &
    Pick<EnrichmentQueueDeps, 'onTransportFailure' | 'onDone'>

  constructor(deps: EnrichmentQueueDeps = {}) {
    this.deps = {
      budget: deps.budget ?? new DetailBudget(DETAIL_MIN_GAP_MS),
      fetchImpl: deps.fetchImpl ?? fetch,
      nowMs: deps.nowMs ?? Date.now,
      gateOpen: deps.gateOpen ?? (() => true),
      onTransportFailure: deps.onTransportFailure,
      onDone: deps.onDone
    }
  }

  get size(): number {
    return this.jobs.length + (this.busy ? 1 : 0)
  }

  get isBusy(): boolean { return this.busy }

  abortActive(): void { this.activeController?.abort() }

  enqueue(projectId: number, url: string): void {
    if (this.jobs.some((j) => j.projectId === projectId)) return
    this.jobs.push({ projectId, url, enqueuedAtMs: this.deps.nowMs() })
    // New matching-affecting work first; bounded queue.
    if (this.jobs.length > 50) this.jobs.splice(0, this.jobs.length - 50)
  }

  drop(projectId: number): void {
    this.jobs = this.jobs.filter((j) => j.projectId !== projectId)
    if (this.activeProjectId === projectId) { this.dropped.add(projectId); this.activeController?.abort() }
  }

  pendingIds(): number[] {
    return this.jobs.map((j) => j.projectId)
  }

  /** Process at most one job; returns true when a fetch actually started. */
  async pump(): Promise<boolean> {
    if (this.busy || this.jobs.length === 0) return false
    if (!this.deps.gateOpen()) return false
    const now = this.deps.nowMs()
    if (now - this.lastStartMs < DETAIL_MIN_GAP_MS) return false
    if (!this.deps.budget.claim(now)) return false
    const job = this.jobs.shift()
    if (!job) return false
    this.busy = true
    this.lastStartMs = now
    const controller = new AbortController()
    this.activeController = controller
    this.activeProjectId = job.projectId
    try {
      const res = await fetchDetail(job.url, { fetchImpl: this.deps.fetchImpl, signal: controller.signal })
      if (this.dropped.has(job.projectId)) return true
      if (res.kind === 'cancelled') {
        this.jobs.unshift(job)
        return true
      }
      if (res.ok && res.html) {
        this.deps.onDone?.(job.projectId, parseDetail(res.html))
      } else {
        if (res.kind === 'http' && typeof res.status === 'number') {
          if (res.status === 429 || res.status >= 500) {
            this.deps.onTransportFailure?.(res.status === 429 ? 'rate_limited' : 'http5xx', res.retryAfterMs ?? null)
          } else if (res.status === 401 || res.status === 403) {
            this.deps.onTransportFailure?.('forbidden', res.retryAfterMs ?? null)
          }
        } else if (res.kind === 'timeout' || res.kind === 'network') {
          this.deps.onTransportFailure?.(res.kind, null)
        }
        this.deps.onDone?.(job.projectId, null)
      }
    } finally {
      this.activeController = null
      this.activeProjectId = null
      this.dropped.delete(job.projectId)
      this.deps.budget.release()
      this.busy = false
    }
    return true
  }
}
