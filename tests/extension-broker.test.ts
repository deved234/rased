import {it,expect,vi} from 'vitest'
import {createConnection,type Socket} from 'node:net'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../src/storage/db.js'
import {applyMigrations} from '../src/storage/migrations.js'
import {ExtensionBroker} from '../src/main/extension/broker.js'
import {FrameReader,encodeFrame} from '../src/main/extension/framing.js'
import {defaultSettings} from '../src/shared/types.js'
import {EXTENSION_VERSION,PROTOCOL_VERSION,MAX_FRAME} from '../src/shared/extension/protocol.js'
import {saveProposalDraft} from '../src/storage/proposalDrafts.js'
import {QUICK_TEXT_MAX} from '../src/shared/quickApply.js'
import {QuickAssistant} from '../src/main/extension/quickAssistant.js'
import type {AiService} from '../src/main/ai/service.js'
import {clearQuickConsent} from '../src/storage/quickConsent.js'
import {getSettingRaw,setSettingRaw} from '../src/storage/repositories.js'
import {saveProfileSet} from '../src/main/proposals.js'
import {emptyProposalProfile} from '../src/shared/proposals.js'
const wait=async(fn:()=>boolean)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,25))}throw Error('condition-timeout')}
const connect=async(broker:ExtensionBroker,token:string,id:string,sockets:Socket[])=>{
  const socket=createConnection(broker.setup.pipe),messages:Record<string,unknown>[]=[];sockets.push(socket)
  socket.on('error',()=>undefined);const reader=new FrameReader(v=>messages.push(v as Record<string,unknown>));socket.on('data',b=>reader.push(b));await new Promise<void>(r=>socket.once('connect',r))
  socket.write(encodeFrame({type:'bridge-auth',token}));if(token!==broker.setup.token){await wait(()=>socket.destroyed);return {socket,messages}}
  await wait(()=>messages.some(m=>m.type==='bridge-ready'))
  socket.write(encodeFrame({type:'hello',clientId:id,token:null,version:EXTENSION_VERSION,protocol:PROTOCOL_VERSION}));await wait(()=>messages.some(m=>m.type==='unpaired'))
  socket.write(encodeFrame({type:'pair-request'}));await wait(()=>broker.status().pairing.some(p=>p.id===id))
  const code=broker.status().pairing.find(p=>p.id===id)!.code;expect(broker.approve(id,code,id.slice(0,3))).toBe(true);return {socket,messages}
}
it.skipIf(process.platform!=='win32')('default profile supplies quick preparation; empty templates reject notifications without launching and permit drafts',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-profiles-')),db=openDatabase(join(root,'db')),sockets:Socket[]=[]
  let settings=defaultSettings()
  settings.quickApply={enabled:true,template:'',budgetPositionPercent:50,extraDays:1}
  setSettingRaw(db,'app',JSON.stringify(settings))
  const set={version:1 as const,defaultId:'0'.repeat(32),profiles:[
    {...emptyProposalProfile(),id:'0'.repeat(32),name:'First',quickTemplate:'First template'},
    {...emptyProposalProfile(),id:'b'.repeat(32),name:'Second',quickTemplate:'Second template'}
  ]}
  const publish=(next:typeof settings)=>{settings=next}
  saveProfileSet(db,set,publish)
  const launch=vi.fn(async()=>undefined)
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,launch,'com.rased.quick_apply_unit')
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const peer=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    saveProfileSet(db,{...set,defaultId:'b'.repeat(32)},publish)
    expect(await broker.quick(1)).toEqual({ok:true})
    await wait(()=>peer.messages.some(m=>m.type==='prepare'))
    expect((peer.messages.find(m=>m.type==='prepare')!.settings as {template:string}).template).toBe('Second template')
    broker.cancel()
    saveProfileSet(db,{...set,defaultId:'b'.repeat(32),profiles:set.profiles.map(p=>({...p,quickTemplate:''}))},publish)
    const before=peer.messages.filter(m=>m.type==='prepare').length
    const ticket=new URL(broker.ticket(1)!).searchParams.get('ticket')!
    expect(await broker.activate(ticket)).toEqual({ok:false,error:'text-empty'})
    expect(await broker.quick(1)).toEqual({ok:false,error:'text-empty'})
    expect(launch).not.toHaveBeenCalled()
    expect(peer.messages.filter(m=>m.type==='prepare')).toHaveLength(before)
    const ai={standingPreflight:vi.fn(),generateStanding:vi.fn()}
    const assistant=new QuickAssistant(db,ai as unknown as AiService,broker,()=>true,()=>undefined)
    for(const proposal of ['', ' \n\t ']){
      saveProposalDraft(db,{projectId:1,proposal,assumptions:[],questions:[],updatedAt:new Date().toISOString()})
      expect(await broker.quick(1,'draft')).toEqual({ok:false,error:'draft-empty'})
      expect(await broker.quick(1,'draft',proposal)).toEqual({ok:false,error:'draft-empty'})
      expect(await assistant.quick(1)).toEqual({ok:false,error:'draft-empty'})
      expect(peer.messages.filter(m=>m.type==='prepare')).toHaveLength(before)
      expect(launch).not.toHaveBeenCalled()
    }
    expect(ai.standingPreflight).not.toHaveBeenCalled()
    expect(ai.generateStanding).not.toHaveBeenCalled()
    assistant.dispose()
    saveProposalDraft(db,{projectId:1,proposal:'Saved draft with no default template',assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    expect(await broker.quick(1,'draft')).toEqual({ok:true})
    await wait(()=>peer.messages.filter(m=>m.type==='prepare').length===before+1)
    expect((peer.messages.filter(m=>m.type==='prepare').at(-1)!.settings as {template:string}).template).toBe('Saved draft with no default template')
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})
it.skipIf(process.platform!=='win32')('authenticates, isolates selected clients, ignores wrong-owner results, and cancels without accepting late results',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-unit-')),db=openDatabase(join(root,'db')),settings=defaultSettings(),sockets:Socket[]=[]
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const wrong=await connect(broker,'0'.repeat(64),'e'.repeat(32),sockets);expect(wrong.messages).toHaveLength(0)
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets),second=await connect(broker,broker.setup.token,'b'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    expect((await broker.quick(1)).ok).toBe(true);await wait(()=>first.messages.some(m=>m.type==='prepare'))
    expect(second.messages.some(m=>m.type==='prepare')).toBe(false)
    const request=broker.status().lastJob!.requestId
    second.socket.write(encodeFrame({type:'result',requestId:request,phase:'ready'}));await new Promise(r=>setTimeout(r,50));expect(broker.status().lastJob!.phase).toBe('opening')
    broker.cancel();first.socket.write(encodeFrame({type:'result',requestId:request,phase:'ready'}));await new Promise(r=>setTimeout(r,50));expect(broker.status().lastJob!.phase).toBe('cancelled')
    expect(first.messages.some(m=>m.type==='cancel')).toBe(true)
    expect((await broker.quick(1)).ok).toBe(true);broker.revoke('a'.repeat(32));expect(broker.status().lastJob!.phase).toBe('cancelled');expect(broker.available()).toBe(false)
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('draft mode sends the saved text and settings',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-quick-opts-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    saveProposalDraft(db,{projectId:1,proposal:'My draft proposal',assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    const result=await broker.quick(1,'draft')
    expect(result.ok).toBe(true)
    await wait(()=>first.messages.some(m=>m.type==='prepare'))
    const prepareMsg=first.messages.find(m=>m.type==='prepare') as Record<string,unknown>
    expect(prepareMsg.settings).toBeDefined()
    const settings_=prepareMsg.settings as Record<string,unknown>
    expect(settings_.template).toBe('My draft proposal')
    expect(settings_.budgetPositionPercent).toBe(50)
    expect(settings_.extraDays).toBe(1)
    expect(settings.quickApply.template).toBe('Private template')
    expect(settings.quickApply.budgetPositionPercent).toBe(50)
    expect(settings.quickApply.extraDays).toBe(1)
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('edited draft after editor save -> text-changed',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-text-changed-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    saveProposalDraft(db,{projectId:1,proposal:'Original draft',assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    saveProposalDraft(db,{projectId:1,proposal:'Edited draft',assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    const result=await broker.quick(1,'draft','Original draft')
    expect(result.ok).toBe(false)
    if(!result.ok)expect(result.error).toBe('text-changed')
    expect(first.messages.some(m=>m.type==='prepare')).toBe(false)
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('deleted draft -> text-missing',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-text-missing-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    const result=await broker.quick(1,'draft')
    expect(result.ok).toBe(false)
    if(!result.ok)expect(result.error).toBe('text-missing')
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('draft too long -> text-too-long',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-text-too-long-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    const longDraft='x'.repeat(QUICK_TEXT_MAX+1)
    saveProposalDraft(db,{projectId:1,proposal:longDraft,assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    const result=await broker.quick(1,'draft')
    expect(result.ok).toBe(false)
    if(!result.ok)expect(result.error).toBe('text-too-long')
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('PrepareJob above the frame limit is rejected by the broker',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-frame-large-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    // Text within QUICK_TEXT_MAX cannot exceed the frame limit: 10 000 characters
    // that escape to 6 JSON bytes each plus a 500-character title stay below 64 KiB.
    const escaped=(n:number)=>Buffer.byteLength(JSON.stringify('\u0001'.repeat(n)),'utf8')
    expect(escaped(QUICK_TEXT_MAX)+escaped(500)).toBeLessThan(MAX_FRAME)
    const normalResult=await broker.quick(1)
    expect(normalResult.ok).toBe(true)
    await wait(()=>first.messages.some(m=>m.type==='prepare'))
    const requestId=broker.status().lastJob!.requestId
    first.socket.write(encodeFrame({type:'result',requestId,phase:'ready',tabId:5,price:30,days:3}))
    await wait(()=>broker.status().lastJob?.phase==='ready')
    const lastBefore=broker.status().lastJob
    const preparesBefore=first.messages.filter(m=>m.type==='prepare').length
    // The legacy no-options path does not length-check the template, so driving it
    // through settings() reproduces a broker-built PrepareJob that is too large.
    settings.quickApply.template='\u0001'.repeat(11000)
    const result=await broker.quick(1)
    expect(result.ok).toBe(false)
    if(!result.ok)expect(result.error).toBe('message-too-large')
    await new Promise(r=>setTimeout(r,100))
    expect(first.messages.filter(m=>m.type==='prepare')).toHaveLength(preparesBefore)
    expect(broker.status().lastJob).toEqual(lastBefore)
    settings.quickApply.template='Private template'
    const afterResult=await broker.quick(1)
    expect(afterResult.ok).toBe(true)
    await wait(()=>first.messages.filter(m=>m.type==='prepare').length>preparesBefore)
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('quick without options sends generic template',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-no-opts-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    saveProposalDraft(db,{projectId:1,proposal:'My draft proposal',assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    const result=await broker.quick(1)
    expect(result.ok).toBe(true)
    await wait(()=>first.messages.some(m=>m.type==='prepare'))
    const prepareMsg=first.messages.find(m=>m.type==='prepare') as Record<string,unknown>
    expect(prepareMsg.settings).toBeDefined()
    const settings_=prepareMsg.settings as Record<string,unknown>
    expect(settings_.template).toBe('Private template')
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.skipIf(process.platform!=='win32')('second quick while job active -> busy',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-busy-')),db=openDatabase(join(root,'db'))
  applyMigrations(db)
  const settings=defaultSettings()
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const sockets:Socket[]=[]
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    saveProposalDraft(db,{projectId:1,proposal:'My draft proposal',assumptions:[],questions:[],updatedAt:new Date().toISOString()})
    const result1=await broker.quick(1,'draft')
    expect(result1.ok).toBe(true)
    await wait(()=>first.messages.some(m=>m.type==='prepare'))
    const result2=await broker.quick(1,'draft')
    expect(result2.ok).toBe(false)
    if(!result2.ok)expect(result2.error).toBe('busy')
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})
it('reserves the broker against notification activation and template jobs until the owner releases it',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-reserved-')),db=openDatabase(join(root,'db')),settings=defaultSettings(),sockets:Socket[]=[]
  settings.quickApply={enabled:true,template:'Template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const peer=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    db.exec("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')")
    const ticket=new URL(broker.ticket(1)!).searchParams.get('ticket')!
    expect(broker.reserve('generation')).toBe(true)
    expect(broker.reserve('other')).toBe(false)
    expect(await broker.activate(ticket)).toMatchObject({error:'busy'})
    expect(await broker.quick(1)).toMatchObject({error:'busy'})
    expect(broker.status().lastJob).toBeNull()
    broker.release('other')
    expect(await broker.quick(1)).toMatchObject({error:'busy'})
    broker.release('generation')
    expect(await broker.activate(ticket)).toEqual({ok:true})
    await wait(()=>peer.messages.some(m=>m.type==='prepare'))
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})
it('cancellation during Chrome launch cannot revive its job or cancel a later job',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-launch-')),db=openDatabase(join(root,'db')),settings=defaultSettings(),sockets:Socket[]=[]
  settings.quickApply={enabled:true,template:'Template',budgetPositionPercent:50,extraDays:1}
  let rejectLaunch!:(reason:Error)=>void
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,()=>new Promise((_resolve,reject)=>{rejectLaunch=reject}),'com.rased.quick_apply_unit')
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const first=await connect(broker,broker.setup.token,'a'.repeat(32),sockets)
    db.exec("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')")
    first.socket.destroy();await wait(()=>!broker.status().clients[0]!.connected)
    expect(broker.reserve('owner')).toBe(true)
    const launching=broker.quick(1,'template',undefined,'owner')
    expect(broker.status().lastJob?.phase).toBe('waiting-client')
    broker.cancelOwned('wrong-owner')
    expect(broker.status().lastJob?.phase).toBe('waiting-client')
    broker.cancelOwned('owner')
    expect(broker.status().lastJob?.phase).toBe('cancelled')
    await connect(broker,broker.setup.token,'b'.repeat(32),sockets)
    expect(await broker.quick(1)).toEqual({ok:true})
    const next=broker.status().lastJob!.requestId
    rejectLaunch(Error('launch failed'))
    expect(await launching).toMatchObject({error:'chrome-unavailable'})
    expect(broker.status().lastJob).toMatchObject({requestId:next,phase:'opening'})
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})

it.each(['consent','acceptance','cancel'])('cancels an Assistant job after launch resolves and before Chrome reconnects on %s withdrawal',async action=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-assistant-owner-')),db=openDatabase(join(root,'db')),settings=defaultSettings(),sockets:Socket[]=[]
  settings.quickApply={enabled:true,template:'Template',budgetPositionPercent:50,extraDays:1}
  const launch=vi.fn(async()=>undefined),ai={cancelStanding:vi.fn()}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,launch,'com.rased.quick_apply_unit')
  let allowed=true
  const assistant=new QuickAssistant(db,ai as unknown as AiService,broker,()=>allowed,()=>undefined)
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const clientId='a'.repeat(32),first=await connect(broker,broker.setup.token,clientId,sockets)
    await wait(()=>first.messages.some(m=>m.type==='paired'))
    const token=first.messages.find(m=>m.type==='paired')!.token
    first.socket.destroy();await wait(()=>!broker.status().clients[0]!.connected)
    db.exec("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')")
    saveProposalDraft(db,{projectId:1,proposal:'Saved draft',assumptions:[],questions:[],updatedAt:'now'})
    setSettingRaw(db,'ai-quick-consent','{"version":1,"fixture":true}')
    const pending=assistant.quick(1),owner=assistant.status()!.operationId
    expect(await pending).toEqual({ok:true})
    expect(launch).toHaveBeenCalledOnce()
    expect(broker.status().lastJob?.phase).toBe('waiting-client')
    assistant.cancel('wrong-owner')
    expect(broker.status().lastJob?.phase).toBe('waiting-client')
    if(action==='consent'){clearQuickConsent(db);expect(getSettingRaw(db,'ai-quick-consent')).toBeNull()}
    if(action==='acceptance')allowed=false
    assistant.cancel(action==='cancel'?owner:undefined)
    expect(broker.status().lastJob?.phase).toBe('cancelled')
    expect(ai.cancelStanding).toHaveBeenCalledWith(owner)
    const socket=createConnection(broker.setup.pipe),messages:Record<string,unknown>[]=[];sockets.push(socket)
    const reader=new FrameReader(v=>messages.push(v as Record<string,unknown>))
    socket.on('data',b=>reader.push(b));socket.on('error',()=>undefined)
    await new Promise<void>(resolve=>socket.once('connect',resolve))
    socket.write(encodeFrame({type:'bridge-auth',token:broker.setup.token}))
    await wait(()=>messages.some(m=>m.type==='bridge-ready'))
    socket.write(encodeFrame({type:'hello',clientId,token,version:EXTENSION_VERSION,protocol:PROTOCOL_VERSION}))
    await wait(()=>messages.some(m=>m.type==='connected'))
    await new Promise(resolve=>setTimeout(resolve,50))
    expect(messages.some(m=>m.type==='prepare')).toBe(false)
    expect(broker.status().lastJob?.phase).toBe('cancelled')
    expect(await broker.quick(1)).toEqual({ok:true})
    const next=broker.status().lastJob!.requestId
    assistant.cancel(owner)
    expect(broker.status().lastJob).toMatchObject({requestId:next,phase:'opening'})
  }finally{assistant.dispose();broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})
