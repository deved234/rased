import type { Db } from './db.js'
import type { KafItem } from '../collector/kaf.js'
import type { parseKafDetails } from '../collector/kafDetails.js'

export function updateKafListMetadata(db: Db, id: number, item: KafItem): void {
  db.prepare(`UPDATE projects SET platform_status=?, skills_json=?,
    budget_min=CASE WHEN ? IS NULL THEN budget_min ELSE ? END,
    budget_max=CASE WHEN ? IS NULL THEN budget_max ELSE ? END,
    budget_raw=COALESCE(?,budget_raw), currency=CASE WHEN ? IS NULL THEN currency ELSE 'USD' END
    WHERE id=? AND source='kaf'`).run(item.platformStatus, JSON.stringify(item.skills), item.budgetRaw, item.budgetMin, item.budgetRaw, item.budgetMax, item.budgetRaw, item.budgetMin, id)
}
export function updateKafDetailsMetadata(db: Db, id: number, data: ReturnType<typeof parseKafDetails>): void {
  db.prepare(`UPDATE projects SET category_name=?, category_confirmed=0, category_slug=NULL,
    duration_days=?, duration_raw=?, published_raw=COALESCE(?,published_raw),
    budget_min=COALESCE(?,budget_min),budget_max=COALESCE(?,budget_max), enrichment_status='ready'
    WHERE id=? AND source='kaf'`).run(data.categoryName, data.durationDays, data.durationRaw, data.publicationRaw, data.budgetMin, data.budgetMax, id)
}
