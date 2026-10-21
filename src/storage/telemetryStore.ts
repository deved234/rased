import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { validTelemetryEnvelope, type TelemetryEnvelope, type TelemetryName } from '../shared/telemetry.js'

const MAX_AGE = 7 * 86400000
/** Worker-owned database. Never attach or include this file in project backups. */
export class TelemetryStore {
  readonly db: DatabaseSync
  constructor(private file: string, private now: () => number = Date.now) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; PRAGMA secure_delete=ON; PRAGMA journal_size_limit=262144;
      CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY,body TEXT NOT NULL,bytes INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS buckets(key TEXT PRIMARY KEY,body TEXT NOT NULL,bytes INTEGER NOT NULL,at INTEGER NOT NULL);
      PRAGMA user_version=1;`)
  }
  get(key: string): string | null { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null }
  set(key: string, value: string): void { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?,?)').run(key, value, this.now()) }
  bind(identity: string | null, enabled: boolean): void {
    if (this.get('identity') !== identity || identity === null) { this.purge(); if (identity) this.set('identity', identity) }
    if (!enabled) this.clear()
    this.trim()
  }
  clear(): void { this.db.exec('DELETE FROM queue; DELETE FROM buckets; PRAGMA wal_checkpoint(TRUNCATE);') }
  purge(): void {
    this.db.exec('PRAGMA secure_delete=ON; DELETE FROM queue; DELETE FROM buckets; DELETE FROM meta; VACUUM;')
    const result = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number; log: number; checkpointed: number }
    if (result.busy !== 0 || result.log !== result.checkpointed || (existsSync(this.file + '-wal') && statSync(this.file + '-wal').size !== 0)) throw Error('forget-incomplete')
  }
  once(key: string): boolean {
    const inserted = this.db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?,?)').run('once:' + key, '1', this.now())
    return inserted.changes > 0
  }
  add(envelope: TelemetryEnvelope, once?: string): boolean {
    if (!validTelemetryEnvelope(envelope) || Buffer.byteLength(JSON.stringify(envelope)) > 4096) return false
    this.db.exec('BEGIN')
    try {
      if (once && !this.once(once)) { this.db.exec('ROLLBACK'); return false }
      const day = envelope.occurredAt.slice(0, 10), rateKey = `rate:${day}:${envelope.name}`
      const count = Number(this.get(rateKey) ?? 0) + 1
      this.set(rateKey, String(count))
      if (count > 100 && !['monitoring_hourly', 'notification_summary'].includes(envelope.name)) {
        const signature = createHash('sha256').update(JSON.stringify(envelope.properties)).digest('hex')
        this.aggregate(`overflow:${day}:${envelope.occurredAt.slice(11, 13)}:${envelope.name}:${signature}`, envelope)
      } else this.insert(envelope)
      this.trim()
      this.db.exec('COMMIT')
      return true
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private insert(e: TelemetryEnvelope): void {
    const body = JSON.stringify(e)
    this.db.prepare('INSERT OR IGNORE INTO queue VALUES(?,?,?,?)').run(e.eventId, body, Buffer.byteLength(body), Date.parse(e.occurredAt))
  }
  aggregate(key: string, envelope: TelemetryEnvelope, field?: string): void {
    if (!validTelemetryEnvelope(envelope)) return
    const previous = this.db.prepare('SELECT body FROM buckets WHERE key=?').get(key) as { body: string } | undefined
    let e = envelope
    if (previous) {
      let candidate: unknown
      try { candidate = JSON.parse(previous.body) } catch { /* Replace only the damaged bucket. */ }
      if (validTelemetryEnvelope(candidate) && candidate.name === envelope.name && candidate.distinctId === envelope.distinctId) {
        e = candidate
        if (field) e.properties[field] = Math.min(1_000_000, Number(e.properties[field] ?? 0) + 1)
        else e.count = Math.min(1_000_000, e.count + 1)
      } else this.set('dropped', String(Number(this.get('dropped') ?? 0) + 1))
    }
    const body = JSON.stringify(e)
    if (validTelemetryEnvelope(e)) this.db.prepare('INSERT OR REPLACE INTO buckets VALUES(?,?,?,?)').run(key, body, Buffer.byteLength(body), Date.parse(e.occurredAt))
    this.trim()
  }
  seal(all = false): void {
    const hour = Math.floor(this.now() / 3600000) * 3600000
    const rows = this.db.prepare('SELECT key,body FROM buckets WHERE at<?').all(all ? this.now() + 86400000 : hour) as { key: string; body: string }[]
    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        let e: unknown
        try { e = JSON.parse(row.body) } catch { /* Drop only the malformed telemetry bucket. */ }
        if (validTelemetryEnvelope(e)) this.insert(e)
        else this.set('dropped', String(Number(this.get('dropped') ?? 0) + 1))
        this.db.prepare('DELETE FROM buckets WHERE key=?').run(row.key)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    this.trim()
  }
  batch(maxBytes = 60 * 1024): TelemetryEnvelope[] {
    this.seal()
    const rows = this.db.prepare('SELECT id,body FROM queue ORDER BY at,rowid LIMIT 50').all() as { id: string; body: string }[]
    const result: TelemetryEnvelope[] = []
    let bytes = 0
    for (const { id, body } of rows) {
      let e: unknown
      try { e = JSON.parse(body) } catch { /* Damaged local rows must not block later events. */ }
      if (!validTelemetryEnvelope(e)) { this.acknowledge([id]); this.set('dropped', String(Number(this.get('dropped') ?? 0) + 1)); continue }
      bytes += Buffer.byteLength(body)
      if (bytes > maxBytes) break
      result.push(e)
    }
    return result
  }
  acknowledge(ids: string[]): void { for (const id of ids) this.db.prepare('DELETE FROM queue WHERE id=?').run(id) }
  read(ids: string[]): TelemetryEnvelope[] {
    const result: TelemetryEnvelope[] = []
    for (const id of ids) {
      const row = this.db.prepare('SELECT body FROM queue WHERE id=?').get(id) as { body: string } | undefined
      if (row) { try { const e: unknown = JSON.parse(row.body); if (validTelemetryEnvelope(e)) result.push(e) } catch { /* Trimmed/damaged tasks cannot block fresh events. */ } }
    }
    return result
  }
  dropPoison(ids: string[], limit: number): string[] {
    const day = new Date(this.now()).toISOString().slice(0, 10), key = 'poison-dropped-day'
    const [storedDay, storedCount] = (this.get(key) ?? '').split(':')
    const count = storedDay === day ? Number(storedCount) || 0 : 0
    const selected = ids.slice(0, Math.max(0, limit - count))
    this.db.exec('BEGIN')
    try {
      this.acknowledge(selected)
      this.set(key, `${day}:${count + selected.length}`)
      this.set('dropped', String((Number(this.get('dropped')) || 0) + selected.length))
      this.set('poisoned', String((Number(this.get('poisoned')) || 0) + selected.length))
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return selected
  }
  status(): { queued: number; dropped: number } {
    const row = this.db.prepare('SELECT (SELECT COUNT(*) FROM queue)+(SELECT COUNT(*) FROM buckets) AS n').get() as { n: number }
    return { queued: row.n, dropped: Number(this.get('dropped') ?? 0) }
  }
  private trim(): void {
    const before = this.status().queued
    this.db.prepare('DELETE FROM queue WHERE at<?').run(this.now() - MAX_AGE)
    this.db.prepare('DELETE FROM buckets WHERE at<?').run(this.now() - MAX_AGE)
    this.db.prepare("DELETE FROM meta WHERE (key LIKE 'once:active:%' OR key LIKE 'rate:%') AND at<?").run(this.now() - MAX_AGE)
    for (let i = 0; i < 1100; i++) {
      const size = this.db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM queue)+(SELECT COALESCE(SUM(bytes),0) FROM buckets) AS bytes').get() as { bytes: number }
      if (this.status().queued <= 1000 && size.bytes <= 2 * 1024 * 1024) break
      const oldest = this.db.prepare("SELECT kind,id FROM (SELECT 'queue' AS kind,id,at FROM queue UNION ALL SELECT 'buckets',key,at FROM buckets) ORDER BY at LIMIT 1").get() as { kind: string; id: string } | undefined
      if (!oldest) break
      if (oldest.kind === 'queue') this.db.prepare('DELETE FROM queue WHERE id=?').run(oldest.id)
      else this.db.prepare('DELETE FROM buckets WHERE key=?').run(oldest.id)
    }
    const dropped = before - this.status().queued
    if (dropped > 0) this.set('dropped', String(Number(this.get('dropped') ?? 0) + dropped))
  }
  counter(name: TelemetryName, key: string, field: string, envelope: TelemetryEnvelope): void {
    if (name !== 'monitoring_hourly' && name !== 'notification_summary') return
    this.aggregate(key, envelope, field)
  }
  close(): void { this.db.close() }
}
