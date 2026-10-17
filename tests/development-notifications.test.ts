import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { developmentComCommand, ensureDevelopmentComRegistration, quoteWindowsArgument, validDevelopmentActivation, type DevelopmentActivationConfig } from '../src/main/notifications/developmentRegistration.js'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rased-test-development-com-')); folders.push(dir)
  writeFileSync(join(dir, 'development.lnk'), 'fixture, not an OS shortcut')
  const config: DevelopmentActivationConfig = { version: 1, executable: 'D:\\RASED project\\RASED-Development.exe', appPath: 'D:\\RASED project', userData: dir, appId: 'com.rased.app.development', clsid: '{12345678-1234-1234-1234-123456789ABC}', relay: 'D:\\RASED project\\out\\main\\developmentRelay.js' }
  const state = { now: 0, command: config.executable, owned: true, registered: false }
  const port = {
    clsid: () => config.clsid,
    readShortcut: () => ({ target: config.executable, args: '', cwd: '', description: '', icon: '', iconIndex: 0, appUserModelId: state.owned ? config.appId : 'com.rased.app', toastActivatorClsid: config.clsid }),
    readServer: vi.fn(async () => state.registered ? state.command : null),
    writeServer: vi.fn(async (_id: string, value: string) => { state.command = value }),
    readAlias: vi.fn(async (): Promise<string | null> => null),
    writeAlias: vi.fn<(id: string, target: string) => Promise<void>>(async () => {}),
    now: () => state.now,
    wait: async (ms: number) => { state.now += ms; state.registered = true }
  }
  return { dir, config, state, port, file: join(dir, 'notifications', 'development-activation.json') }
}
describe('Development native notification startup', () => {
  it('registers an explicit relay entry and retains source/profile paths with spaces', async () => {
    const f = fixture()
    const result = await ensureDevelopmentComRegistration(f.config, f.file, f.dir, f.port)
    const stored = JSON.parse(readFileSync(f.file, 'utf8'))
    expect(stored).toEqual(result)
    expect(stored.appPath).toBe(f.config.appPath)
    expect(stored.userData).toBe(f.dir)
    expect(f.port.writeServer).toHaveBeenCalledOnce()
    expect(f.state.command).toContain('"D:\\RASED project\\out\\main\\developmentRelay.js"')
    expect(f.state.command).toContain('"--rased-relay-config=')
    expect(f.state.command).not.toBe(f.config.executable)
  })
  it('waits for Electron registration and does not touch the installed identity', async () => {
    const f = fixture(); f.state.owned = false
    await expect(ensureDevelopmentComRegistration(f.config, f.file, f.dir, f.port)).rejects.toThrow('timeout')
    expect(f.port.writeServer).not.toHaveBeenCalled()
  })
  it('refuses another executable even when a class ID matches', async () => {
    const f = fixture(); f.state.command = 'C:\\Other app\\Other.exe'
    await expect(ensureDevelopmentComRegistration(f.config, f.file, f.dir, f.port)).rejects.toThrow('timeout')
    expect(f.port.writeServer).not.toHaveBeenCalled()
  })
  it('rejects invalid config and quotes Windows arguments without executing shell syntax', () => {
    const f = fixture()
    expect(validDevelopmentActivation(f.config)).toBe(true)
    expect(validDevelopmentActivation({ ...f.config, appId: 'com.rased.app' })).toBe(false)
    expect(validDevelopmentActivation({ ...f.config, relay: './relative.js' })).toBe(false)
    expect(() => developmentComCommand({ ...f.config, clsid: 'arbitrary-key' }, f.file)).toThrow()
    expect(quoteWindowsArgument('C:\\path with spaces\\')).toBe('"C:\\path with spaces\\\\"')
    expect(() => quoteWindowsArgument('x\ny')).toThrow()
  })
  it('redirects an owned stale shortcut class but leaves foreign aliases untouched', async () => {
    const f = fixture(), legacy = '{AAAAAAAA-1234-1234-1234-123456789ABC}'
    writeFileSync(join(f.dir, 'legacy.lnk'), 'fixture')
    const canonicalLink = f.port.readShortcut()
    const aliases = new Map<string, string>()
    const port = { ...f.port,
      readShortcut: (path: string) => ({ ...canonicalLink, toastActivatorClsid: path.endsWith('legacy.lnk') ? legacy : f.config.clsid }),
      readServer: async (id: string) => id === legacy ? f.config.executable : f.state.registered ? f.state.command : null,
      readAlias: async (id: string) => aliases.get(id) ?? null,
      writeAlias: vi.fn(async (id: string, target: string) => { aliases.set(id, target) })
    }
    await ensureDevelopmentComRegistration(f.config, f.file, f.dir, port)
    expect(aliases.get(legacy)).toBe(f.config.clsid)
    aliases.set(legacy, '{BBBBBBBB-1234-1234-1234-123456789ABC}')
    port.writeAlias.mockClear()
    await ensureDevelopmentComRegistration(f.config, f.file, f.dir, port)
    expect(port.writeAlias).not.toHaveBeenCalled()
  })
})
