// Exercise the built worker with a synthetic fetch inside the test worker only.
// No production endpoint is contacted; all databases are fresh TEMP fixtures.
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { TELEMETRY_DISCLOSURE } from '../src/shared/telemetry.ts'

const root = mkdtempSync(join(tmpdir(),'rased-test-telemetry-worker-'))
const directory = join(root,'telemetry'); mkdirSync(directory)
const entry = resolve('out/main/telemetryWorker.js')
const identity = randomUUID(), disclosure = TELEMETRY_DISCLOSURE
let generation = 0, worker, request=0, messages=[], passed=0, timeOffset=0, configuration=0
const consent = state => ({state,identity:state==='unknown'?null:identity,disclosure,generation:++generation,prompted:state!=='unknown'})
const check = (label,value) => { assert.ok(value,label); passed++; console.log('PASS '+label) }
const pause = () => new Promise(r=>setTimeout(r,20))
async function until(fn) { const deadline=Date.now()+7000; while(Date.now()<deadline) { const value=fn(); if(value) return value; await pause() } throw Error('Timed out waiting for built telemetry worker') }
function boot(c,configured=true,appVersion='0.8.1') {
  messages=[]
  const data={directory,consent:c,config:configured?{host:'https://us.i.posthog.com',environment:'qa',token:'synthetic-test-not-usable-'+configuration}:null,context:{appVersion,environment:'qa',language:'en',windowsFamily:'10'}}
  worker=new Worker(`
    const {parentPort}=require('node:worker_threads'); let mode='success',offset=${timeOffset},realNow=Date.now;
    Date.now=()=>realNow()+offset;
    parentPort.on('message',m=>{if(m.type==='fixture-mode')mode=m.mode;if(m.type==='fixture-advance')offset+=m.ms});
    globalThis.fetch=async(url,init)=>{
      parentPort.postMessage({type:'fixture-http',body:JSON.parse(init.body),redirect:init.redirect});
      if(mode==='pending') return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{parentPort.postMessage({type:'fixture-aborted'});reject(Error('aborted'))},{once:true}));
      if(mode==='offline')throw Error('PRIVATE_NETWORK_CANARY');
      if(mode==='forbidden')return new Response('{}',{status:403});
      if(mode==='invalid')return new Response('{}',{status:400});
      if(mode==='server')return new Response('{}',{status:503});
      if(mode==='throttled')return new Response('{}',{status:429,headers:{'retry-after':'120'}});
      return new Response('{"status":"Ok"}');
    };
    require(${JSON.stringify(entry)});
  `,{eval:true,workerData:data})
  worker.on('message',m=>messages.push(m))
  worker.on('error',error=>{ console.error(error); process.exitCode=1 })
}
async function acknowledged(message) {
  const id=++request; worker.postMessage({...message,request:id})
  return until(()=>messages.find(m=>m.type==='status'&&m.request===id))
}
const mode = value=>worker.postMessage({type:'fixture-mode',mode:value})
const advance = ms=>{timeOffset+=ms;worker.postMessage({type:'fixture-advance',ms})}
const latest=()=>messages.filter(m=>m.type==='status').at(-1)
const calls=()=>messages.filter(m=>m.type==='fixture-http')
function rows() { const d=new DatabaseSync(join(directory,'queue.sqlite'),{timeout:5000}); try{return d.prepare('SELECT body FROM queue').all().map(r=>JSON.parse(r.body))}finally{d.close()} }
function meta(key) { const d=new DatabaseSync(join(directory,'queue.sqlite'),{timeout:5000});try{return d.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value}finally{d.close()} }
async function close() {const w=worker; worker.postMessage({type:'close'}); await new Promise(r=>w.once('exit',r)); worker=null}
try {
  boot(consent('unknown')); await until(latest)
  await acknowledged({type:'flush'}); check('built worker sends nothing without consent',calls().length===0&&rows().length===0)
  await acknowledged({type:'consent',consent:consent('enabled')})
  worker.postMessage({type:'record',generation,name:'active_daily',properties:{activity_kind:'interface'},once:'active:test:interface'})
  worker.postMessage({type:'record',generation,name:'active_daily',properties:{activity_kind:'interface'},once:'active:test:interface'})
  mode('pending'); await acknowledged({type:'flush'}); await until(()=>calls().length===1)
  check('worker deduplicates daily activity and emits enrollment/version exactly once',calls()[0].body.batch.length===3)
  const ids=calls()[0].body.batch.map(e=>e.uuid)
  await acknowledged({type:'consent',consent:consent('disabled')}); await until(()=>messages.some(m=>m.type==='fixture-aborted'))
  check('revoking during an actual pending fetch aborts it and clears its queue',rows().length===0)
  await acknowledged({type:'flush'}); check('revoked generation cannot retry a pending request',calls().length===1)
  await acknowledged({type:'consent',consent:consent('enabled')})
  worker.postMessage({type:'record',generation:generation-2,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  worker.postMessage({type:'record',generation,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  mode('throttled'); await acknowledged({type:'flush'}); await until(()=>latest()?.transport==='retrying')
  check('stale-generation event is rejected',rows().length===1)
  const retryId=calls().at(-1).body.batch[0].uuid, count=calls().length
  await acknowledged({type:'flush'}); advance(119000); await acknowledged({type:'flush'})
  check('Retry-After prevents early sends',calls().length===count)
  advance(2000); mode('success'); await acknowledged({type:'flush'}); await until(()=>latest()?.transport==='idle')
  check('a retry keeps its event UUID and acknowledges only the accepted batch',calls().at(-1).body.batch[0].uuid===retryId&&rows().length===0)
  worker.postMessage({type:'record',generation,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  advance(11000); mode('forbidden'); await acknowledged({type:'flush'}); await until(()=>latest()?.transport==='rejected')
  const rejectedCount=calls().length; advance(36000000); await acknowledged({type:'flush'})
  check('permanent rejection stops repeated network requests',calls().length===rejectedCount)
  await close(); boot(consent('enabled')); await until(latest); await acknowledged({type:'flush'})
  check('permanent rejection survives an ordinary restart',latest()?.transport==='rejected'&&calls().length===0)
  await close(); configuration++; boot(consent('enabled')); await until(latest)
  mode('offline'); await acknowledged({type:'flush'}); await until(()=>latest()?.transport==='retrying')
  const retained=rows().map(e=>e.eventId); await close()
  boot(consent('enabled')); await until(latest); mode('success'); await acknowledged({type:'flush'})
  check('a retry cooldown survives worker restart',calls().length===0)
  advance(40000); await acknowledged({type:'flush'}); await until(()=>calls().length===1&&latest()?.transport==='idle')
  check('worker restart preserves the queued event identity without replaying already acknowledged events',retained.every(id=>calls()[0].body.batch.some(e=>e.uuid===id))&&!calls()[0].body.batch.some(e=>ids.includes(e.uuid)))
  worker.postMessage({type:'counter',generation,name:'monitoring_hourly',field:'mostaql_success'})
  worker.postMessage({type:'counter',generation,name:'monitoring_hourly',field:'mostaql_success'})
  advance(3600000); await acknowledged({type:'flush'}); await until(()=>calls().length===2&&latest()?.transport==='idle')
  check('source checks are aggregated in the actual worker before transport',calls()[1].body.batch.some(e=>e.event==='rased.app.monitoring_hourly'&&e.properties.mostaql_success===2))
  worker.postMessage({type:'suspend'})
  // Inspect the ordered suspend command via the following explicit flush.
  worker.postMessage({type:'record',generation,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  const sleeping=calls().length; advance(3600000); await acknowledged({type:'flush'})
  check('sleep suspends transport while preserving local events',calls().length===sleeping&&rows().length>0)
  worker.postMessage({type:'resume'}); advance(16000); await acknowledged({type:'flush'}); await until(()=>calls().length===sleeping+1)
  check('resume honors a short delay then can send',calls().length===sleeping+1)
  await close(); boot(consent('enabled'),false); await until(latest); await acknowledged({type:'flush'})
  check('unconfigured build never records or sends even with an old enabled consent',calls().length===0&&rows().length===0)
  await close()
  configuration++; boot(consent('enabled')); await until(latest)
  worker.postMessage({type:'record',generation,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  mode('invalid'); await acknowledged({type:'flush'}); await until(()=>latest()?.transport==='retrying')
  check('400 rejection is bounded and does not delete any universally rejected event',calls().length<=12&&rows().length>0&&Number(meta('dropped')??0)===0)
  advance(40000);mode('success');await acknowledged({type:'flush'});await until(()=>latest()?.transport==='idle')
  check('validation rejection recovers without changing the key',rows().length===0)
  worker.postMessage({type:'record',generation,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  advance(11000);mode('server');await acknowledged({type:'flush'});await until(()=>latest()?.transport==='retrying')
  check('one HTTP failure increments the durable counter once',meta('failures')==='1')
  advance(40000);mode('pending');const beforeSleep=Number(meta('failures'))
  await acknowledged({type:'flush'});await until(()=>latest()?.transport==='sending')
  worker.postMessage({type:'suspend'});await until(()=>messages.some(m=>m.type==='fixture-aborted'))
  await until(()=>latest()?.transport==='idle')
  check('a real pending fetch cancelled by sleep preserves the failure ladder',Number(meta('failures'))===beforeSleep)
  worker.postMessage({type:'resume'});advance(60000);mode('success');await acknowledged({type:'flush'});await until(()=>latest()?.transport==='idle'&&rows().length===0)
  worker.postMessage({type:'record',generation,name:'feature_used',properties:{feature:'bookmark',outcome:'success'}})
  advance(11000);mode('throttled');await acknowledged({type:'flush'});await until(()=>latest()?.transport==='retrying')
  const retryDeadline=meta('retry-at');await close()
  boot(consent('enabled'),true,'0.9.0');await until(latest);await acknowledged({type:'flush'})
  check('an app upgrade cannot bypass a provider Retry-After',calls().length===0&&meta('retry-at')===retryDeadline)
  await close()
  console.log(`TELEMETRY WORKER PASSED (${passed} assertions). Synthetic profile: ${root}`)
} catch(error) { console.error(error); process.exitCode=1 }
finally {if(worker) await worker.terminate()}
