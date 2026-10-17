import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, win32 } from 'node:path'
import { promisify } from 'node:util'
import type { ShortcutDetails } from 'electron'

const exec = promisify(execFile)
export interface DevelopmentActivationConfig {
  version: 1
  executable: string
  appPath: string
  userData: string
  appId: string
  clsid: string
  relay: string
}
const guid = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i
export function validDevelopmentActivation(value: unknown): value is DevelopmentActivationConfig {
  if (!value || typeof value !== 'object') return false
  const c = value as DevelopmentActivationConfig
  return c.version === 1 && [c.executable, c.appPath, c.userData, c.relay].every(p => typeof p === 'string' && isAbsolute(p)) &&
    c.appId === 'com.rased.app.development' && typeof c.clsid === 'string' && guid.test(c.clsid)
}
export function quoteWindowsArgument(value: string): string {
  if (/[\0\r\n]/.test(value)) throw Error('invalid-launch-argument')
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}
export function developmentComCommand(config: DevelopmentActivationConfig, file: string): string {
  if (!validDevelopmentActivation(config) || !isAbsolute(file)) throw Error('invalid-development-activation')
  return [config.executable, config.relay, '--rased-relay-config=' + file].map(quoteWindowsArgument).join(' ')
}

interface RegistrationPort {
  clsid: () => string
  readShortcut: (path: string) => ShortcutDetails
  readServer: (clsid: string) => Promise<string | null>
  writeServer: (clsid: string, command: string) => Promise<void>
  readAlias: (clsid: string) => Promise<string | null>
  writeAlias: (clsid: string, target: string) => Promise<void>
  now?: () => number
  wait?: (ms: number) => Promise<void>
}
/** Wait for Electron's background registration, then repair only our own class. */
export async function ensureDevelopmentComRegistration(config: Omit<DevelopmentActivationConfig, 'clsid'>, file: string, programs: string, port: RegistrationPort): Promise<DevelopmentActivationConfig> {
  const now = port.now ?? Date.now, wait = port.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const end = now() + 5000
  for (let attempt = 0; attempt < 50 && now() < end; attempt++) {
    const clsid = port.clsid()
    if (guid.test(clsid)) {
      const entries = await fs.readdir(programs).catch(() => [])
      const ownedLinks: ShortcutDetails[] = []
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.lnk')) continue
        try {
          const link = port.readShortcut(join(programs, entry))
          if (link.appUserModelId === config.appId && link.target.toLowerCase() === config.executable.toLowerCase()) ownedLinks.push(link)
        } catch { /* Ignore unrelated/unreadable shortcuts. */ }
      }
      const owned = ownedLinks.some(link => (link.toastActivatorClsid ?? '').toLowerCase() === clsid.toLowerCase())
      if (owned) {
        const full: DevelopmentActivationConfig = { ...config, clsid }
        const command = developmentComCommand(full, file), current = await port.readServer(clsid)
        // Never replace another executable's registration, even with a matching GUID.
        if (current !== null && (current.toLowerCase() === config.executable.toLowerCase() || current === command)) {
          await fs.mkdir(win32.dirname(file), { recursive: true })
          const temporary = file + '.' + randomUUID() + '.tmp'
          try {
            await fs.writeFile(temporary, JSON.stringify(full), { mode: 0o600 })
            await fs.rename(temporary, file)
          } finally { await fs.rm(temporary, { force: true }) }
          await port.writeServer(clsid, command)
          if (await port.readServer(clsid) !== command) throw Error('development-activation-verification-failed')
          // Older executable branding left extra shortcuts with the same AUMID.
          // Windows can still select their CLSID, including cached old toasts.
          // Redirect only proven same-app/executable aliases to the active class.
          for (const legacy of new Set(ownedLinks.map(link => link.toastActivatorClsid ?? ''))) {
            if (!guid.test(legacy) || legacy.toLowerCase() === clsid.toLowerCase()) continue
            const oldServer = await port.readServer(legacy), alias = await port.readAlias(legacy)
            if (oldServer?.toLowerCase() !== config.executable.toLowerCase() || (alias !== null && alias.toLowerCase() !== clsid.toLowerCase())) continue
            await port.writeAlias(legacy, clsid)
            if ((await port.readAlias(legacy))?.toLowerCase() !== clsid.toLowerCase()) throw Error('development-alias-verification-failed')
          }
          return full
        }
      }
    }
    await wait(100)
  }
  throw Error('development-activation-registration-timeout')
}

const key = (clsid: string): string => {
  if (!guid.test(clsid)) throw Error('invalid-activation-class')
  return `HKCU\\Software\\Classes\\CLSID\\${clsid}\\LocalServer32`
}
export function windowsRegistrationPort(clsid: () => string, readShortcut: RegistrationPort['readShortcut']): RegistrationPort {
  return {
    clsid, readShortcut,
    async readServer(id) {
      try {
        const result = await exec('reg.exe', ['query', key(id), '/ve'], { windowsHide: true, timeout: 2000 })
        return result.stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim() ?? null
      } catch { return null }
    },
    async writeServer(id, command) {
      await exec('reg.exe', ['add', key(id), '/ve', '/t', 'REG_SZ', '/d', command, '/f'], { windowsHide: true, timeout: 2000 })
    },
    async readAlias(id) {
      try {
        const result = await exec('reg.exe', ['query', key(id).replace(/LocalServer32$/, 'TreatAs'), '/ve'], { windowsHide: true, timeout: 2000 })
        return result.stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim() ?? null
      } catch { return null }
    },
    async writeAlias(id, target) {
      if (!guid.test(target)) throw Error('invalid-activation-alias')
      await exec('reg.exe', ['add', key(id).replace(/LocalServer32$/, 'TreatAs'), '/ve', '/t', 'REG_SZ', '/d', target, '/f'], { windowsHide: true, timeout: 2000 })
    }
  }
}
