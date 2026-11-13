import type { DatabaseSync } from 'node:sqlite'

/** Remove derived v10 objects before constructing an actual historical DB. */
export function removeSearchSchema(db: DatabaseSync): void {
  downgradeToSchema10(db)
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'search_%'").all()) db.exec(`DROP TRIGGER "${row.name}"`)
  db.exec('DROP TABLE project_search_cache; DROP TABLE project_search_body; DROP TABLE project_search_fts; DROP TABLE project_search_dirty; DROP TABLE project_search_state; DROP INDEX idx_projects_source_seen;')
}

/** Downgrade an open archive database from schema 11 to schema 10 shape. */
export function downgradeToSchema10(db: DatabaseSync): void {
  db.exec('DROP TABLE IF EXISTS watch_episode_member; DROP TABLE IF EXISTS watch_episode; DROP TABLE IF EXISTS watch_source_state; DROP TABLE IF EXISTS project_watch;')
  const hasSeq = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get()
  const oldSeq = hasSeq ? (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notification_events'").get() as { seq: number } | undefined)?.seq : undefined
  db.exec(`
    CREATE TABLE notification_events_legacy (
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
    INSERT INTO notification_events_legacy (id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at)
      SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events ORDER BY id;
    DROP TABLE notification_events;
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
    INSERT INTO notification_events (id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at)
      SELECT id, project_id, kind, status, session_id, attempted_at, batch_key, created_at, updated_at FROM notification_events_legacy ORDER BY id;
    DROP TABLE notification_events_legacy;
    CREATE INDEX IF NOT EXISTS idx_notify_status ON notification_events(status);
  `)
  if (oldSeq !== undefined) {
    db.exec(`
      UPDATE sqlite_sequence SET seq = ${oldSeq} WHERE name = 'notification_events' AND seq < ${oldSeq};
      INSERT INTO sqlite_sequence (name, seq) SELECT 'notification_events', ${oldSeq} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'notification_events');
    `)
  }
}
