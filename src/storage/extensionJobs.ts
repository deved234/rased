import { randomBytes } from 'node:crypto'
import type { Db } from './db.js'
import { sourceAllowed } from '../shared/extension/protocol.js'
export interface StoredExtensionJob {ticket:string;request_id:string;project_id:number;phase:string;expires_at:number;activated_at:number|null;client_id:string|null;tab_id:number|null;error:string|null;updated_at:number}
export function issueExtensionTicket(db:Db,id:number,now=Date.now()):string {
  const p=db.prepare('SELECT source FROM projects WHERE id=?').get(id) as {source:string}|undefined
  if(!p||!sourceAllowed(p.source))throw Error('unsupported-source')
  db.prepare('DELETE FROM extension_jobs WHERE expires_at<?').run(now)
  const ticket=randomBytes(16).toString('hex'),request=randomBytes(16).toString('hex')
  db.prepare('INSERT INTO extension_jobs(ticket,request_id,project_id,expires_at,updated_at) VALUES(?,?,?,?,?)').run(ticket,request,id,now+86400000,now)
  return `rased://quick-apply-v2?ticket=${ticket}`
}
export function claimExtensionTicket(db:Db,ticket:string,now=Date.now()):StoredExtensionJob|null {
  return db.prepare("UPDATE extension_jobs SET activated_at=?,phase='claimed',updated_at=? WHERE ticket=? AND activated_at IS NULL AND expires_at>=? RETURNING *").get(now,now,ticket,now) as StoredExtensionJob|undefined??null
}
export function storedExtensionTicket(db:Db,ticket:string):StoredExtensionJob|null {return db.prepare('SELECT * FROM extension_jobs WHERE ticket=?').get(ticket) as StoredExtensionJob|undefined??null}
export function updateExtensionJob(db:Db,request:string,phase:string,client:string|null,error:string|null=null,tab:number|null=null):void {
  db.prepare('UPDATE extension_jobs SET phase=?,client_id=?,error=?,tab_id=COALESCE(?,tab_id),updated_at=? WHERE request_id=?').run(phase,client,error,tab,Date.now(),request)
}
