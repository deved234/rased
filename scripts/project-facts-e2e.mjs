// Actual main/preload/SQLite/UI wiring with fresh profiles and synthetic public pages.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, persistentSession, sleep, startApp, stopApp } from './cdp-tools.mjs'
const args = parseArgs(process.argv.slice(2)), profile = newProfile(), port = Number(args.port ?? 9502)
const output = resolve('.local/project-facts-2026-10-15'), shots = join(output, 'screenshots')
mkdirSync(shots, { recursive: true })
const db = new DatabaseSync(join(profile, 'rased.db')), migrations = [...readFileSync('src/storage/migrations.ts', 'utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for (const migration of migrations) db.exec(migration[1])
db.exec('PRAGMA user_version=' + migrations.length)
const now = new Date().toISOString(), sources = ['mostaql', 'nafezly', 'kaf', 'khamsat']
const urls = ['https://mostaql.com/go/123', 'https://nafezly.com/project/456-sample', 'https://kafiil.com/project/789-sample', 'https://khamsat.com/community/requests/321-sample']
const insert = db.prepare("INSERT INTO projects(id,source,external_id,url,title,description_excerpt,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'initial',?,?)")
for (let index = 0; index < 4; index++) {
  const id = index + 1, source = sources[index]
  insert.run(id, source, ['123', '456', '789', '321'][index], urls[index], 'Facts ' + source, 'Synthetic RSS description', now, now, now, now)
  db.prepare("INSERT INTO project_details VALUES(?,?,'full',?,'ready',NULL)").run(id, 'Synthetic RSS description', now)
}
db.prepare("INSERT INTO settings VALUES('app',?)").run(JSON.stringify({ language: 'en', khamsatEnabled: false, ui: { previewOpen: true, previewLayoutVersion: 2 } }))
db.close()
const mostaql = readFileSync('tests/fixtures/mostaql-facts.html', 'utf8'), nafezly = readFileSync('tests/fixtures/nafezly-facts.html', 'utf8')
const description = readFileSync('tests/fixtures/detail-body.html', 'utf8')
writeFileSync(join(profile, 'detail-fixture.html'), description + mostaql)
writeFileSync(join(profile, 'nafezly-detail-fixture.html'), nafezly)
for (const [file, source, link] of [['rss-fixture.xml', 'Mostaql', urls[0]], ['nafezly-fixture.xml', 'Nafezly', urls[1]]]) writeFileSync(join(profile, file), `<rss version="2.0"><channel><title>${source}</title><item><title>Facts ${source.toLowerCase()}</title><link>${link}</link><description>Synthetic RSS description</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`)
writeFileSync(join(profile, 'khamsat-fixture.html'), '<html>Disabled fixture</html>')
writeFileSync(join(profile, 'kaf-list-1.html'), '<div id="projects"><div class="project-box"><a href="https://kafiil.com/project/789-sample">Facts kaf<span class="tag">مفتوح</span></a><span><i class="far fa-clock"></i>منذ دقيقة</span><p class="price">$25 - $50</p><p class="info-content">Synthetic</p></div></div>')
writeFileSync(join(profile, 'kaf-detail.html'), readFileSync('tests/fixtures/kaf-detail.html', 'utf8'))
const child = startApp({ exe: args.exe ?? 'node_modules/electron/dist/electron.exe', app: args.app === '' ? '' : args.app ?? 'out/main/index.js', profile, port })
let ws, session, passed = 0
const checks = [], check = (label, value) => { assert.ok(value, label); checks.push(label); passed++; console.log('PASS ' + label) }
const ev = expression => evaluate(ws, expression)
const invoke = (method, ...values) => ev(`window.rased.${method}(${values.map(value => JSON.stringify(value)).join(',')})`)
const nav = async route => { await ev(`location.hash=${JSON.stringify(route)}`); await sleep(180) }
const trace = () => existsSync(join(profile, 'test-trace.jsonl')) ? readFileSync(join(profile, 'test-trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
const detailCalls = index => trace().filter(event => event.kind === 'fetch' && event.data === urls[index]).length
const waitReady = id => eventually(async () => (await invoke('getProjectFacts', id))?.status === 'ready')
const shot = async name => writeFileSync(join(shots, name + '.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
try {
  ws = await pageWs(port)
  await eventually(() => ev('document.querySelector(".splash")?.dataset.phase==="ready" || !!document.querySelector(".sidebar")'))
  await ev('document.querySelector(".splash-enter")?.click()'); await eventually(() => ev('document.querySelectorAll("[data-row]").length===4'))
  await ev(`document.querySelector('[data-row="1"] article').click()`)
  await eventually(() => ev('document.querySelector(".preview-pane .project-facts-status")?.dataset.status==="deferred"'))
  check('paused source explains deferred facts in preview', await ev('document.querySelector(".preview-pane").textContent.includes("Resume this platform")') && detailCalls(0) === 0)
  await invoke('resume'); await waitReady(1)
  await eventually(() => ev('document.querySelector(".preview-pane [data-fact=duration]")?.textContent.includes("5")'))
  check('preview fetches Mostaql budget and duration from an old body cache', (await invoke('getProjectFacts', 1)).budgetMin === 25 && (await invoke('getProjectFacts', 1)).durationDays === 5)
  await shot('en-mostaql-preview')
  const before = detailCalls(0)
  await nav('#/project/1'); await eventually(() => ev('!!document.querySelector(".detail-article [data-fact=budget]")'))
  await sleep(250)
  check('full page uses the same facts cache without a duplicate page fetch', detailCalls(0) === before && await ev('document.querySelector(".detail-article [data-fact=budget]").textContent.includes("25")'))

  await invoke('resumeNafezly'); await nav('#/project/2'); await waitReady(2)
  await eventually(() => ev('document.querySelector(".detail-article [data-fact=budget]")?.textContent.includes("10")'))
  check('Nafezly full page shows public card price and duration', (await invoke('getProjectFacts', 2)).budgetMax === 25 && (await invoke('getProjectFacts', 2)).durationDays === 1)
  check('Nafezly description remains RSS text', (await invoke('getProjectDetails', 2)).text === 'Synthetic RSS description')
  check('Nafezly metadata request is on demand and deduplicated', detailCalls(1) === 1)
  await shot('en-nafezly-detail')
  await nav('#/'); await eventually(() => ev('document.querySelectorAll("[data-row]").length===4'))
  await ev(`document.querySelector('[data-row="2"] article').click()`)
  await eventually(() => ev('document.querySelector(".preview-pane .project-facts-status")?.dataset.status==="ready"'))
  check('Nafezly preview no longer hides the price or duration', await ev('document.querySelector(".preview-pane [data-fact=budget]").textContent.includes("10") && document.querySelector(".preview-pane [data-fact=duration]").textContent.includes("1")') && detailCalls(1) === 1)
  await invoke('resumeKaf'); await nav('#/project/3'); await waitReady(3)
  check('KAF retrieves missing duration despite a fresh cached description', !!(await invoke('getProjectFacts', 3)).durationDays)
  await nav('#/project/4'); await eventually(() => ev('document.querySelector(".project-facts-status")?.dataset.status==="unsupported"'))
  check('Khamsat explicitly marks unsupported metadata without fetching its page', !(await invoke('getProjectFacts', 4)).budgetMin && !trace().some(event => event.kind === 'fetch' && event.data === urls[3]))
  await shot('en-khamsat-unavailable')

  writeFileSync(join(profile, 'detail-fixture.html'), description)
  await invoke('requestProjectFacts', 1, true)
  await eventually(async () => (await invoke('getProjectFacts', 1)).status === 'failed')
  check('changed markup keeps prior facts and returns a real failure', (await invoke('getProjectFacts', 1)).budgetMin === 25 && (await invoke('getProjectFacts', 1)).durationDays === 5)
  await nav('#/project/1'); await eventually(() => ev('document.querySelector(".project-facts-status")?.dataset.status==="failed"'))
  check('failure is visible alongside cached values and retry control', await ev('document.querySelector(".project-facts-status").textContent.includes("cached") && !!document.querySelector(".project-facts-status button")'))
  await shot('en-cached-after-failure')
  writeFileSync(join(profile, 'nafezly-detail-fixture.html'), nafezly)
  writeFileSync(join(profile, 'facts-config.json'), JSON.stringify({ nafezly: { status: 429, retryAfter: '300' } }))
  await invoke('requestProjectFacts', 2, true)
  await eventually(() => invoke('getNafezlyHealth').then(health => health.state === 'backing-off'))
  const limitedCount = detailCalls(1)
  await invoke('requestProjectFacts', 2, true); await invoke('refresh'); await sleep(150)
  check('detail-page rate limiting applies source cooldown and blocks forced retry', detailCalls(1) === limitedCount && (await invoke('getProjectFacts', 2)).status === 'deferred')
  check('rate limiting preserves cached Nafezly data', (await invoke('getProjectFacts', 2)).budgetMin === 10)
  await nav('#/project/2'); await eventually(() => ev('document.querySelector(".project-facts-status")?.dataset.status==="deferred"'))
  check('cooldown is explained and refresh control is disabled', await ev('document.querySelector(".project-facts-status").textContent.includes("cooldown") && document.querySelector(".project-facts-status button").disabled'))
  session = await persistentSession(ws)
  for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) {
    await invoke('updateSettings', { language, ui: { theme, textScale: 125 } })
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, mobile: false, deviceScaleFactor: 1 })
    await sleep(150)
    check(language + '/' + theme + ' full-page facts fit at 900px/125%', await ev('(()=>{const p=document.querySelector(".detail-article"),b=p.getBoundingClientRect();return [...p.querySelectorAll("[data-fact],.project-facts-status, .project-facts-status button")].every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&e.scrollWidth<=e.clientWidth+1})})()'))
    await ev('document.querySelector(".facts").scrollIntoView({block:"start"})'); await shot(language + '-' + theme + '-nafezly-cooldown')
  }
  console.log(`Project facts integration: ${passed} checks passed; profile=${profile}`)
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ profile, passed, checks }, null, 2))
  session?.close(); await stopApp(child)
}
