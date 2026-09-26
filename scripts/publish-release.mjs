// Run only after committing/pushing validated source and building the installer.
// Creates a draft first; publication is the last step after checking every asset.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', windowsHide: true }).trim()
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const repository = pkg.build.publish.owner + '/' + pkg.build.publish.repo
const tag = 'v' + pkg.version
const head = run('git', ['rev-parse', 'HEAD'])
if (run('git', ['status', '--porcelain'])) throw Error('Commit all source changes before publishing')
if (head !== run('git', ['rev-parse', 'origin/main'])) throw Error('Push the committed source to origin/main first')
const metadata = yaml.load(readFileSync('release/latest.yml', 'utf8'))
const filename = `RASED-Setup-${pkg.version}.exe`
const installer = readFileSync('release/' + filename)
const sha256 = createHash('sha256').update(installer).digest('hex')
const sha512 = createHash('sha512').update(installer).digest('base64')
if (metadata.version !== pkg.version || metadata.files?.length !== 1 || metadata.files[0].url !== filename || metadata.files[0].sha512 !== sha512 || metadata.files[0].size !== installer.length) throw Error('Installer and update metadata do not match; rebuild before publishing')
const notes = resolve(`docs/RELEASE_${pkg.version}.md`)
statSync(notes); statSync('release/' + filename + '.blockmap')
writeFileSync('release/SHA256SUMS.txt', sha256.toUpperCase() + '  ' + filename + '\n')
if (process.argv.includes('--dry-run')) { console.log(`Validated ${tag}, ${filename}, latest.yml and blockmap; no GitHub changes`); process.exit(0) }
run('gh', ['release', 'create', tag, 'release/' + filename, 'release/' + filename + '.blockmap', 'release/latest.yml', 'release/SHA256SUMS.txt', '--repo', repository, '--target', head, '--title', 'RASED ' + pkg.version, '--notes-file', notes, '--draft'])
const release = JSON.parse(run('gh', ['api', `repos/${repository}/releases`, '--jq', `.[] | select(.tag_name == "${tag}")`]))
for (const name of [filename, filename + '.blockmap', 'latest.yml', 'SHA256SUMS.txt']) {
  const local = readFileSync('release/' + name), asset = release.assets.find(a => a.name === name)
  if (!asset || asset.size !== local.length || asset.digest !== 'sha256:' + createHash('sha256').update(local).digest('hex')) throw Error('Uploaded asset mismatch; release left as draft: ' + name)
}
console.log(run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']))
