import { build } from 'esbuild'
import { mkdirSync,readFileSync,writeFileSync,copyFileSync } from 'node:fs'
import { resolve,join } from 'node:path'
import { createHash } from 'node:crypto'
const identity=readFileSync('src/shared/extension/identity.ts','utf8')
const value=name=>identity.match(new RegExp(`${name} = '([^']+)'`))[1]
const dest=resolve(process.env.RASED_EXTENSION_OUTPUT||'resources/chrome-extension')
mkdirSync(dest,{recursive:true})
await build({entryPoints:['extension/src/background.ts','extension/src/content.ts','extension/src/popup.ts'],bundle:true,platform:'browser',format:'iife',target:'chrome120',outdir:dest,define:{__HOST_NAME__:JSON.stringify(process.env.RASED_EXTENSION_HOST||value('HOST_NAME'))}})
for(const file of ['popup.html','popup.css'])copyFileSync(join('extension',file),join(dest,file))
copyFileSync('resources/icon.png',join(dest,'icon.png'))
writeFileSync(join(dest,'manifest.json'),JSON.stringify({manifest_version:3,name:'RASED Quick Apply',version:value('EXTENSION_VERSION'),key:value('EXTENSION_PUBLIC_KEY'),description:'Prepare Mostaql and Nafezly offers locally. Review and submit yourself.',minimum_chrome_version:'120',permissions:['nativeMessaging','storage','alarms'],host_permissions:['https://mostaql.com/*','https://nafezly.com/*'],background:{service_worker:'background.js'},action:{default_popup:'popup.html',default_icon:'icon.png'},icons:{128:'icon.png'},content_scripts:[{matches:['https://mostaql.com/project/*','https://mostaql.com/go/*','https://nafezly.com/project/*'],js:['content.js'],run_at:'document_idle',all_frames:false}]} ,null,2))
const files=['manifest.json','background.js','content.js','popup.js','popup.html','popup.css','icon.png']
const hash=createHash('sha256');for(const file of files)hash.update(file).update(readFileSync(join(dest,file)))
writeFileSync(join(dest,'metadata.json'),JSON.stringify({sha256:hash.digest('hex')}))
console.log('Chrome extension built.')
