import { MAX_FRAME } from '../../shared/extension/protocol.js'
export function encodeFrame(value: unknown): Buffer {
  const body=Buffer.from(JSON.stringify(value),'utf8')
  if (!body.length || body.length>MAX_FRAME) throw new Error('frame-too-large')
  const head=Buffer.alloc(4);head.writeUInt32LE(body.length)
  return Buffer.concat([head,body])
}
export class FrameReader {
  private buffer=Buffer.alloc(0)
  constructor(private onMessage:(value:unknown)=>void) {}
  push(chunk:Buffer):void {
    if(chunk.length>MAX_FRAME*2)throw Error('chunk-too-large')
    this.buffer=Buffer.concat([this.buffer,chunk])
    while(this.buffer.length>=4) {
      const size=this.buffer.readUInt32LE(0)
      if (!size || size>MAX_FRAME) throw new Error('invalid-frame-size')
      if (this.buffer.length<size+4) return
      const raw=this.buffer.subarray(4,size+4);this.buffer=this.buffer.subarray(size+4)
      this.onMessage(JSON.parse(raw.toString('utf8')))
    }
  }
}
