// Run only after committing/pushing validated source and building the installer(s).
// Creates a draft first; publication is the last step after checking every asset.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { verifyMetadata } from './verify-release-files.mjs'

const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', windowsHide: true }).trim()
const arg = (name, fallback = null) => { const p = `--${name}=`; const h = process.argv.find(a => a.startsWith(p)); return h ? h.slice(p.length) : fallback }
const dryRun = process.argv.includes('--dry-run')
const required = (arg('require', 'win') || 'win').split(',').map(s => s.trim()).filter(Boolean)
for (const r of required) if (!['win', 'mac', 'linux'].includes(r)) throw Error(`Unknown --require platform: ${r}`)

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const repository = pkg.build.publish.owner + '/' + pkg.build.publish.repo
const tag = 'v' + pkg.version
const head = run('git', ['rev-parse', 'HEAD'])
if (run('git', ['status', '--porcelain'])) throw Error('Commit all source changes before publishing')
if (head !== run('git', ['rev-parse', 'origin/main'])) throw Error('Push the committed source to origin/main first')

const notes = resolve(`docs/RELEASE_${pkg.version}.md`)
statSync(notes)

const platformMeta = { win: 'release/latest.yml', mac: 'release/latest-mac.yml', linux: 'release/latest-linux.yml' }
const present = []
const allAssets = [] // {name, path}
const installerSums = [] // {name, sha256}

function addAsset(name) {
  const p = resolve('release/' + name)
  statSync(p)
  if (!allAssets.some(a => a.name === name)) allAssets.push({ name, path: p })
}

for (const platform of ['win', 'mac', 'linux']) {
  const metaRel = platformMeta[platform]
  const metaAbs = resolve(metaRel)
  const metaExists = existsSync(metaAbs)
  if (!metaExists) {
    if (required.includes(platform)) throw Error(`Required platform missing: ${metaRel}`)
    continue
  }
  present.push(platform)

  if (platform === 'win') {
    const metadata = yaml.load(readFileSync(metaAbs, 'utf8'))
    const filename = `RASED-Setup-${pkg.version}.exe`
    const installer = readFileSync('release/' + filename)
    const sha256 = createHash('sha256').update(installer).digest('hex')
    const sha512 = createHash('sha512').update(installer).digest('base64')
    if (metadata.version !== pkg.version || metadata.files?.length !== 1 || metadata.files[0].url !== filename || metadata.files[0].sha512 !== sha512 || metadata.files[0].size !== installer.length) throw Error('Installer and update metadata do not match; rebuild before publishing')
    statSync('release/' + filename + '.blockmap')
    installerSums.push({ name: filename, sha256: sha256.toUpperCase() })
    addAsset(filename)
    addAsset(filename + '.blockmap')
    addAsset('latest.yml')
  } else {
    const { assets } = verifyMetadata(platform, pkg.version)
    for (const a of assets) {
      addAsset(a.name)
      if (/\.(exe|dmg|zip|AppImage|deb)$/i.test(a.name)) installerSums.push({ name: a.name, sha256: a.sha256 })
      const blockmap = a.name + '.blockmap'
      if (existsSync(resolve('release/' + blockmap))) addAsset(blockmap)
    }
    addAsset(metaRel.replace(/^release[\\/]/, ''))
  }
}

if (!present.includes('win')) throw Error('Windows release assets are required')
installerSums.sort((a, b) => a.name.localeCompare(b.name))
const sha256sums = installerSums.map(s => `${s.sha256}  ${s.name}`).join('\n') + '\n'
writeFileSync('release/SHA256SUMS.txt', sha256sums)
addAsset('SHA256SUMS.txt')

if (dryRun) {
  console.log(`Validated ${tag} [${present.join(',')}]: ${allAssets.map(a => a.name).join(', ')}; no GitHub changes`)
  process.exit(0)
}

run('gh', ['release', 'create', tag, ...allAssets.map(a => 'release/' + a.name), '--repo', repository, '--target', head, '--title', 'RASED ' + pkg.version, '--notes-file', notes, '--draft'])
const release = JSON.parse(run('gh', ['api', `repos/${repository}/releases`, '--jq', `.[] | select(.tag_name == "${tag}")`]))
for (const { name } of allAssets) {
  const local = readFileSync('release/' + name)
  const asset = release.assets.find(a => a.name === name)
  if (!asset || asset.size !== local.length || asset.digest !== 'sha256:' + createHash('sha256').update(local).digest('hex')) throw Error('Uploaded asset mismatch; release left as draft: ' + name)
}
console.log(run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']))
