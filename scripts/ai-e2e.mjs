// Real Electron, preload, React, Windows encryption and SQLite; synthetic API
// transport only, gated by testHarness's newly marked TEMP profile.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, sleep, startApp, stopApp } from './cdp-tools.mjs'

const profile = newProfile()
const port = 9377
const args = parseArgs(process.argv.slice(2))
const exe = args.exe ?? 'node_modules/electron/dist/electron.exe'
const app = args.app ?? (args.exe ? undefined : 'out/main/index.js')
const db = new DatabaseSync(join(profile, 'rased.db'))
const schema = readFileSync('src/storage/migrations.ts', 'utf8')
for (const match of schema.matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)) db.exec(match[1])
db.exec(`PRAGMA user_version=${[...schema.matchAll(/\/\* \d+ \*\/ `/g)].length};`)
db.exec("INSERT INTO projects(id,source,external_id,url,title,description_excerpt,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','900001','https://mostaql.com/go/900001','Synthetic integration project','Synthetic test description','2020','2020','initial','2020','2020'); INSERT INTO project_details VALUES(1,'Synthetic full description','full','2020','ready',NULL);")
db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({ khamsatEnabled: false, nafezlyEnabled: false }))
writeFileSync(join(profile, 'rss-fixture.xml'), '<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>')
let child, ws, passed = 0
const ev = expression => evaluate(ws, expression)
const wait = expression => eventually(() => ev(expression))
const check = (label, condition) => { assert.ok(condition, label); passed++; console.log('PASS ' + label) }
const nav = async hash => { await ev(`location.hash=${JSON.stringify(hash)}`); await sleep(200) }
const traces = () => existsSync(join(profile, 'test-trace.jsonl')) ? readFileSync(join(profile, 'test-trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : []
const click = async (pattern, selector = 'button') => {
  await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>new RegExp(${JSON.stringify(pattern)}).test(e.textContent));if(!b||b.disabled)throw Error('Missing/disabled button');b.click()})()`)
  await sleep(150)
}
const select = async (selector, value) => { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(150) }
const fill = async (selector, value) => {
  await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.setSelectionRange(0,e.value.length)})()`)
  await call(ws, 'Input.insertText', { text: value }); await sleep(150)
}
async function launch() {
  child = startApp({ exe, app, profile, port })
  ws = await pageWs(port)
  await wait('document.querySelector(".splash")?.dataset.phase==="ready"')
  await ev('document.querySelector(".splash-enter").click()')
  await wait('!!document.querySelector(".app")')
}
const providers = [['gemini', 'gemini-2.5-flash'], ['openai', 'gpt-4.1-mini'], ['anthropic', 'claude-sonnet-4-5']]
try {
  await launch()
  check('startup performs no AI requests', !traces().some(t => t.kind === 'ai-request'))
  for (const [provider, model] of providers) {
    await nav('#/settings/ai'); await wait('!!document.querySelector("#ai-provider") && !document.querySelector("#ai-provider").disabled')
    await select('#ai-provider', provider)
    await fill('#ai-key', 'fake-integration-' + provider + '-key')
    await click('حفظ المفتاح', '.proposal-settings button')
    await wait(`window.rased.getAiSetup().then(s=>s.providers.${provider}.keyReadable)`)
    const path = join(profile, 'ai-keys', provider + '.enc')
    check(provider + ' key is Windows encrypted and absent from SQLite', existsSync(path) && !readFileSync(path).includes('fake-integration-' + provider + '-key') && !readFileSync(join(profile, 'rased.db')).includes('fake-integration-' + provider + '-key'))
    await click('تحديث الموديلات', '.ai-picker button')
    await wait(`!!document.querySelector('#ai-model option[value="${model}"]')`)
    await select('#ai-model', model)
    const dirty = await ev('[...document.querySelectorAll(".proposal-settings button")].find(b=>b.textContent.includes("حفظ إعدادات المساعد"))?.disabled===false')
    if (dirty) await click('حفظ إعدادات المساعد', '.proposal-settings button')
    check(provider + ' default and catalog cross typed IPC', (await ev('window.rased.getAiSetup()')).settings.modelByProvider[provider] === model)
    await ev('window.confirm=()=>true') // only the explicit test-cost dialog
    await click('اختبار التوليد', '.proposal-settings button')
    await wait(`window.rased.getAiSetup().then(s=>s.providers.${provider}.verification?.model===${JSON.stringify(model)})`)
    check(provider + ' test uses synthetic data without a draft', traces().filter(t => t.kind === 'ai-request' && t.data.provider === provider && t.data.method === 'POST').at(-1)?.data.synthetic && !db.prepare('SELECT proposal FROM proposal_drafts WHERE project_id=1').get())
    await nav('#/proposal/1'); await wait('!!document.querySelector(".proposal-fields")')
    check(provider + ' preview names the recipient/model', await ev(`document.querySelector('.proposal-page').textContent.includes(${JSON.stringify(model)})`))
    await ev('document.querySelector(".proposal-consent input").click()')
    await click('توليد المسودة', '.proposal-card button'); await wait('!!document.querySelector(".proposal-editor")')
    check(provider + ' generation saves actual provider provenance', db.prepare('SELECT provider,model FROM proposal_drafts WHERE project_id=1').get().provider === provider)
    check(provider + ' consumed consent cannot trigger a second paid call', await ev('!document.querySelector(".proposal-consent input").checked'))
    await ev('window.rased.deleteProposalDraft(1)')
  }
  await nav('#/proposal/1'); await wait('!!document.querySelector(".proposal-fields")')
  const oldPreview = await ev('window.rased.getProposalPreview(1,"")')
  const count = traces().filter(t => t.kind === 'ai-request').length
  const mismatch = await ev(`window.rased.generateProposal(1,"",${JSON.stringify(oldPreview.fingerprint)},{provider:"openai",model:"gpt-4.1-mini"})`)
  check('changing target rejects stale consent without an API call', mismatch.error === 'preview-changed' && traces().filter(t => t.kind === 'ai-request').length === count)
  await ev('document.querySelector(".proposal-consent input").click()')
  await select('#ai-provider', 'openai')
  check('UI target change invalidates the preview and consent', await ev('!document.querySelector(".proposal-fields") && !document.querySelector(".proposal-consent input").checked && document.querySelector(".proposal-consent input").disabled'))
  await click('تحديث المعاينة', '.proposal-card button'); await wait('!!document.querySelector(".proposal-fields")')
  check('temporary selection keeps the saved provider', (await ev('window.rased.getAiSetup()')).settings.activeProvider === 'anthropic')
  writeFileSync(join(profile, 'ai-fixture.json'), JSON.stringify({ delay: 2000 }))
  await ev('window.__aiPending=window.rased.getProposalPreview(1,"",{provider:"openai",model:"gpt-4.1-mini"}).then(p=>window.rased.generateProposal(1,"",p.fingerprint,{provider:"openai",model:"gpt-4.1-mini"}));true')
  await sleep(200)
  check('real main rejects concurrent generation tests', (await ev('window.rased.testAiModel({provider:"anthropic",model:"claude-sonnet-4-5"})')).error === 'busy')
  await ev('window.rased.cancelProposal()')
  check('real main cancellation saves no late draft', (await ev('window.__aiPending')).error === 'cancelled' && !db.prepare('SELECT proposal FROM proposal_drafts WHERE project_id=1').get())
  writeFileSync(join(profile, 'ai-fixture.json'), JSON.stringify({ status: 429 }))
  const rate = await ev('window.rased.testAiModel({provider:"openai",model:"gpt-4.1-mini"})')
  check('rate limit returns a typed error through preload', rate.error === 'rate-limited')
  writeFileSync(join(profile, 'ai-fixture.json'), '{}')
  await nav('#/settings/ai'); await wait('!!document.querySelector("#ai-key")')
  mkdirSync('.local/qa/screenshots/ai-providers', { recursive: true })
  writeFileSync('.local/qa/screenshots/ai-providers/ar-settings.png', Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await ev('window.rased.updateSettings({language:"en"})'); await wait('document.documentElement.dir==="ltr" && !!document.querySelector("#ai-key")')
  writeFileSync('.local/qa/screenshots/ai-providers/en-settings.png', Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  check('English settings show all providers and model controls', await ev('document.querySelectorAll("#ai-provider option").length===3 && document.querySelector(".proposal-settings").textContent.includes("Test generation")'))
  await ev('window.rased.confirmClose(true)').catch(() => {})
  await eventually(() => child.exitCode !== null, Boolean, 5000)
  child = null
  // Convert fake Gemini key to the former on-disk format using encrypted bytes
  // only: the next launch must exercise actual DPAPI migration, not a mock.
  const newPath = join(profile, 'ai-keys', 'gemini.enc')
  writeFileSync(join(profile, 'gemini-key.enc'), Buffer.from(JSON.parse(readFileSync(newPath, 'utf8')).encrypted, 'base64'))
  unlinkSync(newPath)
  await launch()
  const setup = await ev('window.rased.getAiSetup()')
  console.log('Restart status:', JSON.stringify({ provider: setup.settings.activeProvider, keys: Object.fromEntries(providers.map(([provider]) => [provider, { saved: setup.providers[provider].hasKey, readable: setup.providers[provider].keyReadable }])) }))
  check('defaults and independent keys survive restart', setup.settings.activeProvider === 'anthropic' && providers.every(([provider]) => setup.providers[provider].keyReadable))
  check('actual encrypted legacy Gemini key migrates and removes the old file', existsSync(newPath) && !existsSync(join(profile, 'gemini-key.enc')))
  check('Claude catalog remains local across restart', setup.providers.anthropic.catalog?.models[0]?.id === 'claude-sonnet-4-5')
  const deleted = await ev('window.rased.deleteAiKey("openai")')
  check('deleting one key preserves other providers', deleted.ok && !(await ev('window.rased.getAiSetup()')).providers.openai.hasKey && (await ev('window.rased.getAiSetup()')).providers.anthropic.hasKey)
  await stopApp(child); child = null
  await launch()
  const afterCrash = await ev('window.rased.getAiSetup()')
  check('keys survive forced restart after initial Chromium state was persisted', afterCrash.providers.gemini.keyReadable && afterCrash.providers.anthropic.keyReadable && !afterCrash.providers.openai.hasKey)
  await nav('#/settings/legal'); await wait('!!document.querySelector(".legal-page")')
  check('legal text names all API providers', await ev('document.querySelector(".legal-page").textContent.includes("OpenAI") && document.querySelector(".legal-page").textContent.includes("Anthropic")'))
  console.log(`\n${passed} AI integration checks passed. Network simulated; no live provider authentication claimed. Profile: ${profile}`)
} finally { db.close(); if (child) await stopApp(child) }
