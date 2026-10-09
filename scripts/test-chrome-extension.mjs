// Actual Chrome → native executable → named pipe → broker → Chrome content script.
// Isolated profile, registry host namespace and intercepted HTTPS fixtures only.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync,mkdirSync,cpSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'
const root=mkdtempSync(join(tmpdir(),'rased extension test ')),assets=join(root,'assets'),hostName='com.rased.quick_apply_test'
mkdirSync(assets,{recursive:true});cpSync(join(process.env.RASED_BRIDGE_ASSETS||'resources','chrome-bridge'),join(assets,'chrome-bridge'),{recursive:true})
const made=spawnSync(process.execPath,['scripts/build-extension.mjs'],{encoding:'utf8',env:{...process.env,RASED_EXTENSION_HOST:hostName,RASED_EXTENSION_OUTPUT:join(assets,'chrome-extension')}});if(made.status!==0)throw Error(made.stderr)
await build({stdin:{contents:"export {ExtensionBroker} from './src/main/extension/broker.ts';export {openDatabase} from './src/storage/db.ts';export {defaultSettings} from './src/shared/types.ts';export {EXTENSION_ID} from './src/shared/extension/identity.ts'",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:resolve('out/extension-test.cjs')})
const {ExtensionBroker,openDatabase,defaultSettings,EXTENSION_ID}=createRequire(import.meta.url)(resolve('out/extension-test.cjs'))
const db=openDatabase(join(root,'test.db')),settings=defaultSettings()
settings.quickApply={enabled:true,template:'Fixture proposal — never submit',budgetPositionPercent:50,extraDays:1}
let events=0,checks=0,posts=0
const broker=new ExtensionBroker(db,join(root,'link'),assets,()=>settings,()=>events++,async()=>{throw Error('test-does-not-launch-user-chrome')},hostName)
let browser
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('PASS '+name)}
const wait=async(fn)=>{const until=Date.now()+12000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out waiting for '+fn)}
const html=(source,existing='',budget=true,login=false)=>`<!doctype html><html><head><meta charset="utf-8"></head><body>${login?'<a href="/login">Login</a>':`${budget?'<div><span>الميزانية</span><span>$25 - $50</span></div>':''}<div><span>مدة التنفيذ</span><span>5 أيام</span></div><form onsubmit="window.submissions=(window.submissions||0)+1;event.preventDefault()"><input id="${source==='mostaql'?'bid__period':'period'}" type="number" min="1" max="365" step="1"><input id="${source==='mostaql'?'bid__cost':'cost'}" type="number" min="1" step="1"><textarea id="${source==='mostaql'?'bid__details':'offer_description'}">${existing}</textarea><button type="submit">Submit</button></form>`}</body></html>`
try{
  await broker.start();await broker.prepare()
  const acl=spawnSync('powershell.exe',['-NoProfile','-File',resolve('scripts/inspect-pipe-acl.ps1'),broker.setup.pipe],{encoding:'utf8',windowsHide:true})
  if(acl.status!==0)throw Error(acl.stderr)
  console.log('Actual pipe DACL',acl.stdout.trim())
  const chrome=process.env.RASED_TEST_CHROME || join(process.env.LOCALAPPDATA,'ms-playwright','chromium-1243','chrome-win64','chrome.exe')
  browser=await chromium.launchPersistentContext(join(root,'chrome'),{executablePath:chrome,headless:true,env:{...process.env,PATH:join(process.env.SystemRoot,'System32')},args:[`--disable-extensions-except=${broker.setup.folder}`,`--load-extension=${broker.setup.folder}`],ignoreDefaultArgs:['--disable-extensions']})
  browser.on('page',page=>page.on('pageerror',error=>console.log('PAGE ERROR',error.message)))
  await browser.route('https://mostaql.com/**',route=>{if(route.request().method()!=='GET')posts++;const url=new URL(route.request().url());return route.fulfill({contentType:'text/html',body:html('mostaql',url.pathname.includes('/2')?'User draft':'',!url.pathname.includes('/3'),url.pathname.includes('/4'))})})
  await browser.route('https://nafezly.com/**',route=>{if(route.request().method()!=='GET')posts++;return route.fulfill({contentType:'text/html',body:html('nafezly')})})
  const popup=await browser.newPage();await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html`)
  // Chromium starts extension-created tab navigations before Playwright attaches
  // its interception target. Delay only that navigation in this fixture harness.
  const worker=browser.serviceWorkers()[0]??await browser.waitForEvent('serviceworker')
  await worker.evaluate(()=>{const create=chrome.tabs.create.bind(chrome.tabs);chrome.tabs.create=async options=>{if(!options.url?.startsWith('https://'))return create(options);const tab=await create({...options,url:'about:blank'});await new Promise(r=>setTimeout(r,400));return chrome.tabs.update(tab.id,{url:options.url})}})
  await wait(()=>popup.locator('#pair').isEnabled())
  check('Chrome reaches real standalone Native Messaging host',broker.status().registered)
  await popup.locator('#pair').click();await wait(()=>broker.status().pairing.length===1)
  const pairing=broker.status().pairing[0]
  await wait(async()=>(await popup.locator('#code').textContent())===pairing.code)
  check('same six-digit pairing code in Chrome and RASED',true)
  check('wrong approval code refused',!broker.approve(pairing.id,'000000','Fixture'))
  check('explicit approval succeeds',broker.approve(pairing.id,pairing.code,'Fixture profile'))
  await wait(()=>broker.status().clients.some(c=>c.connected))
  const stored=db.prepare("SELECT value FROM settings WHERE key='extension-pairing'").get().value
  const token=await popup.evaluate(()=>chrome.storage.local.get('token'))
  check('pair token only stored hashed by app',!stored.includes(token.token))
  const run=async(id,source,phase)=>{
    db.prepare("INSERT OR IGNORE INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(?,?,?,?,?,'now','now','initial','now','now')").run(id,source,String(id),`https://${source}.com/project/${id}`,'Fixture '+id)
    check('start '+source+' '+id,await broker.quick(id));await wait(()=>broker.status().lastJob?.phase===phase)
    const page=browser.pages().find(p=>p.url()===`https://${source}.com/project/${id}`)
    check('correct tab '+id,!!page);return page
  }
  const p=await run(1,'mostaql','ready')
  check('Mostaql text filled',await p.locator('#bid__details').inputValue()===settings.quickApply.template)
  check('budget midpoint follows numeric HTML step',await p.locator('#bid__cost').inputValue()==='38')
  check('client duration plus extra day',await p.locator('#bid__period').inputValue()==='6')
  const existing=await run(2,'mostaql','draft-exists');check('existing draft untouched',await existing.locator('#bid__details').inputValue()==='User draft')
  const partial=await run(3,'mostaql','needs-input');check('missing budget remains manual',await partial.locator('#bid__cost').inputValue()==='');check('partial template filled',await partial.locator('#bid__details').inputValue()===settings.quickApply.template)
  await run(4,'mostaql','needs-login')
  const nf=await run(5,'nafezly','ready');check('Nafezly fields filled',await nf.locator('#offer_description').inputValue()===settings.quickApply.template)
  check('no form submission or HTTP offer request',posts===0&&await p.evaluate(()=>!window.submissions)&&await nf.evaluate(()=>!window.submissions))
  check('Khamsat rejected',await broker.quick(6)===false)
  const ticket=broker.ticket(1);check('first ticket activation accepted',await broker.activate(new URL(ticket).searchParams.get('ticket')));await wait(()=>broker.status().lastJob.phase==='ready');const count=browser.pages().length;check('duplicate activation focuses without refilling',await broker.activate(new URL(ticket).searchParams.get('ticket')));check('duplicate does not create another tab',browser.pages().length===count)
  await popup.screenshot({path:resolve('.local/qa/screenshots/quick-apply/chrome-popup.png')})
  await browser.close();await wait(()=>!broker.status().clients[0].connected)
  browser=await chromium.launchPersistentContext(join(root,'chrome'),{executablePath:chrome,headless:true,env:{...process.env,PATH:join(process.env.SystemRoot,'System32')},args:[`--disable-extensions-except=${broker.setup.folder}`,`--load-extension=${broker.setup.folder}`],ignoreDefaultArgs:['--disable-extensions']})
  const reopened=await browser.newPage();await reopened.goto(`chrome-extension://${EXTENSION_ID}/popup.html`)
  await wait(()=>broker.status().clients[0].connected)
  check('Chrome restart reconnects with persisted pairing, without another code',broker.status().clients[0].id===pairing.id&&broker.status().pairing.length===0)
  writeFileSync(resolve('out/extension-test-result.json'),JSON.stringify({checks,events,root,posts},null,2))
  console.log(JSON.stringify({checks,events,root,posts}))
}catch(error){console.log('Failure status',JSON.stringify(broker.status()));for(const p of browser?.pages()??[])console.log('PAGE',p.url(),await p.evaluate(()=>({body:document.body.innerHTML,fields:[...document.querySelectorAll('input,textarea')].map(e=>({id:e.id,visible:e.getClientRects().length,form:!!e.form,value:e.value}))})));throw error}finally{await browser?.close();broker.dispose();await broker.setup.unregister();db.close()}
