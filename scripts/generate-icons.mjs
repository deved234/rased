// Generate all icons from the centered, editable SVG source.
import {writeFileSync,readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import pngToIco from 'png-to-ico'
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const result=spawnSync(resolve('node_modules/electron/dist/electron.exe'),[resolve('scripts/render-brand.mjs')],{env,windowsHide:true,stdio:'inherit'})
if(result.error)throw result.error
if(result.status!==0)throw Error('Brand rendering failed')
const ico=await pngToIco(readFileSync(new URL('../resources/icon-master.png',import.meta.url)))
writeFileSync(new URL('../resources/icon.ico',import.meta.url),ico)
console.log('Centered SVG, PNG, ICO and tray icons generated')
