import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../../storage/db.js'
import { getSettingRaw, setSettingRaw } from '../../storage/repositories.js'
import { claimExtensionTicket, issueExtensionTicket, storedExtensionTicket, updateExtensionJob } from '../../storage/extensionJobs.js'
import { getProjectById } from '../../storage/repositories.js'
import { EXTENSION_VERSION, PROTOCOL_VERSION, nonce, secret, record, phases, sourceAllowed, projectDestination, type ExtensionStatus, type PrepareJob, type JobPhase } from '../../shared/extension/protocol.js'
import type { AppSettings } from '../../shared/types.js'
import { FrameReader, encodeFrame } from './framing.js'
import { ExtensionSetup } from './setup.js'
import { protectExtensionDirectory } from './protect.js'

interface Paired { id:string; label:string; hash:string; version:string }
interface Peer { socket:Socket; id?:string; approved:boolean }
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
const equal=(a:string,b:string)=>a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b))
export class ExtensionBroker {
  readonly setup:ExtensionSetup
  private server:Server|null=null
  private peers=new Set<Peer>()
  private paired:Paired[]=[]
  private selected:string|null=null
  private pending=new Map<string,{peer:Peer;code:string;expiresAt:number}>()
  private job:{message:PrepareJob;projectId:number;clientId:string;sent:boolean;timer:NodeJS.Timeout}|null=null
  private last:ExtensionStatus['lastJob']=null
  private closed=false
  private expiryTimer:NodeJS.Timeout|null=null
  protocolReady=false
  constructor(private db:Db,root:string,assets:string,private settings:()=>AppSettings,private changed:()=>void,private launch:()=>Promise<void>,hostName?:string) {
    protectExtensionDirectory(root)
    const tokenFile=join(root,'bridge-token')
    let token=existsSync(tokenFile)?readFileSync(tokenFile,'utf8'):''
    if(!secret(token)){token=randomBytes(32).toString('hex');writeFileSync(tokenFile,token)}
    const pipe=`\\\\.\\pipe\\rased-extension-${hash(root).slice(0,24)}`
    this.setup=new ExtensionSetup(root,assets,pipe,token,hostName)
    try{const cfg=JSON.parse(getSettingRaw(db,'extension-pairing')??'{}') as {clients:Paired[];selected:string|null};this.paired=(cfg.clients??[]).filter(p=>nonce(p.id)&&secret(p.hash)&&typeof p.label==='string').slice(0,10);this.selected=this.paired.some(p=>p.id===cfg.selected)?cfg.selected:null}catch{ /* invalid local config */ }
    // Unsent leases can be retried on an explicit click. Uncertain handoffs are
    // cancelled instead of replaying a possibly completed form write.
    db.exec("UPDATE extension_jobs SET activated_at=NULL,phase='issued' WHERE phase IN ('claimed','waiting-client')")
    db.exec("UPDATE extension_jobs SET phase='failed',error='app-restarted' WHERE activated_at IS NOT NULL AND phase NOT IN ('ready','failed','cancelled','expired','needs-input','draft-exists')")
  }
  async start():Promise<void> {
    await this.setup.inspect()
    this.server=createServer(socket=>{
      if(this.peers.size>=32){socket.destroy();return}
      const peer:Peer={socket,approved:false};this.peers.add(peer)
      let authenticated=false
      const deadline=setTimeout(()=>socket.destroy(),5000)
      const reader=new FrameReader(v=>{
        if(!authenticated){if(!record(v)||v.type!=='bridge-auth'||!secret(v.token)||!equal(v.token,this.setup.token)){socket.destroy();return}authenticated=true;clearTimeout(deadline);this.send(peer,{type:'bridge-ready'});return}
        try{this.receive(peer,v)}catch{socket.destroy()}
      })
      socket.on('data',b=>{try{reader.push(b)}catch{socket.destroy()}})
      socket.on('error',()=>undefined)
      socket.on('close',()=>{clearTimeout(deadline);this.peers.delete(peer);for(const [id,p] of this.pending)if(p.peer===peer)this.pending.delete(id);if(this.job?.sent&&this.job.clientId===peer.id)this.finish('failed','connection-lost');this.changed()})
    })
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.setup.pipe,resolve)})
    this.server.on('error',()=>{this.setup.error='bridge-unavailable';this.changed()})
    this.expiryTimer=setInterval(()=>{for(const [id,p] of this.pending)if(p.expiresAt<Date.now()){this.pending.delete(id);this.send(p.peer,{type:'pair-expired'});this.changed()}},1000)
    this.expiryTimer.unref()
  }
  private send(peer:Peer,v:unknown):void {if(!peer.socket.destroyed)peer.socket.write(encodeFrame(v))}
  private persist():void {setSettingRaw(this.db,'extension-pairing',JSON.stringify({clients:this.paired,selected:this.selected}));this.changed()}
  private receive(peer:Peer,v:unknown):void {
    if(!record(v))throw Error('bad-message')
    if(v.type==='hello'){
      if(!nonce(v.clientId)||v.protocol!==PROTOCOL_VERSION||v.version!==EXTENSION_VERSION)throw Error('incompatible-extension')
      if(peer.id&&peer.id!==v.clientId)throw Error('changed-client')
      peer.id=v.clientId
      const known=this.paired.find(p=>p.id===v.clientId)
      peer.approved=!!(known&&secret(v.token)&&equal(hash(v.token),known.hash))
      if(peer.approved){for(const other of this.peers)if(other!==peer&&other.id===peer.id)other.socket.destroy();this.send(peer,{type:'connected',language:this.settings().language});this.deliver()}
      else this.send(peer,{type:'unpaired'})
      this.changed();return
    }
    if(v.type==='pair-request'&&peer.id&&!peer.approved){
      if(!this.pending.has(peer.id)&&this.pending.size>=10)throw Error('pairing-limit')
      if(!this.pending.has(peer.id))this.pending.set(peer.id,{peer,code:String(randomInt(100000,1000000)),expiresAt:Date.now()+120000})
      const p=this.pending.get(peer.id)!;this.send(peer,{type:'pair-code',code:p.code,expiresAt:p.expiresAt});this.changed();return
    }
    if(!peer.approved)throw Error('not-paired')
    if(v.type==='result'&&this.job?.sent&&peer.id===this.job.clientId&&v.requestId===this.job.message.requestId){
      if(typeof v.phase!=='string'||!phases.includes(v.phase as JobPhase))throw Error('bad-phase')
      const phase=v.phase as JobPhase
      if(['waiting-client','opening','cancelled'].includes(phase))throw Error('invalid-transition')
      const error=typeof v.error==='string'&&/^[a-z0-9-]{1,80}$/.test(v.error)?v.error:undefined
      if(phase==='reading'){this.setPhase(phase);return}
      if(Number.isSafeInteger(v.tabId)&&(v.tabId as number)>0)updateExtensionJob(this.db,this.job.message.requestId,phase,this.job.clientId,error,(v.tabId as number))
      this.finish(phase,error,typeof v.price==='number'&&Number.isFinite(v.price)?v.price:undefined,typeof v.days==='number'&&Number.isInteger(v.days)?v.days:undefined)
    }
  }
  approve(id:string,code:string,label:string):boolean {
    const p=this.pending.get(id)
    if(!p||p.expiresAt<Date.now()||p.code!==code||!label.trim()||label.length>60||this.paired.length>=10)return false
    const token=randomBytes(32).toString('hex')
    this.paired=this.paired.filter(x=>x.id!==id).concat({id,label:label.trim(),hash:hash(token),version:EXTENSION_VERSION})
    this.selected=id;this.pending.delete(id);p.peer.approved=true;this.send(p.peer,{type:'paired',token,language:this.settings().language});this.persist();return true
  }
  select(id:string):boolean {if(!this.paired.some(p=>p.id===id))return false;this.cancel();this.selected=id;this.persist();return true}
  revoke(id:string):boolean {this.cancel();this.paired=this.paired.filter(p=>p.id!==id);for(const p of this.peers)if(p.id===id){this.send(p,{type:'revoked'});p.approved=false}if(this.selected===id)this.selected=null;this.persist();return true}
  available():boolean {return this.setup.installed&&this.setup.registered&&!!this.selected}
  status():ExtensionStatus {return {installed:this.setup.installed,registered:this.setup.registered,folder:this.setup.folder,extensionVersion:EXTENSION_VERSION,clients:this.paired.map(p=>({id:p.id,label:p.label,version:p.version,selected:p.id===this.selected,connected:[...this.peers].some(x=>x.approved&&x.id===p.id)})),pairing:[...this.pending].map(([id,p])=>({id,code:p.code,expiresAt:p.expiresAt})),selectedId:this.selected,lastJob:this.last,protocolReady:this.protocolReady,error:this.setup.error}}
  async prepare():Promise<void>{if(this.job)throw Error('busy');await this.setup.prepare();this.changed()}
  ticket(id:number):string|null {return this.available()&&this.settings().quickApply.enabled&&sourceAllowed(getProjectById(this.db,id)?.source)?issueExtensionTicket(this.db,id):null}
  async activate(ticket:string):Promise<boolean> {
    if(this.closed||this.job||!this.available()||!this.settings().quickApply.enabled)return false
    const row=claimExtensionTicket(this.db,ticket)
    if(!row){
      const previous=storedExtensionTicket(this.db,ticket)
      if(previous&&previous.expires_at>Date.now()&&['ready','needs-input','draft-exists'].includes(previous.phase)&&previous.client_id===this.selected){
        const peer=[...this.peers].find(p=>p.approved&&p.id===previous.client_id)
        if(peer){this.send(peer,{type:'focus',requestId:previous.request_id});return true}
      }
      return false
    }
    const project=getProjectById(this.db,row.project_id),cfg=this.settings()
    if(!project||!sourceAllowed(project.source)||!projectDestination(project.url,project.source,project.externalId)){updateExtensionJob(this.db,row.request_id,'failed',null,'invalid-project');return false}
    const message:PrepareJob={type:'prepare',requestId:row.request_id,source:project.source,externalId:project.externalId,url:project.url,title:project.title.slice(0,500),language:cfg.language,settings:{...cfg.quickApply},expiresAt:Date.now()+20000}
    this.job={message,projectId:project.id,clientId:this.selected!,sent:false,timer:setTimeout(()=>this.finish('expired','client-timeout'),20000)}
    this.setPhase('waiting-client');this.deliver()
    if(!this.job?.sent){try{await this.launch()}catch{this.finish('failed','chrome-unavailable')}}
    return true
  }
  async quick(id:number):Promise<boolean>{const url=this.ticket(id);return !!url&&this.activate(new URL(url).searchParams.get('ticket')!)}
  private deliver():void {
    if(!this.job||this.job.sent||this.job.message.expiresAt<=Date.now())return
    const peer=[...this.peers].find(p=>p.approved&&p.id===this.job!.clientId)
    if(!peer)return
    this.job.sent=true;clearTimeout(this.job.timer);this.job.message.expiresAt=Date.now()+30000;this.job.timer=setTimeout(()=>this.finish('expired','form-timeout'),30000)
    this.setPhase('opening');this.send(peer,this.job.message)
  }
  private setPhase(phase:JobPhase):void {if(!this.job)return;this.last={requestId:this.job.message.requestId,projectId:this.job.projectId,phase};updateExtensionJob(this.db,this.job.message.requestId,phase,this.job.clientId);this.changed()}
  private finish(phase:JobPhase,error?:string,price?:number,days?:number):void {
    if(!this.job)return
    const job=this.job;clearTimeout(job.timer)
    this.last={requestId:job.message.requestId,projectId:job.projectId,phase,error,price,days}
    updateExtensionJob(this.db,job.message.requestId,phase,job.clientId,error)
    if(!job.sent)this.db.prepare("UPDATE extension_jobs SET activated_at=NULL,phase='issued' WHERE request_id=?").run(job.message.requestId)
    for(const p of this.peers)if(p.approved&&p.id===job.clientId)this.send(p,{type:'cancel',requestId:job.message.requestId})
    this.job=null;this.changed()
  }
  cancel():void {this.finish('cancelled','user-cancelled')}
  dispose():void {this.cancel();this.closed=true;if(this.expiryTimer)clearInterval(this.expiryTimer);for(const p of this.peers)p.socket.destroy();this.server?.close()}
}
