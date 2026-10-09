import { randomBytes } from 'node:crypto'
import type { Db } from './db.js'
export function issueQuickTicket(db: Db, projectId: number, now = Date.now()): string {
  db.prepare('DELETE FROM quick_apply_tickets WHERE expires_at < ?').run(now)
  const ticket = randomBytes(16).toString('hex')
  db.prepare('INSERT INTO quick_apply_tickets(ticket,project_id,expires_at) VALUES(?,?,?)').run(ticket,projectId,now+86400000)
  return `rased://quick-apply?ticket=${ticket}`
}
export function consumeQuickTicket(db: Db, ticket: string, now = Date.now()): number | null {
  const row = db.prepare('UPDATE quick_apply_tickets SET consumed_at=? WHERE ticket=? AND consumed_at IS NULL AND expires_at>=? RETURNING project_id').get(now,ticket,now) as {project_id:number} | undefined
  return row?.project_id ?? null
}
