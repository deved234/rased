// Fails when CI would silently skip tests. Parses .github/workflows/ci.yml and checks that:
// - the `unit` job runs `npm test` in an executable step and package.json defines `test`;
// - every test:* script in package.json is assigned to exactly one group of the `electron` matrix,
//   unless it is excluded below with a reason, and the group step really runs `matrix.suites`;
// - no group names a script that package.json does not define.
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

const EXCLUDED = {
  // Builds two NSIS installers and performs a real install/upgrade cycle of a QA app; too slow for
  // every push. Run manually before releases that touch the installer or updater.
  'test:update-install': 'real NSIS install/upgrade cycle, run manually'
}

const problems = []
const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {})
const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'))
const jobs = workflow?.jobs ?? {}
const runs = job => (Array.isArray(job?.steps) ? job.steps : []).map(step => (typeof step?.run === 'string' ? step.run : '')).filter(Boolean)

if (!scripts.includes('test')) problems.push('package.json has no "test" script for unit tests')
if (!runs(jobs.unit).some(run => /^npm test(\s|$)/m.test(run))) problems.push('the unit job has no executable "npm test" step')

const groups = jobs.electron?.strategy?.matrix?.include
if (!Array.isArray(groups) || groups.length === 0) problems.push('the electron job has no matrix.include groups')
if (!runs(jobs.electron).some(run => run.includes('${{ matrix.suites }}'))) problems.push('no electron step runs ${{ matrix.suites }}')

const assigned = []
for (const [index, group] of (Array.isArray(groups) ? groups : []).entries()) {
  if (typeof group?.suites !== 'string' || !/^\s*test:[a-z0-9-]+(\s+test:[a-z0-9-]+)*\s*$/.test(group.suites)) {
    problems.push(`electron group ${group?.group ?? index} must list suites as space-separated test:* names`)
    continue
  }
  assigned.push(...group.suites.trim().split(/\s+/))
}

for (const suite of scripts.filter(name => name.startsWith('test:'))) {
  const count = assigned.filter(name => name === suite).length
  if (EXCLUDED[suite]) {
    if (count > 0) problems.push(`${suite} is excluded but also assigned to a CI group`)
  } else if (count === 0) problems.push(`${suite} is not run by CI: add it to a group in .github/workflows/ci.yml or exclude it with a reason`)
  else if (count > 1) problems.push(`${suite} is assigned to ${count} CI groups`)
}
for (const name of new Set(assigned)) if (!scripts.includes(name)) problems.push(`${name} is assigned in CI but package.json has no such script`)
for (const name of Object.keys(EXCLUDED)) if (!scripts.includes(name)) problems.push(`${name} is excluded but package.json has no such script`)

if (problems.length) {
  console.error(problems.map(p => `- ${p}`).join('\n'))
  process.exit(1)
}
console.log(`CI suite coverage: unit tests plus ${new Set(assigned).size} suites in ${groups.length} groups; ${Object.keys(EXCLUDED).length} excluded with a reason.`)
