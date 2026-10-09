import {it,expect} from 'vitest'
import {createConnection,type Socket} from 'node:net'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../src/storage/db.js'
import {ExtensionBroker} from '../src/main/extension/broker.js'
import {FrameReader,encodeFrame} from '../src/main/extension/framing.js'
import {defaultSettings} from '../src/shared/types.js'
import {EXTENSION_VERSION,PROTOCOL_VERSION} from '../src/shared/extension/protocol.js'
const wait=async(fn:()=>boolean)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,25))}throw Error('condition-timeout')}
it.skipIf(process.platform!=='win32')('authenticates, isolates selected clients, ignores wrong-owner results, and cancels without accepting late results',async()=>{
  const root=mkdtempSync(join(tmpdir(),'rased-broker-unit-')),db=openDatabase(join(root,'db')),settings=defaultSettings(),sockets:Socket[]=[]
  settings.quickApply={enabled:true,template:'Private template',budgetPositionPercent:50,extraDays:1}
  const broker=new ExtensionBroker(db,join(root,'link'),root,()=>settings,()=>undefined,async()=>undefined,'com.rased.quick_apply_unit')
  const connect=async(token:string,id:string)=>{
    const socket=createConnection(broker.setup.pipe),messages:Record<string,unknown>[]=[];sockets.push(socket)
    socket.on('error',()=>undefined);const reader=new FrameReader(v=>messages.push(v as Record<string,unknown>));socket.on('data',b=>reader.push(b));await new Promise<void>(r=>socket.once('connect',r))
    socket.write(encodeFrame({type:'bridge-auth',token}));if(token!==broker.setup.token){await wait(()=>socket.destroyed);return {socket,messages}}
    await wait(()=>messages.some(m=>m.type==='bridge-ready'))
    socket.write(encodeFrame({type:'hello',clientId:id,token:null,version:EXTENSION_VERSION,protocol:PROTOCOL_VERSION}));await wait(()=>messages.some(m=>m.type==='unpaired'))
    socket.write(encodeFrame({type:'pair-request'}));await wait(()=>broker.status().pairing.some(p=>p.id===id))
    const code=broker.status().pairing.find(p=>p.id===id)!.code;expect(broker.approve(id,code,id.slice(0,3))).toBe(true);return {socket,messages}
  }
  try{
    await broker.start();broker.setup.installed=true;broker.setup.registered=true
    const wrong=await connect('0'.repeat(64),'e'.repeat(32));expect(wrong.messages).toHaveLength(0)
    const first=await connect(broker.setup.token,'a'.repeat(32)),second=await connect(broker.setup.token,'b'.repeat(32))
    broker.select('a'.repeat(32))
    db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','1','https://mostaql.com/project/1','Fixture','now','now','initial','now','now')").run()
    expect(await broker.quick(1)).toBe(true);await wait(()=>first.messages.some(m=>m.type==='prepare'))
    expect(second.messages.some(m=>m.type==='prepare')).toBe(false)
    const request=broker.status().lastJob!.requestId
    second.socket.write(encodeFrame({type:'result',requestId:request,phase:'ready'}));await new Promise(r=>setTimeout(r,50));expect(broker.status().lastJob!.phase).toBe('opening')
    broker.cancel();first.socket.write(encodeFrame({type:'result',requestId:request,phase:'ready'}));await new Promise(r=>setTimeout(r,50));expect(broker.status().lastJob!.phase).toBe('cancelled')
    expect(first.messages.some(m=>m.type==='cancel')).toBe(true)
    expect(await broker.quick(1)).toBe(true);broker.revoke('a'.repeat(32));expect(broker.status().lastJob!.phase).toBe('cancelled');expect(broker.available()).toBe(false)
  }finally{broker.dispose();for(const socket of sockets)socket.destroy();db.close()}
})
