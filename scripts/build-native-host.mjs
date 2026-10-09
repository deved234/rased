import { build } from 'esbuild'
import { inject } from 'postject'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Native host build requires Windows x64')
const work=resolve('out/native-host-build'),dest=resolve('resources/chrome-bridge')
mkdirSync(work,{recursive:true});mkdirSync(dest,{recursive:true})
const inputs=['native-host/src/index.ts','src/main/extension/framing.ts','src/shared/extension/protocol.ts','src/shared/extension/identity.ts','src/shared/quickApply.ts']
const digest=createHash('sha256').update(process.version);for(const input of inputs)digest.update(readFileSync(input));const sourceHash=digest.digest('hex')
const previous=existsSync(resolve(dest,'metadata.json'))?JSON.parse(readFileSync(resolve(dest,'metadata.json'),'utf8')):null
if(previous?.sourceHash===sourceHash&&existsSync(resolve(dest,'rased-chrome-host.exe'))&&existsSync(resolve(dest,'NODE-LICENSE.txt'))&&createHash('sha256').update(readFileSync(resolve(dest,'rased-chrome-host.exe'))).digest('hex')===previous.sha256){console.log('Standalone native host already matches this source/runtime.');process.exit(0)}
await build({entryPoints:['native-host/src/index.ts'],bundle:true,platform:'node',format:'cjs',target:'node24',outfile:resolve(work,'host.cjs')})
const cfg=resolve(work,'sea-config.json'),blob=resolve(work,'host.blob'),exe=resolve(dest,'rased-chrome-host.exe')
writeFileSync(cfg,JSON.stringify({main:resolve(work,'host.cjs'),output:blob,disableExperimentalSEAWarning:true,useCodeCache:false,useSnapshot:false,execArgvExtension:'none'}))
const made=spawnSync(process.execPath,['--experimental-sea-config',cfg],{encoding:'utf8',windowsHide:true})
if(made.status!==0)throw Error(made.stderr)
copyFileSync(process.execPath,exe)
await inject(exe,'NODE_SEA_BLOB',readFileSync(blob),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'})
const check=spawnSync(exe,['--self-test'],{windowsHide:true})
if(check.status!==0||!check.stdout.includes(Buffer.from('self-test')))throw Error('Standalone native host self-test failed')
writeFileSync(resolve(dest,'metadata.json'),JSON.stringify({sha256:createHash('sha256').update(readFileSync(exe)).digest('hex'),runtime:process.version,sourceHash}))
copyFileSync(resolve('node_modules/postject/LICENSE'),resolve(dest,'POSTJECT-LICENSE.txt'))
const license=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`)
if(!license.ok)throw Error('Could not obtain Node runtime license')
writeFileSync(resolve(dest,'NODE-LICENSE.txt'),await license.text())
console.log('Standalone native host built and self-tested (no system Node dependency).')
