import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { InspectedBackup } from '../storage/backups.js'

export function finalizeBackupInWorker(file: string, version: string): Promise<InspectedBackup> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'backupWorker.js'), { workerData: { file, version } })
    let result: InspectedBackup | null = null, failed = false
    worker.once('message', (message: { ok: boolean; result?: InspectedBackup }) => {
      result = message.ok ? message.result ?? null : null
    })
    worker.once('error', () => { failed = true })
    worker.once('exit', code => {
      if (!failed && code === 0 && result) resolve(result)
      else reject(Error('backup-failed'))
    })
  })
}
