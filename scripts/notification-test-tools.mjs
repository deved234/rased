import { createHash } from 'node:crypto'

/** Test-only resolution of the capability stored by the real notification path. */
export function notificationDestination(db, xml) {
  const token = xml?.match(/intent=open-project(?:&amp;|&)ticket=([a-f0-9]{32})/)?.[1]
  if (!token) return null
  return db.prepare('SELECT url FROM notification_activations WHERE token_hash=?').get(createHash('sha256').update(token).digest('hex'))?.url ?? null
}
