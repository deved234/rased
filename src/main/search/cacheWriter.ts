import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'
import { rebuildSearchBatch } from '../../storage/searchCache.js'
let db: DatabaseSync | undefined, path = '', suspended = false, timer: ReturnType<typeof setTimeout> | undefined
let measure = false, reported = false, walPeak = 0
let checkpointAt = 0
const measurements: { rows: number; bytes: number; durationMs: number }[] = []
const port = process.parentPort!
function schedule(delay: number): void {
  timer = setTimeout(() => {
    if (!db) return
    let next = 250
    try {
      if (!suspended) {
        let wal = 0
        try { wal = statSync(path + '-wal').size } catch { /* No sidecar yet. */ }
        if (measure) walPeak = Math.max(walPeak, wal)
        let blocked = false
        if (wal >= 1024 * 1024 && Date.now() - checkpointAt >= 50) {
          const progress = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get() as { log: number; checkpointed: number }
          blocked = wal >= 32 * 1024 * 1024 && progress.checkpointed < progress.log
          checkpointAt = Date.now()
        }
        if (!blocked) {
          const batch = rebuildSearchBatch(db, 20)
          if (measure) measurements.push({ rows: batch.rows, bytes: batch.bytes, durationMs: batch.durationMs })
          if (measure && batch.complete && !reported) { reported = true; port.postMessage({ complete: true, measurements, walPeak }) }
          if (!measure && batch.complete) port.postMessage({ idle: true })
          next = batch.complete ? 1000 : 1
        }
      }
    } catch { next = 1000 }
    schedule(next)
  }, delay)
}
port.on('message', ({ data }: { data: { path?: string; suspended?: boolean; close?: boolean; measure?: boolean } }) => {
  if (data.close) { clearTimeout(timer); db?.close(); process.exit(0) }
  if (typeof data.suspended === 'boolean') suspended = data.suspended
  if (data.path && !db) {
    path = data.path
    measure = data.measure === true
    db = new DatabaseSync(path)
    // Keep the existing FULL durability setting. Run PASSIVE checkpoints after
    // batches, outside their writer transaction, instead of on its COMMIT.
    db.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0')
    schedule(100)
  }
})
