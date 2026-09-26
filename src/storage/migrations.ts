import type { Db } from './db.js'

const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'mostaql',
    external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    description_excerpt TEXT NOT NULL DEFAULT '',
    published_at TEXT NULL,
    published_raw TEXT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    discovery_kind TEXT NOT NULL,
    read_at TEXT NULL,
    category_slug TEXT NULL,
    category_name TEXT NULL,
    category_confirmed INTEGER NOT NULL DEFAULT 0,
    skills_json TEXT NULL,
    budget_min REAL NULL,
    budget_max REAL NULL,
    currency TEXT NULL,
    budget_raw TEXT NULL,
    enrichment_status TEXT NOT NULL DEFAULT 'not_requested',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_projects_seen ON projects(first_seen_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_projects_unread ON projects(read_at);
  CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_slug);
  CREATE TABLE IF NOT EXISTS source_state (
    source TEXT PRIMARY KEY,
    baseline_complete INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT NULL,
    last_attempt_at TEXT NULL,
    last_error TEXT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    backoff_until TEXT NULL,
    transport_kind TEXT NOT NULL DEFAULT 'rss',
    run_id TEXT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'new_project',
    status TEXT NOT NULL DEFAULT 'pending',
    session_id TEXT NULL,
    attempted_at TEXT NULL,
    batch_key TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, kind)
  );
  CREATE INDEX IF NOT EXISTS idx_notify_status ON notification_events(status);
  CREATE TABLE IF NOT EXISTS notification_batches (
    batch_key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    event_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS diagnostics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    endpoint_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    item_count INTEGER NULL,
    error_category TEXT NULL,
    detail TEXT NULL
  );
  `,
  /* 2 */ `
  CREATE TABLE IF NOT EXISTS pending_classifications (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    deadline_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_classification_deadline ON pending_classifications(deadline_at);
  `,
  /* 3 */ `
  CREATE TABLE IF NOT EXISTS project_user_state (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    saved_at TEXT NULL,
    hidden_at TEXT NULL,
    personal_status TEXT NOT NULL DEFAULT 'none',
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_details (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    description_text TEXT NULL,
    provenance TEXT NULL,
    fetched_at TEXT NULL,
    status TEXT NOT NULL DEFAULT 'not_requested',
    error_code TEXT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_filters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tombstones (
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id)
  );
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function applyMigrations(db: Db): void {
  const row = db.prepare('PRAGMA user_version;').get() as { user_version: number }
  const current = row.user_version ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i]
    if (!sql) continue
    db.exec('BEGIN;')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${i + 1};`)
      db.exec('COMMIT;')
    } catch (err) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }
}
