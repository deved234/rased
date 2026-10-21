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
  `,
  /* 4 */ `
  CREATE TABLE IF NOT EXISTS proposal_drafts (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    proposal TEXT NOT NULL,
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    questions_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  `,
  /* 5 */ `
  CREATE TABLE IF NOT EXISTS quick_apply_tickets (
    ticket TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quick_ticket_expiry ON quick_apply_tickets(expires_at);
  `
  ,/* 6 */ `
  CREATE TABLE IF NOT EXISTS extension_jobs (
    ticket TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'issued',
    expires_at INTEGER NOT NULL,
    activated_at INTEGER,
    client_id TEXT,
    tab_id INTEGER,
    error TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_extension_jobs_expiry ON extension_jobs(expires_at);
  `
  ,/* 7 */ `
  ALTER TABLE proposal_drafts ADD COLUMN provider TEXT NULL;
  ALTER TABLE proposal_drafts ADD COLUMN model TEXT NULL;
  ALTER TABLE proposal_drafts ADD COLUMN prompt_version TEXT NULL;
  ALTER TABLE proposal_drafts ADD COLUMN generated_at TEXT NULL;
  `,/* 8 */ `
  ALTER TABLE projects ADD COLUMN platform_status TEXT NULL;
  ALTER TABLE projects ADD COLUMN duration_days INTEGER NULL;
  ALTER TABLE projects ADD COLUMN duration_raw TEXT NULL;
  `,/* 9 */ `
  CREATE TABLE IF NOT EXISTS notification_activations (
    token_hash TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    project_id INTEGER NULL,
    expires_at INTEGER NOT NULL,
    last_attempt_at INTEGER NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notification_activation_expiry ON notification_activations(expires_at);
  `
  ,/* 10 */ `
  CREATE TABLE project_search_cache (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    normalization_version INTEGER NOT NULL,
    published_sort_ms REAL NULL,
    title_norm TEXT NOT NULL,
    excerpt_norm TEXT NOT NULL,
    skills_norm TEXT NOT NULL,
    keywords_norm TEXT NOT NULL,
    body_short TEXT NOT NULL
  );
  CREATE TABLE project_search_body (project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, body_norm TEXT NOT NULL);
  CREATE VIRTUAL TABLE project_search_fts USING fts5(text,content='',contentless_delete=1,detail=none,tokenize='trigram case_sensitive 1');
  CREATE TABLE project_search_dirty (project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE);
  CREATE TABLE project_search_state (id INTEGER PRIMARY KEY CHECK(id=1), normalization_version INTEGER NOT NULL, backfill_complete INTEGER NOT NULL);
  INSERT INTO project_search_state VALUES(1,1,0);
  INSERT INTO project_search_dirty SELECT id FROM projects;
  CREATE INDEX idx_projects_source_seen ON projects(source,first_seen_at DESC,id DESC);
  CREATE TRIGGER search_project_insert AFTER INSERT ON projects BEGIN
    INSERT INTO project_search_dirty VALUES(NEW.id) ON CONFLICT DO NOTHING;
    UPDATE project_search_state SET backfill_complete=0;
  END;
  CREATE TRIGGER search_project_update AFTER UPDATE OF title,description_excerpt,skills_json,published_at ON projects
  WHEN OLD.title IS NOT NEW.title OR OLD.description_excerpt IS NOT NEW.description_excerpt OR OLD.skills_json IS NOT NEW.skills_json OR OLD.published_at IS NOT NEW.published_at BEGIN
    DELETE FROM project_search_cache WHERE project_id=NEW.id;
    DELETE FROM project_search_body WHERE project_id=NEW.id;
    DELETE FROM project_search_fts WHERE rowid=NEW.id;
    INSERT INTO project_search_dirty VALUES(NEW.id) ON CONFLICT DO NOTHING;
    UPDATE project_search_state SET backfill_complete=0;
  END;
  CREATE TRIGGER search_project_delete AFTER DELETE ON projects BEGIN
    DELETE FROM project_search_body WHERE project_id=OLD.id;
    DELETE FROM project_search_fts WHERE rowid=OLD.id;
    DELETE FROM project_search_cache WHERE project_id=OLD.id;
    DELETE FROM project_search_dirty WHERE project_id=OLD.id;
  END;
  CREATE TRIGGER search_details_insert AFTER INSERT ON project_details BEGIN
    DELETE FROM project_search_body WHERE project_id=NEW.project_id;
    DELETE FROM project_search_fts WHERE rowid=NEW.project_id;
    DELETE FROM project_search_cache WHERE project_id=NEW.project_id;
    INSERT INTO project_search_dirty SELECT NEW.project_id WHERE EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id) ON CONFLICT DO NOTHING;
    UPDATE project_search_state SET backfill_complete=0;
  END;
  CREATE TRIGGER search_details_update AFTER UPDATE OF description_text,project_id ON project_details
  WHEN OLD.description_text IS NOT NEW.description_text OR OLD.project_id IS NOT NEW.project_id BEGIN
    DELETE FROM project_search_body WHERE project_id IN (OLD.project_id,NEW.project_id);
    DELETE FROM project_search_fts WHERE rowid IN (OLD.project_id,NEW.project_id);
    DELETE FROM project_search_cache WHERE project_id IN (OLD.project_id,NEW.project_id);
    INSERT INTO project_search_dirty SELECT id FROM projects WHERE id IN (OLD.project_id,NEW.project_id) ON CONFLICT DO NOTHING;
    UPDATE project_search_state SET backfill_complete=0;
  END;
  CREATE TRIGGER search_details_delete AFTER DELETE ON project_details BEGIN
    DELETE FROM project_search_body WHERE project_id=OLD.project_id;
    DELETE FROM project_search_fts WHERE rowid=OLD.project_id;
    DELETE FROM project_search_cache WHERE project_id=OLD.project_id;
    INSERT INTO project_search_dirty SELECT OLD.project_id WHERE EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) ON CONFLICT DO NOTHING;
    UPDATE project_search_state SET backfill_complete=0;
  END;
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function applyMigrations(db: Db): void {
  const row = db.prepare('PRAGMA user_version;').get() as { user_version: number }
  const current = row.user_version ?? 0
  if (current > SCHEMA_VERSION) throw Error('newer-schema')
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
