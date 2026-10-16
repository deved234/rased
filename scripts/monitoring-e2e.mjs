// Fresh profiles and synthetic responses. No live account, provider key or OS clipboard.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, persistentSession, sleep, startApp, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2)), port = Number(args.port ?? 9498)
let profile = newProfile()
const exe = args.exe ?? 'node_modules/electron/dist/electron.exe', app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
const output = resolve(args.output ?? '.local/phase-2-monitoring-2026-10-15'), shots = join(output, 'screenshots')
mkdirSync(shots, { recursive: true })
const db = new DatabaseSync(join(profile, 'rased.db')), migrations = [...readFileSync('src/storage/migrations.ts', 'utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for (const migration of migrations) db.exec(migration[1])
db.exec('PRAGMA user_version=' + migrations.length)
db.prepare("INSERT INTO settings VALUES('app',?)").run(JSON.stringify({ language: 'en', mostaqlEnabled: false, khamsatEnabled: false, nafezlyEnabled: false, kafEnabled: false }))
db.prepare("INSERT INTO settings VALUES('private-test-value','SYNTHETIC_SECRET_EXCLUDED')").run()
db.close()
const stamp = () => new Date().toUTCString()
const mostaql = ids => writeFileSync(join(profile, 'rss-fixture.xml'), `<rss version="2.0"><channel><title>Mostaql</title>${ids.map(id => `<item><title>Synthetic React ${id}</title><link>https://mostaql.com/go/${id}</link><description>Synthetic description</description><pubDate>${stamp()}</pubDate></item>`).join('')}</channel></rss>`)
const nafezly = ids => writeFileSync(join(profile, 'nafezly-fixture.xml'), `<rss version="2.0"><channel><title>Nafezly</title>${ids.map(id => `<item><title>Synthetic React ${id}</title><link>https://nafezly.com/project/${id}-sample</link><description>Synthetic full description</description><pubDate>${stamp()}</pubDate></item>`).join('')}</channel></rss>`)
function khamsat(ids) {
  const now = new Date(), pad = value => String(value).padStart(2, '0')
  const date = `${pad(now.getUTCDate())}/${pad(now.getUTCMonth()+1)}/${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} GMT`
  writeFileSync(join(profile, 'khamsat-fixture.html'), `<table id="forums_table"><tbody>${ids.map(id => `<tr id="forum_post-${id}"><td><h3 class="details-head"><a href="/community/requests/${id}-sample">Synthetic request ${id}</a></h3><span title="${date}">date</span></td></tr>`).join('')}</tbody></table>`)
}
mostaql([900001]); nafezly([900101]); khamsat([900201])
writeFileSync(join(profile, 'detail-fixture.html'), '<html><body><p>Synthetic details</p></body></html>')
writeFileSync(join(profile, 'kaf-list-1.html'), '<div id="projects"><div class="project-box"><a href="https://kafiil.com/project/900301-sample">Synthetic KAF<span class="tag">مفتوح</span></a><span><i class="far fa-clock"></i>منذ دقيقة</span><p class="price">$25 - $50</p><p class="info-content">Synthetic description</p></div></div>')
const configs = {}, configure = () => writeFileSync(join(profile, 'monitoring-config.json'), JSON.stringify(configs))
const trace = () => existsSync(join(profile, 'test-trace.jsonl')) ? readFileSync(join(profile, 'test-trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
const urls = { mostaql: 'https://mostaql.com/rss', khamsat: 'https://khamsat.com/community/requests', nafezly: 'https://nafezly.com/feed', kaf: 'https://kafiil.com/projects?sort=latest&page=1' }
const methods = { mostaql: ['getHealth', 'resume', 'pause'], khamsat: ['getKhamsatHealth', 'resumeKhamsat', 'pauseKhamsat'], nafezly: ['getNafezlyHealth', 'resumeNafezly', 'pauseNafezly'], kaf: ['getKafHealth', 'resumeKaf', 'pauseKaf'] }
let child, ws, session, passed = 0
const checks = []
const check = (label, condition) => { assert.ok(condition, label); passed++; checks.push(label); console.log('PASS ' + label) }
const ev = expression => evaluate(ws, expression)
const invoke = (method, ...values) => ev(`window.rased.${method}(${values.map(value => JSON.stringify(value)).join(',')})`)
const health = id => invoke(methods[id][0])
const fetches = id => trace().filter(event => event.kind === 'fetch' && event.data === urls[id]).length
const nav = async route => {
  await ev(`location.hash=${JSON.stringify(route)}`)
  if (route === '#/settings/watching') await eventually(() => ev('!!document.querySelector(".monitoring-intro")'))
  else if (route === '#/settings/about') await eventually(() => ev('!!document.querySelector(".about-diagnostics")'))
  else await sleep(180)
}
async function boot() {
  child = startApp({ exe, app, profile, port }); ws = await pageWs(port)
  try {
    await eventually(() => ev('document.querySelector(".splash")?.dataset.phase === "ready" || !!document.querySelector(".sidebar")'), Boolean, 20000)
  } catch (error) {
    console.error('Boot state:', await ev('document.body.innerText'))
    throw error
  }
  await ev('document.querySelector(".splash-enter")?.click()')
  await eventually(() => ev('!!document.querySelector(".sidebar")'))
}
try {
  await boot()
  if (!args['notices-only']) {
  for (const id of Object.keys(methods)) check(id + ' starts disabled', (await health(id)).state === 'disabled')
  await nav('#/settings/watching')
  await eventually(() => ev('document.querySelectorAll(".monitoring-source").length === 4'))
  check('four capability-driven settings cards render', await ev('document.querySelectorAll(".monitoring-source").length === 4'))
  check('disabled Mostaql has no pause shortcut in top bar', await ev('!document.querySelector(".source-pill:first-child .source-pause-btn")'))
  check('all-disabled state is visible', await ev('document.querySelector(".statusbar").textContent.includes("Disabled")'))
  await invoke('updateSettings', { mostaqlEnabled: true, khamsatEnabled: true, nafezlyEnabled: true, kafEnabled: true })
  for (const id of Object.keys(methods)) {
    await invoke(methods[id][1]); await eventually(async () => !!(await health(id)).lastSuccessAt)
    await invoke(methods[id][2])
    check(id + ' records a real baseline and last discovery', !!(await health(id)).lastDiscoveryAt)
  }
  const totals = await invoke('getProjectCount', {})
  check('baselines stay in the archive without alerts', totals.total === 4 && !trace().some(event => event.kind === 'toast'))
  await invoke('resumeNafezly')
  await eventually(async () => (await health('nafezly')).nextAttemptAt !== null)
  await invoke('pause')
  check('Mostaql pause does not pause Nafezly', !(await health('nafezly')).paused)
  await invoke('pauseNafezly')

  nafezly([900102])
  await invoke('resumeNafezly')
  await eventually(async () => !!(await health('nafezly')).coverageGap)
  await invoke('pauseNafezly')
  check('Nafezly no-overlap warning reaches preload', (await health('nafezly')).coverageGap.reason === 'no-overlap')
  await nav('#/')
  check('coverage warning is available in a collapsed project-list disclosure', await ev('!document.querySelector(".monitoring-notices").open && document.querySelector("[data-monitoring-source=nafezly]")?.textContent.includes("no overlap")'))
  const gap = (await health('nafezly')).coverageGap
  await nav('#/settings/watching')
  await ev('document.querySelector("[data-source=nafezly]").scrollIntoView({block:"start"})')
  writeFileSync(join(shots, 'en-gap-warning.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))

  // Cancellation must block ingestion, even if the source is rapidly re-enabled.
  configs.mostaql = { delay: 2000 }; configure(); mostaql([900002])
  await invoke('resume'); await eventually(async () => (await health('mostaql')).checking)
  await invoke('updateSettings', { mostaqlEnabled: false })
  await invoke('pause')
  await sleep(250)
  check('disabling Mostaql cancels its in-flight cycle', (await invoke('getProjectCount', {})).total === 5 && (await health('mostaql')).state === 'disabled')
  delete configs.mostaql; configure()
  const toastsBeforeMutedDiscovery = trace().filter(event => event.kind === 'toast').length
  await invoke('updateSettings', { mostaqlEnabled: true, mostaqlNotificationsEnabled: false })
  await invoke('resume'); await eventually(async () => (await invoke('getProjectCount', {})).total === 6); await invoke('pause')
  check('muting Mostaql keeps discovery active without a toast', !!(await health('mostaql')).lastDiscoveryAt && !(await invoke('getSettings')).mostaqlNotificationsEnabled && trace().filter(event => event.kind === 'toast').length === toastsBeforeMutedDiscovery)

  // Return a rate-limit through every actual controller, not mocked health snapshots.
  for (const id of Object.keys(methods)) {
    if (id === 'kaf') writeFileSync(join(profile, 'kaf-config.json'), JSON.stringify({ status: 429, retryAfter: '300' }))
    else { configs[id] = { status: 429, retryAfter: '300' }; configure() }
    await invoke(methods[id][1])
    await eventually(async () => (await health(id)).lastError?.includes('429') || (await health(id)).lastError?.includes('rate_limited'))
    const before = fetches(id), h = await health(id)
    check(id + ' exposes a scheduled cooldown', h.state === 'backing-off' && Date.parse(h.nextAttemptAt) > Date.now() + 200000)
    await invoke('refresh'); await invoke(methods[id][2]); await invoke(methods[id][1])
    await invoke('updateSettings', { [id + 'Enabled']: false }); await invoke('updateSettings', { [id + 'Enabled']: true })
    await sleep(130)
    check(id + ' refresh/resume/re-enable cannot bypass cooldown', fetches(id) === before)
    await invoke(methods[id][2])
  }
  await invoke('updateSettings', { mostaqlEnabled: false, mostaqlNotificationsEnabled: false, khamsatEnabled: false, nafezlyEnabled: false, kafEnabled: false })
  await stopApp(child); await boot()
  check('Mostaql disable and mute survive a real process restart', !(await invoke('getSettings')).mostaqlEnabled && !(await invoke('getSettings')).mostaqlNotificationsEnabled && (await health('mostaql')).state === 'disabled')
  check('coverage warning survives restart', JSON.stringify((await health('nafezly')).coverageGap) === JSON.stringify(gap))
  check('invalid sources cannot acknowledge a warning', !(await invoke('acknowledgeSourceGap', '__proto__')).ok)
  await invoke('updateSettings', { nafezlyEnabled: true })
  await nav('#/settings/watching')
  await ev('document.querySelector("[data-source=nafezly] .coverage-warning button").click()')
  await eventually(async () => !(await health('nafezly')).coverageGap)
  check('explicit acknowledgement clears only the chosen warning', !(await health('nafezly')).coverageGap && !!(await health('mostaql')).coverageGap)
  await invoke('copyMonitoringReport')
  const report = trace().filter(event => event.kind === 'monitoring-report').at(-1)?.data ?? ''
  check('support report has all sources and excludes private values', JSON.parse(report).sources.length === 4 && !/SYNTHETIC_SECRET|Synthetic React|Synthetic description|Users|test-trace/.test(report))
  await nav('#/settings/about')
  await ev('document.querySelector(".about-diagnostics").open = true')
  check('diagnostics includes KAF from the shared source registry', await ev('document.querySelector(".about-diagnostics").textContent.includes("kafiil.com/projects")'))

  await nav('#/settings/watching'); session = await persistentSession(ws)
  for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) {
    await invoke('updateSettings', { language, ui: { theme, textScale: 125 } })
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, mobile: false, deviceScaleFactor: 1 })
    await sleep(150)
    const overflow = await ev('(()=>{const p=document.querySelector(".settings-content"),b=p.getBoundingClientRect();return [...p.querySelectorAll("button,select,section,dl,p")].filter(e=>{const r=e.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||e.scrollWidth>e.clientWidth+1}).map(e=>e.className)})()')
    check(language + '/' + theme + ' monitoring fits 900px at 125%', overflow.length === 0)
    await ev('document.querySelector(".monitoring-intro").scrollIntoView({block:"start"})')
    writeFileSync(join(shots, language + '-' + theme + '-settings.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  await ev('document.querySelector(".source-health-btn").click()')
  check('health dialog exposes all four platforms including disabled ones', await ev('document.querySelectorAll(".health-source").length === 4'))
  check('health dialog initially focuses its close control without scrolling past the heading', await ev('document.activeElement?.getAttribute("aria-label")==="Close" && document.querySelector(".popover").scrollTop===0'))
  check('health dialog fits the viewport and scrolls internally', await ev('(()=>{const p=document.querySelector(".popover"),b=p.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth+1 && b.bottom<=innerHeight && getComputedStyle(p).overflowY==="auto"})()'))
  writeFileSync(join(shots, 'en-light-health-dialog.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  check('health dialog supports Escape', await ev('!document.querySelector(".popover")'))
  }

  // Reproduce three historical gaps without touching the user's database.
  const prefs = await invoke('getSettings')
  session?.close(); session = null
  await stopApp(child)
  profile = newProfile()
  for (const key of Object.keys(configs)) delete configs[key]
  configure(); writeFileSync(join(profile, 'kaf-config.json'), '{}')
  mostaql([900001]); nafezly([900101]); khamsat([900201])
  writeFileSync(join(profile, 'detail-fixture.html'), '<html><body>Synthetic details</body></html>')
  writeFileSync(join(profile, 'kaf-list-1.html'), '<div id="projects"><div class="project-box"><a href="https://kafiil.com/project/900301-sample">Synthetic KAF<span class="tag">مفتوح</span></a><span><i class="far fa-clock"></i>منذ دقيقة</span><p class="price">$25 - $50</p><p class="info-content">Synthetic description</p></div></div>')
  const seeded = new DatabaseSync(join(profile, 'rased.db'))
  for (const migration of migrations) seeded.exec(migration[1])
  seeded.exec('PRAGMA user_version=' + migrations.length)
  seeded.prepare("INSERT INTO settings VALUES('app',?)").run(JSON.stringify({ ...prefs, mostaqlEnabled: true, khamsatEnabled: true, nafezlyEnabled: true, kafEnabled: true, language: 'en', ui: { ...prefs.ui, theme: 'light', textScale: 100 }, displayQuery: { ...prefs.displayQuery, source: 'all' } }))
  const interrupted = { since: new Date(Date.now() - 3600000).toISOString(), detectedAt: new Date().toISOString(), reason: 'interrupted' }
  for (const id of ['mostaql', 'khamsat', 'nafezly']) {
    seeded.prepare('INSERT INTO settings VALUES(?,?)').run('monitoring:' + id, JSON.stringify({ ids: [], lastDiscoveryAt: null, gap: interrupted }))
  }
  seeded.close()
  await boot(); await nav('#/')
  for (const id of Object.keys(methods)) {
    await invoke(methods[id][1])
    await eventually(async () => !!(await health(id)).lastSuccessAt)
  }
  try {
    await eventually(() => ev('document.querySelectorAll(".monitoring-notices [data-monitoring-source]").length === 3'))
  } catch (error) {
    console.error('Notices state:', await ev('document.querySelector(".list-pane")?.innerText'))
    for (const id of Object.keys(methods)) console.error(id, await health(id))
    throw error
  }
  check('three historical gaps share one collapsed strip', await ev('document.querySelectorAll(".monitoring-notices").length === 1 && !document.querySelector(".monitoring-notices").open && document.querySelector(".monitoring-summary").textContent.includes("Possible coverage gaps across 3 platforms")'))
  await ev('document.querySelector(".monitoring-summary").focus()')
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  check('keyboard Enter expands monitoring details', await eventually(() => ev('document.querySelector(".monitoring-notices").open')))
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await eventually(() => ev('!document.querySelector(".monitoring-notices").open'))
  check('collapsing does not acknowledge historical gaps', (await health('mostaql')).coverageGap && (await health('khamsat')).coverageGap && (await health('nafezly')).coverageGap)
  await ev('document.querySelector(".pill")?.click()')
  await eventually(() => ev('!!document.querySelector("[data-row]")'))
  session = await persistentSession(ws)
  for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) {
    await invoke('updateSettings', { language, ui: { theme, textScale: 125 } })
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, mobile: false, deviceScaleFactor: 1 })
    await sleep(150)
    for (const expanded of [false, true]) {
      await ev(`document.querySelector('.monitoring-notices').open=${expanded}`)
      const layout = await ev('(()=>{const n=document.querySelector(".monitoring-notices"),b=n.getBoundingClientRect(),list=document.querySelector(".list-scroll").getBoundingClientRect(),body=n.querySelector(".monitoring-notices-body");return {fits:b.left>=0&&b.right<=innerWidth&&n.scrollWidth<=n.clientWidth+1,listHeight:list.height,listVisible:list.top<innerHeight-100,bounded:body.getBoundingClientRect().height<=innerHeight*.20+2,scrolls:getComputedStyle(body).overflowY==="auto"}})()')
      writeFileSync(join(shots, `${language}-${theme}-notices-${expanded ? 'expanded' : 'collapsed'}.png`), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
      check(`${language}/${theme} ${expanded ? 'expanded' : 'collapsed'} warnings keep projects visible at 900px/125%: ${JSON.stringify(layout)}`, layout.fits && layout.listHeight >= 100 && layout.listVisible && (!expanded || layout.bounded && layout.scrolls))
    }
  }
  await invoke('updateSettings', { language: 'ar', ui: { theme: 'light', textScale: 100 } })
  await session.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, mobile: false, deviceScaleFactor: 1 })
  await ev('document.querySelector(".monitoring-notices").open=false')
  await sleep(150)
  writeFileSync(join(shots, 'ar-light-desktop-notices.png'), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await ev('document.querySelector(".source-option:nth-child(2)").click()')
  check('platform filter scopes the strip and its details', await eventually(() => ev('document.querySelectorAll(".monitoring-notices [data-monitoring-source]").length === 1 && !!document.querySelector(".monitoring-notices [data-monitoring-source=mostaql]")')))
  await ev('document.querySelector(".monitoring-notices").open=true; document.querySelector("[data-monitoring-source=mostaql] .coverage-warning button").click()')
  await eventually(() => ev('!document.querySelector(".monitoring-notices")'))
  check('acknowledging the selected gap removes its strip without clearing others', !(await health('mostaql')).coverageGap && !!(await health('khamsat')).coverageGap && !!(await health('nafezly')).coverageGap)
  await ev('document.querySelector(".source-option:first-child").click()')
  await eventually(() => ev('document.querySelectorAll(".monitoring-notices [data-monitoring-source]").length === 2'))
  await invoke('updateSettings', { khamsatEnabled: false })
  await eventually(() => ev('document.querySelectorAll(".monitoring-notices [data-monitoring-source]").length === 1'))
  check('disabled platforms leave the strip without erasing their gap', !!(await health('khamsat')).coverageGap && !(await health('khamsat')).enabled)
  await ev('document.querySelector(".monitoring-notices").open=true; document.querySelector("[data-monitoring-source=nafezly] .coverage-warning button").click()')
  check('strip disappears when all enabled notices are resolved', await eventually(() => ev('!document.querySelector(".monitoring-notices")')))
  console.log(`Monitoring integration: ${passed} checks passed; profile=${profile}`)
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ profile, passed, checks }, null, 2))
  session?.close(); if (child) await stopApp(child)
}
