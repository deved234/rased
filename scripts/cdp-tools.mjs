import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

export function electronPath() {
  return createRequire(import.meta.url)('electron')
}

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw Error(`Unexpected argument: ${arg}`)
    const eq = arg.indexOf('=')
    if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1)
    else out[arg.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return out
}
export function newProfile(requested) {
  let profile
  if (requested) {
    profile = resolve(requested)
    const rel = relative(resolve(tmpdir()), profile)
    if (!basename(profile).startsWith('rased-test-') || !rel || rel.startsWith('..') || isAbsolute(rel) || existsSync(profile)) throw Error('Profile must be a NEW directory inside TEMP; existing directories are never deleted.')
    mkdirSync(profile, { recursive: true })
  } else profile = mkdtempSync(join(tmpdir(), 'rased-test-'))
  writeFileSync(join(profile, '.rased-test-profile'), 'RASED isolated integration test')
  return profile
}
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export async function eventually(fn, predicate = Boolean, timeout = 10000) {
  const end = Date.now() + timeout
  let value
  while (Date.now() < end) {
    value = await fn()
    if (predicate(value)) return value
    await sleep(100)
  }
  throw Error(`Timed out; last value: ${JSON.stringify(value)}`)
}
export function startApp({ exe, app, profile, port, url, test = true, captureOutput = false }) {
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`]
  if (test) args.push('--rased-test')
  if (app) args.unshift(resolve(app))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  if (url) env.ELECTRON_RENDERER_URL = url
  const spawnOpts = process.platform === 'win32'
    ? { env, windowsHide: true, stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore' }
    : { env, windowsHide: true, detached: true, stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore' }
  const child = spawn(resolve(exe), args, spawnOpts)
  child.on('error', err => { console.error(err.message) })
  return child
}
export async function targets(port) {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
}
export async function pageWs(port, match = t => t.url.includes('index.html') && !t.url.includes('compact'), timeout = 30000) {
  return eventually(async () => {
    try { return (await targets(port)).find(t => t.type === 'page' && match(t))?.webSocketDebuggerUrl } catch { return null }
  }, Boolean, timeout)
}
export function call(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const finish = (err, data) => { clearTimeout(timer); ws.close(); if (err) reject(err); else resolve(data) }
    const timer = setTimeout(() => finish(Error(`CDP timeout: ${method}`)), 10000)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.id === 1) finish(m.error ? Error(JSON.stringify(m.error)) : null, m.result) })
    ws.addEventListener('error', () => finish(Error(`CDP connection failed: ${method}`)))
  })
}
export async function evaluate(ws, expression) {
  const result = await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
export async function stopApp(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      // The root may exit before taskkill finishes closing its renderer/worker
      // descendants. Wait for the whole tree before reopening its SQLite files.
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('close', resolve)
    })
  } else {
    if (child.signalCode !== null || !child.pid) return
    // Kill the entire process group (spawned with detached: true).
    // macOS returns EPERM (not ESRCH) when the group leader already exited and only a zombie remains.
    try { process.kill(-child.pid, 'SIGKILL') } catch (e) { if (e.code === 'EPERM') { try { child.kill('SIGKILL') } catch { /* already gone */ } } else if (e.code !== 'ESRCH') throw e }
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('close', resolve))
  }
}

// Keep the CDP session alive for emulation: Chromium resets it on disconnect.
export async function persistentSession(wsUrl) {
  const ws = new WebSocket(wsUrl), pending = new Map(); let seq = 0
  await new Promise((resolve, reject) => { ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true}) })
  ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)), p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)}})
  return { call(method,params={}) { return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Persistent CDP timeout: '+method))},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))}) }, close(){for(const p of pending.values()) {clearTimeout(p.timer);p.reject(Error('CDP session closed'))}pending.clear();ws.close()} }
}
