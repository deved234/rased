// electron-vite reads Electron's path.txt directly. Electron 44 may be present
// in node_modules without its separately downloaded executable, so make dev
// startup self-healing instead of leaving a cryptic "Electron uninstall" error.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageDir = join(process.cwd(), 'node_modules', 'electron')
const pathFile = join(packageDir, 'path.txt')
const installScript = join(packageDir, 'install.js')

if (!existsSync(installScript)) {
  console.error('Electron package is missing. Run npm ci first.')
  process.exit(1)
}

const executable = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : ''
if (!executable || !existsSync(join(packageDir, 'dist', executable))) {
  console.log('Electron executable is missing; downloading it now...')
  const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
