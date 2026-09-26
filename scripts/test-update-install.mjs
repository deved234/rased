// Real NSIS/updater install cycle in a uniquely named QA app, never RASED's installation.
// Temporary QA installers/profile are retained for diagnosis. No publishing or registry edits by this script.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'
import { eventually, sleep } from './cdp-tools.mjs'

if (process.platform !== 'win32') throw Error('This QA cycle requires Windows')
const root = mkdtempSync(join(tmpdir(), 'rased-upgrade-qa-'))
const suffix = root.split('-').at(-1).toLowerCase()
const appDir = join(root, 'app'), output = join(root, 'release'), installDir = join(root, 'installed')
mkdirSync(appDir); mkdirSync(output); mkdirSync(join(root, 'profile'))
const eventsFile = join(root, 'events.jsonl')
const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '').split('?')[0].slice(1))
  if (name.includes('/') || name.includes('\\') || name.includes('..') || !existsSync(join(output, name))) { res.writeHead(404); res.end(); return }
  res.setHeader('content-type', name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream')
  createReadStream(join(output, name)).pipe(res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const feed = `http://127.0.0.1:${server.address().port}/`
const run = (exe, args, cwd = process.cwd()) => new Promise((resolve, reject) => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve(output) : reject(Error(output)))
})
const pkg = { name: `rased-upgrade-qa-${suffix}`, productName: `RASED Upgrade QA ${suffix}`, version: '1.0.0', author: 'RASED QA', main: 'main.cjs', description: 'Isolated updater installation verification', dependencies: { 'electron-updater': '6.8.9' } }
writeFileSync(join(appDir, 'package.json'), JSON.stringify(pkg, null, 2))
writeFileSync(join(appDir, 'controller.cjs'), ts.transpileModule(readFileSync('src/main/updates.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
writeFileSync(join(appDir, 'main.cjs'), `
const {app}=require('electron');const{NsisUpdater}=require('electron-updater');const{DatabaseSync}=require('node:sqlite');const fs=require('node:fs');const path=require('node:path');const{UpdateController}=require('./controller.cjs');
app.setPath('userData',${JSON.stringify(join(root, 'profile'))});fs.mkdirSync(app.getPath('userData'),{recursive:true});
const record=(kind,data)=>fs.appendFileSync(${JSON.stringify(eventsFile)},JSON.stringify({kind,data})+'\\n');
app.whenReady().then(async()=>{
const db=new DatabaseSync(path.join(app.getPath('userData'),'qa.db'));db.exec('CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,note TEXT)');db.prepare('INSERT OR IGNORE INTO notes VALUES(1,?)').run('PRESERVE THIS NOTE');
app.on('before-quit',()=>{record('closed-db',app.getVersion());db.close()});
record('launch',{version:app.getVersion(),note:db.prepare('SELECT note FROM notes WHERE id=1').get().note});
if(app.getVersion()==='1.0.1'){app.quit();return}
const port=new NsisUpdater();port.disableDifferentialDownload=true;
const controller=new UpdateController(port,app.getVersion(),s=>record('state',s),e=>record('error',String(e)));
const checked=await controller.check();if(!checked.ok||controller.snapshot().phase!=='available')throw Error('No available QA update');
const downloaded=await controller.download();if(!downloaded.ok)throw Error('QA download failed');
record('explicit-install',true);if(!controller.install().ok)throw Error('QA install failed');
}).catch(e=>{record('fatal',String(e));app.quit()});
`)
const config = {
  appId: `com.rased.upgradeqa.${suffix}`, productName: pkg.productName, electronVersion: '44.4.5',
  directories: { app: appDir, output, buildResources: resolve('resources') },
  files: ['main.cjs', 'controller.cjs', 'package.json'],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: resolve('resources/icon.ico') },
  nsis: { oneClick: false, perMachine: false, createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false },
  artifactName: 'QA-${version}.${ext}', publish: { provider: 'generic', url: feed }
}
const configPath = join(root, 'builder.json'); writeFileSync(configPath, JSON.stringify(config))
try {
  console.log('QA workspace:', root)
  await run(process.execPath, [resolve('node_modules/npm/bin/npm-cli.js'), 'install', '--omit=dev', '--ignore-scripts'], appDir).catch(async () => {
    // npm's bundled CLI is generally next to node.exe on Windows.
    await run(process.execPath, [join(resolve(process.execPath, '..'), 'node_modules/npm/bin/npm-cli.js'), 'install', '--omit=dev', '--ignore-scripts'], appDir)
  })
  const build = async version => {
    pkg.version = version; writeFileSync(join(appDir, 'package.json'), JSON.stringify(pkg, null, 2))
    await run(process.execPath, [resolve('node_modules/electron-builder/cli.js'), '--config', configPath, '--win', 'nsis', '--publish', 'never'])
    console.log('Built isolated QA', version)
  }
  await build('1.0.0'); await build('1.0.1')
  // /D must be the final argument. The target is the checked, fixed TEMP QA install path.
  assert.ok(installDir.startsWith(root + '\\'))
  await run(join(output, 'QA-1.0.0.exe'), ['/S', '/D=' + installDir])
  const executable = join(installDir, pkg.productName + '.exe'); assert.ok(existsSync(executable))
  await run(executable, [])
  const events = () => existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').trim().split('\n').map(s => JSON.parse(s)) : []
  await eventually(() => events().some(e => e.kind === 'launch' && e.data.version === '1.0.1'), Boolean, 90000)
  await sleep(500)
  assert.equal(events().find(e => e.kind === 'launch' && e.data.version === '1.0.1').data.note, 'PRESERVE THIS NOTE')
  assert.ok(events().some(e => e.kind === 'closed-db' && e.data === '1.0.0'))
  assert.ok(!events().some(e => e.kind === 'error' || e.kind === 'fatal'))
  console.log('PASS real metadata/download/checksum/NSIS upgrade/relaunch/data preservation')
  const uninstaller = join(installDir, 'Uninstall ' + pkg.productName + '.exe')
  assert.ok(existsSync(uninstaller)); await run(uninstaller, ['/S'])
  console.log('QA application uninstalled. TEMP artifacts retained:', root)
} finally { await new Promise(resolve => server.close(resolve)) }
