import { describe,expect,it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../src/storage/migrations.js'
import { quickPrice,validQuickApply,defaultQuickApply,parseQuickTicket } from '../src/shared/quickApply.js'
import { sanitizeSettings } from '../src/shared/types.js'
import { issueQuickTicket,consumeQuickTicket } from '../src/storage/quickApply.js'
import { browserToastXml } from '../src/main/toast.js'
describe('quick apply values',()=>{
  it.each([[0,25],[50,37.5],[100,50]])('positions %s within the budget', (percent,price)=>expect(quickPrice(25,50,percent)).toBe(price))
  it('uses fixed budgets and rounds within valid integer limits',()=>{expect(quickPrice(25,25,100)).toBe(25);expect(quickPrice(25.2,50.2,0,1)).toBe(26);expect(quickPrice(25.2,25.8,0,1)).toBeNull()})
  it.each([[0,50,0],[50,25,0],[25,50,101],[25,50,NaN],[25,Infinity,0]])('rejects invalid budget %s %s %s',(a,b,c)=>expect(quickPrice(a,b,c)).toBeNull())
  it('preserves old settings and requires an explicit usable template',()=>{
    expect(sanitizeSettings({language:'en'}).quickApply).toEqual(defaultQuickApply())
    expect(validQuickApply({...defaultQuickApply(),enabled:true})).toBe(false)
    expect(validQuickApply({...defaultQuickApply(),template:'Real proposal',enabled:true})).toBe(true)
    expect(validQuickApply({...defaultQuickApply(),extraDays:1.5})).toBe(false)
    expect(validQuickApply({...defaultQuickApply(),template:'x'.repeat(10001)})).toBe(false)
  })
})
describe('notification activation tickets',()=>{
  it.each(['rased://quick-apply?ticket=x','rased://evil?ticket='+'a'.repeat(32),'rased://quick-apply?ticket='+'a'.repeat(32)+'&other=1','rased://quick-apply?ticket='+'a'.repeat(32)+'#x','rased://user@quick-apply?ticket='+'a'.repeat(32)])('rejects unsafe activation %s',url=>expect(parseQuickTicket(url)).toBeNull())
  it('consumes atomically once and expires, including after migration from v4',()=>{
    const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');applyMigrations(db)
    db.exec('DROP TABLE extension_jobs; DROP TABLE quick_apply_tickets; ALTER TABLE proposal_drafts DROP COLUMN provider; ALTER TABLE proposal_drafts DROP COLUMN model; ALTER TABLE proposal_drafts DROP COLUMN prompt_version; ALTER TABLE proposal_drafts DROP COLUMN generated_at; PRAGMA user_version=4;');applyMigrations(db)
    db.exec("INSERT INTO projects(source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES('mostaql','123','https://mostaql.com/go/123','Project','now','now','live','now','now')")
    const url=issueQuickTicket(db,1,1000),ticket=parseQuickTicket(url)!
    expect(ticket).toHaveLength(32);expect(consumeQuickTicket(db,ticket,1001)).toBe(1);expect(consumeQuickTicket(db,ticket,1002)).toBeNull()
    const expired=parseQuickTicket(issueQuickTicket(db,1,2000))!;expect(consumeQuickTicket(db,expired,2000+86400001)).toBeNull()
    const deleted=parseQuickTicket(issueQuickTicket(db,1,3000))!;db.exec('DELETE FROM projects');expect(consumeQuickTicket(db,deleted,3001)).toBeNull();db.close()
  })
  it('keeps browser activation on the body and view button, uses a ticket for quick action',()=>{
    const url='https://mostaql.com/go/123',ticket='rased://quick-apply?ticket='+'a'.repeat(32)
    const xml=browserToastXml('Title','Body',url,'C:/icon.png',false,{link:ticket,language:'en'})
    expect(xml).toContain(`launch="${url}"`);expect(xml).toContain('content="View project"');expect(xml).toContain(`arguments="${ticket}"`);expect(xml).not.toContain('activationType="foreground"')
    expect(xml.indexOf('content="Quick apply"')).toBeLessThan(xml.indexOf('content="View project"'))
    expect(()=>browserToastXml('a','b',url,'C:/icon.png',false,{link:'file:///bad',language:'ar'})).toThrow()
  })
})
