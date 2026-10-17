// Tests lifecycle/SQLite/preload with OS effects substituted, NOT real Windows focus.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evaluate, eventually, newProfile, pageWs, parseArgs, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2)), profile = newProfile(), port = Number(args.port ?? 9564)
const exe = args.exe ?? 'node_modules/electron/dist/electron.exe', app = args.app === '' ? '' : args.app ?? 'out/main/index.js'
const db = new DatabaseSync(join(profile, 'rased.db')), schema = readFileSync('src/storage/migrations.ts', 'utf8')
const migrations = [...schema.matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
for (const migration of migrations) db.exec(migration[1])
db.exec('PRAGMA user_version=' + migrations.length)
const stamp = new Date().toISOString(), token = randomBytes(16).toString('hex'), url = 'https://mostaql.com/go/123'
db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({ mostaqlEnabled: false, khamsatEnabled: false, nafezlyEnabled: false, kafEnabled: false }))
db.prepare("INSERT INTO projects(id,source,external_id,url,title,first_seen_at,last_seen_at,discovery_kind,created_at,updated_at) VALUES(1,'mostaql','123',?,'Synthetic notification',?,?,'initial',?,?)").run(url, stamp, stamp, stamp, stamp)
db.prepare('INSERT INTO notification_activations(token_hash,url,project_id,expires_at) VALUES(?,?,1,?)').run(createHash('sha256').update(token).digest('hex'), url, Date.now() + 86400000)
const activation = 'type=action&action=0&intent=open-project&ticket=' + token
const trace = () => existsSync(join(profile, 'test-trace.jsonl')) ? readFileSync(join(profile, 'test-trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
const opens = () => trace().filter(item => item.kind === 'open-external')
const children = []; let checks = 0, child, ws
const check = (label, value) => { assert.ok(value, label); checks++; console.log('PASS ' + label) }
function launch(extra = []) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  const child = spawn(resolve(exe), [...(app ? [resolve(app)] : []), '--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--rased-test', ...extra], { env, windowsHide: true, stdio: 'ignore' })
  children.push(child); return child
}
async function boot(extra = []) {
  child = launch(extra); ws = await pageWs(port)
  await eventually(() => evaluate(ws, '!!window.rased'))
  await eventually(() => trace().filter(item => item.kind === 'window-launch').length)
}
async function second(extra) {
  const next = launch(extra)
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Second instance timeout')), 10000); next.once('exit', () => { clearTimeout(timer); resolve() }) })
}
try {
  await boot([activation])
  check('cold activation opens its original HTTPS destination once', opens().length === 1 && opens()[0].data === url)
  check('cold notification activation keeps the main window hidden', trace().find(item => item.kind === 'window-launch').data.visible === false)
  check('accepted opening marks an existing project read', !!db.prepare('SELECT read_at FROM projects WHERE id=1').get().read_at)
  db.prepare('UPDATE notification_activations SET last_attempt_at=?').run(Date.now() + 30000)
  await second([activation])
  check('duplicate handoff does not reopen the browser', opens().length === 1)
  await second(['type=action&action=0&intent=open-project&ticket=' + 'f'.repeat(32)])
  check('unknown capability does not open a supplied destination', opens().length === 1 && trace().some(item => item.kind === 'notification-open-result'))
  await stopApp(child)
  db.exec('DELETE FROM projects; UPDATE notification_activations SET last_attempt_at=NULL')
  const start = opens().length
  await boot([activation])
  await eventually(() => opens().length === start + 1)
  check('notification destination persists across restart and project deletion', opens().at(-1).data === url)
  check('opening a deleted project does not recreate it', db.prepare('SELECT COUNT(*) AS n FROM projects').get().n === 0)
  const beforeTest = opens().length
  check('test notification goes through the actual preload/main handler', (await evaluate(ws, 'window.rased.testNotification()')).ok)
  check('test notification opens only the explicit public listing', opens().length === beforeTest + 1 && opens().at(-1).data === 'https://mostaql.com/projects')
  const last = trace().filter(item => item.kind === 'toast').at(-1)
  check('test notification uses foreground XML without Quick Apply', last.data.toastXml.includes('activationType="foreground"') && !last.data.toastXml.includes('quick-apply'))
  check('no late database/uncaught errors were recorded', db.prepare("SELECT COUNT(*) AS n FROM diagnostics WHERE status='uncaught' OR detail LIKE 'async-failed%'").get().n === 0)
  console.log(`NOTIFICATION ACTIVATION PASSED (${checks} assertions); profile: ${profile}`)
} catch (error) { console.error(error); console.error('Retained profile:', profile); process.exitCode = 1 }
finally { db.close(); for (const child of children) if (child.exitCode === null) await stopApp(child) }
