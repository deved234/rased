// Real main/preload/worker/SQLite/UI. The capture boundary is a local fixture,
// enabled only by an existing, marked TEMP test harness. No PostHog requests.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, startApp, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2)), profile = newProfile(), port = Number(args.port ?? 9581)
const exe = args.exe ?? 'node_modules/electron/dist/electron.exe', app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
const fixture = join(profile, 'telemetry-fixture.json'), eventsFile = join(profile, 'telemetry-fixture-sink/fixture-events.jsonl')
writeFileSync(fixture, JSON.stringify({ flush: false }))
const db = new DatabaseSync(join(profile, 'rased.db'))
const migrations = [...readFileSync('src/storage/migrations.ts', 'utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for (const m of migrations) db.exec(m[1])
db.exec('PRAGMA user_version=' + migrations.length)
const stamp = new Date().toISOString(), canary = 'PRIVATE_ANALYTICS_CANARY_DO_NOT_SEND'
db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({ mostaqlEnabled: false, khamsatEnabled: false, nafezlyEnabled: false, kafEnabled: false }))
db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','123','https://mostaql.com/go/123',?,?,?,'initial',?,?)").run(canary, stamp, stamp, stamp, stamp)
db.close()
let child, ws, passed = 0
const check = (label, value) => { assert.ok(value, label); passed++; console.log('PASS ' + label) }
const ev = expression => evaluate(ws, expression)
const status = () => ev('window.rased.getAnalyticsStatus()')
const events = () => existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
async function boot() {
  child = startApp({ exe, app, profile, port, captureOutput: true })
  const capture = chunk => appendFileSync(join(profile, 'electron-output.log'), chunk)
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  ws = await pageWs(port, undefined, 30000)
  await eventually(() => ev('!!window.rased'), Boolean, 30000)
  await eventually(status, Boolean, 30000)
}
async function stop() {
  await stopApp(child)
  // taskkill finishing can precede the old CDP endpoint disappearing. Do not
  // attach a subsequent launch to a dying renderer from the previous process.
  await eventually(async () => { try { await fetch(`http://127.0.0.1:${port}/json/list`); return false } catch { return true } })
}
async function flush() { writeFileSync(fixture, '{"flush":true}'); await status(); writeFileSync(fixture, '{"flush":false}') }
try {
  await boot()
  check('fresh consent is unknown and no identity exists', (await status()).state === 'unknown' && !(await status()).reference)
  await ev('window.rased.openProjectExternal(1)'); await flush()
  check('normal app actions before consent send no analytics', events().length === 0)
  check('renderer cannot invent arbitrary capture events', await ev('window.rased.track === undefined && window.rased.capture === undefined'))
  check('unknown consent actions are rejected', !(await ev('window.rased.analyticsConsent("made-up")')).ok)
  await ev('window.rased.analyticsConsent("disable")'); await stop(); await boot()
  check('decline survives real restart without identity', (await status()).state === 'disabled' && !(await status()).reference)
  check('enable succeeds through actual preload/main/worker', (await ev('window.rased.analyticsConsent("enable")')).ok)
  const identity = (await status()).reference
  check('identity appears only after consent', /^[a-f0-9-]{36}$/.test(identity))
  await ev('window.rased.recordUiUsage("projects"); window.rased.recordUiUsage("detail")')
  await ev('window.rased.openProjectExternal(1)')
  writeFileSync(join(profile, 'update-fixture.json'), JSON.stringify({ version: '0.9.0', releaseNotes: 'Synthetic update only', error: 'download' }))
  await ev('window.rased.checkUpdate()')
  await ev('window.rased.downloadUpdate()'); await ev('window.rased.downloadUpdate()')
  writeFileSync(join(profile, 'update-fixture.json'), JSON.stringify({ version: '0.9.0', releaseNotes: 'Synthetic update only' }))
  await ev('window.rased.downloadUpdate()')
  await flush(); await eventually(() => events().length > 0)
  check('each retry records its own terminal download outcome without duplicating progress callbacks', events().filter(e => e.name === 'update_download_result' && e.properties.outcome === 'failed').length === 2 && events().filter(e => e.name === 'update_download_result' && e.properties.outcome === 'success').length === 1)
  check('fixture events are QA only and use one install identity', events().every(e => e.environment === 'qa' && e.distinctId === identity))
  check('first observed is emitted once and never labeled installation', events().filter(e => e.name === 'analytics_enrolled').length === 1 && events().every(e => !e.name.includes('install')))
  check('UI activity is deduplicated for the UTC day', events().filter(e => e.name === 'active_daily' && e.properties.activity_kind === 'interface').length === 1)
  check('real project opening records a sanitized result', events().some(e => e.name === 'project_open_result' && e.properties.source === 'mostaql' && e.properties.launch === 'accepted'))
  check('payload excludes content, project destinations and raw identifiers', !JSON.stringify(events()).includes(canary) && !JSON.stringify(events()).includes('https://mostaql') && !JSON.stringify(events()).includes('projectId'))
  await ev('window.rased.testNotification()'); await flush()
  check('test notification never increments project notification analytics', events().filter(e => e.name === 'project_open_result').length === 1)
  await ev('window.location.hash="#/settings/analytics"')
  await eventually(() => ev('!!document.getElementById("analytics-heading")'))
  check('Arabic settings disclose WhatsApp, opt-in and remote deletion limits', await ev('document.body.innerText.includes("01201780258") && document.body.innerText.includes("لا يحذف")'))
  check('copy-reference works without sending it externally', (await ev('window.rased.analyticsAction("copy-reference")')).ok)
  check('contact opens only the fixed WhatsApp destination', (await ev('window.rased.analyticsAction("contact")')).ok)
  const trace = readFileSync(join(profile, 'test-trace.jsonl'), 'utf8')
  check('WhatsApp URL contains no prefilled identity or message', trace.includes('https://wa.me/201201780258') && !trace.includes('wa.me/201201780258?'))
  const archive = join(profile, 'analytics-exclusion.rased-backup')
  writeFileSync(join(profile, 'data-dialog.json'), JSON.stringify({ 'save-backup': archive }))
  check('portable backup succeeds with active separate analytics store', (await ev('window.rased.createBackup()')).ok)
  check('portable backup never includes analytics identity', !readFileSync(archive).includes(Buffer.from(identity)))
  await stop(); await boot()
  check('ordinary app restart preserves participating identity', (await status()).reference === identity && (await status()).state === 'enabled')
  await ev('window.rased.recordUiUsage("settings")'); await flush()
  check('restart does not double-count the daily marker or version', events().filter(e => e.name === 'active_daily').length === 1 && events().filter(e => e.name === 'version_first_seen').length === 1)
  await ev('window.rased.openProjectExternal(1)')
  await ev('window.rased.analyticsConsent("disable")'); const before = events().length
  await ev('window.rased.openProjectExternal(1)'); await flush()
  check('revocation clears queued events and stops subsequent capture', (await status()).queued === 0 && events().length === before)
  check('stopping retains the reference for a deletion request', (await status()).reference === identity)
  await ev('window.rased.analyticsConsent("forget")')
  check('forget removes local reference and keeps sharing disabled', !(await status()).reference && (await status()).state === 'disabled')
  check('fixture receiver is outside application-owned telemetry state', !existsSync(join(profile,'telemetry/fixture-events.jsonl')))
  for (const name of readdirSync(join(profile,'telemetry'))) check('forgotten reference absent from '+name,!readFileSync(join(profile,'telemetry',name)).includes(Buffer.from(identity)))
  await ev('window.rased.analyticsConsent("enable")')
  check('re-enrollment after forgetting uses a new identity', (await status()).reference !== identity)
  await ev('window.rased.updateSettings({language:"en"})'); await ev('window.location.hash="#/settings/analytics"')
  await eventually(() => ev('document.body.innerText.includes("Privacy & analytics")'))
  const out = resolve('.local/product-analytics-2026-10-19/screenshots'); mkdirSync(out, { recursive: true })
  for (const [lang, theme] of [['ar', 'dark'], ['en', 'light']]) {
    await ev(`window.rased.updateSettings({language:${JSON.stringify(lang)},ui:{theme:${JSON.stringify(theme)}}})`)
    await eventually(() => ev(`document.body.innerText.includes(${JSON.stringify(lang === 'ar' ? 'لا يحدد راصد موعد حذف دوري' : 'no scheduled expiry')})`))
    check(`${lang} settings disclose no scheduled expiry and the provider storage limitation`, await ev(lang === 'ar' ? 'document.body.innerText.includes("لا يحدد راصد موعد حذف دوري") && document.body.innerText.includes("لا نضمن بقاء البيانات للأبد")' : 'document.body.innerText.includes("no scheduled expiry") && document.body.innerText.includes("Permanent availability is not guaranteed")'))
    await call(ws, 'Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
    const shot = await call(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(out, `analytics-${lang}-${theme}.png`), Buffer.from(shot.data, 'base64'))
    check(`${lang} analytics settings have no horizontal document overflow`, await ev('document.documentElement.scrollWidth <= innerWidth + 2'))
  }
  const consentFile = join(profile, 'telemetry/consent.json'), retainedReference = (await status()).reference
  await stop()
  writeFileSync(consentFile, JSON.stringify({ ...JSON.parse(readFileSync(consentFile, 'utf8')), disclosure: '2026-10-17-v1' }))
  await boot()
  check('a prior 90-day opt-in cannot silently authorize the new retention policy', (await status()).state === 'unknown' && (await status()).reference === retainedReference && !(await status()).prompted)
  const beforePolicyConsent = events().length
  await ev('window.rased.openProjectExternal(1)'); await flush()
  check('no new activity is captured before renewed policy consent', events().length === beforePolicyConsent && (await status()).queued === 0)
  await ev('window.rased.analyticsConsent("enable")')
  check('renewed consent preserves the installation reference under the new disclosure', (await status()).state === 'enabled' && (await status()).reference === retainedReference && (await status()).disclosure === '2026-10-19-v2')
  const diagnostics = new DatabaseSync(join(profile, 'rased.db'))
  check('no uncaught errors through real IPC/worker flows', diagnostics.prepare("SELECT COUNT(*) AS n FROM diagnostics WHERE status='uncaught'").get().n === 0)
  diagnostics.close()
  // A decline is durable across disclosure changes; it must not be re-solicited.
  await ev('window.rased.analyticsConsent("disable")'); await stop()
  const declined = JSON.parse(readFileSync(consentFile,'utf8'))
  writeFileSync(consentFile,JSON.stringify({...declined,disclosure:'2026-10-17-v1'}))
  await boot()
  check('old explicit decline stays disabled and does not show the banner',(await status()).state==='disabled' && (await status()).prompted)
  // Actual main/worker cleanup failure remains visible after identity removal.
  await ev('window.rased.analyticsConsent("enable")')
  writeFileSync(fixture,JSON.stringify({purgeFail:true}))
  const failed = await ev('window.rased.analyticsConsent("forget")')
  check('failed purge has a specific IPC error and no reference',failed.error==='forget-incomplete' && !(await status()).reference && (await status()).purgePending && (await status()).state==='disabled')
  await ev('document.querySelector(".splash-enter")?.click(); location.hash="#/settings/analytics"')
  for (const lang of ['ar','en']) {
    await ev(`window.rased.updateSettings({language:${JSON.stringify(lang)}})`)
    await eventually(()=>ev('!!document.querySelector(".analytics-purge-retry")'))
    check(lang+' incomplete purge message and retry remain accessible without identity',await ev(`document.body.innerText.includes(${JSON.stringify(lang==='ar'?'لم يكتمل النسيان المحلي':'Local forgetting is incomplete')}) && document.querySelector('.analytics-purge-retry').disabled===false`))
    const button=await ev('document.querySelector(".analytics-purge-retry").focus(); document.activeElement.className')
    check(lang+' retry button accepts keyboard focus',button.includes('analytics-purge-retry'))
    const shots=resolve('.local/analytics-repair-2026-10-20/screenshots');mkdirSync(shots,{recursive:true})
    writeFileSync(join(shots,`purge-pending-${lang}.png`),Buffer.from((await call(ws,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'))
  }
  writeFileSync(fixture,JSON.stringify({purgeDelay:1400}))
  await ev('document.querySelector(".analytics-purge-retry").focus()')
  await call(ws,'Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'})
  await call(ws,'Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await eventually(async()=>!(await status()).purgePending,Boolean,15000)
  check('slow purge completes beyond the normal IPC deadline',(await status()).state==='disabled' && !(await status()).reference)
  await ev('window.rased.analyticsConsent("enable")')
  const timedOutIdentity=(await status()).reference
  writeFileSync(fixture,'{"purgeDelay":31000}')
  await ev('window.__purgeResult=null;window.rased.analyticsConsent("forget").then(r=>{window.__purgeResult=r});true')
  const timeoutResult=await eventually(()=>ev('window.__purgeResult'),Boolean,35000)
  check('a cleanup timeout leaves an identity-free pending marker and sharing off',timeoutResult.error==='forget-incomplete'&&(await status()).purgePending&&(await status()).state==='disabled'&&!(await status()).reference)
  writeFileSync(fixture,'{}')
  check('retry after timeout waits for the previous cleanup worker to exit',(await ev('window.rased.analyticsConsent("forget")')).ok&&!(await status()).purgePending)
  for(const name of readdirSync(join(profile,'telemetry'))) check('timed-out identity absent after retry from '+name,!readFileSync(join(profile,'telemetry',name)).includes(Buffer.from(timedOutIdentity)))
  // Recovery from a failed purge is also automatic at the next app startup.
  await ev('window.rased.analyticsConsent("enable")'); writeFileSync(fixture,'{"purgeFail":true}')
  await ev('window.rased.analyticsConsent("forget")'); await stop()
  writeFileSync(fixture,'{}'); await boot()
  await eventually(async()=>!(await status()).purgePending,Boolean,15000)
  check('pending purge resumes after real process restart without enabling collection',(await status()).state==='disabled' && !(await status()).reference)
  console.log(`TELEMETRY E2E PASSED (${passed} assertions). TEMP profile: ${profile}`)
} catch (error) { console.error(error); console.error('Retained TEMP profile:', profile); process.exitCode = 1 }
finally { if (child) await stopApp(child) }
