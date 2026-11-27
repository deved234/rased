// Exercises src/main/systemFetch.ts inside real Electron against a loopback server and a fake proxy.
// Proves: manual/follow/error redirects, headers, no cookies, decompression, streaming with cancel,
// abort, Retry-After, null bodies, refused methods, network errors, auth prompts never answered,
// and that requests go through the session proxy while Node's global fetch does not.
// Run: npm run test:network        (add --live to also check https://mostaql.com/go/<id> once)
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electronPath, parseArgs } from './cdp-tools.mjs'

const live = process.argv.includes('--live')
const args = parseArgs(process.argv.slice(2).filter(a => a !== '--live'))
const dir = mkdtempSync(join(tmpdir(), 'rased-test-network-'))
const exe = resolve(args.exe ?? electronPath())

const runner = String.raw`
const { app, session } = require('electron')
const http = require('node:http')
const zlib = require('node:zlib')
const { createSystemFetch, NETWORK_PARTITION } = require('./systemFetch.cjs')
app.setPath('userData', require('node:path').join(__dirname, 'profile'))
const results = []
const check = (name, pass, info = '') => results.push({ name, pass: !!pass, info: String(info) })
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)))
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e }))

app.whenReady().then(async () => {
  const seen = []
  let bigClosed = false
  let unreadClosed = false
  let stalledClosed = false
  const origin = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers })
    const send = (status, headers, body) => { res.writeHead(status, headers); res.end(body) }
    switch (req.url) {
      case '/redir': return send(301, { location: '/target' }, 'moved')
      case '/chain': return send(302, { location: '/redir' }, '')
      case '/loop': return send(302, { location: '/loop' }, '')
      case '/target': return send(200, { 'content-type': 'text/html', 'set-cookie': 'sid=secret; Path=/' }, '<html>target</html>')
      case '/gzip': return send(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }, zlib.gzipSync('<html>unzipped</html>'))
      case '/retry': return send(429, { 'retry-after': '120' }, '')
      case '/empty': return send(204, {}, '')
      case '/auth': return send(401, { 'www-authenticate': 'Basic realm="x"' }, 'denied')
      case '/slow': return setTimeout(() => { if (!res.destroyed) send(200, {}, 'late') }, 5000)
      case '/stall': res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html>'); return
      case '/unread': {
        res.writeHead(500, { 'content-type': 'text/html' })
        res.on('close', () => { unreadClosed = true })
        const chunk = Buffer.alloc(64 * 1024, 98)
        const t = setInterval(() => { if (res.destroyed) { clearInterval(t); return } res.write(chunk) }, 5)
        return
      }
      case '/stalled500': res.writeHead(500, { 'content-type': 'text/html' }); res.write('<html>error'); res.on('close', () => { stalledClosed = true }); return
      case '/big': {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.on('close', () => { bigClosed = true })
        const chunk = Buffer.alloc(64 * 1024, 97)
        let n = 0
        const t = setInterval(() => { if (res.destroyed || n++ > 400) { clearInterval(t); if (!res.destroyed) res.end(); return } res.write(chunk) }, 1)
        return
      }
      default: return send(404, {}, '')
    }
  })
  const base = 'http://127.0.0.1:' + await listen(origin)
  const proxied = []
  const proxy = http.createServer((req, res) => {
    proxied.push(req.url)
    const u = new URL(req.url)
    const up = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(up)
  })
  const proxyPort = await listen(proxy)
  const closed = http.createServer()
  const closedPort = await listen(closed)
  await new Promise(r => closed.close(r))

  const f = createSystemFetch()
  const H = { 'User-Agent': 'RASED/0.1 (+local Windows watcher)', Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' }
  const last = () => seen[seen.length - 1]
  try {
    let before = seen.length
    const manual = await f(base + '/redir', { headers: H, redirect: 'manual' })
    check('manual redirect returns the 3xx', manual.status === 301, manual.status)
    check('manual redirect keeps the raw Location', manual.headers.get('location') === '/target', manual.headers.get('location'))
    check('manual redirect does not request the target', seen.length === before + 1, seen.length - before)
    check('manual redirect has no body', manual.body === null)

    const followed = await f(base + '/chain', { headers: H })
    check('follow reaches the final page', followed.status === 200 && (await followed.text()) === '<html>target</html>')
    check('follow exposes the final url', followed.url === base + '/target' && followed.redirected === true, followed.url)

    const loop = await settle(f(base + '/loop', { headers: H }))
    check('follow stops after 20 redirects', !loop.ok && loop.e instanceof TypeError, loop.e && loop.e.cause && loop.e.cause.message)
    const refused = await settle(f(base + '/redir', { headers: H, redirect: 'error' }))
    check('redirect error mode rejects', !refused.ok && refused.e instanceof TypeError)

    const plain = await f(base + '/target', { headers: H, redirect: 'manual' })
    await plain.text()
    check('User-Agent sent unchanged', last().headers['user-agent'] === H['User-Agent'], last().headers['user-agent'])
    check('Accept and X-Requested-With sent', last().headers.accept === 'text/html' && last().headers['x-requested-with'] === 'XMLHttpRequest')
    check('url is the requested url without redirects', plain.url === base + '/target' && plain.redirected === false, plain.url)
    const again = await f(base + '/target', { headers: H })
    await again.text()
    check('cookies are never sent back', last().headers.cookie === undefined, last().headers.cookie)
    const jar = await session.fromPartition(NETWORK_PARTITION).cookies.get({})
    check('session cookie jar stays empty', jar.length === 0, jar.length)

    const gz = await f(base + '/gzip', { headers: H })
    check('gzip bodies are decoded', (await gz.text()) === '<html>unzipped</html>')

    const big = await f(base + '/big', { headers: H })
    const reader = big.body.getReader()
    let total = 0
    for (;;) { const c = await reader.read(); if (c.done) break; total += c.value.byteLength; if (total > 2 * 1024 * 1024) { await reader.cancel(); break } }
    await new Promise(r => setTimeout(r, 500))
    check('body streams and cancels at a size limit', total > 2 * 1024 * 1024 && total < 8 * 1024 * 1024, total)
    check('cancel closes the connection', bigClosed)

    const pre = new AbortController(); pre.abort()
    const preR = await settle(f(base + '/target', { signal: pre.signal }))
    check('already-aborted signal rejects without a request', !preR.ok && preR.e.name === 'AbortError')
    const ctrl = new AbortController(); const started = Date.now(); setTimeout(() => ctrl.abort(), 200)
    const slow = await settle(f(base + '/slow', { signal: ctrl.signal }))
    check('abort before the response rejects quickly', !slow.ok && slow.e.name === 'AbortError' && Date.now() - started < 1500, Date.now() - started)
    const ctrl2 = new AbortController()
    const stall = await f(base + '/stall', { signal: ctrl2.signal })
    const stallReader = stall.body.getReader()
    await stallReader.read()
    setTimeout(() => ctrl2.abort(), 100)
    const stallRead = await settle(stallReader.read())
    check('abort during the body errors the stream', !stallRead.ok && stallRead.e.name === 'AbortError')
    const timeout = await settle(f(base + '/slow', { signal: AbortSignal.timeout(150) }))
    check('timeout signal rejects with TimeoutError', !timeout.ok && timeout.e.name === 'TimeoutError', timeout.e && timeout.e.name)

    const quick = createSystemFetch({ bodyLifetimeMs: 400 })
    const unread = await quick(base + '/unread')
    const stalled = await quick(base + '/stalled500')
    check('abandoned error bodies are left unconsumed by the caller', unread.status === 500 && stalled.status === 500)
    const prompt = await quick(base + '/target')
    check('a body read promptly is not cut by the lifetime', (await prompt.text()) === '<html>target</html>')
    await new Promise(r => setTimeout(r, 2500))
    check('an unread body that filled the queue is closed after its lifetime', unreadClosed)
    check('a small stalled unread body is closed after its lifetime', stalledClosed)

    const retry = await f(base + '/retry')
    check('429 Retry-After readable', retry.status === 429 && retry.headers.get('retry-after') === '120')
    const empty = await f(base + '/empty')
    check('204 has a null body', empty.status === 204 && empty.body === null)
    const head = await f(base + '/target', { method: 'HEAD' })
    check('HEAD works without a body', head.status === 200 && head.body === null && last().method === 'HEAD')
    before = seen.length
    const post = await settle(f(base + '/target', { method: 'POST', body: 'x' }))
    check('POST is refused before any request', !post.ok && post.e instanceof TypeError && seen.length === before)
    const auth = await settle(f(base + '/auth'))
    check('auth prompts are not answered', auth.ok && auth.v.status === 401, auth.ok ? auth.v.status : auth.e)
    const down = await settle(f('http://127.0.0.1:' + closedPort + '/'))
    check('connection refused is a TypeError like fetch', !down.ok && down.e instanceof TypeError && down.e.message === 'fetch failed', down.e && down.e.message)

    const ses = session.fromPartition(NETWORK_PARTITION)
    await ses.setProxy({ proxyRules: 'http=127.0.0.1:' + proxyPort, proxyBypassRules: '<-loopback>' })
    const viaProxy = await f(base + '/target', { headers: H })
    await viaProxy.text()
    check('requests go through the session proxy', proxied.some(u => u.endsWith('/target')), JSON.stringify(proxied))
    const nodeBefore = proxied.length
    await fetch(base + '/target').then(r => r.text())
    check('Node global fetch bypasses that proxy (the bug being fixed)', proxied.length === nodeBefore)
    await ses.setProxy({ mode: 'system' })

    if (process.argv.includes('--live')) {
      const real = await f('https://mostaql.com/go/1213000', { headers: { 'User-Agent': H['User-Agent'], Accept: 'text/html' }, redirect: 'manual' })
      check('live mostaql /go/ answers with a project redirect', real.status === 301 && /^https:\/\/mostaql\.com\/project\/1213000-/.test(real.headers.get('location') || ''), real.status + ' ' + (real.headers.get('location') || '').slice(0, 50))
    }
  } catch (e) {
    check('network checks crashed', false, e && e.stack)
  }
  process.stdout.write('RESULTS ' + JSON.stringify(results) + '\n')
  origin.closeAllConnections(); origin.close(); proxy.close()
  app.quit()
})
`

try {
  await build({ entryPoints: ['src/main/systemFetch.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(dir, 'systemFetch.cjs'), logLevel: 'silent' })
  writeFileSync(join(dir, 'main.cjs'), runner)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const output = await new Promise((resolveRun, reject) => {
    const child = spawn(exe, [join(dir, 'main.cjs'), ...(live ? ['--live'] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env })
    let out = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('network checks timed out')) }, 90000)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', () => {})
    child.on('exit', () => { clearTimeout(timer); resolveRun(out) })
  })
  const line = String(output).split(/\r?\n/).find(l => l.startsWith('RESULTS '))
  if (!line) throw new Error('no results from Electron')
  const results = JSON.parse(line.slice(8))
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.pass || !r.info ? '' : ' :: ' + r.info}`)
  const failed = results.filter(r => !r.pass)
  if (failed.length) { console.error(`\nSystem network adapter: ${failed.length} of ${results.length} checks failed.`); process.exitCode = 1 }
  else console.log(`\nSystem network adapter: ${results.length} checks passed.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
