// Real Electron/preload/SQLite/React end-to-end verification for project watch.
// Isolated TEMP profiles, synthetic public pages only, zero network requests.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, persistentSession, sleep, startApp, stopApp, electronPath } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2))
const profile = newProfile(args.profile)
const profilesToClean = [profile]
const port = Number(args.port ?? 9495)
const exe = args.exe ?? electronPath()
const app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
const output = resolve('.local/project-watch-2026-11-11/mock')
mkdirSync(output, { recursive: true })

let child = null
let ws = null
let session = null
let storage = null
let capturedOutput = ''
let checks = 0
const startTime = Date.now()

const check = (label, condition, detail = '') => {
  assert.ok(condition, `${label}: ${detail}`)
  checks++
  console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`)
}

const ev = expr => evaluate(ws, expr)
const wait = expr => eventually(() => ev(expr))
const nav = async hash => {
  await ev(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(150)
}

const traces = () => {
  const file = join(profile, 'test-trace.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(s => JSON.parse(s))
}

function getActivation(db, toastXml) {
  const token = toastXml?.match(/intent=open-project(?:&amp;|&)ticket=([a-f0-9]{32})/)?.[1]
  if (!token || !db) return null
  return db.prepare('SELECT url, project_id, origin FROM notification_activations WHERE token_hash=?')
    .get(createHash('sha256').update(token).digest('hex')) ?? null
}

function isWatchToast(t) {
  if (t.kind !== 'toast') return false
  const body = t.data?.body || ''
  const title = t.data?.title || ''
  if (body.includes('يتواصل') || body.includes('التنفيذ') || body.includes('اكتمل') || title.includes('حصل وأنت غايب') || title.includes('تغييرات في')) return true
  if (storage) {
    const act = getActivation(storage, t.data?.toastXml)
    if (act?.origin === 'watch_notification') return true
  }
  return false
}

async function setWatchState(id, want) {
  const row = storage.prepare('SELECT version FROM project_watch WHERE project_id = ?').get(id)
  const expectVersion = row ? row.version : null
  return await ev(`window.rased.watchSet({ projectId: ${id}, want: ${JSON.stringify(want)}, expectVersion: ${JSON.stringify(expectVersion)}, entry: 'list' })`)
}

async function testConsentGate() {
  const consentProfile = newProfile()
  profilesToClean.push(consentProfile)
  const consentPort = port + 1
  writeFileSync(join(consentProfile, 'telemetry-fixture.json'), JSON.stringify({ flush: false }))
  initDatabase(consentProfile)
  const consentChild = startApp({ exe, app, profile: consentProfile, port: consentPort })
  let consentWs = null
  try {
    consentWs = await pageWs(consentPort, undefined, 30000)
    await eventually(() => evaluate(consentWs, '!!window.rased'), Boolean, 30000)
    await eventually(() => evaluate(consentWs, 'window.rased.getAnalyticsStatus()'), Boolean, 30000)

    const analyticsStatus = await evaluate(consentWs, 'window.rased.getAnalyticsStatus()')
    assert.equal(analyticsStatus?.accessAllowed, false, 'getAnalyticsStatus().accessAllowed must be false')

    const watchSetResult = await evaluate(consentWs, "window.rased.watchSet({ projectId: 1, want: 'on', expectVersion: null, entry: 'list' })")
    assert.equal(watchSetResult?.ok, false, 'watchSet must return ok: false')

    await stopApp(consentChild)
    await sleep(200)

    const consentDb = new DatabaseSync(join(consentProfile, 'rased.db'))
    const watchRow = consentDb.prepare('SELECT * FROM project_watch WHERE project_id = 1').get()
    consentDb.close()
    assert.equal(watchRow, undefined, 'no project_watch row should exist in database')

    const traceFile = join(consentProfile, 'test-trace.jsonl')
    const traceLines = existsSync(traceFile) ? readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
    const watchFetchRecorded = traceLines.some(t => t.kind === 'fetch' && String(t.data).includes('/project/'))
    assert.equal(watchFetchRecorded, false, 'no fetch of a watch URL should be recorded in trace')

    check('Consent gate: unaccepted onboarding blocks watchSet, writes no DB row, and fetches zero watch URLs', true)
  } finally {
    if (consentChild && consentChild.exitCode === null) await stopApp(consentChild)
  }
}

// ------------------------------------------------------------------ DB Seed
function initDatabase(profileDir) {
  const schema = readFileSync('src/storage/migrations.ts', 'utf8')
  const db = new DatabaseSync(join(profileDir, 'rased.db'))
  for (const match of schema.matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)) db.exec(match[1])
  db.exec(`PRAGMA user_version=${[...schema.matchAll(/\/\* \d+ \*\/ `/g)].length}; PRAGMA foreign_keys=ON;`)

  const stamp = new Date().toISOString()
  for (const s of ['mostaql', 'nafezly', 'kaf']) {
    db.prepare(`INSERT INTO source_state(source,baseline_complete,last_success_at,consecutive_failures) VALUES (?,1,?,0)`).run(s, stamp)
  }

  const initialSettings = {
    language: 'ar',
    mostaqlEnabled: true,
    nafezlyEnabled: true,
    kafEnabled: true,
    khamsatEnabled: true,
    notificationsEnabled: true,
    mostaqlNotificationsEnabled: true,
    nafezlyNotificationsEnabled: true,
    kafNotificationsEnabled: true,
    watchNotifyStatus: true,
    watchNotifyContactSure: true,
    watchNotifyContactMaybe: true,
    ui: { previewOpen: false, previewRatio: 0.35, textScale: 100 }
  }
  db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify(initialSettings))

  const insertProject = db.prepare(`
    INSERT INTO projects (
      id, source, external_id, url, title, description_excerpt,
      first_seen_at, last_seen_at, discovery_kind, created_at, updated_at,
      category_slug, category_confirmed, budget_min, budget_max, enrichment_status,
      platform_status
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, 'initial', ?, ?,
      'development', 1, 100, 200, 'ready',
      ?
    )
  `)
  const insertDetail = db.prepare(`
    INSERT INTO project_details (project_id, description_text, provenance, fetched_at, status)
    VALUES (?, 'Synthetic test project description', 'full', ?, 'ready')
  `)

  // Khamsat project 50
  insertProject.run(50, 'khamsat', '50001', 'https://khamsat.com/community/requests/50001-khamsat-50', 'طلب خمسات ٥٠', 'وصف تجريبي', new Date(Date.now() - 300000).toISOString(), stamp, stamp, stamp, null)
  insertDetail.run(50, stamp)

  // KAF projects 30..41
  for (let i = 30; i <= 41; i++) {
    const ext = String(30000 + i)
    const itemStamp = new Date(Date.now() - 200000 + i * 1000).toISOString()
    insertProject.run(i, 'kaf', ext, `https://kafiil.com/project/${ext}-kaf-${i}`, `مشروع كاف ${i}`, 'وصف تجريبي', itemStamp, itemStamp, itemStamp, itemStamp, 'open')
    insertDetail.run(i, stamp)
  }

  // Nafezly projects 20..26
  for (let i = 20; i <= 26; i++) {
    const ext = String(20000 + i)
    const itemStamp = new Date(Date.now() - 100000 + i * 1000).toISOString()
    insertProject.run(i, 'nafezly', ext, `https://nafezly.com/project/${ext}-nafezly-${i}`, `مشروع نفذلي ${i}`, 'وصف تجريبي', itemStamp, itemStamp, itemStamp, itemStamp, null)
    insertDetail.run(i, stamp)
  }

  // Mostaql projects 1..18 (most recent timestamps in the past so timeAgo returns 'الآن')
  for (let i = 1; i <= 18; i++) {
    const ext = String(10000 + i)
    const itemStamp = new Date(Date.now() - 50000 + i * 1000).toISOString()
    insertProject.run(i, 'mostaql', ext, `https://mostaql.com/go/${ext}`, `مشروع مستقل ${i}`, 'وصف تجريبي', itemStamp, itemStamp, itemStamp, itemStamp, null)
    insertDetail.run(i, stamp)
  }

  db.close()
}

// ------------------------------------------------------------------ Fixtures & Harness
const rawMostaqlSure = readFileSync('tests/fixtures/watch/mostaql-open-sure.html', 'utf8')
const rawNafezlyOpen = readFileSync('tests/fixtures/watch/nafezly-open.html', 'utf8')
const rawKafOpen = readFileSync('tests/fixtures/watch/kaf-open.html', 'utf8')
const rawKafCompleted = readFileSync('tests/fixtures/watch/kaf-completed.html', 'utf8')
const rawNafezlyPrivate403 = readFileSync('tests/fixtures/watch/nafezly-private-403.html', 'utf8')
const rawMostaqlGone = readFileSync('tests/fixtures/watch/mostaql-gone-redirect.html', 'utf8')

// Mostaql baseline: open, clientOpen=1, inProgress=0, contacts=0, offers=7
const mostaqlBaseHtml = rawMostaqlSure.replace(/(التواصلات الجارية[\s\S]*?<td>)\d+(<\/td>)/, (_, g1, g2) => g1 + '0' + g2)
// Mostaql offers only: contacts=0, offers=8
const mostaqlOffersOnlyHtml = mostaqlBaseHtml.replace(/id="bid9000007" data-context="default"><div class="bid-inner clearfix"><\/div><\/div>/, 'id="bid9000007" data-context="default"><div class="bid-inner clearfix"></div></div>\n<div class="bid list-group-item pdn--vm " data-bid-item="9000008" id="bid9000008" data-context="default"><div class="bid-inner clearfix"></div></div>')
// Mostaql sure: contacts=1, clientOpen=1, inProgress=0
const mostaqlSureHtml = rawMostaqlSure
// Mostaql maybe: contacts=1, clientOpen=3, inProgress=0
const mostaqlMaybeHtml = rawMostaqlSure.replace(/(>المشاريع المفتوحة<\/span><\/td>\s*<td>)\d+(<\/td>)/, (_, g1, g2) => g1 + '3' + g2)
// Mostaql maybe baseline: contacts=0, clientOpen=3, inProgress=0
const mostaqlMaybeBaseHtml = mostaqlMaybeHtml.replace(/(التواصلات الجارية[\s\S]*?<td>)\d+(<\/td>)/, (_, g1, g2) => g1 + '0' + g2)

// Nafezly in_progress
const nafezlyInProgressHtml = rawNafezlyOpen.replace(/مفتوح/, 'قيد التنفيذ')

// Write fixtures to profile
writeFileSync(join(profile, 'mostaql-base.html'), mostaqlBaseHtml)
writeFileSync(join(profile, 'mostaql-offers.html'), mostaqlOffersOnlyHtml)
writeFileSync(join(profile, 'mostaql-sure.html'), mostaqlSureHtml)
writeFileSync(join(profile, 'mostaql-maybe-base.html'), mostaqlMaybeBaseHtml)
writeFileSync(join(profile, 'mostaql-maybe.html'), mostaqlMaybeHtml)
writeFileSync(join(profile, 'mostaql-gone.html'), rawMostaqlGone)
writeFileSync(join(profile, 'nafezly-base.html'), rawNafezlyOpen)
writeFileSync(join(profile, 'nafezly-in-progress.html'), nafezlyInProgressHtml)
writeFileSync(join(profile, 'nafezly-private-403.html'), rawNafezlyPrivate403)
writeFileSync(join(profile, 'kaf-base.html'), rawKafOpen)
writeFileSync(join(profile, 'kaf-completed.html'), rawKafCompleted)

// Initial watch pages routing
const watchPages = {
  'https://mostaql.com/projects': { status: 200, file: 'mostaql-gone.html' },
  'https://mostaql.com/project/10003-mostaql-3': { status: 302, location: 'https://mostaql.com/projects' },
  'https://nafezly.com/project/20021-nafezly-21': { status: 403, file: 'nafezly-private-403.html' },
  'https://nafezly.com/project/20022-nafezly-22': { status: 403 }
}
// Real Mostaql rows are stored as /go/<id> (from the RSS feed); the site answers with a 301 to the slugged project page.
for (let i = 1; i <= 18; i++) {
  watchPages[`https://mostaql.com/go/${10000 + i}`] = { status: 301, location: `https://mostaql.com/project/${10000 + i}-mostaql-${i}` }
}
for (let i = 1; i <= 18; i++) {
  const url = `https://mostaql.com/project/${10000 + i}-mostaql-${i}`
  if (!watchPages[url]) watchPages[url] = { status: 200, file: (i === 5 ? 'mostaql-maybe-base.html' : 'mostaql-base.html') }
}
for (let i = 20; i <= 26; i++) {
  const url = `https://nafezly.com/project/${20000 + i}-nafezly-${i}`
  if (!watchPages[url]) watchPages[url] = { status: 200, file: 'nafezly-base.html' }
}
for (let i = 30; i <= 41; i++) {
  const url = `https://kafiil.com/project/${30000 + i}-kaf-${i}`
  if (!watchPages[url]) watchPages[url] = { status: 200, file: 'kaf-base.html' }
}
const writeWatchPages = wp => writeFileSync(join(profile, 'watch-pages.json'), JSON.stringify(wp, null, 2))
writeWatchPages(watchPages)

// RSS/list feed fallbacks with un-watched synthetic items so collectors stay healthy without overwriting watched URLs
const nowUtc = new Date().toUTCString()
writeFileSync(join(profile, 'rss-fixture.xml'), `<rss version="2.0"><channel><title>Mostaql</title><item><title>مشروع مستقل غير متابع</title><link>https://mostaql.com/go/99999</link><description>وصف تجريبي</description><pubDate>${nowUtc}</pubDate></item></channel></rss>`)
writeFileSync(join(profile, 'nafezly-fixture.xml'), `<rss version="2.0"><channel><title>Nafezly.com | نفذلي</title><item><title>مشروع نفذلي غير متابع</title><link>https://nafezly.com/project/99999-nafezly-99</link><description>وصف تجريبي</description><pubDate>${nowUtc}</pubDate></item></channel></rss>`)
writeFileSync(join(profile, 'khamsat-fixture.html'), `<table id="forums_table"><tbody><tr id="forum_post-99999"><td><h3 class="details-head"><a href="/community/requests/99999-khamsat-99">طلب خمسات غير متابع</a></h3><span title="${nowUtc}">date</span></td></tr></tbody></table>`)
writeFileSync(join(profile, 'kaf-list-1.html'), '<div id="projects"><div class="project-box"><a href="https://kafiil.com/project/99999-sample">مشروع كاف غير متابع<span class="tag">مفتوح</span></a><span><i class="far fa-clock"></i>منذ دقيقة</span><p class="price">$25 - $50</p><p class="info-content">Synthetic</p></div></div>')
writeFileSync(join(profile, 'kaf-detail.html'), readFileSync('tests/fixtures/kaf-detail.html', 'utf8'))
writeFileSync(join(profile, 'detail-fixture.html'), `<html><body>تفاصيل تجريبية</body></html>`)

async function bootApp() {
  child = startApp({ exe, app, profile, port, captureOutput: true })
  child.stdout.on('data', chunk => { capturedOutput += chunk.toString() })
  child.stderr.on('data', chunk => { capturedOutput += chunk.toString() })
  ws = await pageWs(port)
  await wait('!!window.rased && (!!document.querySelector(".app") || !!document.querySelector(".splash-enter"))')
  await ev('document.querySelector(".splash-enter")?.click()')
  await wait('!!document.querySelector(".app")')
}

// ------------------------------------------------------------------ Execution
try {
  await testConsentGate()
  initDatabase(profile)
  await bootApp()
  storage = new DatabaseSync(join(profile, 'rased.db'))

  // ================================================================
  // a. Button visibility, toggle, Khamsat absence, keyboard Enter/Space
  // ================================================================
  await nav('#/')
  await wait('document.querySelectorAll("[data-row]").length >= 4')

  const khamsatCheck = await ev(`(()=>{
    const row = document.querySelector('[data-row="50"]')
    if (!row) return { exists: false, visible: false, hasWatch: false }
    const rect = row.getBoundingClientRect()
    return {
      exists: true,
      visible: rect.width > 0 && rect.height > 0,
      hasWatch: !!row.querySelector('button[aria-label*="متابعة"]')
    }
  })()`)
  assert.ok(khamsatCheck.exists, 'Khamsat row must exist')
  assert.ok(khamsatCheck.visible, 'Khamsat row must be visible')
  assert.ok(!khamsatCheck.hasWatch, 'Khamsat row must NOT have a Watch button')

  const buttonOrder = await ev(`(()=>{
    const checkSource = id => {
      const row = document.querySelector(\`[data-row="\${id}"]\`)
      if (!row) return false
      const prev = row.querySelector('.preview-action')
      const watch = row.querySelector('button[aria-label*="متابعة"]')
      if (!prev || !watch) return false
      return prev.compareDocumentPosition(watch) === Node.DOCUMENT_POSITION_FOLLOWING
    }
    return checkSource(1) && checkSource(20) && checkSource(30)
  })()`)
  check('Button: «متابعة» visible after «معاينة» on Mostaql, Nafezly and KAF rows; absent on a Khamsat row', buttonOrder && khamsatCheck.visible && !khamsatCheck.hasWatch)

  // Click Mostaql project 1 Watch button -> turns active (watch-on, aria-pressed true)
  await ev('document.querySelector(\'[data-row="1"] button[aria-label*="متابعة"]\').click()')
  await eventually(async () => {
    return await ev(`(()=>{
      const btn = document.querySelector('[data-row="1"] button[aria-pressed]')
      return btn && btn.getAttribute('aria-pressed') === 'true' && btn.textContent.includes('تحت المتابعة')
    })()`)
  })
  check('Button: click toggles to «تحت المتابعة ✓» with aria-pressed true', true)

  // Click again -> turns off (متابعة, aria-pressed false)
  await ev('document.querySelector(\'[data-row="1"] button[aria-pressed]\').click()')
  await eventually(async () => {
    return await ev(`(()=>{
      const btn = document.querySelector('[data-row="1"] button[aria-label*="متابعة"]')
      return btn && btn.getAttribute('aria-pressed') === 'false' && btn.textContent.includes('متابعة') && !btn.textContent.includes('تحت')
    })()`)
  })
  check('Button: click again toggles back to «متابعة» with aria-pressed false', true)

  // Keyboard Enter toggles button and does NOT open preview
  await ev('document.querySelector(\'[data-row="1"] button[aria-label*="متابعة"]\').focus()')
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await eventually(async () => {
    return await ev(`document.querySelector('[data-row="1"] button[aria-pressed]')?.getAttribute('aria-pressed') === 'true'`)
  })
  const previewOpenAfterEnter = await ev('!!document.querySelector(".preview-pane")')
  check('Button: keyboard Enter on the button toggles it and does NOT open preview', !previewOpenAfterEnter)

  // Keyboard Space toggles button back and does NOT open preview
  await ev('document.querySelector(\'[data-row="1"] button[aria-pressed]\').focus()')
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' })
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await eventually(async () => {
    return await ev(`document.querySelector('[data-row="1"] button[aria-pressed]')?.getAttribute('aria-pressed') === 'false'`)
  })
  const previewOpenAfterSpace = await ev('!!document.querySelector(".preview-pane")')
  check('Button: keyboard Space on the button toggles it and does NOT open preview', !previewOpenAfterSpace)

  // ================================================================
  // l. Layout: Arabic RTL & English LTR at 900px, 125% text; compact 280px
  // ================================================================
  session = await persistentSession(ws)
  for (const lang of ['ar', 'en']) {
    await ev(`(async()=>{
      const s = await window.rased.getSettings()
      await window.rased.updateSettings({ language: ${JSON.stringify(lang)}, ui: { ...s.ui, textScale: 125 } })
    })()`)
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false })
    await sleep(250)

    // Row with Watch button: no horizontal overflow
    await nav('#/')
    await wait('document.querySelectorAll("[data-row]").length >= 4')
    const rowNoOverflow = await ev('document.body.scrollWidth <= innerWidth && [...document.querySelectorAll(".opportunity-row")].every(r => r.scrollWidth <= r.clientWidth + 2)')
    check(`Layout (${lang}): no horizontal overflow in row with Watch button at 900px 125% text`, rowNoOverflow)

    // Watched projects screen: no horizontal overflow
    await nav('#/watching')
    await wait('!!document.querySelector(".watching-view")')
    const screenNoOverflow = await ev('document.body.scrollWidth <= innerWidth && document.querySelector(".watching-view").scrollWidth <= document.querySelector(".watching-view").clientWidth + 2')
    check(`Layout (${lang}): no horizontal overflow on watched projects screen at 900px 125% text`, screenNoOverflow)
  }

  // Reset to Arabic and textScale 100 for remaining logic
  await ev(`(async()=>{
    const s = await window.rased.getSettings()
    await window.rased.updateSettings({ language: 'ar', ui: { ...s.ui, textScale: 100 } })
  })()`)
  await session.call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await sleep(200)

  // ================================================================
  // c. Limit: 10 watches on one platform, 11th waiting, limit dialog,
  //    Escape closes only dialog (preview stays), Swap picker, victim stopped replaced
  // ================================================================
  await nav('#/')
  // Activate 10 watches on Mostaql (projects 1..10)
  for (let id = 1; id <= 10; id++) {
    await setWatchState(id, 'on')
  }

  // Open preview on project 11
  await ev('document.querySelector(\'[data-row="11"] .preview-action\')?.click() || document.querySelector(\'[data-row="11"] .project-title-button\')?.click()')
  await wait('document.querySelector(".preview-pane h2")?.textContent?.includes("مستقل 11")')

  // Click Watch on project 11 (the 11th on Mostaql) -> opens limit dialog
  await ev('document.querySelector(".preview-pane button[aria-pressed]:not(.icon-btn)")?.click()')
  await wait('!!document.querySelector(".dialog[role=dialog]")')

  // Limit dialog opens with "انتظر مكانًا" focused
  const waitFocused = await ev(`(()=>{
    const el = document.activeElement
    return el && el.textContent.includes('انتظر مكانًا')
  })()`)
  check('Limit: start 10 watches on one platform, the 11th opens limit dialog with «انتظر مكانًا» focused', waitFocused)

  // Project 11 state is waiting
  const p11StateWaiting = storage.prepare('SELECT state FROM project_watch WHERE project_id = 11').get()?.state === 'waiting'
  check('Limit: 11th project state is «بانتظار مكان» (waiting)', p11StateWaiting)

  // Verify limit dialog AND picker dialog overflow at 900px, 125% text, in both Arabic and English
  await ev('(async()=>{ const s = await window.rased.getSettings(); await window.rased.updateSettings({ ui: { ...s.ui, textScale: 125 } }) })()')
  await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false })
  await sleep(150)

  const limitNoOverflowAr = await ev('document.querySelector(".dialog[role=dialog]").scrollWidth <= document.querySelector(".dialog[role=dialog]").clientWidth + 2')
  check('Layout (ar): limit dialog fits 900px at 125% text without overflow', limitNoOverflowAr)

  await ev('window.rased.updateSettings({ language: "en" })')
  await sleep(150)
  const limitNoOverflowEn = await ev('document.querySelector(".dialog[role=dialog]").scrollWidth <= document.querySelector(".dialog[role=dialog]").clientWidth + 2')
  check('Layout (en): limit dialog fits 900px at 125% text without overflow', limitNoOverflowEn)

  // Click "Swap with another project" -> opens replacement picker
  await ev('Array.from(document.querySelectorAll(".dialog button")).find(b => b.textContent.includes("Swap")).click()')
  await wait('!!document.querySelector(".watch-replace-list")')

  const pickerNoOverflowEn = await ev('document.querySelector(".dialog[role=dialog]").scrollWidth <= document.querySelector(".dialog[role=dialog]").clientWidth + 2')
  check('Layout (en): picker dialog fits 900px at 125% text without overflow', pickerNoOverflowEn)

  await ev('window.rased.updateSettings({ language: "ar" })')
  await sleep(150)
  const pickerNoOverflowAr = await ev('document.querySelector(".dialog[role=dialog]").scrollWidth <= document.querySelector(".dialog[role=dialog]").clientWidth + 2')
  check('Layout (ar): picker dialog fits 900px at 125% text without overflow', pickerNoOverflowAr)

  // Reset text scale and window size
  await ev('(async()=>{ const s = await window.rased.getSettings(); await window.rased.updateSettings({ ui: { ...s.ui, textScale: 100 } }) })()')
  await session.call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await sleep(150)

  // Cancel picker -> keeps project 11 waiting
  await ev('Array.from(document.querySelectorAll(".dialog button")).find(b => b.textContent.includes("إلغاء")).click()')
  await wait('!document.querySelector(".dialog[role=dialog]")')
  const stillWaitingAfterCancel = storage.prepare('SELECT state FROM project_watch WHERE project_id = 11').get()?.state === 'waiting'
  check('Limit: cancelling the picker keeps the project waiting', stillWaitingAfterCancel)

  // Open preview on project 12 to test Escape
  await ev('document.querySelector(\'[data-row="12"] .preview-action\')?.click() || document.querySelector(\'[data-row="12"] .project-title-button\')?.click()')
  await wait('document.querySelector(".preview-pane h2")?.textContent?.includes("مستقل 12")')

  // Click Watch on project 12 -> opens limit dialog
  await ev('document.querySelector(".preview-pane button[aria-pressed]:not(.icon-btn)")?.click()')
  await wait('!!document.querySelector(".dialog[role=dialog]")')

  // Press Escape -> limit dialog closes, preview stays open, focus returns exactly to Watch button
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait('!document.querySelector(".dialog[role=dialog]")')

  const previewStaysOpen = await ev('!!document.querySelector(".preview-pane")')
  const watchButtonFocusedAfterEsc = await ev('document.activeElement === document.querySelector(".preview-pane button[aria-pressed]:not(.icon-btn)")')
  assert.ok(previewStaysOpen, 'preview must stay open after Escape')
  assert.ok(watchButtonFocusedAfterEsc, 'activeElement after Escape must be exactly the preview Watch button')
  check('Limit: Escape closes only the dialog (preview stays open) and returns focus to Watch button', previewStaysOpen && watchButtonFocusedAfterEsc)

  // Open preview on project 13
  await ev('document.querySelector(\'[data-row="13"] .preview-action\')?.click() || document.querySelector(\'[data-row="13"] .project-title-button\')?.click()')
  await wait('document.querySelector(".preview-pane h2")?.textContent?.includes("مستقل 13")')

  // Click Watch on project 13 -> opens limit dialog
  await ev('document.querySelector(".preview-pane button[aria-pressed]:not(.icon-btn)")?.click()')
  await wait('!!document.querySelector(".dialog[role=dialog]")')

  // Click "بدّل بمشروع آخر" -> opens replacement picker
  await ev('Array.from(document.querySelectorAll(".dialog button")).find(b => b.textContent.includes("بدّل بمشروع")).click()')
  await wait('!!document.querySelector(".watch-replace-list")')

  // Select project 2 radio
  await ev('document.querySelector("#replace-victim-2")?.click() || document.querySelector("label[for=\'replace-victim-2\']")?.click()')
  // Click Swap button
  await ev('Array.from(document.querySelectorAll(".dialog button")).find(b => b.textContent === "بدّل" && !b.disabled)?.click()')
  await wait('!document.querySelector(".dialog[role=dialog]")')

  // Target project 13 is now active; victim project 2 is stopped with stopReason 'replaced'
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 13').get()?.state === 'active')
  const p13Row = storage.prepare('SELECT state FROM project_watch WHERE project_id = 13').get()
  const p2Row = storage.prepare('SELECT state, stop_reason FROM project_watch WHERE project_id = 2').get()
  check('Limit: swap activates target (13) and stops victim (2) with reason replaced', p13Row?.state === 'active' && p2Row?.state === 'stopped' && p2Row?.stop_reason === 'replaced')

  // Close preview pane
  await ev('document.querySelector(".preview-pane button[aria-label*=\'إغلاق\'], .preview-pane .icon-btn")?.click()')
  await sleep(150)

  // Compact window layout test
  await session.call('Emulation.setDeviceMetricsOverride', { width: 280, height: 600, deviceScaleFactor: 1, mobile: false })
  await nav('#/compact')
  await wait('!!document.querySelector(".compact")')

  const compactCheck = await ev(`(()=>{
    const isWatch = b => /متابعة|بانتظار مكان|Watch|Waiting for a slot/.test(b.getAttribute("aria-label") || "")
    const watchBtn = [...document.querySelectorAll(".compact button[aria-pressed]")].find(isWatch)
    if (!watchBtn) return { found: false }
    const meta = watchBtn.closest(".meta")
    const sibling = meta ? [...meta.querySelectorAll("button")].find(b => b !== watchBtn && !isWatch(b)) : null
    if (!sibling) return { found: true, sibling: false }
    const iconOnly = watchBtn.textContent.trim() === "" && !!watchBtn.querySelector("svg")
    const watchRect = watchBtn.getBoundingClientRect()
    const siblingRect = sibling.getBoundingClientRect()
    const sameLine = Math.abs(watchRect.top - siblingRect.top) <= 2
    const noOverflow = document.body.scrollWidth <= innerWidth
    return { found: true, sibling: true, iconOnly, sameLine, noOverflow }
  })()`)
  assert.ok(compactCheck.found, 'Compact Watch button must exist')
  assert.ok(compactCheck.sibling, 'Compact Watch button must have a distinct sibling button in its row')
  assert.ok(compactCheck.iconOnly, 'Compact Watch button must be icon-only')
  assert.ok(compactCheck.sameLine, 'Compact Watch button must not wrap onto another line')
  assert.ok(compactCheck.noOverflow, 'Compact window must not overflow horizontally')
  check('Layout: compact window at minimum width (280px) shows icon-only Watch button without wrapping', compactCheck.found && compactCheck.sibling && compactCheck.iconOnly && compactCheck.sameLine && compactCheck.noOverflow)

  await session.call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await nav('#/')

  // ================================================================
  // d. Auto start: personal status «قدّمت» -> auto_submitted;
  //    «تجاهل» -> stopped 'ignored' and promotes oldest waiting one
  // ================================================================
  // Stop project 13 so oldest waiting (project 11) gets promoted to active
  await setWatchState(13, 'off')
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 11').get()?.state === 'active')

  // Stop project 11 so oldest waiting (project 12) gets promoted to active
  await setWatchState(11, 'off')
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 12').get()?.state === 'active')

  // Stop project 12 so there is 1 free slot (active: 1, 3..10 = 9 active)
  await setWatchState(12, 'off')

  // Now set project 14 personal status to 'submitted'
  await ev('window.rased.updateProjectUserState(14, { status: "submitted" })')
  await eventually(() => storage.prepare('SELECT state, origin FROM project_watch WHERE project_id = 14').get()?.state === 'active')
  const p14Watch = storage.prepare('SELECT state, origin FROM project_watch WHERE project_id = 14').get()
  check('Auto start: setting personal status to «قدّمت» starts watching with origin auto_submitted', p14Watch?.state === 'active' && p14Watch?.origin === 'auto_submitted')

  // Put TWO projects into waiting: 15 and 16 with different waiting_since
  await setWatchState(15, 'on')
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 15').get()?.state === 'waiting')
  storage.prepare("UPDATE project_watch SET waiting_since = '2026-11-14T10:00:00.000Z' WHERE project_id = 15").run()

  await setWatchState(16, 'on')
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 16').get()?.state === 'waiting')
  storage.prepare("UPDATE project_watch SET waiting_since = '2026-11-14T11:00:00.000Z' WHERE project_id = 16").run()

  // Now set project 14 personal status to 'ignored' («تجاهل»)
  await ev('window.rased.updateProjectUserState(14, { status: "ignored" })')
  await eventually(() => storage.prepare('SELECT state, stop_reason FROM project_watch WHERE project_id = 14').get()?.state === 'stopped')
  const p14Stopped = storage.prepare('SELECT state, stop_reason FROM project_watch WHERE project_id = 14').get()
  assert.equal(p14Stopped?.stop_reason, 'ignored', 'project 14 stop_reason must be ignored')

  // Oldest waiting project 15 gets promoted to active, while project 16 remains waiting
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 15').get()?.state === 'active')
  const p15State = storage.prepare('SELECT state FROM project_watch WHERE project_id = 15').get()?.state
  const p16State = storage.prepare('SELECT state FROM project_watch WHERE project_id = 16').get()?.state
  assert.equal(p15State, 'active', 'older waiting project 15 must be promoted to active')
  assert.equal(p16State, 'waiting', 'younger waiting project 16 must remain waiting')
  check('Auto start: setting personal status to «تجاهل» stops watch (reason ignored) and promotes oldest waiting project', p14Stopped?.stop_reason === 'ignored' && p15State === 'active' && p16State === 'waiting')

  // ================================================================
  // e. Watched projects screen: sidebar item after «المحفوظة» with active count,
  //    three sections, per-platform «N / 10», stopped row with «تابع من جديد»,
  //    open project and press back preserves scroll position and focuses title
  // ================================================================
  await nav('#/')
  const sidebarCheck = await ev(`(()=>{
    const items = [...document.querySelectorAll(".sidebar .nav-btn")]
    const savedIdx = items.findIndex(el => el.textContent.includes('المحفوظة'))
    const watchIdx = items.findIndex(el => el.textContent.includes('متابعة المشاريع'))
    const watchItem = items[watchIdx]
    const badge = watchItem ? watchItem.querySelector('.count')?.textContent : null
    return watchIdx === savedIdx + 1 && Number(badge) > 0
  })()`)
  check('Watched projects screen: sidebar item «متابعة المشاريع» after «المحفوظة» with active count', sidebarCheck)

  // Navigate to #/watching
  await nav('#/watching')
  await wait('!!document.querySelector(".watching-view")')

  const sectionsRendered = await ev(`(()=>{
    const activeSec = document.querySelector('section[aria-label="تحت المتابعة"]')
    const stopSec = document.querySelector('section[aria-label="توقفت مؤخرًا"]')
    const counters = document.querySelectorAll('.watch-platform-counter')
    return !!activeSec && !!stopSec && counters.length === 3
  })()`)
  check('Watched projects screen: renders sections and per-platform «N / 10» counters', sectionsRendered)

  // Stopped row with «تابع من جديد»
  const stoppedWatchAgain = await ev(`(()=>{
    const stopSec = document.querySelector('section[aria-label="توقفت مؤخرًا"]')
    return !!stopSec && stopSec.textContent.includes('تابع من جديد')
  })()`)
  check('Watched projects screen: stopped row shows «تابع من جديد»', stoppedWatchAgain)

  // Open project from watching screen and go back -> scroll position & focus preserved
  await ev('document.querySelector(".watching-view").scrollTop = 150')
  await sleep(100)
  const storedScrollTop = await ev('document.querySelector(".watching-view").scrollTop')
  assert.ok(storedScrollTop > 0, `scrollTop must be non-zero, got ${storedScrollTop}`)

  const openedId = await ev(`(()=>{
    const btn = document.querySelector('.watching-view [data-watch-title]')
    const row = btn?.closest('[data-watch-project-id]')
    const id = row ? Number(row.dataset.watchProjectId) : null
    btn?.click()
    return id
  })()`)
  await wait('location.hash.startsWith("#/project/")')
  // Go back via detail Back button
  await ev('document.querySelector(".detail-article button.btn, .detail-wrap button.btn, button[title*=\'الرجوع\'], button[aria-label*=\'الرجوع\']")?.click()')
  await wait('!!document.querySelector(".watching-view")')
  await sleep(150)

  const isOpenedTitleFocused = await ev(`document.activeElement === document.querySelector('[data-watch-project-id="${openedId}"] [data-watch-title]')`)
  assert.ok(isOpenedTitleFocused, 'document.activeElement must be exactly the opened row title button')
  check('Watched projects screen: returning from project focuses opened row title button', isOpenedTitleFocused)

  const restoredScrollTop = await ev('document.querySelector(".watching-view")?.scrollTop')
  const scrollPreserved = Math.abs(restoredScrollTop - storedScrollTop) <= 2
  check('Watched projects screen: returning from project preserves scroll position within 2px', scrollPreserved)

  // ================================================================
  // b. Baseline silent check, then change Mostaql project page (sure),
  //    second Mostaql project (maybe with {k}), Nafezly in progress,
  //    KAF completed (stops 'closed'), offers changes alone (no toast),
  //    toast traces origin & activation pointing to right project
  // ================================================================
  // Clear other active Mostaql watches so slots are free and only targeted projects are active
  const activeBeforeB = storage.prepare("SELECT project_id FROM project_watch WHERE state IN ('active', 'waiting')").all()
  for (const r of activeBeforeB) {
    await setWatchState(r.project_id, 'off')
  }

  // Resume monitoring loops so gateOpen returns true for watch checks
  await ev('Promise.all([window.rased.resume(), window.rased.resumeNafezly(), window.rased.resumeKaf()])')

  // Activate Mostaql 1, Mostaql 5, Nafezly 20, KAF 30
  await setWatchState(1, 'on')
  await setWatchState(5, 'on')
  await setWatchState(20, 'on')
  await setWatchState(30, 'on')

  // Wait for baseline checks to run for all four
  await eventually(() => {
    const p1 = storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 1').get()
    const p5 = storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 5').get()
    const p20 = storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 20').get()
    const p30 = storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 30').get()
    return p1?.status_seen_at !== null && p5?.status_seen_at !== null && p20?.status_seen_at !== null && p30?.status_seen_at !== null
  }, Boolean, 35000)

  // Confirm baseline was silent (zero watch toasts)
  const baselineWatchToasts = traces().filter(isWatchToast)
  assert.equal(baselineWatchToasts.length, 0, 'baseline must produce zero watch toasts')
  check('First check is a silent baseline (no toast)', true)

  // Offers changes alone on Mostaql 1 -> no toast
  writeWatchPages({
    ...watchPages,
    'https://mostaql.com/project/10001-mostaql-1': { status: 200, file: 'mostaql-offers.html' }
  })
  // Wait for project 1 offers to update to 8 in database
  await eventually(() => storage.prepare('SELECT offers FROM project_watch WHERE project_id = 1').get()?.offers === 8, Boolean, 30000)
  const offersOnlyWatchToasts = traces().filter(isWatchToast)
  assert.equal(offersOnlyWatchToasts.length, 0, 'offers change alone must produce zero watch toasts')
  check('Offers changes alone -> no toast', true)

  // Change Mostaql 1 to raise contacts with clientOpen 1 and in-progress 0 -> sure toast
  writeWatchPages({
    ...watchPages,
    'https://mostaql.com/project/10001-mostaql-1': { status: 200, file: 'mostaql-sure.html' },
    'https://nafezly.com/project/20020-nafezly-20': { status: 200, file: 'nafezly-in-progress.html' },
    'https://kafiil.com/project/30030-kaf-30': { status: 200, file: 'kaf-completed.html' }
  })

  // Wait for sure toast on Mostaql 1
  await eventually(() => {
    return traces().some(t => t.kind === 'toast' && t.data?.body?.includes('العميل بدأ يتواصل مع مستقلين على هذا المشروع'))
  }, Boolean, 40000)
  const sureToasts = traces().filter(t => t.kind === 'toast' && t.data?.body?.includes('العميل بدأ يتواصل مع مستقلين على هذا المشروع'))
  assert.equal(sureToasts.length, 1, 'must have exactly 1 sure toast')
  check('Mostaql contacts raised with clientOpen 1 and in-progress 0 -> sure toast', true)

  // Wait for Nafezly status change toast
  await eventually(() => {
    return traces().some(t => t.kind === 'toast' && t.data?.body?.includes('المشروع دخل مرحلة التنفيذ'))
  }, Boolean, 40000)
  const inProgressToasts = traces().filter(t => t.kind === 'toast' && t.data?.body?.includes('المشروع دخل مرحلة التنفيذ'))
  assert.equal(inProgressToasts.length, 1, 'must have exactly 1 in progress toast')
  check('Nafezly status change to in progress -> «المشروع دخل مرحلة التنفيذ»', true)

  // Wait for KAF completed toast and stopReason 'closed'
  await eventually(() => {
    return traces().some(t => t.kind === 'toast' && t.data?.body?.includes('المشروع اكتمل — توقفت المتابعة'))
  }, Boolean, 40000)
  const completedToasts = traces().filter(t => t.kind === 'toast' && t.data?.body?.includes('المشروع اكتمل — توقفت المتابعة'))
  assert.equal(completedToasts.length, 1, 'must have exactly 1 completed toast')
  const kaf30StopReason = storage.prepare('SELECT stop_reason FROM project_watch WHERE project_id = 30').get()?.stop_reason
  check('KAF moving to completed -> completed text and watch stops (stop reason closed)', kaf30StopReason === 'closed')

  // Now change Mostaql 5 to raise contacts with clientOpen 3 -> maybe toast with {k}
  writeWatchPages({
    ...watchPages,
    'https://mostaql.com/project/10005-mostaql-5': { status: 200, file: 'mostaql-maybe.html' }
  })
  await eventually(() => {
    return traces().some(t => t.kind === 'toast' && t.data?.body?.includes('عنده 3 مشاريع مفتوحة، فقد يكون على هذا المشروع'))
  }, Boolean, 40000)
  const maybeToasts = traces().filter(t => t.kind === 'toast' && t.data?.body?.includes('عنده 3 مشاريع مفتوحة، فقد يكون على هذا المشروع'))
  assert.equal(maybeToasts.length, 1, 'must have exactly 1 maybe toast')
  check('Second Mostaql project with clientOpen 3 -> maybe toast with {k}', true)

  // Verify total watch toasts === 4
  const watchToasts = traces().filter(isWatchToast)
  assert.equal(watchToasts.length, 4, 'total watch toasts must be exactly 4')

  // Verify toast traces have activation pointing to the right project
  const p1Toast = sureToasts[0]
  const p20Toast = inProgressToasts[0]
  const p30Toast = completedToasts[0]
  const p5Toast = maybeToasts[0]

  const p1Act = getActivation(storage, p1Toast?.data?.toastXml)
  const p20Act = getActivation(storage, p20Toast?.data?.toastXml)
  const p30Act = getActivation(storage, p30Toast?.data?.toastXml)
  const p5Act = getActivation(storage, p5Toast?.data?.toastXml)

  assert.equal(p1Act?.project_id, 1, 'p1 activation project_id')
  assert.equal(p1Act?.origin, 'watch_notification', 'p1 activation origin')
  assert.equal(p20Act?.project_id, 20, 'p20 activation project_id')
  assert.equal(p20Act?.origin, 'watch_notification', 'p20 activation origin')
  assert.equal(p30Act?.project_id, 30, 'p30 activation project_id')
  assert.equal(p30Act?.origin, 'watch_notification', 'p30 activation origin')
  assert.equal(p5Act?.project_id, 5, 'p5 activation project_id')
  assert.equal(p5Act?.origin, 'watch_notification', 'p5 activation origin')

  check('Each toast trace has origin/activation pointing to the right project', true)

  // Clear watches from scenario b to keep subsequent source slots fast
  await setWatchState(1, 'off')
  await setWatchState(5, 'off')
  await setWatchState(20, 'off')

  // ================================================================
  // f. Block: Nafezly 403 non-private pauses platform, primary backoff,
  //    screen shows «متوقفة مؤقتًا لحماية الرصد». Private 403 stops 'gone'.
  // ================================================================
  // First test private 403 on Nafezly 21 -> stops gone, does not pause platform
  await setWatchState(21, 'on')
  await eventually(() => storage.prepare('SELECT stop_reason FROM project_watch WHERE project_id = 21').get()?.stop_reason === 'gone', Boolean, 20000)
  const nafezlySourceStateBefore = storage.prepare("SELECT paused_until FROM watch_source_state WHERE source = 'nafezly'").get()
  check('Nafezly private 403 stops watch with reason gone and does not pause platform', !nafezlySourceStateBefore || nafezlySourceStateBefore.paused_until === null)

  // Now test non-private 403 while Watched projects screen is OPEN (no navigation away/back)
  await nav('#/watching')
  await wait('!!document.querySelector(".watching-view")')
  const toastsBeforeBlock = traces().filter(isWatchToast).length

  await setWatchState(22, 'on')
  await eventually(async () => {
    return await ev('document.querySelector(".watch-platform-counters")?.textContent?.includes("متوقفة مؤقتًا لحماية الرصد")')
  }, Boolean, 25000)

  const nafezlyWss = storage.prepare("SELECT paused_until, needs_poll_success FROM watch_source_state WHERE source = 'nafezly'").get()
  assert.ok(nafezlyWss?.paused_until, 'nafezly must have paused_until')
  const pausedTime = Date.parse(nafezlyWss.paused_until)
  const now = Date.now()
  const pauseDurationValid = pausedTime >= now + 29 * 60 * 1000 && pausedTime <= now + 31 * 60 * 1000
  assert.ok(pauseDurationValid, `paused_until must be between now+29m and now+31m, got ${nafezlyWss.paused_until}`)

  const toastsAfterBlock = traces().filter(isWatchToast).length
  assert.equal(toastsAfterBlock, toastsBeforeBlock, 'zero toasts from the block')
  assert.equal(nafezlyWss.needs_poll_success, 1, 'nafezly watch must wait for a successful primary poll')
  const nafezlyPrimary = storage.prepare("SELECT backoff_until FROM source_state WHERE source = 'nafezly'").get()
  const primaryCooldown = !!nafezlyPrimary?.backoff_until && Date.parse(nafezlyPrimary.backoff_until) > Date.now()
  assert.ok(primaryCooldown, 'primary Nafezly monitoring must be in cooldown after the watch block')

  check('Block: Nafezly 403 non-private pauses platform for 30m, applies primary cooldown, and screen shows warning banner', pauseDurationValid && nafezlyWss.needs_poll_success === 1 && primaryCooldown && (toastsAfterBlock === toastsBeforeBlock))
  await setWatchState(22, 'off')

  // ================================================================
  // g. Mostaql removed project: 302 to /projects -> watch stops 'gone', no toast
  // ================================================================
  const watchToastsBeforeGone = traces().filter(isWatchToast).length
  await setWatchState(3, 'on')
  await eventually(() => storage.prepare('SELECT stop_reason FROM project_watch WHERE project_id = 3').get()?.stop_reason === 'gone', Boolean, 25000)
  const watchToastsAfterGone = traces().filter(isWatchToast).length
  assert.equal(watchToastsAfterGone, watchToastsBeforeGone, 'no toasts from removed project')
  check('Mostaql removed project: 302 to /projects followed by listing -> watch stops gone with no toast', true)

  // ================================================================
  // h. Disable platform in settings -> watches stop with 'source_disabled', no promotion
  // ================================================================
  // Start 10 active watches on KAF (projects 30..39) + 1 waiting watch (project 40)
  for (let id = 30; id <= 39; id++) {
    await setWatchState(id, 'on')
  }
  await setWatchState(40, 'on')
  await eventually(() => storage.prepare('SELECT state FROM project_watch WHERE project_id = 40').get()?.state === 'waiting', Boolean, 15000)

  // Disable KAF in settings
  await ev('window.rased.updateSettings({ kafEnabled: false })')
  await eventually(() => {
    const stoppedCount = storage.prepare("SELECT count(*) as c FROM project_watch pw JOIN projects p ON p.id = pw.project_id WHERE p.source = 'kaf' AND pw.state = 'stopped' AND pw.stop_reason = 'source_disabled'").get()?.c
    return stoppedCount === 11
  }, Boolean, 20000)

  const kafActiveCount = storage.prepare("SELECT count(*) as n FROM project_watch pw JOIN projects p ON p.id = pw.project_id WHERE p.source = 'kaf' AND pw.state = 'active'").get()?.n
  assert.equal(kafActiveCount, 0, 'all kaf watches must be stopped, 0 active')
  const kafWaitingCount = storage.prepare("SELECT count(*) as n FROM project_watch pw JOIN projects p ON p.id = pw.project_id WHERE p.source = 'kaf' AND pw.state = 'waiting'").get()?.n
  assert.equal(kafWaitingCount, 0, 'no kaf watches should remain waiting')
  check('Disable platform in settings -> its watches stop with source_disabled and no promotion', true)

  // Re-enable KAF
  await ev('window.rased.updateSettings({ kafEnabled: true })')

  // ================================================================
  // j. Do Not Disturb active -> change produces no toast, suppressed;
  //    after DND ends, not sent later
  // ================================================================
  const watchToastsBeforeDnd = traces().filter(isWatchToast).length
  await ev(`window.rased.updateSettings({ doNotDisturbUntil: new Date(Date.now() + 3600000).toISOString() })`)

  // Start watch on project 10
  await setWatchState(10, 'on')
  // Wait for baseline check
  await eventually(() => storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 10').get()?.status_seen_at !== null, Boolean, 20000)

  // Change page to trigger contact increase while in DND
  writeWatchPages({
    ...watchPages,
    'https://mostaql.com/project/10010-mostaql-10': { status: 200, file: 'mostaql-sure.html' }
  })

  // Wait for event to be generated and suppressed
  await eventually(() => {
    const evRow = storage.prepare('SELECT status FROM notification_events WHERE project_id = 10').get()
    return evRow && evRow.status === 'suppressed'
  }, Boolean, 25000)
  const watchToastsDuringDnd = traces().filter(isWatchToast).length
  assert.equal(watchToastsDuringDnd, watchToastsBeforeDnd, 'zero toasts during DND')
  check('Do Not Disturb: change produces no toast and is stored suppressed', true)

  // End DND
  const endDndStamp = new Date().toISOString()
  await ev('window.rased.updateSettings({ doNotDisturbUntil: null })')

  // Wait with eventually() for a further watch check of that source to complete past DND end time
  await eventually(() => {
    const p10 = storage.prepare('SELECT last_attempt_at, status_seen_at FROM project_watch WHERE project_id = 10').get()
    const checkTime = p10?.status_seen_at ?? p10?.last_attempt_at
    return checkTime && Date.parse(checkTime) >= Date.parse(endDndStamp)
  }, Boolean, 25000)

  const evAfterDnd = storage.prepare('SELECT status FROM notification_events WHERE project_id = 10').get()
  assert.equal(evAfterDnd?.status, 'suppressed', 'event must remain suppressed')
  const watchToastsAfterDnd = traces().filter(isWatchToast).length
  assert.equal(watchToastsAfterDnd, watchToastsBeforeDnd, 'zero toasts sent after DND ended')
  check('Do Not Disturb: after DND ends, suppressed event is not sent later', true)
  await setWatchState(10, 'off')

  // ================================================================
  // Setup 2 active watched projects for Scenario i (away restart):
  // Projects 7 and 8 on Mostaql
  // ================================================================
  const activeBeforeI = storage.prepare("SELECT project_id FROM project_watch WHERE state IN ('active', 'waiting')").all()
  for (const r of activeBeforeI) {
    if (r.project_id !== 7 && r.project_id !== 8) {
      await setWatchState(r.project_id, 'off')
    }
  }

  await setWatchState(7, 'on')
  await setWatchState(8, 'on')
  await eventually(() => {
    const p7 = storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 7').get()
    const p8 = storage.prepare('SELECT status_seen_at FROM project_watch WHERE project_id = 8').get()
    return p7?.status_seen_at !== null && p8?.status_seen_at !== null
  }, Boolean, 25000)

  // Stop App instance 1
  storage.close()
  storage = null
  session?.close()
  session = null
  await stopApp(child)
  child = null
  ws = null

  // ================================================================
  // i. Restart while away: 2 projects changed offline ->
  //    single away summary toast «حصل وأنت غايب: تغييرات في 2 مشاريع»
  // ================================================================
  const traceCountBeforeRestart = traces().length
  const restartTime = new Date().toISOString()

  // Update pages for both projects while app is closed
  writeWatchPages({
    ...watchPages,
    'https://mostaql.com/project/10007-mostaql-7': { status: 200, file: 'mostaql-sure.html' },
    'https://mostaql.com/project/10008-mostaql-8': { status: 200, file: 'mostaql-sure.html' }
  })

  // Start App instance 2
  await bootApp()
  storage = new DatabaseSync(join(profile, 'rased.db'))
  await ev('Promise.all([window.rased.resume(), window.rased.resumeNafezly(), window.rased.resumeKaf()])')

  // Wait for both projects' last check to be newer than restart time
  await eventually(() => {
    const p7 = storage.prepare('SELECT status_seen_at, last_attempt_at FROM project_watch WHERE project_id = 7').get()
    const p8 = storage.prepare('SELECT status_seen_at, last_attempt_at FROM project_watch WHERE project_id = 8').get()
    const t7 = p7?.status_seen_at ?? p7?.last_attempt_at
    const t8 = p8?.status_seen_at ?? p8?.last_attempt_at
    return t7 && t8 &&
      Date.parse(t7) >= Date.parse(restartTime) &&
      Date.parse(t8) >= Date.parse(restartTime)
  }, Boolean, 35000)

  // Wait for the away episode toast
  await eventually(() => {
    return traces().slice(traceCountBeforeRestart).some(t => t.kind === 'toast' && t.data?.title?.includes('حصل وأنت غايب: تغييرات في 2 مشاريع'))
  }, Boolean, 25000)

  // Wait across one more full watch slot cycle of those sources (10s)
  await sleep(11000)

  const afterRestartToasts = traces().slice(traceCountBeforeRestart).filter(isWatchToast)
  const awaySummaryToasts = afterRestartToasts.filter(t => t.data?.title?.includes('حصل وأنت غايب: تغييرات في 2 مشاريع'))
  const individualToasts = afterRestartToasts.filter(t => !t.data?.title?.includes('حصل وأنت غايب'))
  assert.equal(awaySummaryToasts.length, 1, 'must have exactly 1 away summary toast')
  assert.equal(individualToasts.length, 0, 'must have 0 individual toasts for away projects')
  check('Restart while away: changes produce ONE away summary toast and no individual toasts', true)

  await setWatchState(7, 'off')
  await setWatchState(8, 'off')

  // ================================================================
  // k. Quit while watch check is in flight -> clean exit, no late DB writes
  // ================================================================
  // Prepare project 6 with delayed watch page (20s delay)
  writeWatchPages({
    ...watchPages,
    'https://mostaql.com/project/10006-mostaql-6': { status: 200, delayMs: 20000, file: 'mostaql-base.html' }
  })
  const fetchesBeforeK = traces().filter(t => t.kind === 'fetch' && t.data.includes('/project/10006-')).length
  await setWatchState(6, 'on')

  // Wait for the fetch of project 6 to be recorded as in flight
  await eventually(() => {
    return traces().filter(t => t.kind === 'fetch' && t.data.includes('/project/10006-')).length > fetchesBeforeK
  }, Boolean, 25000)

  // Assert request is in flight and no result yet
  const rowInFlight = storage.prepare('SELECT last_attempt_at, failures, status_seen_at FROM project_watch WHERE project_id = 6').get()
  assert.equal(rowInFlight?.status_seen_at, null, 'request must still be in flight, no result yet')

  // Take snapshot of row and notification_events count just before quit
  const snapP6 = { ...rowInFlight }
  const snapEventsCount = storage.prepare('SELECT count(*) as c FROM notification_events').get()?.c ?? 0

  // Quit immediately while check is in flight
  const quitStart = Date.now()
  await ev('window.rased.confirmClose(true); true').catch(() => {})
  await eventually(() => child.exitCode, code => code !== null, 8000)
  const quitElapsed = Date.now() - quitStart
  assert.ok(quitElapsed < 8000, `quit took ${quitElapsed}ms, must exit well before 20s delay finishes`)
  assert.equal(child.exitCode, 0, 'child exitCode must be 0')
  child = null

  // Close live storage before inspecting database read-only
  storage?.close()
  storage = null

  // Verify clean shutdown, unchanged DB state, and no late writes
  const readOnlyDb = new DatabaseSync(join(profile, 'rased.db'), { readOnly: true })
  const p6AfterQuit = readOnlyDb.prepare('SELECT last_attempt_at, failures, status_seen_at FROM project_watch WHERE project_id = 6').get()
  const eventsAfterQuit = readOnlyDb.prepare('SELECT count(*) as c FROM notification_events').get()?.c ?? 0
  const uncaughtCount = readOnlyDb.prepare("SELECT count(*) as c FROM diagnostics WHERE status = 'uncaught'").get()?.c ?? 0
  readOnlyDb.close()

  assert.deepEqual({ ...p6AfterQuit }, { ...snapP6 }, 'project_watch row fields must be unchanged')
  assert.equal(eventsAfterQuit, snapEventsCount, 'notification_events count must be unchanged')
  assert.equal(uncaughtCount, 0, 'no uncaught diagnostics')

  // Assert captured stdout/stderr has no 'database is not open' and no uncaught error text
  assert.ok(!capturedOutput.toLowerCase().includes('database is not open'), 'captured output must not contain "database is not open"')
  assert.ok(!capturedOutput.toLowerCase().includes('uncaught'), 'captured output must not contain uncaught error')

  check('Quit while watch check is in flight: clean exit within 8s, unchanged DB state, no late writes or database-closed errors', true)

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nProject watch integration: ${checks} checks passed in ${durationSec}s.`)
} catch (error) {
  if (ws) console.error(await ev('document.body.innerText').catch(() => 'No renderer output'))
  throw error
} finally {
  session?.close()
  storage?.close()
  if (child) await stopApp(child)
  for (const p of profilesToClean) {
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors on exit
    }
  }
}
