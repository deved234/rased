import { validQuickApply, type QuickApplySettings, type QuickSource } from '../quickApply.js'
export { EXTENSION_ID, EXTENSION_VERSION, HOST_NAME, PROTOCOL_VERSION } from './identity.js'
export const MAX_FRAME = 65536
export const nonce = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v)
export const secret = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const sourceAllowed = (v: unknown): v is QuickSource => v === 'mostaql' || v === 'nafezly'
export function projectDestination(raw: unknown, source: unknown, externalId: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2048 || !sourceAllowed(source) || typeof externalId !== 'string' || !/^\d+$/.test(externalId)) return false
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.hostname !== `${source}.com` || u.port || u.username || u.password || u.search || u.hash) return false
    const m = u.pathname.match(/^\/(project|go)\/(\d+)(?:-[^/]*)?\/?$/)
    return m?.[2] === externalId && (m[1] === 'project' || source === 'mostaql')
  } catch { return false }
}
export type JobPhase = 'waiting-client' | 'opening' | 'reading' | 'ready' | 'needs-input' | 'needs-login' | 'draft-exists' | 'failed' | 'cancelled' | 'expired'
export const phases: JobPhase[] = ['waiting-client','opening','reading','ready','needs-input','needs-login','draft-exists','failed','cancelled','expired']
export interface PrepareJob { type:'prepare'; requestId:string; source:QuickSource; externalId:string; url:string; title:string; language:'ar'|'en'; settings:QuickApplySettings; expiresAt:number }
export function validPrepare(v: unknown): v is PrepareJob {
  return record(v) && v.type === 'prepare' && nonce(v.requestId) && projectDestination(v.url,v.source,v.externalId) && typeof v.title === 'string' && v.title.length <= 500 && (v.language === 'ar' || v.language === 'en') && validQuickApply(v.settings) && typeof v.expiresAt === 'number' && Number.isSafeInteger(v.expiresAt)
}
export interface ExtensionClient { id:string; label:string; version:string; connected:boolean; selected:boolean }
export interface PairRequest { id:string; code:string; expiresAt:number }
export interface JobStatus { requestId:string; projectId:number; phase:JobPhase; error?:string; price?:number; days?:number }
export interface ExtensionStatus { installed:boolean; registered:boolean; folder:string; extensionVersion:string; clients:ExtensionClient[]; pairing:PairRequest[]; selectedId:string|null; lastJob:JobStatus|null; protocolReady:boolean; error?:string }
export function parseExtensionTicket(raw: string): string | null {
  if (raw.length > 200) return null
  try { const u=new URL(raw),ticket=u.searchParams.get('ticket');return u.protocol==='rased:' && u.hostname==='quick-apply-v2' && (!u.pathname || u.pathname==='/') && !u.username && !u.password && !u.port && !u.hash && [...u.searchParams.keys()].length===1 && nonce(ticket)?ticket:null } catch { return null }
}
