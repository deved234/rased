// CI helper: re-emit the tail of a failed step's output as a public workflow annotation.
// Job logs need a GitHub sign-in; annotations are visible on the run page and through the API.
// Usage: node scripts/ci-failure-note.mjs <title> <log-file>
import { existsSync, readFileSync } from 'node:fs'

const [title = 'failure', file = ''] = process.argv.slice(2)
const os = process.env.RUNNER_OS ?? process.platform
const text = file && existsSync(file) ? readFileSync(file, 'utf8') : ''
// Chromium's dbus chatter on headless Linux would otherwise hide the real failure.
const tail = text.split(/\r?\n/).filter(line => line.trim() && !line.includes(':ERROR:dbus/')).slice(-30).join('\n').slice(-3000)
const escape = value => value.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
console.log(`::error title=${escape(`${os} ${title}`).replace(/[:,]/g, ' ')}::${escape(tail || '(no output)')}`)
