import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EXTENSION_ID, HOST_NAME } from '../../shared/extension/identity.js'
import { protectExtensionDirectory } from './protect.js'
const exec=promisify(execFile)
export class ExtensionSetup {
  installed=false
  registered=false
  error:string|undefined
  readonly folder:string
  readonly hostFolder:string
  constructor(readonly root:string,readonly assets:string,readonly pipe:string,readonly token:string,readonly hostName=HOST_NAME) {this.folder=join(root,'extension');this.hostFolder=join(root,'bridge')}
  async prepare():Promise<void> {
    this.error=undefined
    try {
      protectExtensionDirectory(this.root)
      for(const name of ['extension','bridge']) {
        const dir=join(this.root,name)
        try{if((await fs.lstat(dir)).isSymbolicLink())throw Error('unsafe-setup-path')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
      }
      const metadata=JSON.parse(await fs.readFile(join(this.assets,'chrome-bridge','metadata.json'),'utf8')) as {sha256:string}
      const exe=await fs.readFile(join(this.assets,'chrome-bridge','rased-chrome-host.exe'))
      if(createHash('sha256').update(exe).digest('hex')!==metadata.sha256)throw Error('host-integrity-failed')
      await fs.mkdir(this.hostFolder,{recursive:true})
      // Replacing an active executable may be refused: stop that bridge first from the broker.
      const target=join(this.hostFolder,'rased-chrome-host.exe')
      const same=await fs.readFile(target).then(b=>createHash('sha256').update(b).digest('hex')===metadata.sha256,()=>false)
      if(!same)await fs.writeFile(target,exe)
      for(const name of ['NODE-LICENSE.txt','POSTJECT-LICENSE.txt'])await fs.copyFile(join(this.assets,'chrome-bridge',name),join(this.hostFolder,name))
      await fs.writeFile(join(this.hostFolder,'host-config.json'),JSON.stringify({pipe:this.pipe,token:this.token}))
      const current=await fs.readFile(join(this.folder,'metadata.json'),'utf8').catch(()=>null)
      const incoming=await fs.readFile(join(this.assets,'chrome-extension','metadata.json'),'utf8')
      if(current!==incoming || !(await fs.stat(join(this.folder,'background.js')).catch(()=>null))) {
        const staging=join(this.root,'extension-staging'),backup=join(this.root,'extension-backup')
        for(const path of [staging,backup]) {try{if((await fs.lstat(path)).isSymbolicLink())throw Error('unsafe-setup-path')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}
        await fs.rm(staging,{recursive:true,force:true});await fs.cp(join(this.assets,'chrome-extension'),staging,{recursive:true})
        await fs.rm(backup,{recursive:true,force:true})
        if(await fs.stat(this.folder).catch(()=>null))await fs.rename(this.folder,backup)
        try{await fs.rename(staging,this.folder)}catch(e){await fs.rename(backup,this.folder).catch(()=>undefined);throw e}
      }
      const manifest=join(this.hostFolder,'native-host.json')
      await fs.writeFile(manifest,JSON.stringify({name:this.hostName,description:'RASED local quick apply bridge',path:resolve(target),type:'stdio',allowed_origins:[`chrome-extension://${EXTENSION_ID}/`]}))
      await exec('reg.exe',['add',`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${this.hostName}`,'/ve','/t','REG_SZ','/d',resolve(manifest),'/f'],{windowsHide:true})
      this.registered=true;this.installed=true
    }catch(e){this.error=e instanceof Error?e.message:'setup-failed';throw Error('setup-failed',{cause:e})}
  }
  async inspect():Promise<void> {
    this.installed=!!await fs.stat(join(this.folder,'manifest.json')).catch(()=>null)
    try{const result=await exec('reg.exe',['query',`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${this.hostName}`,'/ve'],{windowsHide:true});this.registered=result.stdout.includes(join(this.hostFolder,'native-host.json'))}catch{this.registered=false}
  }
  async unregister():Promise<void> {
    if(!this.registered)return
    await exec('reg.exe',['delete',`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${this.hostName}`,'/f'],{windowsHide:true})
    this.registered=false
  }
}
