import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createConnection } from 'node:net'
import { EXTENSION_ID, record, secret } from '../../src/shared/extension/protocol.js'
import { encodeFrame, FrameReader } from '../../src/main/extension/framing.js'

if(process.argv.includes('--self-test')) {
  process.stdout.write(encodeFrame({type:'self-test',ok:true}));process.exit(0)
}
try {
  if(process.argv[2]!==`chrome-extension://${EXTENSION_ID}/`) throw new Error('origin-denied')
  const config:unknown=JSON.parse(readFileSync(join(dirname(process.execPath),'host-config.json'),'utf8'))
  if(!record(config)||typeof config.pipe!=='string'||!config.pipe.startsWith('\\\\.\\pipe\\rased-extension-')||!secret(config.token)) throw new Error('invalid-config')
  const socket=createConnection(config.pipe)
  let authenticated=false
  const native=new FrameReader(value=>{if(!authenticated)throw new Error('not-connected');socket.write(encodeFrame(value))})
  const relay=new FrameReader(value=>{
    if(!authenticated){if(!record(value)||value.type!=='bridge-ready')throw new Error('bridge-auth-failed');authenticated=true;process.stdin.on('data',chunk=>{try{native.push(chunk)}catch{socket.destroy()}});process.stdin.resume();return}
    process.stdout.write(encodeFrame(value))
  })
  socket.on('connect',()=>socket.write(encodeFrame({type:'bridge-auth',token:config.token})))
  socket.on('data',chunk=>{try{relay.push(chunk)}catch{socket.destroy()}})
  const finish=()=>process.exit(0)
  socket.on('error',finish);socket.on('close',finish);process.stdin.on('end',()=>socket.end())
  process.stdin.pause()
  setTimeout(()=>{if(!authenticated)socket.destroy()},5000).unref()
}catch{process.stderr.write('RASED native bridge unavailable\n');process.exit(1)}
