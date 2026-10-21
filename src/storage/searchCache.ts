import type { Db } from './db.js'
import { foldForSearch, normalizeGeneralSearch, searchSkills } from '../shared/searchText.js'
import { shortSearchKeys } from './searchShortText.js'

export function resetSearchCache(db: Db): void {
  db.exec("DELETE FROM project_search_cache; DELETE FROM project_search_body; INSERT INTO project_search_fts(project_search_fts) VALUES('delete-all'); DELETE FROM project_search_dirty; UPDATE project_search_state SET normalization_version=1,backfill_complete=0; INSERT INTO project_search_dirty SELECT id FROM projects;")
}

export function searchCacheReady(db: Db): boolean {
  return (db.prepare('SELECT backfill_complete FROM project_search_state WHERE id=1').get() as {backfill_complete: number} | undefined)?.backfill_complete === 1
}

export function rebuildSearchBatch(db: Db, maxRows = 50): { rows: number; bytes: number; durationMs: number; complete: boolean } {
  const began = performance.now()
  let rows = 0, bytes = 0
  const items = db.prepare('SELECT project_id FROM project_search_dirty ORDER BY project_id DESC LIMIT ?').all(maxRows) as unknown as {project_id: number}[]
  if (!items.length) { db.exec('UPDATE project_search_state SET backfill_complete=1 WHERE id=1 AND backfill_complete=0'); return { rows, bytes, durationMs: performance.now() - began, complete: true } }
  const get = db.prepare('SELECT p.title,p.description_excerpt,p.skills_json,p.published_at,d.description_text FROM projects p LEFT JOIN project_details d ON d.project_id=p.id WHERE p.id=?')
  const put = db.prepare('INSERT OR REPLACE INTO project_search_cache VALUES(?,1,?,?,?,?,?,?)')
  const putBody = db.prepare('INSERT OR REPLACE INTO project_search_body VALUES(?,?)')
  const removeFts = db.prepare('DELETE FROM project_search_fts WHERE rowid=?')
  const putFts = db.prepare('INSERT INTO project_search_fts(rowid,text) VALUES(?,?)')
  const remove = db.prepare('DELETE FROM project_search_dirty WHERE project_id=?')
  type Original = {title: string; description_excerpt: string; skills_json: string | null; published_at: string | null; description_text: string | null}
  const prepared: { id: number; original: Original | undefined; values?: [number | null, string, string, string, string, string, string] }[] = []
  // Expensive Unicode work happens before taking the writer lock. Revalidate
  // originals under the lock so concurrent collector updates cannot become stale cache.
  for (const { project_id } of items) {
    const original = get.get(project_id) as Original | undefined
    if (!original) { prepared.push({ id: project_id, original }); continue }
    const skills = searchSkills(original.skills_json), body = original.description_text ?? ''
    const cost = Buffer.byteLength(original.title + original.description_excerpt + skills + body)
    if (prepared.length && bytes + cost > 256 * 1024) break
    bytes += cost
    const epoch = Date.parse(original.published_at ?? '')
    const title = normalizeGeneralSearch(original.title), excerpt = normalizeGeneralSearch(original.description_excerpt), normalizedSkills = normalizeGeneralSearch(skills), normalizedBody = normalizeGeneralSearch(body)
    prepared.push({ id: project_id, original, values: [Number.isFinite(epoch) ? epoch : null, title, excerpt, normalizedSkills, foldForSearch(`${original.title}\n${original.description_excerpt}\n${skills}`), shortSearchKeys(normalizedBody), normalizedBody] })
  }
  const transactionStart = performance.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { id, original, values } of prepared) {
      const current = get.get(id) as Original | undefined
      const same = current === undefined ? original === undefined : !!original && current.title === original.title && current.description_excerpt === original.description_excerpt && current.skills_json === original.skills_json && current.published_at === original.published_at && current.description_text === original.description_text
      if (!same) continue
      if (values) {
        const [epoch, title, excerpt, skills, keywords, short, body] = values
        put.run(id, epoch, title, excerpt, skills, keywords, short)
        putBody.run(id, body)
        removeFts.run(id); putFts.run(id, [title, excerpt, skills, body].join('\n'))
      }
      remove.run(id); rows++
      if (performance.now() - transactionStart >= 3) break
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return { rows, bytes, durationMs: performance.now() - transactionStart, complete: false }
}
