import type { DatabaseSync } from 'node:sqlite'

/** Remove derived v10 objects before constructing an actual historical DB. */
export function removeSearchSchema(db: DatabaseSync): void {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'search_%'").all()) db.exec(`DROP TRIGGER "${row.name}"`)
  db.exec('DROP TABLE project_search_cache; DROP TABLE project_search_body; DROP TABLE project_search_fts; DROP TABLE project_search_dirty; DROP TABLE project_search_state; DROP INDEX idx_projects_source_seen;')
}
