// Maintainer-only operations. No version change, commit, push or publication.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { assertReviewedIngest, reviewedDestinations } from './destinations.mjs'

export function runPrivate(executable, args, { input, env = process.env } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe','pipe','pipe'] })
    let output = '', bytes = 0
    const timer = setTimeout(() => { child.kill(); reject(Error('Maintainer operation timed out')) }, 600000)
    child.stdin.on('error', () => {})
    const collect = chunk => { bytes += chunk.length; if (bytes <= 4 * 1024 * 1024) output += chunk.toString() }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.on('error', () => { clearTimeout(timer); reject(Error('Maintainer process could not start; no private output logged')) })
    child.on('close', code => { clearTimeout(timer); if (code === 0) accept(output); else reject(Error('Maintainer process failed; no private output logged')) })
    child.stdin.end(input ?? '')
  })
}
export async function stageProductionToken(project, token, runner = runPrivate, destinations = reviewedDestinations) {
  assertReviewedIngest(project, 'production', token, destinations)
  // Disable first. Preparing the secret cannot start scheduled capture.
  await runner('gh', ['variable','set','RASED_ANALYTICS_OPERATIONS_READY','--body','false','--repo','deved234/rased'])
  await runner('gh', ['secret','set','RASED_POSTHOG_PROJECT_TOKEN','--repo','deved234/rased'], { input: token })
  return { project, secret: 'RASED_POSTHOG_PROJECT_TOKEN', operationsReady: false, codePublished: false }
}
export async function capturePublicProductionDownloads(project, token) {
  assertReviewedIngest(project, 'production', token)
  // Exercise the same entry point as the future Actions step, including its
  // production fingerprint guard. The token is environment-only, never argv.
  const output = await runPrivate(process.execPath, [resolve('scripts/analytics/github-downloads.mjs'),'--apply'], { env: { ...process.env, RASED_POSTHOG_PROJECT_TOKEN: token } })
  const result = JSON.parse(output.trim())
  if (!result.published || !Number.isSafeInteger(result.assets) || !Number.isSafeInteger(result.cumulativeDownloads)) throw Error('Incomplete distribution preflight result')
  return { project, assets: result.assets, cumulativeDownloads: result.cumulativeDownloads, appEvents: 0, environment: 'production', workflowCommandVerified: true }
}
export async function packageQa(project, token) {
  assertReviewedIngest(project, 'qa', token)
  const root = resolve('.local/analytics-launch-readiness-2026-10-20/configured-qa')
  mkdirSync(root, { recursive: true })
  const env = { ...process.env, RASED_ANALYTICS_BUILD_TOKEN: token, RASED_ANALYTICS_BUILD_READY: 'true', RASED_ANALYTICS_BUILD_ENVIRONMENT: 'qa', RASED_ANALYTICS_LOCAL_RELEASE: 'true' }
  try {
    const build = await runPrivate(process.execPath, [resolve('node_modules/electron-vite/bin/electron-vite.js'),'build'], { env })
    writeFileSync(join(root,'build.log'),build)
    const packaged = await runPrivate(process.execPath, [resolve('node_modules/electron-builder/cli.js'),'--win','--dir','--publish','never','--config.directories.output='+join(root,'package')])
    writeFileSync(join(root,'package.log'),packaged)
    return { project, environment: 'qa', version: JSON.parse(readFileSync('package.json','utf8')).version, root, installerCreated: false, published: false }
  } finally {
    // Leave the developer's ordinary output unconfigured even after failure.
    const cleanEnv = { ...process.env }
    for (const key of ['RASED_ANALYTICS_BUILD_TOKEN','RASED_ANALYTICS_BUILD_READY','RASED_ANALYTICS_BUILD_ENVIRONMENT','RASED_ANALYTICS_LOCAL_RELEASE']) delete cleanEnv[key]
    writeFileSync(join(root,'restore-default-build.log'), await runPrivate(process.execPath,[resolve('node_modules/electron-vite/bin/electron-vite.js'),'build'],{env:cleanEnv}))
  }
}
