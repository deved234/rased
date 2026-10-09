/// <reference types="chrome" />
import { EXTENSION_VERSION, PROTOCOL_VERSION, record, nonce, secret, validPrepare, projectDestination, type PrepareJob } from '../../src/shared/extension/protocol.js'
declare const __HOST_NAME__:string
let port:chrome.runtime.Port|null=null
let state:{status:string;code?:string;expiresAt?:number;language?:string;error?:string}={status:'disconnected'}
let active:{job:PrepareJob;tabId:number;delivered:boolean;timer:ReturnType<typeof setTimeout>}|null=null
let connecting=false
const random=(size:number)=>Array.from(crypto.getRandomValues(new Uint8Array(size)),b=>b.toString(16).padStart(2,'0')).join('')
function send(value:unknown):void {try{port?.postMessage(value)}catch{ /* reconnect alarm */ }}
async function connect():Promise<void> {
  if(port||connecting)return
  connecting=true
  try {
    const storage=await chrome.storage.local.get(['clientId','token'])
    const clientId=nonce(storage.clientId)?storage.clientId:random(16)
    await chrome.storage.local.set({clientId})
    port=chrome.runtime.connectNative(__HOST_NAME__)
    port.onDisconnect.addListener(()=>{state={status:'disconnected',error:chrome.runtime.lastError?.message?.slice(0,160)};port=null;stop();void chrome.alarms.create('reconnect',{delayInMinutes:0.5})})
    port.onMessage.addListener(message=>{void receive(message).catch(()=>{stop();state={status:'error',error:'bridge-message-failed'}})})
    send({type:'hello',clientId,token:secret(storage.token)?storage.token:null,version:EXTENSION_VERSION,protocol:PROTOCOL_VERSION})
  }catch{state={status:'disconnected',error:'native-host-unavailable'};port=null}
  finally{connecting=false}
}
function stop():void {if(active){clearTimeout(active.timer);void chrome.tabs.sendMessage(active.tabId,{type:'cancel',requestId:active.job.requestId}).catch(()=>undefined)}active=null;void chrome.storage.session.remove('activeJob')}
function result(phase:string,error?:string):void {if(active)send({type:'result',requestId:active.job.requestId,phase,error});stop()}
async function receive(v:unknown):Promise<void> {
  if(!record(v))return
  if(v.type==='paired'&&secret(v.token)){await chrome.storage.local.set({token:v.token});state={status:'connected',language:typeof v.language==='string'?v.language:'en'};return}
  if(v.type==='connected'){state={status:'connected',language:typeof v.language==='string'?v.language:'en'};return}
  if(v.type==='unpaired'){state={status:'unpaired'};return}
  if(v.type==='pair-code'&&typeof v.code==='string'&&/^\d{6}$/.test(v.code)&&typeof v.expiresAt==='number'){state={status:'pairing',code:v.code,expiresAt:v.expiresAt};return}
  if(v.type==='revoked'){await chrome.storage.local.remove('token');state={status:'unpaired'};stop();return}
  if(v.type==='pair-expired'){state={status:'unpaired'};return}
  if(v.type==='cancel'&&v.requestId===active?.job.requestId){stop();return}
  if(v.type==='focus'&&state.status==='connected'&&nonce(v.requestId)){
    const saved=await chrome.storage.session.get('recentJobs'),recent=record(saved.recentJobs)?saved.recentJobs:{}
    const prior=recent[v.requestId]
    if(record(prior)&&typeof prior.tabId==='number'&&typeof prior.expiresAt==='number'&&prior.expiresAt>Date.now()){
      const tab=await chrome.tabs.get(prior.tabId).catch(()=>null)
      if(tab&&projectDestination(tab.url,prior.source,prior.externalId)){await chrome.tabs.update(tab.id!,{active:true});await chrome.windows.update(tab.windowId,{focused:true})}
    }
    return
  }
  if(!validPrepare(v)||state.status!=='connected'||v.expiresAt<=Date.now()||v.expiresAt>Date.now()+35000)return
  if(active){send({type:'result',requestId:v.requestId,phase:'failed',error:'busy'});return}
  const tab=await chrome.tabs.create({url:v.url,active:true})
  if(tab.id===undefined){send({type:'result',requestId:v.requestId,phase:'failed',error:'tab-unavailable'});return}
  await chrome.windows.update(tab.windowId,{focused:true})
  active={job:v,tabId:tab.id,delivered:false,timer:setTimeout(()=>result('expired','form-timeout'),Math.max(1,v.expiresAt-Date.now()))}
  await chrome.storage.session.set({activeJob:{requestId:v.requestId,tabId:tab.id}})
  // Content ready handles both cached and newly loaded pages.
  if(tab.status==='complete')await deliver(tab.id,tab.url)
}
async function deliver(tabId:number,url?:string):Promise<void> {
  if(!active||active.tabId!==tabId||active.delivered||Date.now()>=active.job.expiresAt)return
  if(!projectDestination(url,active.job.source,active.job.externalId))return
  try{await chrome.tabs.sendMessage(tabId,{type:'prepare',job:active.job});if(active?.tabId===tabId){active.delivered=true;send({type:'result',requestId:active.job.requestId,phase:'reading'})}}catch{ /* wait for content-ready */ }
}
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(active?.tabId!==id)return
  if(change.url&&!projectDestination(change.url,active.job.source,active.job.externalId)){result('needs-login','navigation-changed');return}
  if(change.status==='complete')void deliver(id,tab.url)
})
chrome.tabs.onRemoved.addListener(id=>{if(active?.tabId===id)result('failed','tab-closed')})
chrome.runtime.onMessage.addListener((v:unknown,sender,reply)=>{
  if(!record(v)||sender.id!==chrome.runtime.id)return false
  if(sender.tab&&sender.url!==chrome.runtime.getURL('popup.html')){
    if(!active||sender.frameId!==0||sender.tab.id!==active.tabId||!projectDestination(sender.url,active.job.source,active.job.externalId))return false
    if(v.type==='content-ready'){void deliver(sender.tab.id!,sender.url);return false}
    if(v.type==='content-result'&&v.requestId===active.job.requestId&&['ready','needs-input','needs-login','draft-exists','failed'].includes(String(v.phase))){
      const job=active
      send({...v,type:'result',tabId:job.tabId})
      if(['ready','needs-input','draft-exists'].includes(String(v.phase)))void chrome.storage.session.get('recentJobs').then(saved=>{
        const recent=record(saved.recentJobs)?saved.recentJobs:{}
        const entries=Object.entries(recent).slice(-9)
        void chrome.storage.session.set({recentJobs:{...Object.fromEntries(entries),[job.job.requestId]:{tabId:job.tabId,source:job.job.source,externalId:job.job.externalId,expiresAt:Date.now()+86400000}}})
      })
      stop()
    }
    return false
  }
  if(sender.url!==chrome.runtime.getURL('popup.html'))return false
  if(v.type==='state'){reply(state);return false}
  if(v.type==='pair'){if(state.status==='unpaired'||state.status==='pairing')send({type:'pair-request'});return false}
  if(v.type==='connect'){void connect();return false}
  return false
})
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='reconnect')void connect()})
chrome.runtime.onStartup.addListener(()=>void connect())
chrome.runtime.onInstalled.addListener(()=>void connect())
// A restarted worker cancels an uncertain write; never resumes it silently.
void chrome.storage.session.get('activeJob').then(async saved=>{
  if(record(saved.activeJob)&&typeof saved.activeJob.tabId==='number'&&nonce(saved.activeJob.requestId))await chrome.tabs.sendMessage(saved.activeJob.tabId,{type:'cancel',requestId:saved.activeJob.requestId}).catch(()=>undefined)
  await chrome.storage.session.remove('activeJob');await connect()
})
