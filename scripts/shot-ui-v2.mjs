// Real packaged UI evidence with live RSS in a NEW TEMP profile. No deletion.
// Usage: node scripts/shot-ui-v2.mjs --exe="release/win-unpacked/RASED.exe" --out="docs/screenshots/ui-fixes"
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, parseArgs, sleep, startApp, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2))
const profile = newProfile(args.profile)
const out = resolve(args.out ?? 'docs/screenshots/ui-fixes')
mkdirSync(out, { recursive: true })
const port = Number(args.port ?? 9347)
const child = startApp({ exe: args.exe ?? 'release/win-unpacked/RASED.exe', app: '', profile, port, test: false })
try {
  const ws = await pageWs(port)
  const ev = expression => evaluate(ws, expression)
  const shot = async name => {
    const r = await call(ws, 'Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, name), Buffer.from(r.data, 'base64'))
    console.log('SHOT', name)
  }
  await eventually(() => ev('document.querySelectorAll("[data-row]").length>0'), Boolean, 45000)
  await ev('window.rased.pause()')
  await shot('ar-main.png')
  await ev('document.querySelector("[data-row] article").click()')
  await eventually(() => ev('!!document.querySelector(".detail-article")'))
  await shot('ar-detail.png')
  const result = await ev('window.rased.getProjects({limit:1}).then(rows=>window.rased.openProjectExternal(rows[0].id))')
  if (!result.ok) throw Error('Real browser opener failed: '+JSON.stringify(result))
  console.log('REAL shell.openExternal succeeded', JSON.stringify(result))
  await ev('location.hash="#/settings/notifications"'); await sleep(400); await shot('ar-settings.png')
  await ev('window.rased.updateSettings({language:"en"})'); await ev('location.hash="#/"'); await sleep(400); await shot('en-main.png')
  await ev('window.rased.openCompact()')
  const compact = await pageWs(port, t=>t.url.includes('compact'))
  await eventually(()=>evaluate(compact,'!!document.querySelector(".compact-top")'))
  const image = await call(compact,'Page.captureScreenshot',{format:'png'})
  writeFileSync(join(out,'compact.png'),Buffer.from(image.data,'base64'))
  writeFileSync(join(out,'CAPTURE.md'),`Live RSS; packaged version ${await ev('window.rased.getAppInfo().then(i=>i.version)')}; real OS browser opener succeeded. Pause intentionally enabled for screenshots. TEMP profile: ${profile}. No OS toast click/audibility assertion.\n`)
  console.log('DONE; profile retained:',profile)
} finally { await stopApp(child) }
