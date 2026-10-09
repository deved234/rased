import { lstatSync,mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
export function protectExtensionDirectory(root:string):void {
  try{if(lstatSync(root).isSymbolicLink())throw Error('unsafe-setup-path')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  mkdirSync(root,{recursive:true})
  if(process.platform==='win32'){
    const user=execFileSync('whoami.exe',[],{encoding:'utf8',windowsHide:true}).trim()
    execFileSync('icacls.exe',[root,'/inheritance:r','/grant:r',`${user}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'})
  }
}
