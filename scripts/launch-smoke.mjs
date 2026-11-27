// Release smoke check: start a packaged RASED binary in a fresh TEMP test profile and
// confirm the window loads its preload bridge, then stop it. Used in CI to launch the
// Linux AppImage and the installed deb under Ubuntu's default AppArmor restriction.
// Usage: node scripts/launch-smoke.mjs --exe=<binary> [--label=<name>] [--port=9371]
import { evaluate, newProfile, pageWs, parseArgs, settles, startApp, stopApp } from './cdp-tools.mjs'

const args = parseArgs(process.argv.slice(2))
if (typeof args.exe !== 'string' || !args.exe) throw Error('--exe=<packaged binary> is required')
const label = typeof args.label === 'string' ? args.label : args.exe
const port = Number(args.port ?? 9371)
const profile = newProfile()
const child = startApp({ exe: args.exe, app: '', profile, port, captureOutput: true })
let output = ''
for (const stream of [child.stdout, child.stderr]) { stream?.setEncoding('utf8'); stream?.on('data', chunk => { output = (output + chunk).slice(-16384) }) }
let exitedEarly = false
child.once('exit', () => { exitedEarly = true })
try {
  const ws = await pageWs(port, undefined, 60000)
  const ready = await settles(() => evaluate(ws, 'typeof window.rased === "object" && !!document.querySelector(".desktop-shell")'), 30000)
  if (!ready) throw Error('window opened without the RASED bridge or shell')
  console.log(`PASS ${label} launched and loaded its window`)
} catch (error) {
  console.error(`FAIL ${label} did not launch${exitedEarly ? ' (process exited)' : ''}: ${error instanceof Error ? error.message : String(error)}`)
  console.error('Last output:\n' + output.split(/\r?\n/).filter(line => line.trim() && !line.includes(':ERROR:dbus/')).slice(-30).join('\n'))
  process.exitCode = 1
} finally {
  await stopApp(child).catch(() => {})
}
