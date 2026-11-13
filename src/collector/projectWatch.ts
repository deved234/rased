// Dormant, pure parsers for the future project-watch feature. Nothing imports
// this module yet: it only classifies a saved response and reads the labeled
// snapshot panels. Values are never taken from descriptions or offer prose.
//
// The document is tokenized once by `scanHtml` and every query runs on that
// lenient tree, so no regular expression ever walks the raw HTML. The only
// regex over the whole body is the narrow challenge marker below.

import {
  WATCH_OFFERS_PAGE_CAP,
  type WatchPage,
  type WatchPlatformStatus,
  type WatchSnapshot,
  type WatchSource
} from '../shared/projectWatch.js'
import {
  attribute,
  childElements,
  closest,
  descendants,
  find,
  findAll,
  hasClass,
  nextElementSibling,
  readText,
  scanHtml,
  MAX_DEPTH,
  type ElementNode,
  type TextRead
} from './htmlScan.js'

const MAX_HTML_CHARS = 3_000_000
// Only elements with a tiny subtree can be headings or label cells: anything
// bigger is a container, never a value, and is skipped before any text() walk.
const SMALL_SUBTREE = 8
// Bound each marker read, not the number of unrelated elements preceding it.
const MARKER_RAW_CHARS = 256
// Same protection-challenge markers the KAF fetcher already trusts.
const CHALLENGE_RE = /cf-chl-|challenge-form|<title>\s*Just a moment/i

const MOSTAQL_PANEL_ID = 'project-meta-panel'
const MOSTAQL_WIDGET_ATTR = 'employer_widget'
const MOSTAQL_BIDS_ID = 'bidsCollection-panel'
const MOSTAQL_STATUS_LABEL = 'حالة المشروع'
const MOSTAQL_STATUS_TOKEN = /^label-prj-([a-z-]{1,20})$/
const MOSTAQL_STATUS: ReadonlyMap<string, WatchPlatformStatus> = new Map<string, WatchPlatformStatus>([
  ['open', 'open'],
  ['processing', 'in_progress'],
  ['closed', 'closed'],
  ['completed', 'completed']
])

const NAFEZLY_HEADING_TEXT = 'بطاقة المشروع'
const NAFEZLY_STATUS_LABEL = 'حالة المشروع'
const NAFEZLY_OFFERS_LABEL = 'عدد المتقدمين'
const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g

const KAF_INFO_HEADING = 'معلومات المشروع'
const KAF_OFFERS_LABEL = 'عدد العروض'

const NAFEZLY_PRIVATE_TITLE = 'خطأ 403 | نفذلي'
const NAFEZLY_PRIVATE_BODY = '403 | غير مصرح لك بتنفيذ هذه العملية'
const KAF_PRIVATE_BODY = '403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة'

const INVALID: WatchPage = { kind: 'invalid' }

function classTokens(el: ElementNode): string[] {
  const value = attribute(el, 'class')
  return value === null ? [] : value.split(/\s+/).filter(token => token.length > 0)
}

/** ASCII, Arabic-Indic or Extended Arabic-Indic digits, 1-9 of them. */
function parseCount(value: string): number | null {
  if (!/^[0-9\u0660-\u0669\u06f0-\u06f9]{1,9}$/.test(value)) return null
  let total = 0
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    const digit = code <= 0x39 ? code - 0x30 : code <= 0x669 ? code - 0x660 : code - 0x6f0
    total = total * 10 + digit
  }
  return total
}

/**
 * Label/value rows of a two-column table; later rows win over earlier ones.
 * Values keep their truncation flag so an integer is never fabricated.
 */
function readLabelRows(table: ElementNode, limit = 200): Map<string, TextRead> {
  const rows = new Map<string, TextRead>()
  for (const row of findAll(table, el => el.name === 'tr', limit)) {
    const cells = childElements(row).filter(cell => cell.name === 'td' || cell.name === 'th')
    if (cells.length !== 2) continue
    const label = readExact(cells[0]!, 60)
    if (label === null) continue
    rows.set(label, readText(cells[1]!, 60))
  }
  return rows
}

/** A count is only real when its cell ended inside the cap and is pure digits. */
function countOf(rows: Map<string, TextRead>, label: string): number | null {
  const read = rows.get(label)
  if (read === undefined || read.truncated) return null
  return parseCount(read.value)
}

/** Small enough to be a heading or a label cell rather than a container. */
function isSmall(el: ElementNode): boolean {
  return el.size <= SMALL_SUBTREE
}

/**
 * Exact-match text: null when the value was cut short, so a truncated cell can
 * never be mapped to a status, a label or a page marker.
 */
function readExact(el: ElementNode, max: number): string | null {
  const read = readText(el, max)
  return read.truncated ? null : read.value
}

/** O(1) eligibility check before decoding any candidate marker text. */
function readMarker(el: ElementNode, max: number): string | null {
  if (!isSmall(el) || el.rawTextLength > MARKER_RAW_CHARS) return null
  return readExact(el, max)
}

function isMostaqlProjectsUrl(finalUrl: string | undefined): boolean {
  if (typeof finalUrl !== 'string' || finalUrl.length === 0) return false
  let url: URL
  try {
    url = new URL(finalUrl)
  } catch {
    return false
  }
  return url.protocol === 'https:' &&
    url.hostname === 'mostaql.com' &&
    (url.pathname === '/projects' || url.pathname === '/projects/')
}

/** The Mostaql listing page a removed project is redirected to. */
function isMostaqlListing(root: ElementNode): boolean {
  const title = find(root, el => el.name === 'title' &&
    readMarker(el, 120)?.startsWith('المشاريع المفتوحة') === true)
  if (title === null) return false
  return find(root, el => attribute(el, 'id') === 'filter-projects') !== null
}

// Remaining limit: a block page that is byte-identical to the site's own
// private-project page cannot be distinguished by content.
const VETO_PREFIXES = [
  'cf-error',
  'cf-wrapper',
  'cf-browser-verification',
  'cf-challenge',
  'cf-turnstile',
  'challenge-',
  'g-recaptcha',
  'h-captcha',
  'captcha'
]
const VETO_TEXT_RE = /access denied|too many requests|rate limit|temporarily blocked|maintenance|صيانة|محظور|تم حظر|طلبات كثيرة/i

function hasPrivateVeto(root: ElementNode): boolean {
  const visible = readText(root, 200_000, 200_000)
  if (visible.truncated || VETO_TEXT_RE.test(visible.value)) return true
  for (const node of descendants(root)) {
    if (node.type !== 'element' || node.inert) continue
    const id = attribute(node, 'id')
    if (id !== null) {
      const lowerId = id.toLowerCase()
      if (VETO_PREFIXES.some(p => lowerId.startsWith(p) || lowerId.split(/\s+/).some(t => t.startsWith(p)))) return true
    }
    const classes = classTokens(node)
    if (classes.some(t => {
      const lower = t.toLowerCase()
      return VETO_PREFIXES.some(p => lower.startsWith(p))
    })) return true
    if (node.name === 'input' && attribute(node, 'type')?.toLowerCase() === 'password') return true
  }
  return false
}

function isPrivatePage(root: ElementNode, source: 'kaf' | 'nafezly'): boolean {
  if (source === 'nafezly') {
    const title = find(root, el => el.name === 'title' && readMarker(el, 120) === NAFEZLY_PRIVATE_TITLE)
    if (title === null) return false
    return find(root, el => el.name === 'h3' && readMarker(el, 120) === NAFEZLY_PRIVATE_BODY) !== null
  }
  // Check each description once, even with nested help-center containers.
  return find(root, el => el.name === 'p' && hasClass(el, 'about-desc') &&
    readMarker(el, 160) === KAF_PRIVATE_BODY && el.parent !== null &&
    closest(el.parent, parent => hasClass(parent, 'help-center'), MAX_DEPTH) !== null) !== null
}

// ------------------------------------------------------------------ mostaql

function mostaqlStatus(panel: ElementNode): WatchPlatformStatus | null {
  const row = find(panel, el =>
    hasClass(el, 'meta-row') &&
    childElements(el).some(child => hasClass(child, 'meta-label') && isSmall(child) &&
      readExact(child, 60) === MOSTAQL_STATUS_LABEL)
  )
  if (row === null) return null
  const value = childElements(row).find(child => hasClass(child, 'meta-value'))
  if (value === undefined) return null
  for (const node of descendants(value)) {
    if (node.type !== 'element') continue
    for (const token of classTokens(node)) {
      const match = MOSTAQL_STATUS_TOKEN.exec(token)
      if (match === null) continue
      // Map lookups only: `constructor` and `toString` stay 'unknown'.
      return MOSTAQL_STATUS.get(match[1]!) ?? 'unknown'
    }
  }
  return null
}

interface MostaqlClient {
  contacts: number | null
  clientOpen: number | null
  clientInProgress: number | null
}

function mostaqlClient(widget: ElementNode): MostaqlClient {
  const client: MostaqlClient = { contacts: null, clientOpen: null, clientInProgress: null }
  const table = find(widget, el => el.name === 'table')
  if (table === null) return client
  const rows = readLabelRows(table)
  client.contacts = countOf(rows, 'التواصلات الجارية')
  client.clientOpen = countOf(rows, 'المشاريع المفتوحة')
  client.clientInProgress = countOf(rows, 'مشاريع قيد التنفيذ')
  return client
}

function mostaqlOffers(root: ElementNode): number | null {
  const panel = find(root, el => attribute(el, 'id') === MOSTAQL_BIDS_ID)
  if (panel === null) return null
  const ids = new Set<string>()
  for (const node of descendants(panel)) {
    if (node.type !== 'element') continue
    const value = attribute(node, 'data-bid-item')
    if (value !== null && /^\d{1,12}$/.test(value)) ids.add(value)
  }
  return ids.size
}

function mostaqlSnapshot(root: ElementNode): WatchSnapshot | null {
  const panel = find(root, el => attribute(el, 'id') === MOSTAQL_PANEL_ID)
  const widget = find(root, el => attribute(el, 'data-type') === MOSTAQL_WIDGET_ATTR)
  if (panel === null && widget === null) return null
  const client = widget === null
    ? { contacts: null, clientOpen: null, clientInProgress: null }
    : mostaqlClient(widget)
  const offers = mostaqlOffers(root)
  return {
    status: panel === null ? null : mostaqlStatus(panel),
    offers,
    offersCapped: offers === WATCH_OFFERS_PAGE_CAP,
    ...client
  }
}

// ------------------------------------------------------------------ nafezly

function nafezlyStatus(value: string): WatchPlatformStatus | null {
  const plain = value.replace(ARABIC_DIACRITICS, '').trim()
  if (plain.length === 0) return null
  if (plain === 'مفتوح') return 'open'
  if (plain === 'مغلق') return 'closed'
  if (plain === 'مكتمل') return 'completed'
  if (plain === 'قيد التنفيذ') return 'in_progress'
  return 'unknown'
}

/**
 * The card must be the very next element sibling of the heading (or of an
 * ancestor up to 3 levels). While climbing, every ancestor on the way may hold
 * nothing but the chain we came from, so no unrelated element can sit between
 * the heading and the card.
 */
function nafezlyCard(heading: ElementNode): ElementNode | null {
  let scope: ElementNode | null = heading
  let child: ElementNode | null = null
  for (let level = 0; scope !== null && level <= 3; level++) {
    if (child !== null) {
      // Stop at the first unrelated child instead of repeatedly copying a
      // large ancestor's children for every matching heading on the page.
      for (const sibling of scope.children) {
        if (sibling.type === 'element' && !sibling.inert && sibling !== child) return null
      }
    }
    const sibling = nextElementSibling(scope)
    if (sibling !== null && !sibling.inert && sibling.name === 'div' &&
      hasClass(sibling, 'col-12') && hasClass(sibling, 'row') && hasClass(sibling, 'p-3')) {
      return sibling
    }
    child = scope
    scope = scope.parent
    if (scope !== null && scope.name === '#document') return null
  }
  return null
}

function nafezlyFromCard(card: ElementNode): WatchSnapshot {
  let status: WatchPlatformStatus | null = null
  let offers: number | null = null
  for (const row of childElements(card)) {
    if (row.name !== 'div' || row.inert) continue
    const cells = childElements(row).filter(cell => cell.name === 'div')
    if (cells.length < 2) continue
    const labelCell = cells[0]!
    if (!hasClass(labelCell, 'col-6') || !isSmall(labelCell)) continue
    const label = readExact(labelCell, 60)
    if (label === null) continue
    const value = readText(cells[1]!, 120)
    if (label === NAFEZLY_STATUS_LABEL) status = value.truncated ? 'unknown' : nafezlyStatus(value.value)
    else if (label === NAFEZLY_OFFERS_LABEL) offers = value.truncated ? null : parseCount(value.value)
  }
  return { status, offers, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null }
}

function nafezlySnapshot(root: ElementNode): WatchSnapshot | null {
  for (const heading of descendants(root)) {
    if (heading.type !== 'element' || heading.name !== 'div' ||
      readMarker(heading, 40) !== NAFEZLY_HEADING_TEXT) continue
    const card = nafezlyCard(heading)
    if (card !== null) return nafezlyFromCard(card)
  }
  return null
}

// ----------------------------------------------------------------------- kaf

function kafStage(root: ElementNode): WatchPlatformStatus | null {
  const container = find(root, el => hasClass(el, 'steps-container'))
  if (container === null) return null
  const step = find(container, el => el.name === 'div' && hasClass(el, 'step') && hasClass(el, 'current'))
  if (step === null) return null
  const title = find(step, el => el.name === 'span' && hasClass(el, 'title'))
  if (title === null) return 'unknown'
  const value = readExact(title, 200)
  if (value === null) return 'unknown'
  if (value.includes('تلقي العروض')) return 'open'
  if (value.includes('التنفيذ')) return 'in_progress'
  if (value.includes('الإستلام') || value.includes('الاستلام')) return 'completed'
  return 'unknown'
}

/**
 * The info table of the «معلومات المشروع» section: the first heading whose
 * parent is a `block-head`, then the IMMEDIATE next sibling of that `block-head`
 * (which must be a `block-body`), then an `info-table` inside that body only.
 */
function kafInfoTable(root: ElementNode): ElementNode | null {
  const heading = find(root, el =>
    (el.name === 'p' || el.name === 'div') &&
    el.parent !== null && hasClass(el.parent, 'block-head') &&
    readMarker(el, 60) === KAF_INFO_HEADING)
  if (heading === null) return null
  const body = nextElementSibling(heading.parent!)
  if (body === null || body.inert || body.name !== 'div' || !hasClass(body, 'block-body')) return null
  return find(body, el => el.name === 'table' && hasClass(el, 'info-table'))
}

function kafSnapshot(root: ElementNode): WatchSnapshot | null {
  const steps = find(root, el => hasClass(el, 'steps-container'))
  const table = kafInfoTable(root)
  if (steps === null && table === null) return null
  const offers = table === null ? null : countOf(readLabelRows(table), KAF_OFFERS_LABEL)
  return {
    status: kafStage(root),
    offers,
    // The 50-offer page cap is a Mostaql-only concept.
    offersCapped: false,
    contacts: null,
    clientOpen: null,
    clientInProgress: null
  }
}

// --------------------------------------------------------------- entry point

/**
 * Classify one saved response. Pure: no IO, no clock, no network.
 * Response defaults to a 200 without a final URL.
 */
export function parseWatchPage(
  html: string,
  source: WatchSource,
  response: { status?: number; finalUrl?: string } = {}
): WatchPage {
  const status = response.status

  // A removed project answers 404/410, whatever the body says (even nothing).
  if (status === 404 || status === 410) return { kind: 'gone' }
  // Only the first 3 MB are ever inspected; a challenge there wins over content.
  if (CHALLENGE_RE.test(html.slice(0, MAX_HTML_CHARS))) return { kind: 'challenge' }
  if (html.length > MAX_HTML_CHARS) return INVALID
  if (html.trim().length === 0) return INVALID

  const scanned = scanHtml(html)
  if (!scanned.ok) return INVALID
  const root = scanned.root

  const snapshot = source === 'mostaql'
    ? mostaqlSnapshot(root)
    : source === 'nafezly'
      ? nafezlySnapshot(root)
      : kafSnapshot(root)
  if (snapshot !== null) return { kind: 'snapshot', snapshot }

  if (
    (source === 'kaf' || source === 'nafezly') &&
    status === 403 &&
    !hasPrivateVeto(root) &&
    isPrivatePage(root, source)
  ) {
    return { kind: 'private' }
  }
  if (
    source === 'mostaql' &&
    (status === undefined || status === 200) &&
    isMostaqlProjectsUrl(response.finalUrl) &&
    isMostaqlListing(root)
  ) {
    return { kind: 'gone' }
  }
  return INVALID
}

export const PRIVATE_PAGE_MAX_CHARS = 256 * 1024
export const PRIVATE_PAGE_MAX_TAGS = 30_000

function countTags(html: string): number {
  let count = 0
  for (let i = 0; i < html.length; i++) {
    if (html.charCodeAt(i) === 60 /* '<' */) count++
  }
  return count
}

export function isPrivateProjectPage(html: string, source: 'nafezly' | 'kaf'): boolean {
  if (html.length > PRIVATE_PAGE_MAX_CHARS) return false
  if (countTags(html) > PRIVATE_PAGE_MAX_TAGS) return false
  return parseWatchPage(html, source, { status: 403 }).kind === 'private'
}
