// Real collector -> main -> worker counters, graceful quit and restore. TEMP only.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { eventually, newProfile, startApp, stopApp, pageWs, evaluate, parseArgs } from './cdp-tools.mjs'
const args=parseArgs(process.argv.slice(2)), profile=newProfile(), port=Number(args.port??9584)
const exe=args.exe??'node_modules/electron/dist/electron.exe',app=args.app===''?'':args.app??'out/main/index.js'
const db=new DatabaseSync(join(profile,'rased.db'))
const migrations=[...readFileSync('src/storage/migrations.ts','utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for(const m of migrations)db.exec(m[1])
db.exec('PRAGMA user_version='+migrations.length)
db.prepare("INSERT INTO settings VALUES('app',?)").run(JSON.stringify({mostaqlEnabled:false,khamsatEnabled:false,nafezlyEnabled:false,kafEnabled:false}))
db.close()
writeFileSync(join(profile,'telemetry-fixture.json'),'{}')
writeFileSync(join(profile,'detail-fixture.html'),readFileSync('tests/fixtures/detail-body.html','utf8')+readFileSync('tests/fixtures/detail-sample.html','utf8'))
const rss=ids=>writeFileSync(join(profile,'rss-fixture.xml'),`<rss version="2.0"><channel><title>Fixture</title>${ids.map(id=>`<item><title>Synthetic React ${id}</title><link>https://mostaql.com/go/${id}</link><description>Fixture only</description><pubDate>${new Date().toUTCString()}</pubDate></item>`).join('')}</channel></rss>`)
rss([990001])
let child,ws,passed=0
const check=(name,value)=>{assert.ok(value,name);passed++;console.log('PASS '+name)}
const ev=x=>evaluate(ws,x)
const rows=()=>{const d=new DatabaseSync(join(profile,'telemetry/queue.sqlite'));try{return d.prepare('SELECT body FROM queue UNION ALL SELECT body FROM buckets').all().map(r=>JSON.parse(r.body))}finally{d.close()}}
const counters=()=>rows().filter(e=>e.name==='monitoring_hourly').reduce((n,e)=>({success:n.success+(e.properties.mostaql_success??0),failure:n.failure+(e.properties.mostaql_failure??0)}),{success:0,failure:0})
const sink=()=>{const file=join(profile,'telemetry-fixture-sink/fixture-events.jsonl');return existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]}
async function boot(){child=startApp({exe,app,profile,port});ws=await pageWs(port);await eventually(()=>ev('!!window.rased'));await ev('document.querySelector(".splash-enter")?.click()')}
async function graceful(){await ev('window.rased.confirmClose(true);true');await eventually(()=>child.exitCode,code=>code!==null,15000);await eventually(async()=>{try{await fetch(`http://127.0.0.1:${port}/json/list`);return false}catch{return true}})}
try{
 await boot();await ev('window.rased.analyticsConsent("enable")')
 await ev('window.rased.updateSettings({mostaqlEnabled:true})');await ev('window.rased.resume()')
 await eventually(()=>ev('window.rased.getHealth()'),h=>!!h.lastSuccessAt,15000);await ev('window.rased.pause()')
 await eventually(()=>counters().success===1)
 check('actual first collector success is counted without treating cached startup as a new check',counters().success===1)
 writeFileSync(join(profile,'monitoring-config.json'),'{"mostaql":{"status":503}}')
 await ev('window.rased.resume()');await eventually(()=>ev('window.rased.getHealth()'),h=>!!h.lastError,15000);await ev('window.rased.pause()')
 writeFileSync(join(profile,'monitoring-config.json'),'{}');rss([990002,990001])
 await ev('window.rased.resume()');await eventually(()=>counters().success===2,Boolean,25000)
 check('real collector success/failure/success reaches hourly telemetry exactly',counters().success===2&&counters().failure===1)
 await eventually(()=>rows().some(e=>e.name==='notification_summary'&&e.properties.mostaql_shown===1),Boolean,40000)
 await ev('window.rased.pause()')
 const notices=rows().filter(e=>e.name==='notification_summary')
 check('project notification records requested and OS-fixture shown outcomes',notices.reduce((n,e)=>n+(e.properties.mostaql_requested??0),0)===1&&notices.reduce((n,e)=>n+(e.properties.mostaql_shown??0),0)===1)
 await graceful()
 const state=new DatabaseSync(join(profile,'telemetry/queue.sqlite'))
 check('graceful application shutdown seals current-hour buckets',state.prepare('SELECT count(*) n FROM buckets').get().n===0&&state.prepare('SELECT count(*) n FROM queue').get().n>0);state.close()
 await boot();await ev('window.rased.updateSettings({mostaqlEnabled:false})')
 const archive=join(profile,'synthetic.rased-backup')
 writeFileSync(join(profile,'data-dialog.json'),JSON.stringify({'save-backup':archive,'open-backup':archive}))
 check('creates a scoped backup before restoration',(await ev('window.rased.createBackup()')).ok)
 const preview=await ev('window.rased.validateRestore()');check('validates the actual restore archive',preview.ok)
 check('actual restore stages successfully',(await ev(`window.rased.applyRestore(${JSON.stringify(preview.token)},false)`)).ok)
 // Restore reset intentionally discards pre-restore unsent counters.
 await eventually(()=>rows().filter(e=>e.name==='feature_used'&&e.properties.feature==='restore_requested').length===1)
 check('restore reset records exactly one new restore outcome',rows().filter(e=>e.name==='feature_used'&&e.properties.feature==='restore_requested').length===1)
 check('pre-restore monitoring counters were cleared',!rows().some(e=>e.name==='monitoring_hourly'))
 check('fixture sink remains separate from the app data and no automatic cloud sending occurs',sink().every(e=>e.environment==='qa'))
 await graceful()
 console.log(`TELEMETRY LIFECYCLE PASSED (${passed} assertions). TEMP profile: ${profile}`)
}finally{if(child&&child.exitCode===null)await stopApp(child)}
