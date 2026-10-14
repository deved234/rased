// Real Electron/preload/SQLite/React with synthetic public content and OS traces.
// No network requests, real accounts, API keys or user profiles.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, persistentSession, sleep, startApp, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2))
const profile = newProfile(), port = Number(args.port ?? 9394), output = resolve('.local/kaf-research-2026-10-14/implementation')
const exe = args.exe ?? 'node_modules/electron/dist/electron.exe', app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
mkdirSync(output, { recursive: true })
const fixture = readFileSync('tests/fixtures/kaf-list.html', 'utf8')
const writeList = (text = fixture) => writeFileSync(join(profile, 'kaf-list-1.html'), text)
const noPaging = html => html.replace(/<a page="2">التالي<\/a>/, '')
writeList(noPaging(fixture))
writeFileSync(join(profile, 'kaf-detail.html'), readFileSync('tests/fixtures/kaf-detail.html', 'utf8'))
const traces = () => existsSync(join(profile, 'test-trace.jsonl')) ? readFileSync(join(profile, 'test-trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
const sourceFetches = () => traces().filter(t => t.kind === 'fetch' && t.data.startsWith('https://kafiil.com/'))
let child, ws, session, storage, checks = 0
const ev = e => evaluate(ws, e), wait = e => eventually(() => ev(e))
const check = (label, condition) => { assert.ok(condition, label); checks++; console.log('PASS ' + label) }
const query = () => ev('(async()=>window.rased.queryProjectsPage({...((await window.rased.getSettings()).displayQuery),source:"kaf",scope:"all",search:""},50,0))()')
const boot = async () => {
  child = startApp({ exe, app, profile, port })
  ws = await pageWs(port)
  await wait('!!window.rased && (!!document.querySelector(".app") || !!document.querySelector(".splash-enter"))')
  await ev('document.querySelector(".splash-enter")?.click()')
  await wait('!!document.querySelector(".app")')
}
const rowCount = () => storage.prepare("SELECT count(*) AS n FROM projects WHERE source='kaf'").get().n
try {
  await boot()
  storage = new DatabaseSync(join(profile, 'rased.db'))
  await ev('window.rased.resumeKaf()'); await eventually(() => rowCount() === 2)
  check('silent baseline through real main/preload/SQLite', storage.prepare('SELECT count(*) AS n FROM notification_events').get().n === 0)
  check('independent KAF resume leaves the other three paused', await ev('Promise.all([window.rased.getHealth(),window.rased.getKhamsatHealth(),window.rased.getNafezlyHealth()]).then(all=>all.every(s=>s.paused))'))
  writeList(noPaging(fixture).replace('project/300-', 'project/298-').replace('تطوير واجهة React', 'مشروع جديد React'))
  await eventually(() => rowCount() === 3, Boolean, 15000)
  await eventually(() => traces().some(t => t.kind === 'toast'), Boolean, 8000)
  const events = storage.prepare("SELECT e.status,p.external_id FROM notification_events e JOIN projects p ON p.id=e.project_id WHERE p.source='kaf'").all()
  check('only newly visible open lower-ID project has one notification event', events.length === 1 && events[0].external_id === '298')
  const p = (await query()).rows.find(r => r.externalId === '298')
  await ev(`window.rased.openProjectExternal(${p.id})`)
  check('validated stored project opens through default-browser boundary', traces().some(t => t.kind === 'open-external' && t.data === p.url))
  await ev(`location.hash='#/project/${p.id}'`); await wait('!!document.querySelector(".detail-rail")')
  await wait(`window.rased.getProjectDetails(${p.id}).then(d=>d.status==='ready')`)
  check('on-demand details expose actual category/duration and keep timestamp raw', await ev(`window.rased.getProject(${p.id}).then(p=>p.durationDays===5 && p.publishedAt===null && p.publishedRaw==='2026-10-14 09:37:20')`))
  check('KAF has no Quick Apply or AI action', await ev('!document.querySelector(".detail-rail .quick-apply-button") && !Array.from(document.querySelectorAll(".detail-rail button")).some(b=>/مساعد العروض|تقديم سريع/.test(b.textContent))'))
  const preview = await ev(`window.rased.getProposalPreview(${p.id},'')`)
  check('AI main service refuses KAF even through direct IPC', preview === null)
  check('Quick Apply main service rejects KAF', !(await ev(`window.rased.quickApplyProject(${p.id})`)).ok)
  const toast = traces().find(t => t.kind === 'toast')?.data?.toastXml
  check('KAF toast uses the project HTTPS destination with no Quick Apply action', typeof toast === 'string' && toast.includes(p.url) && !toast.includes('quick-apply') && !toast.includes('<actions>'))
  await ev('window.rased.pauseKaf()'); const count = sourceFetches().length
  await ev('window.rased.refresh()'); await sleep(1500)
  check('pause cancels KAF while global refresh cannot restart it', sourceFetches().length === count)
  await ev('window.rased.updateSettings({kafKeywordsAny:["React"],kafExcludeKeywords:["WordPress"]})')
  await ev('location.hash="#/settings/notifications"'); await wait('!!document.querySelector("#kaf-any")')
  check('KAF keyword settings persist and render with labeled fields', await ev('document.querySelector("#kaf-any").value==="React" && document.querySelector("label[for=kaf-any]")!==null'))
  await ev('location.hash="#/"'); session = await persistentSession(ws)
  for (const language of ['ar', 'en']) {
    await ev(`(async()=>{const s=await window.rased.getSettings();await window.rased.updateSettings({language:${JSON.stringify(language)},ui:{...s.ui,textScale:125}})})()`)
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false }); await sleep(350)
    check(`${language}: four source controls fit 900px at 125% text`, await ev('document.body.scrollWidth<=innerWidth && document.querySelectorAll(".source-health-strip .source-pill").length===4 && [...document.querySelectorAll(".source-health-strip button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})'))
    writeFileSync(join(output, language + '-900.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  session.close(); session = null
  writeFileSync(join(profile, 'kaf-config.json'), JSON.stringify({ delay: 5000 }))
  await ev('window.rased.resumeKaf()'); await eventually(() => sourceFetches().length > count)
  await ev('window.rased.updateSettings({kafEnabled:false})'); const before = rowCount()
  writeList(noPaging(fixture).replace('project/300-', 'project/400-')); await sleep(1600)
  check('disabling source aborts the request and prevents late inserts', rowCount() === before)
  writeFileSync(join(profile, 'kaf-config.json'), JSON.stringify({ status: 429, retryAfter: '120' }))
  await ev('window.rased.updateSettings({kafEnabled:true})'); await ev('window.rased.refresh()')
  await wait('window.rased.getKafHealth().then(h=>h.state==="backing-off")')
  const until = storage.prepare("SELECT backoff_until FROM source_state WHERE source='kaf'").get().backoff_until
  check('Retry-After is persisted and source-local', Date.parse(until) > Date.now() + 100000 && await ev('window.rased.getKhamsatHealth().then(h=>h.lastError===null)'))
  await stopApp(child); child = null; const beforeRestart = sourceFetches().length
  await boot(); await ev('window.rased.resumeKaf()'); await ev('window.rased.refresh()'); await sleep(1200)
  check('restart and manual refresh preserve active KAF cooldown', sourceFetches().length === beforeRestart && await ev('window.rased.getKafHealth().then(h=>h.state==="backing-off")'))
  check('KAF rows persist after restart', (await query()).total === before)
  writeFileSync(join(output, 'e2e-result.json'), JSON.stringify({ profile, checks, notificationEvents: events, limits: 'Synthetic transport and OS traces; actual Windows toast activation and live publication delay are not proven.' }, null, 2))
  console.log(`KAF integration: ${checks} checks passed`)
} catch (error) { if (ws) console.error(await ev('document.body.innerText').catch(() => 'No renderer')); throw error }
finally { session?.close(); storage?.close(); if (child) await stopApp(child) }
