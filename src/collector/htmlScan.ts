// Dependency-free, strictly linear HTML tokenizer + lenient tree builder.
// One forward index over the input; no regex ever runs over an unbounded slice.
// Failures are returned, never thrown, so callers can fail safe.

export const MAX_INPUT_CHARS = 3_000_000
export const MAX_NODES = 250_000
export const MAX_DEPTH = 512
export const MAX_TAG_CHARS = 20_000
export const MAX_ATTRS = 200

export type ScanFailure = 'too-long' | 'too-many-nodes' | 'too-deep' | 'tag-too-long' | 'too-many-attrs'

export interface ElementNode {
  type: 'element'
  name: string
  attrs: Map<string, string>
  children: HtmlNode[]
  parent: ElementNode | null
  /** Position among the parent's children; sibling walks start here, not at 0. */
  index: number
  /** True for template/noscript/svg/math and everything inside them: never queried. */
  inert: boolean
  /** True for svg/math and everything inside them: self-closing tags are honoured. */
  foreign: boolean
  /** Query budget: descendant nodes, counting each inert subtree as one node. */
  size: number
  /** Raw text length outside inert subtrees, before entity decoding or normalization. */
  rawTextLength: number
}

export interface TextNode {
  type: 'text'
  text: string
  parent: ElementNode | null
  index: number
}

export type HtmlNode = ElementNode | TextNode

export type ScanResult = { ok: true; root: ElementNode } | { ok: false; reason: ScanFailure }

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'
])
// RCDATA: text only until the real closing tag, but the text is kept as a node.
const RCDATA_ELEMENTS = new Set(['title', 'textarea'])
// Raw text: content is dropped entirely.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes'])
// Inert or unsupported subtrees: parsed normally, but never exposed to queries.
const INERT_ELEMENTS = new Set(['template', 'noscript', 'svg', 'math'])
// Start tags that close an open <p>.
const P_CLOSERS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'ul'
])

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' }
const ENTITY = /&(amp|lt|gt|quot|#39|nbsp);|&#([0-9]{1,7});|&#[xX]([0-9a-fA-F]{1,7});/g

function isSpace(code: number): boolean {
  // space, tab, LF, FF, CR
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13
}

function isBoundary(code: number): boolean {
  // whitespace, '/', '>' or end of input
  return code === 47 || code === 62 || isSpace(code) || Number.isNaN(code)
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isNameChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 45 || code === 58 || code === 95
}

function isScalar(code: number): boolean {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
}

function decodeEntities(value: string): string {
  if (value.indexOf('&') < 0) return value
  return value.replace(ENTITY, (match, named?: string, decimal?: string, hex?: string) => {
    if (named !== undefined) return NAMED_ENTITIES[named] ?? match
    const code = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex!, 16)
    return isScalar(code) ? String.fromCodePoint(code) : '\ufffd'
  })
}

/** `</name` at `at`, matched case-insensitively. */
function matchesCloseName(html: string, at: number, name: string): boolean {
  if (at + name.length > html.length) return false
  for (let i = 0; i < name.length; i++) {
    if ((html.charCodeAt(at + i) | 32) !== name.charCodeAt(i)) return false
  }
  return true
}

/** Position of the real closing tag of a raw/RCDATA element, or -1. */
function findRawClose(html: string, from: number, name: string): number {
  let i = from
  for (;;) {
    const lt = html.indexOf('<', i)
    if (lt < 0) return -1
    if (html.charCodeAt(lt + 1) === 47 && matchesCloseName(html, lt + 2, name) && isBoundary(html.charCodeAt(lt + 2 + name.length))) {
      return lt
    }
    i = lt + 1
  }
}

interface ParsedTag {
  name: string
  valid: boolean
  attrs: Map<string, string>
  end: number
  selfClosing: boolean
}

type TagRead = { ok: true; tag: ParsedTag } | { ok: false; reason: ScanFailure | 'eof' }

const FAIL_TAG: TagRead = { ok: false, reason: 'tag-too-long' }
const FAIL_ATTRS: TagRead = { ok: false, reason: 'too-many-attrs' }
const READ_EOF: TagRead = { ok: false, reason: 'eof' }

function readTag(html: string, lt: number, isEnd: boolean): TagRead {
  const n = html.length
  // First index the tag may not reach: a tag of exactly MAX_TAG_CHARS is allowed.
  const hardEnd = lt + MAX_TAG_CHARS + 1
  let i = lt + (isEnd ? 2 : 1)
  const nameStart = i
  let validName = true
  while (i < n && i < hardEnd) {
    const code = html.charCodeAt(i)
    if (code === 47 || code === 62 || isSpace(code)) break
    if (!isNameChar(code)) validName = false
    i++
  }
  if (i >= hardEnd) return FAIL_TAG
  if (i >= n) return READ_EOF
  const name = html.slice(nameStart, i).toLowerCase()
  const attrs = new Map<string, string>()
  let count = 0
  let selfClosing = false
  for (;;) {
    while (i < n && i < hardEnd && isSpace(html.charCodeAt(i))) i++
    if (i >= hardEnd) return FAIL_TAG
    if (i >= n) return READ_EOF
    const code = html.charCodeAt(i)
    if (code === 62) {
      i++
      break
    }
    if (code === 47 && html.charCodeAt(i + 1) === 62) {
      i += 2
      selfClosing = true
      break
    }
    const attrStart = i
    while (i < n && i < hardEnd) {
      const ch = html.charCodeAt(i)
      if (isSpace(ch) || ch === 61 || ch === 62 || ch === 47) break
      i++
    }
    if (i >= hardEnd) return FAIL_TAG
    if (i >= n) return READ_EOF
    if (i === attrStart) {
      i++
      continue
    }
    const attrName = (!isEnd && validName) ? html.slice(attrStart, i).toLowerCase() : ''
    while (i < n && i < hardEnd && isSpace(html.charCodeAt(i))) i++
    if (i >= hardEnd) return FAIL_TAG
    let value = ''
    if (html.charCodeAt(i) === 61) {
      i++
      while (i < n && i < hardEnd && isSpace(html.charCodeAt(i))) i++
      if (i >= hardEnd) return FAIL_TAG
      const quote = html.charCodeAt(i)
      if (quote === 34 || quote === 39) {
        // Scanned under the same tag budget: a value that never closes is a
        // too-long tag, not a valid EOF recovery.
        let close = i + 1
        while (close < n && close < hardEnd && html.charCodeAt(close) !== quote) close++
        if (close >= hardEnd) return FAIL_TAG
        if (close >= n) return READ_EOF
        if (!isEnd && validName) value = html.slice(i + 1, close)
        i = close + 1
      } else {
        const valueStart = i
        while (i < n && i < hardEnd) {
          const ch = html.charCodeAt(i)
          if (ch === 62 || isSpace(ch)) break
          i++
        }
        if (i >= hardEnd) return FAIL_TAG
        if (!isEnd && validName) value = html.slice(valueStart, i)
      }
    }
    count++
    if (count > MAX_ATTRS) return FAIL_ATTRS
    // First occurrence wins, exactly like the DOM.
    if (!isEnd && validName && !attrs.has(attrName)) attrs.set(attrName, decodeEntities(value))
  }
  if (i - lt > MAX_TAG_CHARS) return FAIL_TAG
  return { ok: true, tag: { name, valid: validName, attrs, end: i, selfClosing } }
}

/** Lenient document root of the built tree. */
function createRoot(): ElementNode {
  return {
    type: 'element', name: '#document', attrs: new Map(), children: [], parent: null, index: 0,
    inert: false, foreign: false, size: 0, rawTextLength: 0
  }
}

/** Tokenize and build a lenient tree in a single forward pass. */
export function scanHtml(html: string): ScanResult {
  if (html.length > MAX_INPUT_CHARS) return { ok: false, reason: 'too-long' }
  const root = createRoot()
  const open: ElementNode[] = [root]
  const openCounts = new Map<string, number>()
  // Stack of open indices of inert elements: the tree builder may never close
  // below the innermost one from inside it.
  const inertIndices: number[] = []
  const n = html.length
  let nodes = 1, i = 0
  const chunks: string[] = []
  let pendingLength = 0

  const pushOpen = (el: ElementNode): void => {
    open.push(el)
    openCounts.set(el.name, (openCounts.get(el.name) ?? 0) + 1)
    // Only a tag that is inert by its own name starts a new boundary; content
    // that is merely inert by ancestry is ordinary inside that boundary.
    if (INERT_ELEMENTS.has(el.name)) inertIndices.push(open.length - 1)
  }
  const popTo = (length: number): void => {
    while (open.length > length) {
      const el = open.pop()!
      if (INERT_ELEMENTS.has(el.name) && inertIndices[inertIndices.length - 1] === open.length) inertIndices.pop()
      const next = (openCounts.get(el.name) ?? 1) - 1
      if (next === 0) openCounts.delete(el.name)
      else openCounts.set(el.name, next)
    }
  }
  // Index of the innermost open inert element, or 0 when none is open. Nothing
  // below this floor may ever be closed from inside: it is a hard boundary.
  const floor = (): number => inertIndices.length === 0 ? 0 : inertIndices[inertIndices.length - 1]!

  /**
   * Minimal implied end tags. The cheap name count keeps this O(1) when the
   * document has no matching open element, so a deep tree never turns every
   * start tag into a stack walk. Only elements above the inert floor qualify.
   */
  const closeImplied = (name: string): void => {
    const limit = floor()
    if (P_CLOSERS.has(name)) {
      if ((openCounts.get('p') ?? 0) === 0) return
      for (let k = open.length - 1; k > limit; k--) {
        if (open[k]!.name === 'p') {
          popTo(k)
          return
        }
      }
      return
    }
    if (name === 'li') {
      if ((openCounts.get('li') ?? 0) === 0) return
      for (let k = open.length - 1; k > limit; k--) {
        const openName = open[k]!.name
        if (openName === 'ul' || openName === 'ol') return
        if (openName === 'li') {
          popTo(k)
          return
        }
      }
      return
    }
    if (name === 'tr') {
      if ((openCounts.get('tr') ?? 0) === 0) return
      for (let k = open.length - 1; k > limit; k--) {
        const openName = open[k]!.name
        if (openName === 'table') return
        if (openName === 'tr') {
          popTo(k)
          return
        }
      }
      return
    }
    if (name === 'td' || name === 'th') {
      if ((openCounts.get('td') ?? 0) === 0 && (openCounts.get('th') ?? 0) === 0) return
      for (let k = open.length - 1; k > limit; k--) {
        const openName = open[k]!.name
        if (openName === 'table' || openName === 'tr') return
        if (openName === 'td' || openName === 'th') {
          popTo(k)
          return
        }
      }
      return
    }
    if (name === 'option') {
      if ((openCounts.get('option') ?? 0) === 0) return
      for (let k = open.length - 1; k > limit; k--) {
        const openName = open[k]!.name
        if (openName === 'select' || openName === 'datalist' || openName === 'optgroup') return
        if (openName === 'option') {
          popTo(k)
          return
        }
      }
    }
  }

  const appendText = (value: string): void => {
    if (value.length === 0) return
    chunks.push(value)
    pendingLength += value.length
  }
  const flush = (): ScanFailure | null => {
    if (pendingLength === 0) return null
    const parent = open[open.length - 1]!
    parent.children.push({ type: 'text', text: chunks.join(''), parent, index: parent.children.length })
    chunks.length = 0
    pendingLength = 0
    nodes++
    return nodes > MAX_NODES ? 'too-many-nodes' : null
  }

  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      appendText(html.slice(i))
      break
    }
    if (lt > i) appendText(html.slice(i, lt))
    const next = html.charCodeAt(lt + 1)

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      if (end < 0) break // unterminated comment consumes the rest, once
      i = end + 3
      continue
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9)
      if (end < 0) break
      i = end + 3
      continue
    }
    if (next === 63) { // <? … >
      const end = html.indexOf('>', lt + 2)
      if (end < 0) break
      i = end + 1
      continue
    }
    if (next === 33) {
      const isDoctype = matchesCloseName(html, lt + 2, 'doctype') &&
        (html.charCodeAt(lt + 9) === 62 || isSpace(html.charCodeAt(lt + 9)))
      if (!isDoctype) {
        const end = html.indexOf('>', lt + 2)
        if (end < 0) break
        i = end + 1
        continue
      }
      const hardEnd = lt + MAX_TAG_CHARS + 1
      let j = lt + 2
      while (j < n && j < hardEnd) {
        const code = html.charCodeAt(j)
        if (code === 62) {
          j++
          break
        }
        if (code === 34 || code === 39) {
          j++
          while (j < n && j < hardEnd && html.charCodeAt(j) !== code) j++
          if (j < n && j < hardEnd) j++
          continue
        }
        j++
      }
      if (j >= hardEnd) return { ok: false, reason: 'tag-too-long' }
      if (j >= n && html.charCodeAt(j - 1) !== 62) break
      i = j
      continue
    }
    if (next === 47) { // closing tag
      if (!isAsciiLetter(html.charCodeAt(lt + 2))) {
        appendText('<')
        i = lt + 1
        continue
      }
      const read = readTag(html, lt, true)
      if (!read.ok) {
        if (read.reason === 'eof') break
        return { ok: false, reason: read.reason }
      }
      i = read.tag.end
      if (!read.tag.valid) continue
      const failure = flush()
      if (failure) return { ok: false, reason: failure }
      const name = read.tag.name
      // No open element has this name: nothing to close, no stack walk.
      if ((openCounts.get(name) ?? 0) === 0) continue
      // An open inert element is a hard boundary: an end tag may only close
      // elements opened inside it, or inert elements from inside their own
      // subtree by their own name. Everything below is out of reach.
      const limit = floor()
      let target = -1
      for (let k = open.length - 1; k > limit; k--) {
        if (open[k]!.name === name) {
          target = k
          break
        }
      }
      if (target < 0 && limit > 0 && open[limit]!.name === name) target = limit
      if (target >= 0) popTo(target)
      continue
    }
    if (!isAsciiLetter(next)) {
      appendText('<')
      i = lt + 1
      continue
    }

    const read = readTag(html, lt, false)
    if (!read.ok) {
      if (read.reason === 'eof') break
      return { ok: false, reason: read.reason }
    }
    i = read.tag.end
    if (!read.tag.valid) continue
    const failure = flush()
    if (failure) return { ok: false, reason: failure }
    closeImplied(read.tag.name)
    const parent = open[open.length - 1]!
    const inert = parent.inert || INERT_ELEMENTS.has(read.tag.name)
    const foreign = parent.foreign || read.tag.name === 'svg' || read.tag.name === 'math'
    const element: ElementNode = {
      type: 'element',
      name: read.tag.name,
      attrs: read.tag.attrs,
      children: [],
      parent,
      index: parent.children.length,
      inert,
      foreign,
      size: 0,
      rawTextLength: 0
    }
    parent.children.push(element)
    nodes++
    if (nodes > MAX_NODES) return { ok: false, reason: 'too-many-nodes' }
    i = read.tag.end
    if (VOID_ELEMENTS.has(element.name)) continue
    // Outside foreign content a self-closing slash is ignored: the element opens.
    if (read.tag.selfClosing && foreign) continue
    pushOpen(element)
    if (open.length - 1 > MAX_DEPTH) return { ok: false, reason: 'too-deep' }

    if (element.name === 'plaintext') {
      // plaintext never ends: the rest of the document is content, not markup.
      break
    }
    if (RCDATA_ELEMENTS.has(element.name)) {
      const close = findRawClose(html, i, element.name)
      appendText(html.slice(i, close < 0 ? n : close))
      const textFailure = flush()
      if (textFailure) return { ok: false, reason: textFailure }
      if (close < 0) break
      const read = readTag(html, close, true)
      if (!read.ok) {
        if (read.reason === 'eof') break
        return { ok: false, reason: read.reason }
      }
      i = read.tag.end
      popTo(open.length - 1)
      continue
    }
    if (RAW_TEXT_ELEMENTS.has(element.name)) {
      const close = findRawClose(html, i, element.name)
      if (close < 0) break // unterminated raw text drops the rest, once
      const read = readTag(html, close, true)
      if (!read.ok) {
        if (read.reason === 'eof') break
        return { ok: false, reason: read.reason }
      }
      i = read.tag.end
      popTo(open.length - 1)
      continue
    }
  }
  const failure = flush()
  if (failure) return { ok: false, reason: failure }
  computeSizes(root)
  return { ok: true, root }
}

/**
 * Post-order pass: `size` counts the descendant nodes a text query would visit.
 * An inert subtree contributes only its root, because queries never enter it.
 * Raw text lengths are summed without reading or decoding the text itself.
 */
function computeSizes(root: ElementNode): void {
  const order: ElementNode[] = []
  const stack: ElementNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    order.push(node)
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]!
      if (child.type === 'element') stack.push(child)
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]!
    let size = 0
    let rawTextLength = 0
    for (const child of node.children) {
      size += 1
      if (child.type === 'element' && !child.inert) size += child.size
      if (!node.inert) rawTextLength += child.type === 'text' ? child.text.length : child.rawTextLength
    }
    node.size = size
    node.rawTextLength = rawTextLength
  }
}

// ------------------------------------------------------------------ queries

export function isElement(node: HtmlNode): node is ElementNode {
  return node.type === 'element'
}

export function attribute(el: ElementNode, name: string): string | null {
  return el.attrs.get(name) ?? null
}

export function hasClass(el: ElementNode, token: string): boolean {
  const value = el.attrs.get('class')
  if (value === undefined) return false
  return value.split(/\s+/).includes(token)
}

export function childElements(el: ElementNode): ElementNode[] {
  const out: ElementNode[] = []
  for (const child of el.children) if (child.type === 'element' && !child.inert) out.push(child)
  return out
}

/** Depth-first, document-order iterator over every visible descendant node. */
export function* descendants(el: ElementNode): Generator<HtmlNode> {
  // Inert subtrees (template/noscript/svg/math) are never queried.
  if (el.inert) return
  const stack: HtmlNode[] = []
  for (let i = el.children.length - 1; i >= 0; i--) {
    const child = el.children[i]!
    if (child.type === 'element' && child.inert) continue
    stack.push(child)
  }
  while (stack.length > 0) {
    const node = stack.pop()!
    yield node
    if (node.type === 'element') {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i]!
        if (child.type === 'element' && child.inert) continue
        stack.push(child)
      }
    }
  }
}

/** First descendant element matching the predicate, or null. */
export function find(el: ElementNode, predicate: (node: ElementNode) => boolean): ElementNode | null {
  for (const node of descendants(el)) {
    if (node.type === 'element' && predicate(node)) return node
  }
  return null
}

/** First `limit` descendants matching the predicate. */
export function findAll(el: ElementNode, predicate: (node: ElementNode) => boolean, limit = 100): ElementNode[] {
  const out: ElementNode[] = []
  for (const node of descendants(el)) {
    if (node.type !== 'element' || !predicate(node)) continue
    out.push(node)
    if (out.length >= limit) break
  }
  return out
}

/** Element that follows `el` among its parent's children. O(distance to next element). */
export function nextElementSibling(el: ElementNode): ElementNode | null {
  const parent = el.parent
  if (parent === null) return null
  for (let i = el.index + 1; i < parent.children.length; i++) {
    const child = parent.children[i]!
    if (child.type === 'element') return child
  }
  return null
}

/** Nearest element (starting with `el` itself) matching the predicate. */
export function closest(el: ElementNode, predicate: (node: ElementNode) => boolean, maxLevels = 64): ElementNode | null {
  if (el.inert) return null
  let node: ElementNode | null = el
  for (let level = 0; node !== null && level <= maxLevels; level++) {
    if (predicate(node)) return node
    node = node.parent
  }
  return null
}

export interface TextRead {
  value: string
  truncated: boolean
}

/** Raw characters one text()/readText() call may ever walk. */
export const TEXT_RAW_BUDGET = 200_000

function isMark(code: number): boolean {
  return (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
}

function isTextSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
}

/**
 * One character reference at `at` (`raw[at] === '&'`), matched in a bounded
 * window so a long run of `&` never scans the rest of the node.
 */
function decodeAt(raw: string, at: number, remaining: number): { text: string; length: number } | null {
  const limit = Math.min(raw.length, at + 12, at + remaining)
  let end = at + 1
  while (end < limit && raw.charCodeAt(end) !== 59) end++
  if (end >= limit || raw.charCodeAt(end) !== 59) return null
  const body = raw.slice(at + 1, end)
  const named = Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : undefined
  if (named !== undefined) return { text: named, length: end - at + 1 }
  if (body.length >= 2 && body.charCodeAt(0) === 35 /* # */) {
    const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88
    const digits = body.slice(hex ? 2 : 1)
    const pattern = hex ? /^[0-9a-fA-F]{1,7}$/ : /^[0-9]{1,7}$/
    if (!pattern.test(digits)) return null
    const code = parseInt(digits, hex ? 16 : 10)
    return { text: isScalar(code) ? String.fromCodePoint(code) : '\ufffd', length: end - at + 1 }
  }
  return null
}

/**
 * Streaming text of an element: entity-decoded, de-marked and whitespace
 * collapsed as it is collected, so a whitespace run of any length contributes
 * at most one space and costs nothing toward `max`. Decoding is incremental and
 * charged to the raw-work budget, so a huge text node is never expanded up
 * front. Collection stops as soon as the output is provably longer than `max`,
 * and never walks more than `budget` raw characters in one call. `truncated`
 * says the value is incomplete.
 */
export function readText(el: ElementNode, max = 400, budget = TEXT_RAW_BUDGET): TextRead {
  if (max <= 0) return { value: '', truncated: false }
  let out = ''
  let pendingSpace = false
  let work = 0
  let truncated = false
  outer:
  for (const node of descendants(el)) {
    if (node.type !== 'text') continue
    const raw = node.text
    let i = 0
    while (i < raw.length) {
      if (work >= budget) {
        truncated = true
        break outer
      }
      let unit: string
      let step = 1
      if (raw.charCodeAt(i) === 38 /* & */) {
        const decoded = decodeAt(raw, i, budget - work)
        if (decoded === null) {
          unit = '&'
        } else {
          unit = decoded.text
          step = decoded.length
        }
      } else {
        unit = raw[i]!
      }
      work += step
      i += step
      for (let k = 0; k < unit.length; k++) {
        const code = unit.charCodeAt(k)
        if (isMark(code)) continue
        if (isTextSpace(code)) {
          if (out.length > 0) pendingSpace = true
          continue
        }
        if (pendingSpace) {
          out += ' '
          pendingSpace = false
        }
        out += unit[k]
        if (out.length > max) {
          truncated = true
          break outer
        }
      }
    }
  }
  if (out.length > max) out = out.slice(0, max)
  return { value: out, truncated }
}

/** Display-only shorthand; exact-match consumers must check `readText.truncated`. */
export function text(el: ElementNode, max = 400): string {
  return readText(el, max).value
}
