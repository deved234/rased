// Windows taskbar may use the executable icon even with a BrowserWindow icon.
// Brand a separate development executable; keep the original Electron untouched.
import { createHash } from 'node:crypto'
import { copyFileSync,existsSync,readFileSync,writeFileSync } from 'node:fs'
import { dirname,join,resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn,spawnSync } from 'node:child_process'
const require=createRequire(import.meta.url)
const mode=process.argv[2]
if(mode!=='dev'&&mode!=='preview')throw Error('Expected dev or preview')
let executable=require('electron')
if(process.platform==='win32'){
  const dist=dirname(executable),target=join(dist,'RASED-Development.exe'),metadata=join(dist,'rased-development.json')
  const icon=resolve('resources/icon.ico'),editor=join(dirname(require.resolve('electron-winstaller/package.json')),'vendor','rcedit.exe')
  const hash=createHash('sha256').update(readFileSync(executable)).update(readFileSync(icon)).update('rased-development-v1').digest('hex')
  let previous=null
  try{previous=JSON.parse(readFileSync(metadata,'utf8'))}catch{ /* first run */ }
  if(previous?.hash!==hash||!existsSync(target)){
    copyFileSync(executable,target)
    const changed=spawnSync(editor,[target,'--set-icon',icon,'--set-version-string','ProductName','RASED','--set-version-string','FileDescription','RASED Development'],{encoding:'utf8',windowsHide:true})
    if(changed.error)throw changed.error
    if(changed.status!==0)throw Error(changed.stderr||'Could not brand the development executable')
    writeFileSync(metadata,JSON.stringify({hash}))
    console.log('RASED development executable prepared with the project logo.')
  }
  executable=target
}
const cli=join(dirname(require.resolve('electron-vite/package.json')),'bin','electron-vite.js')
const env={...process.env,ELECTRON_EXEC_PATH:executable}
delete env.ELECTRON_RUN_AS_NODE
const child=spawn(process.execPath,[cli,mode,...process.argv.slice(3)],{env,stdio:'inherit',windowsHide:true})
child.on('error',error=>{console.error(error.message);process.exitCode=1})
child.on('exit',code=>{process.exitCode=code??1})
// The child also receives console signals; let electron-vite close Electron.
process.on('SIGINT',()=>undefined)
process.on('SIGTERM',()=>child.kill('SIGTERM'))
