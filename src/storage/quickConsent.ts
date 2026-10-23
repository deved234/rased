import type { Db } from './db.js'

/** Device-local authorization, deliberately excluded from portable settings. */
export function clearQuickConsent(db: Db): void {
  db.prepare("DELETE FROM settings WHERE key='ai-quick-consent'").run()
}
