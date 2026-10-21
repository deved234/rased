// Real Windows regression: a mapped WAL sidecar survives a crashed writer.
// Only new, marked TEMP fixtures are touched. No real application data.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import koffi from 'koffi'
import { evaluate, eventually, newProfile, pageWs, startApp, stopApp, parseArgs } from './cdp-tools.mjs'

if (process.platform !== 'win32') throw Error('Windows-only startup regression')
const args = parseArgs(process.argv.slice(2)), profile = newProfile(), port = Number(args.port ?? 9589)
const file = join(profile, 'rased.db'), db = new DatabaseSync(file)
for (const m of readFileSync('src/storage/migrations.ts','utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)) db.exec(m[1])
const migrations = [...readFileSync('src/storage/migrations.ts','utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)].length
db.exec('PRAGMA user_version=' + migrations)
db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({mostaqlEnabled:false,khamsatEnabled:false,nafezlyEnabled:false,kafEnabled:false}))
db.close()
const writer = spawn(process.execPath,['-e',`const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(file)});d.exec("PRAGMA journal_mode=WAL;INSERT INTO settings VALUES('startup-canary','preserved')");console.log('ready');setInterval(()=>{},1000)`],{windowsHide:true,stdio:['ignore','pipe','pipe']})
const kernel = koffi.load('kernel32.dll')
const createFile = kernel.func('void* __stdcall CreateFileW(str16, uint32, uint32, void*, uint32, uint32, void*)')
const createMapping = kernel.func('void* __stdcall CreateFileMappingW(void*, void*, uint32, uint32, uint32, str16)')
const mapView = kernel.func('void* __stdcall MapViewOfFile(void*, uint32, uint32, uint32, size_t)')
const unmap = kernel.func('int __stdcall UnmapViewOfFile(void*)')
const close = kernel.func('int __stdcall CloseHandle(void*)')
let fileHandle, mapping, view, child, releaseTimer
const release = () => { if(view){unmap(view);view=null} if(mapping){close(mapping);mapping=null} if(fileHandle){close(fileHandle);fileHandle=null} }
try {
  let ready = false
  writer.stdout.on('data', chunk => { if(String(chunk).includes('ready')) ready = true })
  await eventually(()=>ready)
  fileHandle = createFile(file+'-shm',0xc0000000,7,null,3,0x80,null)
  assert.ok(fileHandle && koffi.address(fileHandle) !== 0xffffffffffffffffn,'Open synthetic shm')
  mapping = createMapping(fileHandle,null,4,0,0,null); assert.ok(mapping,'Create synthetic shm mapping')
  view = mapView(mapping,2,0,0,0); assert.ok(view,'Hold a real Windows shm mapping')
  const exited = new Promise(resolve=>writer.once('exit',resolve)); writer.kill(); await exited
  const exe = args.exe ?? 'node_modules/electron/dist/electron.exe', app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
  child = startApp({exe,app,profile,port,captureOutput:true})
  let output = ''
  child.stderr.on('data', chunk => {
    output += chunk
    if(!releaseTimer && output.includes('DevTools listening')) releaseTimer = setTimeout(release,1000)
  })
  const ws = await pageWs(port,undefined,15000)
  assert.ok(await eventually(()=>evaluate(ws,'!!window.rased')),'Window must start after mapped sidecar releases')
  assert.ok(readFileSync(join(profile,'test-trace.jsonl'),'utf8').includes('startup-db-retry'),'The native mapping must exercise the actual bounded retry')
  const check = new DatabaseSync(file)
  assert.equal(check.prepare("SELECT value FROM settings WHERE key='startup-canary'").get().value,'preserved')
  assert.equal(check.prepare('PRAGMA integrity_check(1)').get().integrity_check,'ok'); check.close()
  console.log('PASS mapped WAL recovery starts the real app without deleting committed data')
  await stopApp(child); child=null
  const bad = newProfile(); mkdirSync(join(bad,'rased.db'))
  child = startApp({exe,app,profile:bad,port:port+1,captureOutput:true})
  // Drain output so a pipe cannot become the startup failure itself.
  child.stdout.resume(); child.stderr.resume()
  await eventually(()=>child.exitCode,code=>code!==null,15000)
  assert.equal(child.exitCode,0,'Electron must quit cleanly after reporting the startup error')
  assert.ok(readFileSync(join(bad,'test-trace.jsonl'),'utf8').includes('boot-failed'))
  writeFileSync(join(bad,'rased.db','preserved.txt'),'original target directory was not deleted')
  console.log('PASS unrecoverable startup exits with a recorded error and preserves the failed target')
  const later = newProfile(); writeFileSync(join(later,'startup-failure.json'),'{}')
  child = startApp({exe,app,profile:later,port:port+2,captureOutput:true})
  child.stdout.resume();child.stderr.resume()
  await eventually(()=>child.exitCode,code=>code!==null,15000)
  assert.equal(child.exitCode,0)
  const failure = JSON.parse(readFileSync(join(later,'startup-failure.log'),'utf8').trim())
  assert.equal(failure.stage,'later');assert.equal(failure.sqliteCode,null)
  assert.ok(!JSON.stringify(failure).includes('synthetic'))
  console.log('PASS post-database startup failure writes sanitized diagnostics and quits cleanly')
  console.log('STARTUP REGRESSION PASSED. TEMP profiles: '+profile+', '+bad)
} finally { clearTimeout(releaseTimer); release(); if(writer.exitCode===null) writer.kill(); if(child) await stopApp(child) }
