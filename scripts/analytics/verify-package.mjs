// Maintainer-only inspection of the configured release. Never log token values.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { assertReviewedIngest, reviewedDestinations } from './destinations.mjs'

const require = createRequire(import.meta.url)
const { extractFile, listPackage } = require('@electron/asar')
function verifyPackage() {
  const archive = 'release/win-unpacked/resources/app.asar'
  const files = listPackage(archive)
  const main = extractFile(archive, join('out', 'main', 'index.js')).toString()
  const source = main.match(/function telemetryConfig\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0]
  if (!source) throw Error('Configured telemetry function not found')
  const config = runInNewContext('(' + source + ')', Object.create(null), { timeout: 1000 })
  const production = config(true, false)
  if (!production || production.environment !== 'production' || production.host !== 'https://us.i.posthog.com' || config(false, false) !== null || config(true, true) !== null) throw Error('Release analytics isolation/configuration mismatch')
  assertReviewedIngest(reviewedDestinations.production.project, 'production', production.token)
  if (files.some(name => /[\\/](?:\.local|scripts|tests)[\\/]|\.(?:db|sqlite|env)$/.test(name)) || /phx_[A-Za-z0-9_-]{10,}/.test(main)) throw Error('Unexpected private/admin material in package')
  const pkg = JSON.parse(extractFile(archive, 'package.json'))
  const name = `RASED-Setup-${pkg.version}.exe`
  const installer = readFileSync('release/' + name)
  const sha256 = createHash('sha256').update(installer).digest('hex').toUpperCase()
  writeFileSync('release/SHA256SUMS.txt', sha256 + '  ' + name + '\n')
  const manifest = { version: pkg.version, commit: process.env.GITHUB_SHA ?? null, environment: 'production', project: reviewedDestinations.production.project, tokenSha256: reviewedDestinations.production.sha256, consentRequired: true, developmentAndIsolatedDisabled: true, cloudEventDeletionVerified: false, deferredByOwner: '2026-10-21', installer: { name, size: installer.length, sha256 } }
  writeFileSync('release/build-verification.json', JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify(manifest))
}
try { verifyPackage() } catch {
  console.error('Configured package verification failed; no credential values logged.')
  process.exitCode = 1
}
