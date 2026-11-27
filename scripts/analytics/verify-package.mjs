// Maintainer-only inspection of the configured release. Never log token values.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { assertReviewedIngest, reviewedDestinations } from './destinations.mjs'
import { PRIVATE_FILE_RE, PRIVATE_TOKEN_RE, platformPaths, verifyMetadata } from '../verify-release-files.mjs'

const require = createRequire(import.meta.url)
const { extractFile, listPackage } = require('@electron/asar')

function arg(name, fallback = null) {
  const prefix = `--${name}=`
  const hit = process.argv.find(a => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}

function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex').toUpperCase() }

function verifyPackage() {
  const platform = arg('platform', 'win')
  const { asar } = platformPaths(platform)
  const archive = resolve(asar)
  const files = listPackage(archive)
  const main = extractFile(archive, join('out', 'main', 'index.js')).toString()
  const source = main.match(/function telemetryConfig\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0]
  if (!source) throw Error('Configured telemetry function not found')
  const config = runInNewContext('(' + source + ')', Object.create(null), { timeout: 1000 })
  const production = config(true, false)
  if (!production || production.environment !== 'production' || production.host !== 'https://us.i.posthog.com' || config(false, false) !== null || config(true, true) !== null) throw Error('Release analytics isolation/configuration mismatch')
  assertReviewedIngest(reviewedDestinations.production.project, 'production', production.token)
  if (files.some(name => PRIVATE_FILE_RE.test(name)) || PRIVATE_TOKEN_RE.test(main)) throw Error('Unexpected private/admin material in package')
  const pkg = JSON.parse(extractFile(archive, 'package.json'))

  if (platform === 'win') {
    const name = `RASED-Setup-${pkg.version}.exe`
    const installer = readFileSync('release/' + name)
    const sha256 = sha256Hex(installer)
    writeFileSync('release/SHA256SUMS.txt', sha256 + '  ' + name + '\n')
    const manifest = { version: pkg.version, commit: process.env.GITHUB_SHA ?? null, environment: 'production', project: reviewedDestinations.production.project, tokenSha256: reviewedDestinations.production.sha256, consentRequired: true, developmentAndIsolatedDisabled: true, cloudEventDeletionVerified: false, deferredByOwner: '2026-10-21', installer: { name, size: installer.length, sha256 } }
    writeFileSync('release/build-verification.json', JSON.stringify(manifest, null, 2) + '\n')
    console.log(JSON.stringify(manifest))
    return
  }

  const { assets } = verifyMetadata(platform, pkg.version)
  const installers = assets.filter(a => /\.(dmg|zip|AppImage|deb)$/i.test(a.name))
  // For linux, deb may be present in assets; include it. Keep stable order by name for determinism.
  installers.sort((a, b) => a.name.localeCompare(b.name))
  const manifest = { version: pkg.version, commit: process.env.GITHUB_SHA ?? null, environment: 'production', project: reviewedDestinations.production.project, tokenSha256: reviewedDestinations.production.sha256, consentRequired: true, developmentAndIsolatedDisabled: true, cloudEventDeletionVerified: false, deferredByOwner: '2026-10-21', installers: installers.map(a => ({ name: a.name, size: a.size, sha256: a.sha256 })) }
  writeFileSync(`release/build-verification-${platform}.json`, JSON.stringify(manifest, null, 2) + '\n')
  const sums = installers.map(a => `${a.sha256}  ${a.name}`).join('\n') + (installers.length ? '\n' : '')
  writeFileSync(`release/SHA256SUMS-${platform}.txt`, sums)
  console.log(JSON.stringify(manifest))
}
try { verifyPackage() } catch {
  console.error('Configured package verification failed; no credential values logged.')
  process.exitCode = 1
}
