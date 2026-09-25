// Gate/verification helper: inspects a RASED user-data dir with node:sqlite.
// Usage: node scripts/check-db.mjs <user-data-dir>
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: check-db.mjs <user-data-dir>')
  process.exit(2)
}
const db = new DatabaseSync(join(dir, 'rased.db'))
const total = db.prepare('SELECT COUNT(*) AS n FROM projects;').get()
const unread = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE read_at IS NULL;').get()
const state = db.prepare('SELECT baseline_complete, last_success_at, consecutive_failures FROM source_state WHERE source=?;').get('mostaql')
const kinds = db.prepare('SELECT discovery_kind, COUNT(*) AS n FROM projects GROUP BY discovery_kind;').all()
const events = db.prepare('SELECT status, COUNT(*) AS n FROM notification_events GROUP BY status;').all()
const settings = db.prepare("SELECT value FROM settings WHERE key='app';").get()
const enrich = db.prepare('SELECT enrichment_status, COUNT(*) AS n FROM projects GROUP BY enrichment_status;').all()
const cats = db.prepare('SELECT category_slug, COUNT(*) AS n FROM projects GROUP BY category_slug;').all()
const diag = db.prepare('SELECT at, endpoint_kind, status, duration_ms, item_count, error_category FROM diagnostics ORDER BY id DESC LIMIT 15;').all()
console.log(JSON.stringify({ total, unread, state, kinds, events, settingsLang: settings ? JSON.parse(settings.value).language : null, enrich, cats, diag }, null, 2))
db.close()
