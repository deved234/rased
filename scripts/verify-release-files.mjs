import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { listPackage } = require('@electron/asar')

export const PRIVATE_FILE_RE = /[\\/](?:\.local|scripts|tests)[\\/]|\.(?:db|sqlite|env)$/
export const PRIVATE_TOKEN_RE = /phx_[A-Za-z0-9_-]{10,}/

function arg(name, fallback = null) {
  const prefix = `--${name}=`
  const hit = process.argv.find(a => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}

function sha512Base64(buf) { return createHash('sha512').update(buf).digest('base64') }
function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex').toUpperCase() }

export function platformPaths(platform) {
  if (platform === 'win') return { metadata: 'release/latest.yml', asar: 'release/win-unpacked/resources/app.asar' }
  if (platform === 'mac') return { metadata: 'release/latest-mac.yml', asar: 'release/mac-universal/RASED.app/Contents/Resources/app.asar' }
  if (platform === 'linux') return { metadata: 'release/latest-linux.yml', asar: 'release/linux-unpacked/resources/app.asar' }
  throw Error(`Unknown platform: ${platform}`)
}

export function requiredPlatformFiles(platform, version, metadata) {
  if (platform === 'win') return [`RASED-Setup-${version}.exe`]
  if (platform === 'mac') return [`RASED-${version}-mac.dmg`, `RASED-${version}-mac.zip`]
  if (platform === 'linux') {
    const appImage = (metadata?.files ?? []).map(f => f.url).find(u => typeof u === 'string' && u.endsWith('.AppImage'))
    const deb = (metadata?.files ?? []).map(f => f.url).find(u => typeof u === 'string' && u.endsWith('.deb'))
      ?? (existsSync(`release/RASED-${version}-linux-amd64.deb`) ? `RASED-${version}-linux-amd64.deb` : null)
      ?? (existsSync(`release/RASED-${version}-linux-x86_64.deb`) ? `RASED-${version}-linux-x86_64.deb` : null)
    return [appImage, deb].filter(Boolean)
  }
  throw Error(`Unknown platform: ${platform}`)
}

export function verifyMetadata(platform, version, releaseDir = 'release') {
  const { metadata: metadataPath } = platformPaths(platform)
  const abs = resolve(releaseDir, metadataPath.replace(/^release[\\/]/, ''))
  if (!existsSync(abs)) throw Error(`Missing metadata: ${metadataPath}`)
  const metadata = yaml.load(readFileSync(abs, 'utf8'))
  if (String(metadata?.version) !== String(version)) throw Error(`${metadataPath}: version ${metadata?.version} !== ${version}`)
  const files = metadata?.files
  if (!Array.isArray(files) || files.length === 0) throw Error(`${metadataPath}: no files listed`)

  const required = requiredPlatformFiles(platform, version, metadata)
  for (const name of required) {
    if (!files.some(f => f?.url === name)) {
      if (platform === 'mac' && name.endsWith('.dmg')) {
        throw Error(`${metadataPath}: required DMG ${name} is not listed. DmgUpdater needs the dmg listed in latest-mac.yml; electron-builder did not list it. Do not hand-edit metadata.`)
      }
      throw Error(`${metadataPath}: required file not listed: ${name}`)
    }
  }

  const seen = new Set()
  const assets = []
  for (const file of files) {
    const name = file?.url
    if (typeof name !== 'string' || !name) throw Error(`${metadataPath}: invalid file entry`)
    if (seen.has(name)) throw Error(`${metadataPath}: duplicate file entry: ${name}`)
    seen.add(name)
    const filePath = resolve(releaseDir, name)
    if (!existsSync(filePath)) throw Error(`${metadataPath}: listed file missing: ${name}`)
    const buf = readFileSync(filePath)
    const size = buf.length
    const actualSha512 = sha512Base64(buf)
    if (file.sha512 !== actualSha512) throw Error(`${metadataPath}: sha512 mismatch for ${name}`)
    if (Number(file.size) !== size) throw Error(`${metadataPath}: size mismatch for ${name} (metadata ${file.size}, actual ${size})`)
    assets.push({ name, path: filePath, size, sha256: sha256Hex(buf), sha512: actualSha512 })
  }

  if (platform === 'linux') {
    const hasAppImage = assets.some(a => a.name.endsWith('.AppImage'))
    if (!hasAppImage) throw Error(`${metadataPath}: no AppImage listed in latest-linux.yml`)
    const debName = required.find(n => n.endsWith('.deb'))
    if (debName) {
      const debPath = resolve(releaseDir, debName)
      if (!existsSync(debPath)) throw Error(`Missing Linux deb: ${debName}`)
      if (!assets.some(a => a.name === debName)) {
        const buf = readFileSync(debPath)
        assets.push({ name: debName, path: debPath, size: buf.length, sha256: sha256Hex(buf), sha512: sha512Base64(buf) })
      }
    }
  }

  return { metadataPath, abs, metadata, assets }
}

export function verifyAsar(platform, releaseDir = 'release') {
  const { asar } = platformPaths(platform)
  const abs = resolve(releaseDir, asar.replace(/^release[\\/]/, ''))
  if (!existsSync(abs)) throw Error(`Missing packaged asar: ${asar}`)
  const files = listPackage(abs)
  const bad = files.filter(name => PRIVATE_FILE_RE.test(name))
  if (bad.length) throw Error(`${asar}: unexpected private material in package: ${bad.slice(0, 5).join(', ')}`)
  const mainPath = join('out', 'main', 'index.js')
  const main = files.includes(mainPath) ? require('@electron/asar').extractFile(abs, mainPath).toString() : ''
  if (main && PRIVATE_TOKEN_RE.test(main)) throw Error(`${asar}: private token pattern found in main bundle`)
  if (platform !== 'win') {
    const resourcesDir = resolve(abs, '..')
    for (const forbidden of ['chrome-bridge', 'chrome-extension']) {
      if (existsSync(resolve(resourcesDir, forbidden))) throw Error(`${asar}: ${platform} package must not contain ${forbidden}`)
    }
  }
  return { asarPath: asar, abs, files }
}

export function writePlatformSha256(platform, assets, releaseDir = 'release') {
  if (platform === 'win') return null
  const name = `SHA256SUMS-${platform}.txt`
  const installers = assets.filter(a => /\.(exe|dmg|zip|AppImage|deb)$/i.test(a.name))
  const text = installers.map(a => `${a.sha256}  ${a.name}`).join('\n') + (installers.length ? '\n' : '')
  const out = resolve(releaseDir, name)
  writeFileSync(out, text)
  return { name, path: out, text }
}

export function verifyReleasePlatform(platform, version, releaseDir = 'release') {
  const metadata = verifyMetadata(platform, version, releaseDir)
  const asar = verifyAsar(platform, releaseDir)
  const sha256File = writePlatformSha256(platform, metadata.assets, releaseDir)
  return { platform, version, metadata, asar, sha256File }
}

function main() {
  const platform = arg('platform', process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const version = arg('version', pkg.version)
  const result = verifyReleasePlatform(platform, version)
  const files = result.metadata.assets.map(a => a.name).join(', ')
  console.log(`Verified ${platform} ${version}: ${files}`)
  if (result.sha256File) console.log(`Wrote ${result.sha256File.name}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
