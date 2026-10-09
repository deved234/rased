// Retirement integration: real main/preload/React/SQLite, isolated TEMP data only.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createConnection} from 'node:net'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {newProfile,startApp,stopApp,pageWs,evaluate,eventually,parseArgs,targets,call} from './cdp-tools.mjs'
const args=parseArgs(process.argv.slice(2)), profile=newProfile(),port=9366
const db=new DatabaseSync(join(profile,'rased.db'))
const schema=readFileSync('src/storage/migrations.ts','utf8'),migrations=[...schema.matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for(const m of migrations)db.exec(m[1])
db.exec(`PRAGMA user_version=${migrations.length}`)
for(const [id,source] of [[1,'mostaql'],[2,'nafezly'],[3,'khamsat']])db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(?,?,?,?,?,'now','now','initial','now','now')").run(id,source,String(id),`https://${source}.com/project/${id}`,'Retirement fixture '+source)
db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({khamsatEnabled:false,nafezlyEnabled:false,quickApply:{enabled:true,template:'Preserved template',budgetPositionPercent:50,extraDays:1}}))
db.prepare('INSERT INTO quick_apply_tickets(ticket,project_id,expires_at) VALUES(?,?,?)').run('a'.repeat(32),1,Date.now()+60000)
for(const name of ['rased-quick-apply-mostaql','rased-quick-apply-nafezly','unrelated-profile']){const path=join(profile,'Partitions',name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'Cookies'),'fixture')}
const child=startApp({exe:args.exe??'node_modules/electron/dist/electron.exe',app:args.app??(args.exe?undefined:'out/main/index.js'),profile,port})
let checks=0
let bridgeSocket
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS '+name)}
try {
 const ws=await pageWs(port),ev=expression=>evaluate(ws,expression)
 await eventually(()=>ev("typeof window.rased?.getSettings==='function'"))
 await eventually(()=>ev("!!document.querySelector('.app') || document.querySelector('.splash')?.dataset.phase==='ready'"))
 await ev("document.querySelector('.splash-enter')?.click()")
 await eventually(()=>ev("!!document.querySelector('.app')"))
 const saved=await ev('window.rased.getSettings()')
 check('saved template and calculation preferences preserved',saved.quickApply.template==='Preserved template'&&saved.quickApply.budgetPositionPercent===50&&saved.quickApply.extraDays===1)
 check('legacy enabled flag disabled',saved.quickApply.enabled===false)
 check('embedded-browser preload APIs removed',await ev("['quickStart','quickLogin','quickClear','quickState','quickCommand','onQuickState'].every(k=>!(k in window.rased))"))
 check('only old browser partitions deleted',!existsSync(join(profile,'Partitions','rased-quick-apply-mostaql'))&&!existsSync(join(profile,'Partitions','rased-quick-apply-nafezly'))&&existsSync(join(profile,'Partitions','unrelated-profile','Cookies')))
 check('old activation tickets invalidated',db.prepare('SELECT COUNT(*) n FROM quick_apply_tickets').get().n===0)
 check('all three source histories preserved',db.prepare('SELECT COUNT(*) n FROM projects').get().n===3)
 await ev("location.hash='#/settings/quick'")
 await eventually(()=>ev("!!document.getElementById('quick-template')"))
 check('settings show preserved template',await ev("document.getElementById('quick-template').value==='Preserved template'"))
 check('extension toggle requires pairing and embedded login is absent',await ev("!Array.from(document.querySelectorAll('button')).some(b=>/الدخول|حذف جلسة|Sign in|Delete session/.test(b.textContent)) && document.querySelector('section.set-group input[type=checkbox]').disabled"))
 check('extension setup and Khamsat exclusion disclosed',await ev("document.body.textContent.includes('خمسات غير مشمول')&&document.body.textContent.includes('تحميل إضافة غير مضغوطة')"))
 mkdirSync('.local/qa/screenshots/quick-apply',{recursive:true})
 writeFileSync('.local/qa/screenshots/quick-apply/ar-settings.png',Buffer.from((await call(ws,'Page.captureScreenshot',{format:'png'})).data,'base64'))
 await ev("window.rased.updateSettings({quickApply:{enabled:false,template:'Updated template',budgetPositionPercent:75,extraDays:2}})")
 check('template settings remain editable',(await ev('window.rased.getSettings()')).quickApply.template==='Updated template')
 await ev("window.rased.updateSettings({quickApply:{enabled:true,template:'Updated template',budgetPositionPercent:75,extraDays:2}}).catch(()=>null)")
 check('legacy clients cannot re-enable the retired flow',(await ev('window.rased.getSettings()')).quickApply.enabled===false)
 await ev("window.rased.updateSettings({language:'en'})")
 await eventually(()=>ev("document.documentElement.lang==='en'"))
 check('English explains unpacked extension setup',await ev("document.body.textContent.includes('Load unpacked')"))
 writeFileSync('.local/qa/screenshots/quick-apply/en-settings.png',Buffer.from((await call(ws,'Page.captureScreenshot',{format:'png'})).data,'base64'))
 check('no embedded platform webcontents',(await targets(port)).every(t=>!/^https:\/\/(mostaql|nafezly)\.com/.test(t.url)))
 check('extension files prepared through trusted main IPC',(await ev("window.rased.extensionAction({action:'prepare'})")).ok)
 const status=await ev('window.rased.getExtensionStatus()')
 check('packaged/source helper copied to stable user folder',status.installed&&status.registered&&existsSync(join(profile,'chrome-link','bridge','rased-chrome-host.exe')))
 const root=join(profile,'chrome-link'),token=readFileSync(join(root,'bridge-token'),'utf8'),pipe='\\\\.\\pipe\\rased-extension-'+createHash('sha256').update(root).digest('hex').slice(0,24)
 const messages=[];let buffer=Buffer.alloc(0)
 bridgeSocket=createConnection(pipe)
 bridgeSocket.on('error',()=>undefined)
 bridgeSocket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){const n=buffer.readUInt32LE(0);messages.push(JSON.parse(buffer.subarray(4,4+n)));buffer=buffer.subarray(4+n)}})
 const send=value=>{const b=Buffer.from(JSON.stringify(value)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);bridgeSocket.write(Buffer.concat([h,b]))}
 await new Promise(resolve=>bridgeSocket.once('connect',resolve));send({type:'bridge-auth',token});await eventually(()=>messages.some(m=>m.type==='bridge-ready'))
 send({type:'hello',clientId:'a'.repeat(32),token:null,version:'0.1.0',protocol:1});await eventually(()=>messages.some(m=>m.type==='unpaired'));send({type:'pair-request'})
 const pending=await eventually(()=>ev('window.rased.getExtensionStatus()'),v=>v.pairing.length===1)
 const pair=pending.pairing[0]
 check('main IPC approves only the pending code',(await ev(`window.rased.extensionAction(${JSON.stringify({action:'approve',id:pair.id,code:pair.code,label:'Integration profile'})})`)).ok)
 const cfg=await ev("window.rased.updateSettings({quickApply:{enabled:true,template:'Integration draft',budgetPositionPercent:50,extraDays:1}})")
 check('paired client enables saved template',cfg.quickApply.enabled)
 check('quick project action enters actual broker',(await ev('window.rased.quickApplyProject(1)')).ok)
 await eventually(()=>messages.some(m=>m.type==='prepare'))
 const request=messages.find(m=>m.type==='prepare')
 check('only the explicit project and settings snapshot are sent',request.source==='mostaql'&&request.externalId==='1'&&request.settings.template==='Integration draft'&&request.url==='https://mostaql.com/project/1')
 send({type:'result',requestId:request.requestId,phase:'ready',tabId:123,price:38,days:6})
 await eventually(()=>ev('window.rased.getExtensionStatus()'),v=>v.lastJob?.phase==='ready')
 check('result crosses broker, main, preload and UI status',true)
 await eventually(()=>ev("document.querySelector('.settings-content')?.textContent.includes('Draft ready')"))
 check('terminal job status is translated and offers no cancellation',await ev("!Array.from(document.querySelectorAll('.settings-content button')).some(b=>b.textContent.includes('Cancel preparation'))"))
 check('Khamsat quick action rejected by actual main IPC',!(await ev('window.rased.quickApplyProject(3)')).ok)
 await ev(`window.rased.extensionAction(${JSON.stringify({action:'revoke',id:pair.id})})`)
 check('unpair disables Quick Apply without deleting template',!(await ev('window.rased.getSettings()')).quickApply.enabled)
 console.log(JSON.stringify({checks,profile}))
}finally{bridgeSocket?.destroy();await stopApp(child);db.close();const key='HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.rased.quick_apply_integration';const entry=spawnSync('reg.exe',['query',key,'/ve'],{encoding:'utf8',windowsHide:true});if(entry.stdout.includes(join(profile,'chrome-link','bridge','native-host.json')))spawnSync('reg.exe',['delete',key,'/f'],{windowsHide:true})}
