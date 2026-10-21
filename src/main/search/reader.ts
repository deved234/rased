import { DatabaseSync } from 'node:sqlite'
import { queryProjectsPage } from '../../storage/repositories.js'
import { queryMatchingIds } from '../../storage/projectQuery.js'
import type { SearchRequest } from './protocol.js'

// Only the parent supplies the database path. This process has no network,
// writes, renderer channels or collectors; killing it can interrupt native SQL.
const port = process.parentPort!
let db: DatabaseSync | undefined
port.on('message', async ({ data }: { data: { path?: string; close?: boolean } | SearchRequest }) => {
  if ('path' in data && data.path) {
    db = new DatabaseSync(data.path, { readOnly: true })
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100')
    port.postMessage({ ready: true })
    return
  }
  if ('close' in data) { db?.close(); process.exit(0) }
  if (!('id' in data) || !db) return
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = data.ids ? queryMatchingIds(db, data.definition, data.ids) : queryProjectsPage(db, data.definition, { limit: data.limit, offset: data.offset }, data.window)
      port.postMessage({ id: data.id, result })
      return
    } catch (error) {
      const busy = error instanceof Error && /locked|busy/i.test(error.message)
      if (busy && attempt === 0) { await new Promise(resolve => setTimeout(resolve, 25)); continue }
      port.postMessage({ id: data.id, error: busy ? 'search-busy' : 'search-failed' })
    }
  }
})
