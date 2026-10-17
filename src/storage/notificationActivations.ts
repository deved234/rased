import { createHash, randomBytes } from 'node:crypto'
import type { Db } from './db.js'
import { NOTIFICATION_DEDUP_MS, NOTIFICATION_TICKET_TTL } from '../shared/notificationActivation.js'
import { isAllowedProjectUrl, isAllowedTestUrl } from '../main/links.js'

export interface NotificationDestination { url: string; projectId: number | null }
interface ActivationRow { url: string; project_id: number | null; last_attempt_at: number | null; expires_at: number }
const hash = (token: string): string => createHash('sha256').update(token).digest('hex')

export function issueNotificationActivation(db: Db, destination: NotificationDestination, now = Date.now()): string {
  if (!isAllowedProjectUrl(destination.url) && !isAllowedTestUrl(destination.url)) throw Error('invalid-notification-url')
  if (destination.projectId !== null && (!Number.isSafeInteger(destination.projectId) || destination.projectId < 1 || !isAllowedProjectUrl(destination.url))) throw Error('invalid-notification-project')
  const token = randomBytes(16).toString('hex')
  cleanupNotificationActivations(db, now)
  db.prepare('INSERT INTO notification_activations(token_hash,url,project_id,expires_at) VALUES(?,?,?,?)').run(hash(token), destination.url, destination.projectId, now + NOTIFICATION_TICKET_TTL)
  return token
}

/** Reserve before external delivery. A crash never causes an automatic replay. */
export function claimNotificationActivation(db: Db, token: string, now = Date.now()): NotificationDestination | 'duplicate' | null {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const row = db.prepare('SELECT url,project_id,last_attempt_at,expires_at FROM notification_activations WHERE token_hash=?').get(hash(token)) as ActivationRow | undefined
  if (!row || row.expires_at <= now || (!isAllowedProjectUrl(row.url) && !isAllowedTestUrl(row.url))) return null
  if (row.last_attempt_at !== null && now - row.last_attempt_at < NOTIFICATION_DEDUP_MS) return 'duplicate'
  const updated = db.prepare(`UPDATE notification_activations SET last_attempt_at=? WHERE token_hash=? AND expires_at>?
    AND (last_attempt_at IS NULL OR last_attempt_at<=?)`).run(now, hash(token), now, now - NOTIFICATION_DEDUP_MS)
  if (!updated.changes) return 'duplicate'
  return { url: row.url, projectId: row.project_id }
}

export function cleanupNotificationActivations(db: Db, now = Date.now()): void {
  db.prepare('DELETE FROM notification_activations WHERE expires_at<=?').run(now)
}
