import type { Db } from './db.js'
import { getProjectById, getSettingRaw, setSettingRaw, runInTransaction } from './repositories.js'
import { FACTS_RETRY_MS, FACTS_TTL_MS, type ProjectFacts, type ProjectFactValues } from '../shared/projectFacts.js'

interface FactRecord { version: number; status: 'ready' | 'failed' | 'loading' | 'not_requested'; fetchedAt: string | null; attemptedAt: string | null; errorCode: string | null }
const key = (id: number): string => `project-facts:${id}`
export function factRecord(db: Db, id: number): FactRecord {
  try {
    const row = JSON.parse(getSettingRaw(db, key(id)) ?? 'null') as FactRecord | null
    if (row && row.version === 1 && ['ready', 'failed', 'loading', 'not_requested'].includes(row.status) &&
      (row.fetchedAt === null || typeof row.fetchedAt === 'string' && Number.isFinite(Date.parse(row.fetchedAt))) &&
      (row.attemptedAt === null || typeof row.attemptedAt === 'string' && Number.isFinite(Date.parse(row.attemptedAt)))) return row
  } catch { /* Old body caches are not evidence that metadata was parsed. */ }
  return { version: 1, status: 'not_requested', fetchedAt: null, attemptedAt: null, errorCode: null }
}
export function factsNeedFetch(db: Db, id: number, now = Date.now(), force = false): boolean {
  const row = factRecord(db, id)
  if (force) return true
  if (row.status === 'failed' && row.attemptedAt && now - Date.parse(row.attemptedAt) < FACTS_RETRY_MS) return false
  return row.status !== 'ready' || !row.fetchedAt || now - Date.parse(row.fetchedAt) >= FACTS_TTL_MS
}
export function projectFacts(db: Db, id: number): ProjectFacts | null {
  const p = getProjectById(db, id)
  if (!p) return null
  const meta = factRecord(db, id)
  return { projectId: id, budgetMin: p.budgetMin, budgetMax: p.budgetMax, budgetRaw: p.budgetRaw, currency: p.currency,
    durationDays: p.durationDays ?? null, durationRaw: p.durationRaw ?? null, status: p.source === 'khamsat' ? 'unsupported' : meta.status,
    fetchedAt: meta.fetchedAt, errorCode: meta.errorCode }
}
export function markFacts(db: Db, id: number, status: FactRecord['status'], errorCode: string | null = null, now = new Date().toISOString()): void {
  const old = factRecord(db, id)
  setSettingRaw(db, key(id), JSON.stringify({ ...old, status, errorCode, attemptedAt: status === 'not_requested' ? old.attemptedAt : now }))
}
export function saveFetchedFacts(db: Db, id: number, data: ProjectFactValues, now = new Date().toISOString()): void {
  runInTransaction(db, () => {
    db.prepare('UPDATE projects SET budget_min=?,budget_max=?,budget_raw=?,currency=?,duration_days=?,duration_raw=?,updated_at=? WHERE id=?').run(data.budgetMin, data.budgetMax, data.budgetRaw, data.currency, data.durationDays, data.durationRaw, now, id)
    setSettingRaw(db, key(id), JSON.stringify({ version: 1, status: 'ready', fetchedAt: now, attemptedAt: now, errorCode: null }))
  })
}
