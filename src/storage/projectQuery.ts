import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { FilterDefinition, QueryWindow } from '../shared/types.js'
import { containsGeneralSearch, foldForSearch, normalizeGeneralSearch, searchSkills, type MatchedField } from '../shared/searchText.js'
import { shortSearchKey } from './searchShortText.js'

const registered = new WeakSet<DatabaseSync>()
const text = (value: SQLInputValue): string => typeof value === 'string' ? value : ''
export function registerSearchFunctions(db: DatabaseSync): void {
  if (registered.has(db)) return
  db.function('rased_normalize', { deterministic: true }, value => normalizeGeneralSearch(text(value)))
  db.function('rased_contains', { deterministic: true }, (value, needle) => containsGeneralSearch(text(value), text(needle)) ? 1 : 0)
  db.function('rased_skills', { deterministic: true }, value => searchSkills(value))
  db.function('rased_keywords', { deterministic: true }, (title, excerpt, skills) => foldForSearch(`${text(title)}\n${text(excerpt)}\n${searchSkills(skills)}`))
  db.function('rased_epoch', { deterministic: true }, value => { const n = Date.parse(text(value)); return Number.isFinite(n) ? n : null })
  registered.add(db)
}

interface Compiled { from: string; where: string; params: SQLInputValue[]; order: string; fields: [MatchedField, string][] }
export function compileProjectQuery(def: FilterDefinition): Compiled {
  const needle = normalizeGeneralSearch(def.search)
  const keywords = def.categoryFilter
  const needsCache = !!needle || keywords.keywordsAny.length + keywords.keywordsAll.length + keywords.excludeKeywords.length > 0 || def.sort === 'latestPublished'
  const fields: [MatchedField, string][] = []
  let from = 'projects p LEFT JOIN project_user_state u ON u.project_id=p.id'
  if (needsCache) from += ' LEFT JOIN project_search_cache c ON c.project_id=p.id AND c.normalization_version=1'
  if (needle) {
    const literal = `CAST(X'${Buffer.from(needle).toString('hex')}' AS TEXT)`
    const original = (raw: string): string => `CASE WHEN rased_contains(${raw},${literal}) THEN ${literal} ELSE '' END`
    const cached = (column: string, raw: string): string => `CASE WHEN c.project_id IS NOT NULL THEN c.${column} ELSE ${original(raw)} END`
    const originalBody = '(SELECT description_text FROM project_details pd WHERE pd.project_id=p.id)'
    fields.push(['title', cached('title_norm', 'p.title')], ['excerpt', cached('excerpt_norm', 'p.description_excerpt')], ['skills', cached('skills_norm', 'rased_skills(p.skills_json)')], ['body', `CASE WHEN c.project_id IS NOT NULL THEN COALESCE((SELECT b.body_norm FROM project_search_body b WHERE b.project_id=p.id),${original(originalBody)}) ELSE ${original(originalBody)} END`])
    if (Array.from(needle).length <= 2) fields[3] = ['body', `CASE WHEN c.project_id IS NOT NULL THEN CASE WHEN instr(c.body_short,'${shortSearchKey(needle)}')>0 THEN ${literal} ELSE '' END ELSE ${original(originalBody)} END`]
    if (def.searchInNotes) fields.push(['note', original('u.note')])
    if (def.searchInDrafts) { from += ' LEFT JOIN proposal_drafts d ON d.project_id=p.id'; fields.push(['draft', original('d.proposal')]) }
  }
  const where: string[] = [], params: SQLInputValue[] = []
  const add = (clause: string, ...values: SQLInputValue[]): void => { where.push(clause); params.push(...values) }
  if (def.source !== 'all') add('p.source=?', def.source)
  add(def.scope === 'hidden' ? 'u.hidden_at IS NOT NULL' : 'u.hidden_at IS NULL')
  if (def.scope === 'saved') add('u.saved_at IS NOT NULL')
  if (def.unreadOnly) add('p.read_at IS NULL')
  if (def.statuses.length) add(`COALESCE(u.personal_status,'none') IN (${def.statuses.map(() => '?').join(',')})`, ...def.statuses)
  if (needle) {
    const publicFields = fields.slice(0, 4), personalFields = fields.slice(4)
    // FTS supplies candidates only: literal instr predicates remain authoritative.
    // Cold/dirty rows and control-character queries always use original fields.
    const indexed = Array.from(needle).length >= 3 && !Array.from(needle).some(char => { const n = char.codePointAt(0)!; return n < 32 || n >= 0xd800 && n <= 0xdfff })
    const candidate = indexed ? '(c.project_id IS NULL OR p.id NOT IN (SELECT rowid FROM project_search_fts) OR p.id IN (SELECT rowid FROM project_search_fts WHERE project_search_fts MATCH ?)) AND ' : ''
    const publicSql = '(' + candidate + '(' + publicFields.map(([, field]) => `instr(${field},?)>0`).join(' OR ') + '))'
    const privateSql = personalFields.map(([, field]) => `instr(${field},?)>0`)
    const points = Array.from(needle)
    const grams = new Set<string>()
    for (let i = 0; i < points.length - 2; i += Math.max(1, Math.floor((points.length - 2) / 16))) grams.add(points.slice(i, i + 3).join(''))
    grams.add(points.slice(-3).join(''))
    const candidates = [...grams].map(gram => '"' + gram.replace(/"/g, '""') + '"').join(' AND ')
    add('(' + [publicSql, ...privateSql].join(' OR ') + ')', ...(indexed ? [candidates] : []), ...publicFields.map(() => needle), ...personalFields.map(() => needle))
  }
  const hay = "CASE WHEN c.project_id IS NOT NULL THEN c.keywords_norm ELSE rased_keywords(p.title,p.description_excerpt,p.skills_json) END"
  for (const kw of keywords.excludeKeywords.map(v => foldForSearch(v.trim())).filter(Boolean)) add(`instr(${hay},?)=0`, kw)
  if (keywords.keywordsAny.length) {
    const values = keywords.keywordsAny.map(v => foldForSearch(v.trim())).filter(Boolean)
    if (!values.length) add('0')
    else add('(' + values.map(() => `instr(${hay},?)>0`).join(' OR ') + ')', ...values)
  }
  for (const kw of keywords.keywordsAll.map(v => foldForSearch(v.trim())).filter(Boolean)) add(`instr(${hay},?)>0`, kw)
  if (keywords.mode === 'selected') {
    add("p.source='mostaql'")
    add(`(p.category_confirmed=0 OR p.category_slug IS NULL${keywords.categories.length ? ` OR p.category_slug IN (${keywords.categories.map(() => '?').join(',')})` : ''})`, ...keywords.categories)
  }
  const known: string[] = [], bounds: SQLInputValue[] = []
  if (def.budgetMin !== null) { known.push('COALESCE(p.budget_max,p.budget_min)>=?'); bounds.push(def.budgetMin) }
  if (def.budgetMax !== null) { known.push('COALESCE(p.budget_min,p.budget_max)<=?'); bounds.push(def.budgetMax) }
  const unknown = '(p.budget_min IS NULL AND p.budget_max IS NULL)'
  if (known.length) add(`(${def.includeUnknownBudget ? unknown + ' OR ' : ''}(NOT ${unknown} AND ${known.join(' AND ')}))`, ...bounds)
  else if (!def.includeUnknownBudget) add(`NOT ${unknown}`)
  const order = def.sort === 'latestPublished' ? 'published_sort_ms DESC,id DESC' : 'first_seen_at DESC,id DESC'
  return { from, where: where.join(' AND ') || '1', params, order, fields }
}

interface PageIds { ids: number[]; total: number; unread: number; visibleTotal: number; ceilingId: number }
export function queryProjectIds(db: DatabaseSync, def: FilterDefinition, page: {limit: number; offset: number}, window: QueryWindow = {}): PageIds {
  registerSearchFunctions(db)
  const q = compileProjectQuery(def)
  const ceilingId = window.ceilingId ?? (db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM projects').get() as {n: number}).n
  const epoch = def.sort === 'latestPublished' ? 'CASE WHEN c.project_id IS NOT NULL THEN c.published_sort_ms ELSE rased_epoch(p.published_at) END' : 'NULL'
  const sql = `WITH matched AS MATERIALIZED (SELECT p.id,p.read_at,p.first_seen_at,${epoch} AS published_sort_ms FROM ${q.from} WHERE ${q.where}),
    counts AS (SELECT COUNT(*) AS total,COALESCE(SUM(read_at IS NULL),0) AS unread,COALESCE(SUM(id<=?),0) AS visibleTotal FROM matched),
    page AS (SELECT id FROM matched WHERE id<=? ORDER BY ${q.order} LIMIT ? OFFSET ?)
    SELECT page.id,counts.total,counts.unread,counts.visibleTotal FROM counts LEFT JOIN page ON 1`
  const rows = db.prepare(sql).all(...q.params, ceilingId, ceilingId, Math.max(0, page.limit), page.offset) as unknown as {id: number | null; total: number; unread: number; visibleTotal: number}[]
  const first = rows[0]!
  return { ids: rows.flatMap(r => r.id === null ? [] : [r.id]), total: first.total, unread: first.unread, visibleTotal: first.visibleTotal, ceilingId }
}

export function queryMatchingIds(db: DatabaseSync, def: FilterDefinition, ids: number[]): number[] {
  if (!ids.length) return []
  registerSearchFunctions(db)
  const q = compileProjectQuery(def)
  return (db.prepare(`SELECT p.id FROM ${q.from} WHERE ${q.where} AND p.id IN (${ids.map(() => '?').join(',')})`).all(...q.params, ...ids) as unknown as {id: number}[]).map(r => r.id)
}

export function matchingFields(db: DatabaseSync, def: FilterDefinition, ids: number[]): Map<number, MatchedField[]> {
  const result = new Map<number, MatchedField[]>(), needle = normalizeGeneralSearch(def.search)
  if (!needle || !ids.length) return result
  const q = compileProjectQuery(def)
  const rows = db.prepare(`SELECT p.id,${q.fields.map(([name, field]) => `(instr(${field},?)>0) AS ${name}`).join(',')} FROM ${q.from} WHERE p.id IN (${ids.map(() => '?').join(',')})`).all(...q.fields.map(() => needle), ...ids) as unknown as Record<string, number>[]
  for (const row of rows) result.set(row.id!, q.fields.filter(([name]) => row[name] === 1).map(([name]) => name))
  return result
}
