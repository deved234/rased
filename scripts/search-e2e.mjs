// Real Electron utility reader, preload, SQLite and bilingual React, TEMP only.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, persistentSession, sleep, startApp, stopApp } from './cdp-tools.mjs'
const args = parseArgs(process.argv.slice(2)), profile = newProfile(), port = Number(args.port ?? 9570)
const output = resolve('.local/phase-3-search-performance-2026-10-21/integration'); mkdirSync(output, { recursive: true })
const file = join(profile, 'rased.db'), db = new DatabaseSync(file)
const migrations = [...readFileSync('src/storage/migrations.ts', 'utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for (const migration of migrations) db.exec(migration[1])
db.exec('PRAGMA user_version=' + migrations.length)
const now = new Date().toISOString()
const insert = db.prepare("INSERT INTO projects(id,source,external_id,url,title,description_excerpt,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(?,'mostaql',?,?,?,'excerpt',?,?,'initial',?,?)")
for (let id = 1; id <= 260; id++) insert.run(id, String(id), 'https://mostaql.com/go/' + id, id === 1 ? 'إِدَارَة ١٢' : 'Search fixture ' + id, now, now, now, now)
db.exec("INSERT INTO project_details(project_id,description_text,status) VALUES(1,'BodyOnly café','ready')")
db.prepare("INSERT INTO settings VALUES('app',?)").run(JSON.stringify({ language: 'en', mostaqlEnabled: false, nafezlyEnabled: false, khamsatEnabled: false, kafEnabled: false, autoRevealNewAtTop: false }))
db.close()
const child = startApp({ exe: args.exe ?? 'node_modules/electron/dist/electron.exe', app: args.app === '' ? '' : args.app ?? 'out/main/index.js', profile, port, captureOutput: true })
let electronOutput = ''
child.stdout.on('data', data => { electronOutput += data.toString() })
child.stderr.on('data', data => { electronOutput += data.toString() })
let ws, session
const checks = [], check = (label, value) => { assert.ok(value, label); checks.push(label); console.log('PASS ' + label) }
const ev = expression => evaluate(ws, expression)
const invoke = (method, ...values) => ev(`window.rased.${method}(${values.map(value => JSON.stringify(value)).join(',')})`)
const def = { source: 'all', scope: 'all', search: '', unreadOnly: false, searchInNotes: false, searchInDrafts: false, statuses: [], categoryFilter: { mode: 'all', categories: [], keywordsAny: [], keywordsAll: [], excludeKeywords: [] }, budgetMin: null, budgetMax: null, includeUnknownBudget: true, sort: 'latestDetected' }
const input = async text => { await ev('document.querySelector(".search-top").focus();document.querySelector(".search-top").select()'); await call(ws, 'Input.insertText', { text }) }
try {
  ws = await pageWs(port)
  await eventually(() => ev('!!document.querySelector(".splash-enter") || !!document.querySelector(".sidebar")'))
  await ev('document.querySelector(".splash-enter")?.click()')
  await eventually(() => ev('document.querySelectorAll("[data-row]").length===50'))
  check('database probe and isolated utility page are wired', await invoke('databaseReady') && (await invoke('queryProjectsPage', def, 50, 0)).total === 260)
  // Sample on mutations, every frame and explicitly from the test: fast reloads
  // can finish before delayed progress text appears, and occluded windows pause frames.
  await ev(`window.searchUiProbe={errors:[],tops:[]};const sampleSearchUi=window.sampleSearchUi=()=>{const banner=document.querySelector('.list-pane .banner.bad');if(banner)window.searchUiProbe.errors.push(banner.textContent);const toolbar=document.querySelector('.list-toolbar');if(toolbar)window.searchUiProbe.tops.push(toolbar.getBoundingClientRect().top)};window.searchUiObserver=new MutationObserver(sampleSearchUi);window.searchUiObserver.observe(document.querySelector('.list-pane'),{childList:true,subtree:true,characterData:true});window.searchUiFrames=true;const frame=()=>{if(!window.searchUiFrames)return;sampleSearchUi();requestAnimationFrame(frame)};requestAnimationFrame(frame)`)
  const burst = await ev(`(async()=>{
    const d=${JSON.stringify(def)};
    const settle=p=>p.then(()=> 'ready',e=>e.message);
    return Promise.all(Array.from({length:20},()=>[
      settle(window.rased.queryProjectsPage(d,50,0)),
      settle(window.rased.getSidebarCounts()),
      settle(window.rased.previewFilterCount(d)),
      settle(window.rased.matchProjectIds(d,[1,2,3]))
    ]).flat())
  })()`)
  check('overlapping IPC requests cancel quietly while the newest requests complete', burst.some(value => value === 'search-superseded') && burst.filter(value => value === 'ready').length >= 4 && burst.every(value => value === 'ready' || value === 'search-superseded'))
  for (let i = 0; i < 8; i++) {
    await invoke('updateProjectUserState', 10, { note: 'Live burst ' + i })
    await sleep(110)
    await ev('window.sampleSearchUi()')
  }
  await eventually(() => ev(`document.querySelector('.list-scroll').getAttribute('aria-busy')==='false'`))
  const probe = await ev('window.searchUiFrames=false;window.searchUiObserver.disconnect();window.searchUiProbe')
  console.log('live-reload probe', JSON.stringify({ errors: probe.errors.slice(0, 3), samples: probe.tops.length, shift: probe.tops.length ? Math.max(...probe.tops) - Math.min(...probe.tops) : null, rows: await ev('document.querySelectorAll("[data-row]").length') }))
  check('live reloads retain rows without transient error banners or progress layout shifts', probe.errors.length === 0 && probe.tops.length > 0 && Math.max(...probe.tops) - Math.min(...probe.tops) < 1 && await ev('document.querySelectorAll("[data-row]").length===50'))
  check('expected cancellations do not reach Electron IPC handler error logging', !electronOutput.includes('Error occurred in handler') && !electronOutput.includes('Error: search-superseded'))
  const body = await invoke('queryProjectsPage', { ...def, search: 'bodyonly' }, 50, 0)
  check('cached full description is searched without being returned', body.rows[0]?.id === 1 && body.rows[0].matchedFields.join() === 'body' && !JSON.stringify(body).includes('BodyOnly'))
  check('NFC and Arabic matching run in the real reader', (await invoke('queryProjectsPage', { ...def, search: 'cafe\u0301' }, 50, 0)).total === 1 && (await invoke('queryProjectsPage', { ...def, search: 'اداره 12' }, 50, 0)).total === 1)
  await invoke('updateProjectUserState', 2, { note: 'PrivateNote' })
  await invoke('saveProposalDraft', { projectId: 3, proposal: 'PrivateDraft', assumptions: [], questions: [] })
  check('private fields are opt-in and transport contains no private text', (await invoke('queryProjectsPage', { ...def, search: 'PrivateNote' }, 50, 0)).total === 0 && (await invoke('queryProjectsPage', { ...def, search: 'PrivateNote', searchInNotes: true }, 50, 0)).rows[0]?.matchedFields.join() === 'note' && (await invoke('queryProjectsPage', { ...def, search: 'PrivateDraft', searchInDrafts: true }, 50, 0)).rows[0]?.id === 3)
  check('batched matching uses the same SQL predicate', JSON.stringify(await invoke('matchProjectIds', { ...def, search: 'PrivateDraft', searchInDrafts: true }, [1, 2, 3, 3])) === '[3]')
  check('oversized match batches reject', await ev(`window.rased.matchProjectIds(${JSON.stringify(def)},Array(201).fill(1)).then(()=>false,()=>true)`))
  await input('bodyonly'); await eventually(() => ev(`document.querySelectorAll('[data-row]').length===1 && !!document.querySelector('[data-row="1"]')`))
  check('visible search explains cached-body match', await ev('document.querySelector(".list-scroll").textContent.includes("cached description")'))
  await input('NoMatchYet'); await eventually(() => ev('document.querySelectorAll("[data-row]").length===0'))
  await invoke('updateSettings', { displayQuery: { ...def, search: 'NoMatchYet', searchInNotes: true } })
  await invoke('updateProjectUserState', 8, { note: 'NoMatchYet' })
  await eventually(() => ev(`!!document.querySelector('[data-row="8"]')`))
  check('an old row enters an empty live result after note editing', true)
  await invoke('updateProjectUserState', 8, { note: 'removed' }); await eventually(() => ev('document.querySelectorAll("[data-row]").length===0'))
  check('an old row leaves after note stops matching', true)
  await invoke('updateSettings', { displayQuery: def, autoRevealNewAtTop: false }); await input('')
  await eventually(() => ev('document.querySelectorAll("[data-row]").length===50'))
  const original = await invoke('queryProjectsPage', def, 50, 0)
  const writer = new DatabaseSync(file)
  writer.prepare("INSERT INTO projects(id,source,external_id,url,title,description_excerpt,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(261,'mostaql','261','https://mostaql.com/go/261','New arrival','excerpt',?,?,'live',?,?)").run(now, now, now, now)
  writer.close(); await invoke('updateProjectUserState', 2, { saved: true })
  await eventually(() => ev('!!document.querySelector(".list-scroll .pill")'))
  check('old-row invalidation keeps new arrivals outside the visible window', !await ev(`!!document.querySelector('[data-row="261"]')`) && (await invoke('queryProjectsPage', def, 50, 0, { ceilingId: original.ceilingId })).visibleTotal === 260)
  await ev('document.querySelector(".list-scroll .pill").click()'); await eventually(() => ev(`!!document.querySelector('[data-row="261"]')`))
  check('explicit reveal advances the ceiling', true)
  session = await persistentSession(ws)
  for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) {
    await invoke('updateSettings', { language, ui: { theme, textScale: 125 } })
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, mobile: false, deviceScaleFactor: 1 })
    await ev('document.querySelector(".filter-trigger").click()'); await eventually(() => ev('!!document.querySelector(".drawer")'))
    check(language + '/' + theme + ' search controls fit and are labelled', await ev('(()=>{const d=document.querySelector(".drawer");return d.scrollWidth<=d.clientWidth+1&&d.querySelectorAll(".switch input[aria-label]").length>=3})()'))
    writeFileSync(join(output, language + '-' + theme + '.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await eventually(() => ev('!document.querySelector(".drawer")'))
  }
  await invoke('deleteProposalDraft', 3)
  check('draft deletion updates SQL matching', (await invoke('queryProjectsPage', { ...def, search: 'PrivateDraft', searchInDrafts: true }, 50, 0)).total === 0)
  const broken = new DatabaseSync(file); broken.exec('ALTER TABLE project_search_cache RENAME TO unavailable_search_fixture'); broken.close()
  await input('fixture'); await eventually(() => ev('!!document.querySelector(".list-pane .banner.bad")'))
  check('search failure keeps old results and leaves settings/monitoring reachable', await ev('document.querySelectorAll("[data-row]").length>0 && document.querySelector(".list-pane .banner.bad").textContent.includes("Retry")') && !!await invoke('getSettings') && !!await invoke('getHealth'))
  const repaired = new DatabaseSync(file); repaired.exec('ALTER TABLE unavailable_search_fixture RENAME TO project_search_cache'); repaired.close()
  await ev('document.querySelector(".list-pane .banner.bad button").click()')
  await eventually(() => ev('!document.querySelector(".list-pane .banner.bad") && document.querySelectorAll("[data-row]").length===50'))
  check('retry recovers the real reader after a temporary schema failure', true)
  await sleep(100)
  console.log('Search integration: ' + checks.length + ' checks passed')
} finally {
  writeFileSync(join(output, 'results' + (args.app === '' ? '-packaged' : '') + '.json'), JSON.stringify({ profile, checks }, null, 2))
  session?.close(); await stopApp(child)
}

