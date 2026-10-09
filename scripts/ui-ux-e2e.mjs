/* global document, location, innerWidth, innerHeight, getComputedStyle */
// Browser-only measurement function is serialized into isolated Electron via CDP.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, sleep, startApp, stopApp, persistentSession } from './cdp-tools.mjs'
const output=resolve('.local/ui-ux-implementation-2026-10-09'),profile=newProfile(),port=9392
mkdirSync(join(output,'screenshots'),{recursive:true})
const db=new DatabaseSync(join(profile,'rased.db')),schema=readFileSync('src/storage/migrations.ts','utf8'),migrations=[...schema.matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for(const m of migrations)db.exec(m[1]);db.exec(`PRAGMA user_version=${migrations.length}`)
const now=new Date().toISOString()
const sources=['mostaql','nafezly','khamsat']
for(let id=1;id<=30;id++){
 const source=sources[(id-1)%3],external=String(900000+id)
 const title=id===28?'تطوير لوحة تحكم لإدارة المبيعات والمخزون باستخدام React وTypeScript مع دعم اللغة العربية والإنجليزية وتقارير تفصيلية للمستخدمين':'فرصة تجريبية: '+(source==='khamsat'?'طلب تصميم هوية بصرية احترافية':'تطوير واجهة عربية وإنجليزية لتطبيق إدارة المشاريع')+' '+id
 const url=source==='mostaql'?`https://mostaql.com/go/${external}`:source==='nafezly'?`https://nafezly.com/project/${external}`:`https://khamsat.com/community/requests/${external}`
 db.prepare("INSERT INTO projects(id,source,external_id,url,title,description_excerpt,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at,category_slug,category_confirmed,budget_min,budget_max,enrichment_status,published_at) VALUES(?,?,?,?,?,?,?,?,'initial',?,?,'development',1,100,250,'ready',?)").run(id,source,external,url,title,'مطلوب تنفيذ واجهة واضحة وسهلة الاستخدام، مع تحسين تجربة التنقل ومعالجة حالات التحميل والخطأ.',now,now,now,now,now)
 db.prepare("INSERT INTO project_details VALUES(?,?,'full',?,'ready',NULL)").run(id,'وصف تجريبي للفحص فقط.\nالمطلوب تطوير شاشة متابعة مشاريع، واجهة عربية وإنجليزية، وتصميم متجاوب مع أحجام نوافذ Windows المختلفة.\nالمدة المقترحة 7 أيام.\nمخرجات العمل: الكود المصدري والتوثيق ومراجعة جودة الواجهة.',now)
}
db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({language:'ar',khamsatEnabled:true,nafezlyEnabled:true,quickApply:{enabled:false,template:'قالب محفوظ للفحص',budgetPositionPercent:50,extraDays:1}}))
db.prepare("INSERT INTO project_user_state VALUES(1,?,NULL,'interested','ملاحظة تجريبية محفوظة',?)").run(now,now)
db.prepare("INSERT INTO proposal_drafts(project_id,proposal,assumptions_json,questions_json,updated_at,provider,model) VALUES(1,?,'[]','[]',?,'gemini','gemini-2.5-flash')").run('مرحبًا، يمكنني تنفيذ واجهة المشروع باستخدام React وTypeScript. هذه مسودة تجريبية للفحص فقط.',now)
db.close()
for(const file of ['rss-fixture.xml','nafezly-fixture.xml'])writeFileSync(join(profile,file),'<rss version="2.0"><channel><title>Audit</title></channel></rss>')
writeFileSync(join(profile,'detail-fixture.html'),'<html><body>Audit fixture</body></html>');writeFileSync(join(profile,'khamsat-fixture.html'),'<html><body>Audit fixture</body></html>')
const child=startApp({exe:'node_modules/electron/dist/electron.exe',app:'out/main/index.js',profile,port}),results={profile,screens:[],checks:{}}
let ws, session
const ev=e=>evaluate(ws,e),wait=e=>eventually(()=>ev(e))
const nav=async hash=>{await ev(`location.hash=${JSON.stringify(hash)}`);await sleep(400)}
const click=async(selector)=>{await ev(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(200)}
const fill=async(selector,text)=>{await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.setSelectionRange(0,e.value.length)})()`);await call(ws,'Input.insertText',{text});await sleep(100)}
const measure=()=>{
 const shown=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'
 const named=e=>e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||(e.labels?.length&&[...e.labels].map(l=>l.textContent).join(' ').trim())||e.title
 const fields=[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(shown)
 const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}}
 const controls=[...document.querySelectorAll('button,[role=button]')].filter(shown)
 return {route:location.hash,language:document.documentElement.lang,theme:document.documentElement.dataset.theme,viewport:{w:innerWidth,h:innerHeight},bodyWidth:document.body.scrollWidth,unnamedFields:fields.filter(e=>!named(e)).map(e=>({tag:e.tagName,id:e.id,cls:e.className,near:e.closest('.set-row,.proposal-card,.detail-rail')?.textContent.slice(0,85)})),nestedControls:document.querySelectorAll('[role=button] button').length,smallTargets:controls.filter(e=>{const r=rect(e);return r.w<24||r.h<24}).map(e=>({name:e.textContent.trim().slice(0,45)||e.getAttribute('aria-label'),...rect(e)})),smallText:[...document.querySelectorAll('.hint,.small,.fact .k')].filter(shown).map(e=>({text:e.textContent.slice(0,75),size:getComputedStyle(e).fontSize,color:getComputedStyle(e).color})).slice(0,8),outsideHorizontal:controls.filter(e=>{const b=e.getBoundingClientRect();return b.right>innerWidth+1||b.left< -1}).map(e=>({name:e.textContent.trim().slice(0,45),...rect(e)})).slice(0,8)}
}
async function shot(name){const metric=await ev(`(${measure.toString()})()`);results.screens.push({name,...metric});writeFileSync(join(output,'screenshots',name+'.png'),Buffer.from((await call(ws,'Page.captureScreenshot',{format:'png'})).data,'base64'));console.log('AUDIT '+name)}
try{
 ws=await pageWs(port);await call(ws,'Page.reload');await sleep(200);await wait('!!document.querySelector(".splash")');await wait('document.querySelector(".splash")?.dataset.phase==="ready"');await shot('ar-dark-splash');await ev('document.querySelector(".splash-enter")?.click()');await wait('document.querySelectorAll("[data-row]").length===30')
 const prefs=await ev('window.rased.getSettings()')
 await ev(`window.rased.createSavedFilter('تصميم وتطوير',{...${JSON.stringify(prefs.displayQuery)},search:''})`)
 await shot('ar-dark-projects')
 await ev('document.querySelector("[data-row] article").focus()');await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await call(ws,'Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});results.checks.rowSpaceOpensPreview=await ev('!!document.querySelector(".preview-pane")');assert.ok(results.checks.rowSpaceOpensPreview,'Space opens focused opportunity preview')
 await click('[data-row] article');await wait('!!document.querySelector(".preview-pane")');await shot('ar-dark-preview')
 await nav('#/project/1');await wait('!!document.querySelector(".detail-rail")');await shot('ar-dark-detail')
 await nav('#/project/3');await wait('document.querySelector(".detail-article")?.textContent.includes("خمسات")');await shot('ar-dark-khamsat-detail')
 await nav('#/saved');await shot('ar-dark-saved')
 await nav('#/filters');await shot('ar-dark-filters');await ev('document.querySelector(".settings-inner .row-actions button:nth-child(2)").click()');await wait('!!document.querySelector(".drawer")');results.checks.savedFilterEditName=await ev('document.querySelector(".drawer input[maxlength]")?.value');assert.equal(results.checks.savedFilterEditName,'تصميم وتطوير','edit filter retains its current name');await shot('ar-dark-filter-drawer');await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(100)
 for(const section of ['watching','notifications','appearance','ai','quick','data','updates','about','legal']){await nav('#/settings/'+section);await shot('ar-dark-settings-'+section)}
 await nav('#/settings/quick');await fill('#quick-template','تعديل محمي في اختبار الواجهة');await nav('#/settings/about')
 assert.equal(await ev('location.hash'),'#/settings/quick','dirty template blocks route before unmount')
 await wait('!!document.querySelector(".dialog")')
 await ev('Array.from(document.querySelectorAll(".dialog button")).find(e=>e.textContent.includes("البقاء")).click()');await sleep(100)
 assert.equal(await ev('document.querySelector("#quick-template").value'),'تعديل محمي في اختبار الواجهة','cancel retains unsaved template')
 await nav('#/settings/about');await ev('Array.from(document.querySelectorAll(".dialog button")).find(e=>e.textContent.includes("حفظ والمتابعة")).click()');await wait('location.hash==="#/settings/about"')
 assert.equal((await ev('window.rased.getSettings()')).quickApply.template,'تعديل محمي في اختبار الواجهة','save resumes the exact transition and persists template')
 await nav('#/settings/quick');await fill('#quick-template','تعديل سيتم تجاهله');await nav('#/settings/about');await ev('Array.from(document.querySelectorAll(".dialog button")).find(e=>e.textContent.includes("تجاهل")).click()');await wait('location.hash==="#/settings/about"')
 assert.equal((await ev('window.rased.getSettings()')).quickApply.template,'تعديل محمي في اختبار الواجهة','discard preserves stored template')
 await nav('#/settings/quick');await fill('#quick-template','محاولة حفظ أثناء خطأ قاعدة البيانات');await nav('#/settings/about')
 const lockDb=new DatabaseSync(join(profile,'rased.db'));lockDb.exec('BEGIN IMMEDIATE')
 try {
  await ev('Array.from(document.querySelectorAll(".dialog button")).find(e=>e.textContent.includes("حفظ والمتابعة")).click()')
  await wait('document.querySelector(".dialog")?.textContent.includes("تعذر الحفظ")')
  assert.equal(await ev('location.hash'),'#/settings/quick','failed database save cannot leave the page')
  assert.equal(await ev('document.querySelector("#quick-template").value'),'محاولة حفظ أثناء خطأ قاعدة البيانات','failed save retains every character')
 } finally {lockDb.exec('ROLLBACK');lockDb.close()}
 await ev('Array.from(document.querySelectorAll(".dialog button")).find(e=>e.textContent.includes("تجاهل")).click()');await wait('location.hash==="#/settings/about"')
 assert.equal((await ev('window.rased.getSettings()')).quickApply.template,'تعديل محمي في اختبار الواجهة','failed storage write also preserves live settings')
 results.checks.failedSave='actual SQLite lock retained route and edits'
 await nav('#/settings/notifications');await fill('#khamsat-any','واجهة، تصميم');await nav('#/settings/about');await wait('!!document.querySelector(".dialog")');await ev('Array.from(document.querySelectorAll(".dialog button")).find(e=>e.textContent.includes("تجاهل")).click()');await nav('#/settings/notifications');assert.equal(await ev('document.querySelector("#khamsat-any").value'),'','discard resets a retained settings component');await nav('#/settings/about')
 results.checks.unsavedTemplate='save/cancel/discard passed'
 await nav('#/settings/legal');await ev('document.querySelector("[role=tab]").focus()');await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37})
 assert.equal(await ev('document.activeElement.id'),'legal-tab-privacy','RTL legal tabs navigate with the arrow key')
 assert.equal(await ev('document.querySelector("[role=tabpanel]").getAttribute("aria-labelledby")'),'legal-tab-privacy')
 results.checks.legalKeyboard='passed'
 await ev('(async()=>{const s=await window.rased.getSettings();return window.rased.updateSettings({language:"en",ui:{...s.ui,theme:"light",textScale:125}})})()');await sleep(150)
 session=await persistentSession(ws);await session.call('Emulation.setDeviceMetricsOverride',{width:900,height:650,deviceScaleFactor:1,mobile:false});await sleep(150)
 for(const [name,route] of [['projects','#/'],['quick','#/settings/quick'],['ai','#/settings/ai'],['proposal','#/proposal/1'],['detail','#/project/1']]){await nav(route);await shot('en-light-125-900-'+name)}
 await ev('(async()=>{const s=await window.rased.getSettings();return window.rased.updateSettings({language:"ar",ui:{...s.ui,theme:"dark",textScale:100}})})()');await nav('#/');await shot('ar-dark-100-900-projects');await click('[data-row] article .preview-action');await shot('ar-dark-100-900-preview')
 await nav('#/settings/ai');await ev('document.querySelector("#ai-key").focus()');await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});results.checks.inputKeyboardFocusStyle=await ev('(()=>{const s=getComputedStyle(document.activeElement);return {outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth}})()');assert.notEqual(results.checks.inputKeyboardFocusStyle.outlineStyle,'none','keyboard focus indicator is visible')
 for (const language of ['ar','en']) for (const theme of ['dark','light']) for (const [width,height] of [[900,600],[1024,768],[1280,800],[1920,1080]]) for (const textScale of [100,125]) {
  await ev(`(async()=>{const s=await window.rased.getSettings();return window.rased.updateSettings({language:${JSON.stringify(language)},ui:{...s.ui,theme:${JSON.stringify(theme)},textScale:${textScale}}})})()`)
  await session.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await nav('#/')
  const metric=await ev(`(${measure.toString()})()`);assert.equal(metric.outsideHorizontal.length,0,`${language}/${theme}/${width}/${textScale}: controls fit`)
  results.checks.layoutMatrix??=[];results.checks.layoutMatrix.push({language,theme,width,height,textScale,overflow:metric.outsideHorizontal.length})
 }
 for(const textScale of [90,110]) {await ev(`(async()=>{const s=await window.rased.getSettings();return window.rased.updateSettings({ui:{...s.ui,textScale:${textScale}}})})()`);await nav('#/');assert.equal((await ev(`(${measure.toString()})()`)).outsideHorizontal.length,0)}
 await session.call('Emulation.setDeviceMetricsOverride',{width:900,height:650,deviceScaleFactor:1,mobile:false})
 await ev('(async()=>{const s=await window.rased.getSettings();return window.rased.updateSettings({language:"en",ui:{...s.ui,theme:"light",textScale:125}})})()');await nav('#/')
 await nav('#/');await session.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});results.checks.reducedMotion=await ev('matchMedia("(prefers-reduced-motion: reduce)").matches')
 await ev('window.rased.openCompact()');const compact=await pageWs(port,t=>t.url.includes('compact'));await eventually(()=>evaluate(compact,'!!document.documentElement && !!document.querySelector(".compact")'));results.checks.compactMetrics=await evaluate(compact,`(${measure.toString()})()`);writeFileSync(join(output,'screenshots','en-light-compact.png'),Buffer.from((await call(compact,'Page.captureScreenshot',{format:'png'})).data,'base64'))
 await ev('(async()=>{const s=await window.rased.getSettings();return window.rased.updateSettings({displayQuery:{...s.displayQuery,search:"no-fixture-can-match-this"}})})()')
 await evaluate(compact,'document.querySelector(".compact-caption input").click()');await eventually(()=>evaluate(compact,'document.querySelectorAll(".compact-list .row").length===0'))
 await evaluate(compact,'document.querySelector(".compact-caption input").click()');await eventually(()=>evaluate(compact,'document.querySelectorAll(".compact-list .row").length===8'))
 results.checks.compactFilter='opt-in follows display query; opt-out restores latest eight'
 await nav('#/proposal/1');await wait('!!document.querySelector(".proposal-editor")');results.checks.draftAccessibleName=await ev('(()=>{const e=document.querySelector(".proposal-editor");return {labels:e.labels.length,ariaLabel:e.getAttribute("aria-label")}})()')
 assert.equal(results.checks.draftAccessibleName.ariaLabel,'Proposal draft text');assert.ok(results.screens.every(s=>s.unnamedFields.length===0),'all visible fields have programmatic names');assert.ok(results.screens.filter(s=>s.name.includes('900')).every(s=>s.outsideHorizontal.length===0),'narrow layouts keep controls within viewport');assert.ok(results.screens.every(s=>s.nestedControls===0),'opportunity articles no longer nest controls inside buttons');writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.checks,null,2))
}finally{writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));session?.close();await stopApp(child)}
