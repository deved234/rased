// Deterministic integration regression checks: REAL Electron/preload/SQLite/React.
// Only network and OS boundaries are substituted in an explicitly marked TEMP profile.
// Usage: npm run build && npm run test:e2e
// Optional: --exe="release/win-unpacked/RASED.exe" --app="" --port=9361
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, persistentSession, sleep, startApp, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2))
const profile = newProfile(args.profile)
const port = Number(args.port ?? 9361)
const exe = args.exe ?? 'node_modules/electron/dist/electron.exe'
const app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
const schema = readFileSync('src/storage/migrations.ts', 'utf8')
const db = new DatabaseSync(join(profile, 'rased.db'))
for (const match of schema.matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)) db.exec(match[1])
db.exec('PRAGMA user_version=3; PRAGMA foreign_keys=ON;')
const stamp = new Date().toISOString()
const insert = db.prepare(`INSERT INTO projects(id,source,external_id,url,title,description_excerpt,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at,category_slug,category_confirmed,budget_min,budget_max,enrichment_status) VALUES (?,'mostaql',?,?,?,?,?,?,'initial',?,?,?,1,100,200,'ready')`)
for (let id = 1; id <= 450; id++) {
  const external = String(90000000 + id)
  insert.run(id, external, 'https://mostaql.com/go/' + external, 'Review project ' + id, 'React work', new Date(Date.parse('2020-01-01') + id * 1000).toISOString(), stamp, stamp, stamp, id % 2 ? 'development' : 'design')
}
db.exec(`INSERT INTO project_details SELECT id,'Cached review description','full','2020-01-01T00:00:00.000Z','ready',NULL FROM projects;`)
db.prepare(`INSERT INTO source_state(source,baseline_complete,last_success_at,consecutive_failures) VALUES ('mostaql',1,?,0)`).run(stamp)
const def = { scope: 'all', unreadOnly: false, statuses: [], search: '', categoryFilter: { mode: 'all', categories: [], keywordsAny: [], keywordsAll: [], excludeKeywords: [] }, budgetMin: null, budgetMax: null, includeUnknownBudget: true, sort: 'latestDetected' }
const rss = items => `<?xml version="1.0"?><rss version="2.0"><channel><title>مستقل</title>${items.map(p => `<item><title>${p.title}</title><link>https://mostaql.com/go/${p.external}</link><description>React work</description><pubDate>${new Date().toUTCString()}</pubDate></item>`).join('')}</channel></rss>`
const writeRss = items => writeFileSync(join(profile, 'rss-fixture.xml'), rss(items))
writeRss([{ title: 'Review project 450', external: '90000450' }])
writeFileSync(join(profile, 'detail-fixture.html'), readFileSync('tests/fixtures/detail-body.html', 'utf8') + readFileSync('tests/fixtures/detail-sample.html', 'utf8'))
let child, ws, viewportSession, passed = 0
const check = (label, condition, detail = '') => { assert.ok(condition, `${label}: ${detail}`); passed++; console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`) }
const ev = expression => evaluate(ws, expression)
const wait = expression => eventually(() => ev(expression))
const click = async (pattern, selector = 'button') => {
  await ev(`(()=>{const b=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>new RegExp(${JSON.stringify(pattern)}).test(b.textContent));if(!b)throw Error('Button missing: '+${JSON.stringify(pattern)});b.click()})()`)
  await sleep(150)
}
const nav = async hash => { await ev(`location.hash=${JSON.stringify(hash)}`); await sleep(200) }
const fill = async (selector, value) => {
  await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Field missing');e.focus();e.setSelectionRange(0,e.value.length)})()`)
  if (value) await call(ws, 'Input.insertText', { text: value })
  else { await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }) }
  await sleep(450)
}
const traces = () => existsSync(join(profile, 'test-trace.jsonl')) ? readFileSync(join(profile, 'test-trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)) : []
try {
  child = startApp({ exe, app, profile, port })
  ws = await pageWs(port)
  await wait('!!document.querySelector(".splash")')
  check('startup splash is visible before the projects shell', await ev('!document.querySelector(".app") && !!document.querySelector(".window-titlebar")'))
  await wait('document.querySelector(".splash")?.dataset.phase === "ready"')
  check('ready splash confirms real local bootstrap and exposes entry', await ev('document.querySelectorAll(".splash-steps .done").length===3 && !!document.querySelector(".splash-enter")'))
  await sleep(600) // let the ready milestone's CSS transition settle for the screenshot
  mkdirSync('docs/screenshots/startup', { recursive: true })
  const splashShot = await call(ws, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync('docs/screenshots/startup/ar-ready.png', Buffer.from(splashShot.data, 'base64'))
  await ev('document.querySelector(".splash-enter")?.click()')
  await wait('document.querySelectorAll("[data-row]").length === 50')
  check('real bootstrap with cached 450 rows and no RSS dependency', await ev('!document.querySelector(".splash")'))
  await ev('document.querySelector(".window-controls button:nth-child(2)").click()'); await wait('window.rased.getWindowState().then(s=>s.maximized)')
  await wait('document.querySelector(".window-controls button:nth-child(2)").getAttribute("aria-pressed")==="true"')
  check('custom maximize control synchronizes real window state', true)
  await ev('document.querySelector(".window-controls button:nth-child(2)").click()'); await wait('window.rased.getWindowState().then(s=>!s.maximized)')
  check('custom restore control restores window', true)
  await ev('document.querySelector(".window-controls button:first-child").click()')
  await wait('window.rased.getWindowState().then(s=>s.minimized)')
  check('custom minimize control minimizes the real window', true)
  await ev('window.rased.windowControl("maximize")'); await wait('window.rased.getWindowState().then(s=>s.maximized)'); await ev('window.rased.windowControl("maximize")'); await wait('window.rased.getWindowState().then(s=>!s.maximized)')
  await nav('#/settings/legal'); await wait('!!document.querySelector(".legal-page")')
  check('offline legal terms render in Arabic', await ev('document.querySelector(".legal-page").textContent.includes("لا تمنح هذه الصفحات إذنًا")'))
  await click('الخصوصية', '.legal-page .chips button'); check('privacy discloses local unencrypted storage', await ev('document.querySelector(".legal-page").textContent.includes("ليست مشفرة")'))
  await click('الرخص', '.legal-page .chips button'); check('licenses include actual dependency texts', await ev('document.querySelector(".license-text")?.textContent.includes("MIT License")'))
  const legalOpens=traces().filter(t=>t.kind==='open-external').length
  await click('شروط مستقل الرسمية','.legal-page button'); await eventually(()=>traces().filter(t=>t.kind==='open-external').length===legalOpens+1)
  check('legal source button opens the fixed official destination',traces().filter(t=>t.kind==='open-external').at(-1).data==='https://mostaql.com/p/terms')
  await nav('#/'); await wait('document.querySelectorAll("[data-row]").length===50')


  for (let i=0;i<5;i++) { await click('عرض المزيد|Load more'); await wait(`document.querySelectorAll('[data-row]').length===${100+i*50}`) }
  check('paging exceeds 200 through actual IPC/UI', await ev('document.querySelectorAll("[data-row]").length') === 300)
  await ev('document.querySelector(".list-scroll").scrollTop=1800')
  const before = await ev('document.querySelector(".list-scroll").scrollTop')
  await ev('document.querySelector("[data-row] article").click()'); await wait('!!document.querySelector("textarea")')
  check('detail marks stored read state', !!db.prepare('SELECT read_at FROM projects WHERE id=450').get().read_at)
  await click('الرجوع|Back'); await wait('document.querySelectorAll("[data-row]").length===300')
  const after = await ev('document.querySelector(".list-scroll").scrollTop')
  check('nonzero scroll and loaded range survive detail/back', Math.abs(before-after)<2, `${before} -> ${after}`)
  // Handler registration + OS opener boundary + read state, via actual icon.
  await ev('document.querySelector(".list-scroll").scrollTop=0')
  const opens = traces().filter(t=>t.kind==='open-external').length
  await ev('document.querySelector("[data-row] article button[title*=مستقل], [data-row] article button[title*=Mostaql]").click()')
  await sleep(200)
  check('external icon reaches registered main handler exactly once', traces().filter(t=>t.kind==='open-external').length===opens+1)
  check('external icon keeps internal route', await ev('location.hash') === '#/' || await ev('location.hash') === '')
  // Hidden and restore use real filter scope.
  await ev('window.rased.updateProjectUserState(450,{hidden:true})')
  await click('الفلاتر|Filters', '.chip')
  await ev('(()=>{const s=document.querySelector(".drawer select");s.value="hidden";s.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await click('تطبيق|Apply', '.drawer button'); await wait('document.querySelectorAll("[data-row]").length===1')
  check('hidden scope lists only the hidden project', await ev('document.querySelector("[data-row]").dataset.row')==='450')
  await ev('document.querySelector("[data-row] article").click()'); await wait('!!document.querySelector("textarea")')
  await click('إظهار المشروع|Unhide project'); await click('الرجوع|Back')
  await wait('document.querySelectorAll("[data-row]").length===0')
  check('unhide restores visibility in storage', db.prepare('SELECT hidden_at FROM project_user_state WHERE project_id=450').get().hidden_at===null)
  await ev(`window.rased.updateSettings({displayQuery:${JSON.stringify(def)}})`); await wait('document.querySelectorAll("[data-row]").length===50')
  await ev('window.rased.updateSettings({linkDisplayAndNotifyFilters:true})')
  await click('^تصميم$|^Design$', '.chips .chip'); await wait('document.querySelector(".list-head").textContent.includes("225")')
  const settings = await ev('window.rased.getSettings()')
  check('category filter really restricts ids and links notification settings', settings.notifyFilter.categories.includes('design') && await ev('Array.from(document.querySelectorAll("[data-row]")).every(r=>Number(r.dataset.row)%2===0)'))
  // Saved definition keeps search; hidden scope was checked separately.
  await ev(`window.rased.createSavedFilter('Audit search',{...${JSON.stringify(def)},search:'Review project 1'})`)
  await nav('#/filters'); await click('تطبيق|Apply'); await wait('document.querySelector(".search-top").value==="Review project 1"')
  check('saved filter preserves search and actual matching count', await ev('document.querySelector(".list-head").textContent.includes("111")'))
  await fill('.search-top',''); await wait('document.querySelector(".list-head").textContent.includes("450")')
  // Dirty note guard catches sidebar routes and allows save/discard/cancel.
  await nav('#/project/450'); await wait('!!document.querySelector("textarea")'); await fill('textarea','PERSISTENT NOTE')
  await nav('#/settings'); await wait('!!document.querySelector("[role=alertdialog]")')
  check('dirty note blocks route before unmount', await ev('location.hash')==='#/project/450' && await ev('document.querySelector("textarea").value')==='PERSISTENT NOTE')
  await click('حفظ الملاحظة|Save note', '.dialog button'); await wait('location.hash==="#/settings"')
  check('save-and-leave persists the note', db.prepare('SELECT note FROM project_user_state WHERE project_id=450').get().note==='PERSISTENT NOTE')
  await nav('#/project/450'); await wait('document.querySelector("textarea")?.value==="PERSISTENT NOTE"'); await fill('textarea','DISCARD THIS')
  await nav('#/settings'); await wait('!!document.querySelector(".dialog")'); await click('تجاهل|Discard', '.dialog button'); await wait('location.hash==="#/settings"')
  check('discard leaves stored note intact', db.prepare('SELECT note FROM project_user_state WHERE project_id=450').get().note==='PERSISTENT NOTE')
  await ev('window.rased.updateProjectUserState(450,{saved:true})'); await nav('#/saved'); await wait('document.querySelectorAll("[data-row]").length===1')
  await ev('document.querySelector("[data-row] article").click()'); await wait('!!document.querySelector("textarea")'); await click('الرجوع|Back'); await wait('location.hash==="#/saved"')
  check('detail returns to saved source route', true)
  await nav('#/'); await wait('document.querySelectorAll("[data-row]").length===50')
  const second = await ev('document.querySelectorAll("[data-row]")[1].dataset.row')
  await ev('document.querySelectorAll("[data-row] article")[1].focus()')
  await call(ws, 'Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 }); await call(ws,'Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await wait(`location.hash==='#/project/${second}'`)
  check('keyboard Enter opens focused row once, not stale selection', true)
  await nav('#/project/9999999'); await wait('!!document.querySelector(".empty")'); await nav('#/project/450'); await wait('!!document.querySelector(".detail-article")')
  check('project route clears missing state from previous id', await ev('document.querySelector(".detail-article h2").textContent')==='Review project 450')
  // Actual event reaches WebAudio code (audibility remains a manual check).
  await ev('window.__audioStarts=0;const start=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){window.__audioStarts++;return start.apply(this,args)}')
  await ev('window.rased.testSound()'); await wait('window.__audioStarts===1')
  check('main/preload sound event starts an oscillator exactly once', true)
  await ev('window.rased.openCompact()'); const compact = await pageWs(port,t=>t.url.includes('compact'))
  await evaluate(compact,'window.rased.setAlwaysOnTop(true)')
  await eventually(()=>evaluate(compact,'document.querySelector(".compact-top [aria-pressed]")?.getAttribute("aria-pressed")==="true"'))
  await ev('window.rased.updateSettings({language:"en"})'); await eventually(()=>evaluate(compact,'document.documentElement.dir==="ltr"'))
  check('compact receives pin and language broadcasts', true)
  await ev('window.rased.resume()'); await eventually(()=>evaluate(compact,'document.querySelector(".compact-top").textContent.includes("Watching")'))
  await ev('window.rased.pause()'); await eventually(()=>evaluate(compact,'document.querySelector(".compact-top").textContent.includes("Paused")'))
  check('compact receives live health transitions', true)
  await ev('window.rased.closeCompact()')
  // Mouse preview, keyboard resizing, narrow viewport focus, and native close guard.
  await nav('#/'); await wait('document.querySelectorAll("[data-row]").length===50')
  await ev('document.querySelector("[data-row] button[title*=preview]").click()'); await wait('!!document.querySelector(".preview-pane")')
  check('mouse preview opens independently without changing route', await ev('location.hash')==='#/')
  await ev('document.querySelector("[role=separator]").focus()')
  await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35}); await wait('window.rased.getSettings().then(s=>s.ui.previewRatio===0.6)')
  await wait('document.querySelector("[role=separator]").getAttribute("aria-valuenow")=="60"')
  check('preview separator supports keyboard resizing', await ev('document.querySelector("[role=separator]").getAttribute("aria-valuenow")')==='60')
  viewportSession=await persistentSession(ws)
  await viewportSession.call('Emulation.setDeviceMetricsOverride',{width:900,height:600,deviceScaleFactor:1.5,mobile:false})
  await wait('innerWidth===900 && innerHeight===600'); await ev('window.dispatchEvent(new Event("resize"))')
  await wait('!!document.querySelector(".preview-pane.overlay")')
  await ev('document.querySelector(".preview-pane.overlay button:last-of-type").focus()')
  await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  check('preview focus stays in overlay at 900x600 with 1.5 device scale', await ev('document.querySelector(".preview-pane.overlay").contains(document.activeElement)'))
  await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await wait('!document.querySelector(".preview-pane")')
  await nav('#/project/450'); await wait('!!document.querySelector("textarea")')
  await ev('document.querySelector("textarea").scrollIntoView({block:"center"})')
  check('detail notes remain accessible in small viewport', await ev('(()=>{const r=document.querySelector("textarea").getBoundingClientRect();return r.height>0 && r.top>=0 && r.bottom<=innerHeight})()'))
  await viewportSession.call('Emulation.clearDeviceMetricsOverride'); viewportSession.close(); viewportSession=null
  await fill('textarea','CANCEL CLOSE DRAFT'); await ev('document.querySelector(".window-close").click()'); await wait('!!document.querySelector(".dialog")')
  check('native close asks before discarding note', await ev('document.querySelector("textarea").value')==='CANCEL CLOSE DRAFT')
  await click('Cancel|إلغاء','.dialog button'); await wait('!document.querySelector(".dialog")')
  check('cancel close retains page and dirty draft', await ev('location.hash')==='#/project/450' && await ev('document.querySelector("textarea").value')==='CANCEL CLOSE DRAFT')
  await nav('#/'); await click('Discard|تجاهل','.dialog button'); await wait('location.hash==="#/"')
  // Electron navigation guards protect the original page and deny popup creation.
  await ev('window.open("https://example.com")'); await sleep(100)
  await ev('location.assign("https://example.com")'); await sleep(200)
  check('renderer external navigation is blocked', await ev('location.href.includes("index.html")'))
  // Live fixture arrival must not shift visible ids/anchor on enrichment.
  await nav('#/'); await wait('document.querySelectorAll("[data-row]").length===50')
  await sleep(450); await ev('document.querySelector(".list-scroll").scrollTop=1300')
  const visible = await ev('Array.from(document.querySelectorAll("[data-row]")).map(e=>e.dataset.row)')
  await ev('window.__events=[];window.rased.onProjectsChanged(e=>window.__events.push(e))'); writeRss([{title:'New matching project',external:'91000001'}]); await ev('window.rased.resume()')
  await wait('!!document.querySelector(".pill")').catch(async e=>{console.error('Arrival debug',await ev('JSON.stringify({events:window.__events,scroll:document.querySelector(".list-scroll").scrollTop,rows:Array.from(document.querySelectorAll("[data-row]")).map(e=>e.dataset.row),text:document.body.innerText,settings:await window.rased.getSettings()})'));throw e}); await sleep(2700)
  check('new arrival/enrichment preserves loaded ids until reveal', JSON.stringify(visible)===JSON.stringify(await ev('Array.from(document.querySelectorAll("[data-row]")).map(e=>e.dataset.row)')))
  check('single toast click opens its original project in browser without in-app navigation', traces().filter(t=>t.kind==='open-external').at(-1)?.data==='https://mostaql.com/go/91000001' && await ev('location.hash')==='#/')
  await click('.', '.pill'); await wait('document.querySelector("[data-row] article").textContent.includes("New matching project")')
  check('arrival reveal fetches new row', true)
  await ev('window.rased.pause()')
  // Summary click uses the actual main closure and opens one newest project.
  const toastCount = traces().filter(t=>t.kind==='toast').length
  const summaryOpens = traces().filter(t=>t.kind==='open-external').length
  const items = Array.from({length:7},(_,i)=>({title:'Summary project '+i,external:String(92000001+i)}))
  writeRss(items); await ev('window.rased.resume()'); await wait('window.rased.getProjectCount({}).then(r=>r.total===458)'); await ev('window.rased.pause()')
  const newToasts = traces().filter(t=>t.kind==='toast').slice(toastCount)
  check('summary click opens newest persisted project once', newToasts.length===1 && traces().filter(t=>t.kind==='open-external').length===summaryOpens+1 && traces().filter(t=>t.kind==='open-external').at(-1).data==='https://mostaql.com/go/92000007')
  const mutedToasts = traces().filter(t=>t.kind==='toast').length
  await ev('window.rased.setDnd(new Date(Date.now()+60000).toISOString())'); writeRss([{title:'Muted project',external:'93000001'}]); await ev('window.rased.resume()'); await wait('window.rased.getProjectCount({}).then(r=>r.total===459)'); await ev('window.rased.pause()')
  check('DND suppresses actual main dispatch while discovery continues', traces().filter(t=>t.kind==='toast').length===mutedToasts && db.prepare("SELECT COUNT(*) n FROM notification_events WHERE status='suppressed'").get().n>=1)
  await ev('window.rased.setDnd(null)'); await ev('window.rased.resume()'); await sleep(400); await ev('window.rased.pause()')
  check('DND expiry/clear does not resend suppressed history', traces().filter(t=>t.kind==='toast').length===mutedToasts)
  await ev('window.rased.requestProjectDetails(450,true)'); await ev('window.rased.resume()')
  await eventually(()=>db.prepare("SELECT COUNT(*) n FROM project_details WHERE fetched_at > '2026-01-01' AND status='ready'").get().n>0,Boolean,20000); await ev('window.rased.pause()')
  check('stale cache was refreshed with real parser and metadata', db.prepare("SELECT COUNT(*) n FROM project_details WHERE fetched_at > '2026-01-01' AND status='ready'").get().n>0)
  // Real process restart, not Page.reload.
  await ev('window.rased.confirmClose(true)').catch(()=>{}); await sleep(500); await stopApp(child)
  child = startApp({exe,app,profile,port}); ws=await pageWs(port)
  await wait('document.querySelector(".splash")?.dataset.phase === "ready"')
  check('restart splash uses persisted English preferences', await ev('document.querySelector(".splash-enter")?.textContent === "Open projects" && document.documentElement.dir === "ltr"'))
  await sleep(600)
  const englishSplash = await call(ws, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync('docs/screenshots/startup/en-ready.png', Buffer.from(englishSplash.data, 'base64'))
  await wait('!document.querySelector(".splash")')
  check('ready splash enters workspace automatically without a click', await ev('!!document.querySelector(".app")'))
  const note = await ev('window.rased.getProject(450).then(p=>p.note)')
  check('saved note and bookmark survive a real process restart', note==='PERSISTENT NOTE' && await ev('window.rased.getProject(450).then(p=>p.saved)'))
  await wait('document.querySelectorAll("[data-row]").length>0')
  await ev('window.rased.markAllRead()'); await wait('Array.from(document.querySelectorAll("[data-row] article")).every(e=>!e.classList.contains("unread"))')
  check('mark-all-read updates real stored and visible states', db.prepare('SELECT COUNT(*) n FROM projects WHERE read_at IS NULL').get().n===0)
  const preview = await ev('window.rased.purgeHistoryPreview("2021-01-01")')
  check('purge protects bookmarked/noted project', preview.ok && preview.affected===449)
  const purged = await ev('window.rased.purgeHistoryApply("2021-01-01")')
  await wait('document.querySelectorAll("[data-row]").length===10')
  check('purge updates visible rows, creates backup and preserves note', purged.ok && purged.deleted===449 && existsSync(purged.backupPath) && db.prepare('SELECT note FROM project_user_state WHERE project_id=450').get().note==='PERSISTENT NOTE')
  // Updater fixture replaces its native/network boundary; controller, IPC and UI are real.
  await nav('#/settings/updates'); await wait('!!document.querySelector(".updates-page")')
  writeFileSync(join(profile, 'update-fixture.json'), JSON.stringify({ version: '0.3.0', releaseNotes: '<h2>Safe release notes</h2>\nA new feature', error: 'check' }))
  await click('Check for updates', '.updates-page button'); await wait('window.rased.getUpdateState().then(s=>s.phase==="error")')
  check('offline update check surfaces retry without losing local notes', await ev('document.querySelector(".updates-page").textContent.includes("Could not complete")') && db.prepare('SELECT note FROM project_user_state WHERE project_id=450').get().note==='PERSISTENT NOTE')
  writeFileSync(join(profile, 'update-fixture.json'), JSON.stringify({ version: '0.3.0', releaseNotes: '<h2>Safe release notes</h2>\nA new feature' }))
  await click('Retry', '.updates-page button'); await wait('window.rased.getUpdateState().then(s=>s.phase==="available")')
  check('available update shows banner and plain text without auto-download', await ev('!!document.querySelector(".update-banner") && document.querySelector(".update-notes").textContent.includes("Safe release notes") && !document.querySelector(".update-notes h2")') && !traces().some(t=>t.kind==='update-download'))
  await click('Download update', '.updates-page button'); await wait('!!document.querySelector(".update-progress progress")')
  check('download progress reaches renderer through actual IPC', await ev('window.rased.getUpdateState().then(s=>s.phase==="downloading")'))
  await wait('window.rased.getUpdateState().then(s=>s.phase==="downloaded")')
  check('download waits for explicit install', !traces().some(t=>t.kind==='update-install'))
  mkdirSync('docs/screenshots/updates', { recursive: true })
  const updateShot = await call(ws, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync('docs/screenshots/updates/en-downloaded.png', Buffer.from(updateShot.data, 'base64'))
  await nav('#/project/450'); await wait('!!document.querySelector("textarea")'); await fill('textarea','UPDATE UNSAVED NOTE')
  await click('Restart and update', '.update-banner button'); await wait('!!document.querySelector(".dialog")')
  check('update asks before losing an unsaved note', !traces().some(t=>t.kind==='update-install') && await ev('document.querySelector("textarea").value')==='UPDATE UNSAVED NOTE')
  await click('Cancel', '.dialog button'); await wait('!document.querySelector(".dialog")')
  check('cancel update keeps the app and dirty note', !traces().some(t=>t.kind==='update-install') && await ev('document.querySelector("textarea").value')==='UPDATE UNSAVED NOTE')
  await click('Restart and update', '.update-banner button'); await wait('!!document.querySelector(".dialog")'); await click('Save', '.dialog button')
  await wait('window.rased.getUpdateState().then(s=>s.phase==="installing")')
  check('confirmed update requests silent relaunch once after saving', traces().filter(t=>t.kind==='update-install').length===1 && traces().find(t=>t.kind==='update-install').data.relaunch===true && db.prepare('SELECT note FROM project_user_state WHERE project_id=450').get().note==='UPDATE UNSAVED NOTE')
  const problems = db.prepare("SELECT detail FROM diagnostics WHERE status='uncaught' OR detail LIKE 'async-failed%'").all()
  check('no uncaught/late DB writes through exercised flows', problems.length===0,JSON.stringify(problems))
  console.log(`E2E PASSED (${passed} assertions), isolated profile: ${profile}`)
} catch(err) {
  console.error(`E2E FAILED after ${passed} assertions:`,err.stack); console.error('Profile retained:',profile); process.exitCode=1
} finally { viewportSession?.close(); db.close(); if(child) await stopApp(child) }
