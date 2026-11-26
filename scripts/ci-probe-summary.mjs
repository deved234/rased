// Temporary 0.14.0 macOS/Linux probe reporter (.github/workflows/cross-platform-probe.yml).
// Job logs need a GitHub sign-in, so results and failure tails are re-emitted as
// public workflow annotations and the job summary. Exits 1 when any step failed.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'

const os = process.env.PROBE_OS ?? process.platform
const steps = ['install', 'typecheck', 'lint', 'unit', 'build', 'suites'].map(name => [name, process.env['PROBE_' + name.toUpperCase()] ?? 'unknown'])
const read = file => existsSync(file) ? readFileSync(file, 'utf8') : ''
const tail = (text, lines) => text.split(/\r?\n/).filter(line => line.trim()).slice(-lines).join('\n')
const escape = text => text.slice(-3000).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
const note = (level, title, text) => console.log(`::${level} title=${os} ${title}::${escape(text || '(no output)')}`)

const suites = read('probe-suites.txt').trim()
const overview = steps.map(([name, outcome]) => `${name}=${outcome}`).join(' ') + (suites ? '\n' + suites : '')
note('notice', 'results', overview)

if (existsSync('probe-unit.json')) {
  const report = JSON.parse(read('probe-unit.json'))
  const failing = report.testResults.filter(file => file.status !== 'passed').map(file => relative(process.cwd(), file.name) + ': ' + file.assertionResults.filter(test => test.status === 'failed').slice(0, 3).map(test => test.title + ' -> ' + String(test.failureMessages[0] ?? '').split(/\r?\n/)[0].slice(0, 160)).join(' | '))
  note(failing.length ? 'warning' : 'notice', 'unit tests', failing.length ? failing.join('\n') : `all ${report.numPassedTests} passed`)
} else if (existsSync('probe-unit.log')) note('error', 'unit test run', tail(read('probe-unit.log'), 30))

if (process.env.PROBE_BUILD === 'failure') note('error', 'build', tail(read('probe-build.log'), 30))
if (existsSync('probe-logs')) for (const file of readdirSync('probe-logs')) {
  const suite = 'test:' + file.replace(/\.log$/, '')
  if (suites.split('\n').includes('FAIL ' + suite)) note('error', suite, tail(read('probe-logs/' + file), 25))
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${os}\n\n\`\`\`\n${overview}\n\`\`\`\n`)
if (steps.some(([, outcome]) => outcome !== 'success')) process.exit(1)
