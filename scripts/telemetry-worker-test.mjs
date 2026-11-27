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
  const data={directory,consent:c,config:configured?{host:'https://us.i.posthog.com',environment:'qa',token:'synthetic-test-not-usable-'+configuration}:null,context:{appVersion,environment:'qa',language:'en',osFamily:'windows-10',osMajor:'none',cpuArch:'x64'}}
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
function buckets() { const d=new DatabaseSync(join(directory,'queue.sqlite'),{timeout:5000});try{return d.prepare('SELECT key, body FROM buckets').all().map(r=>({key:r.key, body:JSON.parse(r.body)}))}finally{d.close()} }
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

  // Clear retry deadline and remaining events before watch checks
  configuration++; boot(consent('disabled'), true, '0.9.0'); await until(latest)
  await close()

  // Fresh boot for watch telemetry worker tests
  configuration++; boot(consent('enabled'), true, '0.9.0'); await until(latest)

  // 1a. With enabled consent: counter messages for watch_hourly (mostaql_ok, kaf_blocked) and gauge messages
  // (mostaql_slot '20s' then '10s', nafezly_slot '80s_plus') in the same hour produce ONE watch_hourly
  // bucket/envelope whose properties are mostaql_ok 1, kaf_blocked 1, mostaql_slot '20s', nafezly_slot '80s_plus',
  // and it is delivered to the synthetic endpoint when flush/seal runs.
  worker.postMessage({type:'counter',generation,name:'watch_hourly',field:'mostaql_ok'})
  worker.postMessage({type:'counter',generation,name:'watch_hourly',field:'kaf_blocked'})
  worker.postMessage({type:'gauge',generation,name:'watch_hourly',field:'mostaql_slot',value:'20s'})
  worker.postMessage({type:'gauge',generation,name:'watch_hourly',field:'mostaql_slot',value:'10s'})
  worker.postMessage({type:'gauge',generation,name:'watch_hourly',field:'nafezly_slot',value:'80s_plus'})
  await until(()=>buckets().some(b=>b.key.startsWith('watch_hourly:')&&b.body.properties.nafezly_slot==='80s_plus'))
  const b1=buckets().find(b=>b.key.startsWith('watch_hourly:'))
  assert.equal(buckets().filter(b=>b.key.startsWith('watch_hourly:')).length, 1)
  assert.deepEqual(b1.body.properties, {mostaql_ok:1, kaf_blocked:1, mostaql_slot:'20s', nafezly_slot:'80s_plus'})
  advance(3600000); mode('success'); await acknowledged({type:'flush'}); await until(()=>calls().length===1&&latest()?.transport==='idle')
  const deliveredWatchHourly=calls()[0].body.batch.find(e=>e.event==='rased.app.watch_hourly')
  check('watch_hourly aggregates counters and highest gauge in one envelope delivered to transport',
    deliveredWatchHourly&&deliveredWatchHourly.properties.mostaql_ok===1&&deliveredWatchHourly.properties.kaf_blocked===1&&
    deliveredWatchHourly.properties.mostaql_slot==='20s'&&deliveredWatchHourly.properties.nafezly_slot==='80s_plus')

  // 1b. A gauge sent BEFORE any counter in a new hour, then a counter: one envelope containing both.
  worker.postMessage({type:'gauge',generation,name:'watch_hourly',field:'mostaql_slot',value:'40s'})
  worker.postMessage({type:'counter',generation,name:'watch_hourly',field:'mostaql_ok'})
  await until(()=>buckets().some(b=>b.key.startsWith('watch_hourly:')&&b.body.properties.mostaql_slot==='40s'&&b.body.properties.mostaql_ok===1))
  advance(3600000); await acknowledged({type:'flush'}); await until(()=>calls().length===2&&latest()?.transport==='idle')
  const gaugeBeforeCounter=calls()[1].body.batch.find(e=>e.event==='rased.app.watch_hourly')
  check('gauge before counter in a new hour produces one envelope containing both',
    gaugeBeforeCounter&&gaugeBeforeCounter.properties.mostaql_slot==='40s'&&gaugeBeforeCounter.properties.mostaql_ok===1)

  // 1c. Stale generation: counter and gauge messages carrying an old generation are dropped (no bucket change).
  const preStaleBuckets=buckets().length
  worker.postMessage({type:'counter',generation:generation-1,name:'watch_hourly',field:'kaf_failed'})
  worker.postMessage({type:'gauge',generation:generation-1,name:'watch_hourly',field:'kaf_slot',value:'40s'})
  advance(1000); await acknowledged({type:'flush'})
  check('stale generation counter and gauge messages are dropped',
    buckets().length===preStaleBuckets&&!buckets().some(b=>b.body.properties.kaf_failed||b.body.properties.kaf_slot))

  // 1d. Disabled consent: counter and gauge messages are dropped.
  await acknowledged({type:'consent',consent:consent('disabled')})
  worker.postMessage({type:'counter',generation,name:'watch_hourly',field:'mostaql_ok'})
  worker.postMessage({type:'gauge',generation,name:'watch_hourly',field:'mostaql_slot',value:'20s'})
  advance(1000); await acknowledged({type:'flush'})
  check('disabled consent drops counter and gauge messages',
    buckets().length===0&&rows().length===0)

  // 1e. Withdrawal while watch counters/gauges are pending: the pending watch_hourly bucket is cleared exactly like existing summaries, and nothing is sent afterwards.
  await acknowledged({type:'consent',consent:consent('enabled')})
  worker.postMessage({type:'counter',generation,name:'watch_hourly',field:'mostaql_ok'})
  worker.postMessage({type:'gauge',generation,name:'watch_hourly',field:'mostaql_slot',value:'20s'})
  await until(()=>buckets().some(b=>b.key.startsWith('watch_hourly:')&&b.body.properties.mostaql_slot==='20s'))
  await acknowledged({type:'consent',consent:consent('disabled')})
  const callsBeforeWithdraw=calls().length
  check('withdrawal while watch data is pending clears the pending bucket', buckets().length===0)
  advance(3600000); await acknowledged({type:'flush'})
  check('nothing sent after withdrawal of pending watch data', calls().length===callsBeforeWithdraw)

  // 1f. Purge (local forgetting) with pending watch data: the bucket and the once:watch_daily:* marker are gone afterwards.
  await acknowledged({type:'consent',consent:consent('enabled')})
  worker.postMessage({type:'counter',generation,name:'watch_hourly',field:'mostaql_ok'})
  worker.postMessage({type:'record',generation,name:'watch_daily',properties:{source:'mostaql',watched:'1_2',waiting:'0'},once:'watch_daily:today:mostaql'})
  await until(()=>meta('once:watch_daily:today:mostaql')==='1'&&buckets().length>0)
  await acknowledged({type:'purge'})
  check('purge with pending watch data clears bucket and once:watch_daily marker',
    buckets().length===0&&meta('once:watch_daily:today:mostaql')==null)

  // 1g. watch_daily once key across a real restart of the worker: record watch_daily with once watch_daily:<today>:mostaql, close the worker, boot it again on the same directory, record again -> exactly one watch_daily envelope; a different source the same day -> recorded.
  await close()
  configuration++; boot(consent('enabled'), true, '0.9.0'); await until(latest)
  const today=new Date().toISOString().slice(0,10)
  const onceMostaql='watch_daily:'+today+':mostaql'
  const onceNafezly='watch_daily:'+today+':nafezly'
  worker.postMessage({type:'record',generation,name:'watch_daily',properties:{source:'mostaql',watched:'1_2',waiting:'0'},once:onceMostaql})
  await until(()=>rows().some(e=>e.name==='watch_daily'&&e.properties.source==='mostaql'))
  await close()
  boot(consent('enabled'), true, '0.9.0'); await until(latest)
  worker.postMessage({type:'record',generation,name:'watch_daily',properties:{source:'mostaql',watched:'1_2',waiting:'0'},once:onceMostaql})
  worker.postMessage({type:'record',generation,name:'watch_daily',properties:{source:'nafezly',watched:'0',waiting:'1_2'},once:onceNafezly})
  await until(()=>rows().some(e=>e.name==='watch_daily'&&e.properties.source==='nafezly'))
  const dailyRows=rows().filter(e=>e.name==='watch_daily')
  check('watch_daily once key survives restart with exactly one envelope and accepts another source',
    dailyRows.filter(e=>e.properties.source==='mostaql').length===1&&
    dailyRows.filter(e=>e.properties.source==='nafezly').length===1)
  await close()
  console.log(`TELEMETRY WORKER PASSED (${passed} assertions). Synthetic profile: ${root}`)
} catch(error) { console.error(error); process.exitCode=1 }
finally {if(worker) await worker.terminate()}
