import { afterEach,describe,it,expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase,type Db } from '../src/storage/db.js'
import { FrameReader,encodeFrame } from '../src/main/extension/framing.js'
import { parseExtensionTicket,projectDestination,validPrepare,MAX_FRAME } from '../src/shared/extension/protocol.js'
import { issueExtensionTicket,claimExtensionTicket } from '../src/storage/extensionJobs.js'
import { quickPrice } from '../src/shared/quickApply.js'
const databases:Db[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
describe('extension boundary',()=>{
  it('handles fragmented and coalesced native frames',()=>{const got:unknown[]=[];const r=new FrameReader(v=>got.push(v)),a=encodeFrame({a:'عربي'}),b=encodeFrame({b:2});r.push(a.subarray(0,2));r.push(a.subarray(2,6));r.push(Buffer.concat([a.subarray(6),b]));expect(got).toEqual([{a:'عربي'},{b:2}])})
  it('rejects oversized, empty and invalid JSON frames',()=>{for(const n of [0,MAX_FRAME+1]){const b=Buffer.alloc(4);b.writeUInt32LE(n);expect(()=>new FrameReader(()=>undefined).push(b)).toThrow()}const b=Buffer.from([1,0,0,0,123]);expect(()=>new FrameReader(()=>undefined).push(b)).toThrow()})
  it('binds HTTPS destination to supported source and exact project ID',()=>{expect(projectDestination('https://mostaql.com/project/123-name','mostaql','123')).toBe(true);for(const url of ['https://mostaql.com.evil.test/project/123','https://mostaql.com/project/124','http://mostaql.com/project/123','https://user@mostaql.com/project/123','https://mostaql.com/project/123?redirect=evil'])expect(projectDestination(url,'mostaql','123')).toBe(false);expect(projectDestination('https://khamsat.com/project/123','khamsat','123')).toBe(false)})
  it('rejects legacy, malformed and extra protocol ticket data',()=>{expect(parseExtensionTicket('rased://quick-apply-v2?ticket='+'a'.repeat(32))).toBe('a'.repeat(32));expect(parseExtensionTicket('rased://quick-apply?ticket='+'a'.repeat(32))).toBeNull();expect(parseExtensionTicket('rased://quick-apply-v2?ticket='+'a'.repeat(32)+'&url=evil')).toBeNull()})
  it('validates a settings snapshot and forbids unsupported platforms',()=>{const v={type:'prepare',requestId:'a'.repeat(32),source:'mostaql',externalId:'1',url:'https://mostaql.com/project/1',title:'Project',language:'ar',expiresAt:Date.now()+10000,settings:{enabled:true,template:'Draft',budgetPositionPercent:50,extraDays:1}};expect(validPrepare(v)).toBe(true);expect(validPrepare({...v,source:'khamsat'})).toBe(false);expect(validPrepare({...v,settings:{...v.settings,template:''}})).toBe(false)})
  it('uses numeric input step base within the budget range',()=>{expect(quickPrice(25,50,50,1,1)).toBe(38);expect(quickPrice(25,50,0,2,1)).toBe(25);expect(quickPrice(25,50,100,2,1)).toBe(49);expect(quickPrice(25,25,100,2,0)).toBeNull()})
  it('atomically claims tickets once and rejects expiry/Khamsat',()=>{
    const db=openDatabase(join(mkdtempSync(join(tmpdir(),'rased-job-unit-')),'db'));databases.push(db)
    const stmt=db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(?,?,?,?,?,'now','now','initial','now','now')")
    stmt.run(1,'mostaql','1','https://mostaql.com/project/1','Fixture');stmt.run(2,'khamsat','2','https://khamsat.com/community/requests/2','Fixture')
    const url=issueExtensionTicket(db,1,100),ticket=parseExtensionTicket(url)!
    expect(claimExtensionTicket(db,ticket,101)?.project_id).toBe(1);expect(claimExtensionTicket(db,ticket,102)).toBeNull()
    const expired=parseExtensionTicket(issueExtensionTicket(db,1,200))!;expect(claimExtensionTicket(db,expired,200+86400001)).toBeNull();expect(()=>issueExtensionTicket(db,2)).toThrow('unsupported-source')
  })
})
