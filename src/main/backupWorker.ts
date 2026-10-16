import { parentPort, workerData } from 'node:worker_threads'
import { finalizeBackup } from '../storage/backups.js'

if (!parentPort) throw Error('Backup worker requires a parent')
try {
  parentPort.postMessage({ ok: true, result: finalizeBackup(workerData.file, workerData.version) })
} catch {
  // Do not transfer database content or low-level file errors to the renderer.
  parentPort.postMessage({ ok: false })
}
