// Verification helper: reports read-state rows + ui audit trail for a data dir.
// Usage: node scripts/audit-reads.mjs <user-data-dir>
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const dir = process.argv[2]
const db = new DatabaseSync(join(dir, 'rased.db'))
console.log('read_rows:', JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM projects WHERE read_at IS NOT NULL;').get()))
console.log('ui_audit:', JSON.stringify(db.prepare("SELECT at, detail FROM diagnostics WHERE endpoint_kind='ui' ORDER BY id DESC LIMIT 10;").all()))
db.close()
