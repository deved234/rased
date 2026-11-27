import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { applyAutoStart, quoteDesktopExec } from '../src/main/platform/autostart.js'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rased-autostart-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('platform autostart', () => {
  it.each(['win32', 'darwin'] as const)('calls the login-item port on %s', platform => {
    const setLoginItemSettings = vi.fn()
    applyAutoStart({
      platform,
      packaged: false,
      testHarness: false,
      openAtLogin: true,
      loginItem: { setLoginItemSettings }
    })
    applyAutoStart({
      platform,
      packaged: true,
      testHarness: false,
      openAtLogin: false,
      loginItem: { setLoginItemSettings }
    })
    expect(setLoginItemSettings.mock.calls).toEqual([[{ openAtLogin: true }], [{ openAtLogin: false }]])
  })

  it('skips all platforms when running under testHarness', () => {
    const dir = makeTempDir()
    const setLoginItemSettings = vi.fn()
    applyAutoStart({
      platform: 'win32',
      packaged: true,
      testHarness: true,
      openAtLogin: true,
      loginItem: { setLoginItemSettings }
    })
    applyAutoStart({
      platform: 'linux',
      packaged: true,
      testHarness: true,
      openAtLogin: true,
      loginItem: { setLoginItemSettings },
      env: { XDG_CONFIG_HOME: dir },
      paths: { execPath: '/usr/bin/rased', homeDir: dir }
    })
    expect(setLoginItemSettings).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'autostart', 'rased.desktop'))).toBe(false)
  })

  it('creates rased.desktop using APPIMAGE on packaged Linux with default ~/.config/autostart', () => {
    const home = makeTempDir()
    applyAutoStart({
      platform: 'linux',
      packaged: true,
      testHarness: false,
      openAtLogin: true,
      loginItem: { setLoginItemSettings: vi.fn() },
      env: { APPIMAGE: '/opt/RASED-0.12.1.AppImage' },
      paths: { execPath: '/tmp/.mount_RASED/rased', homeDir: home }
    })
    const desktopFile = join(home, '.config', 'autostart', 'rased.desktop')
    expect(existsSync(desktopFile)).toBe(true)
    expect(readFileSync(desktopFile, 'utf8')).toBe(
      '[Desktop Entry]\nType=Application\nName=RASED\nExec="/opt/RASED-0.12.1.AppImage"\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n'
    )
  })

  it('creates rased.desktop using execPath when APPIMAGE is absent and respects XDG_CONFIG_HOME', () => {
    const home = makeTempDir()
    const xdg = join(makeTempDir(), 'custom-config')
    applyAutoStart({
      platform: 'linux',
      packaged: true,
      testHarness: false,
      openAtLogin: true,
      loginItem: { setLoginItemSettings: vi.fn() },
      env: { XDG_CONFIG_HOME: xdg },
      paths: { execPath: '/opt/rased/rased', homeDir: home }
    })
    const desktopFile = join(xdg, 'autostart', 'rased.desktop')
    expect(existsSync(desktopFile)).toBe(true)
    expect(existsSync(join(home, '.config', 'autostart', 'rased.desktop'))).toBe(false)
    expect(readFileSync(desktopFile, 'utf8')).toContain('Exec="/opt/rased/rased"\n')
  })

  it('quotes spaces and escapes embedded quotes and backslashes per Desktop Entry spec', () => {
    const home = makeTempDir()
    const rawExec = '/opt/My Apps/rased "nightly"\\bin/$100%'
    applyAutoStart({
      platform: 'linux',
      packaged: true,
      testHarness: false,
      openAtLogin: true,
      loginItem: { setLoginItemSettings: vi.fn() },
      env: {},
      paths: { execPath: rawExec, homeDir: home }
    })
    const content = readFileSync(join(home, '.config', 'autostart', 'rased.desktop'), 'utf8')
    expect(quoteDesktopExec(rawExec)).toBe('"/opt/My Apps/rased \\\\"nightly\\\\"\\\\\\\\bin/\\\\$100%%"')
    expect(content).toContain('Exec="/opt/My Apps/rased \\\\"nightly\\\\"\\\\\\\\bin/\\\\$100%%"\n')
  })

  it('deletes rased.desktop on Linux when openAtLogin is false and tolerates missing file', () => {
    const xdg = makeTempDir()
    const desktopFile = join(xdg, 'autostart', 'rased.desktop')
    mkdirSync(join(xdg, 'autostart'), { recursive: true })
    writeFileSync(desktopFile, '[Desktop Entry]\n', 'utf8')

    applyAutoStart({
      platform: 'linux',
      packaged: true,
      testHarness: false,
      openAtLogin: false,
      loginItem: { setLoginItemSettings: vi.fn() },
      env: { XDG_CONFIG_HOME: xdg },
      paths: { execPath: '/opt/rased/rased', homeDir: xdg }
    })
    expect(existsSync(desktopFile)).toBe(false)

    expect(() =>
      applyAutoStart({
        platform: 'linux',
        packaged: true,
        testHarness: false,
        openAtLogin: false,
        loginItem: { setLoginItemSettings: vi.fn() },
        env: { XDG_CONFIG_HOME: xdg },
        paths: { execPath: '/opt/rased/rased', homeDir: xdg }
      })
    ).not.toThrow()
  })

  it('does not touch Linux desktop files when unpackaged and never throws on errors', () => {
    const writeFile = vi.fn(() => { throw new Error('disk full') })
    const mkdir = vi.fn()
    applyAutoStart({
      platform: 'linux',
      packaged: false,
      testHarness: false,
      openAtLogin: true,
      loginItem: { setLoginItemSettings: vi.fn() },
      env: { XDG_CONFIG_HOME: '/home/user/.xdg' },
      paths: { execPath: '/opt/rased/rased', homeDir: '/home/user', join: posix.join, isAbsolute: posix.isAbsolute },
      fs: { mkdirSync: mkdir, writeFileSync: writeFile, unlinkSync: vi.fn() }
    })
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()

    expect(() =>
      applyAutoStart({
        platform: 'linux',
        packaged: true,
        testHarness: false,
        openAtLogin: true,
        loginItem: { setLoginItemSettings: vi.fn() },
        env: { XDG_CONFIG_HOME: '/home/user/.xdg' },
        paths: { execPath: '/opt/rased/rased', homeDir: '/home/user', join: posix.join, isAbsolute: posix.isAbsolute },
        fs: { mkdirSync: mkdir, writeFileSync: writeFile, unlinkSync: vi.fn() }
      })
    ).not.toThrow()
    expect(writeFile).toHaveBeenCalledWith(
      '/home/user/.xdg/autostart/rased.desktop',
      expect.stringContaining('Exec="/opt/rased/rased"'),
      'utf8'
    )

    expect(() =>
      applyAutoStart({
        platform: 'win32',
        packaged: true,
        testHarness: false,
        openAtLogin: true,
        loginItem: { setLoginItemSettings: () => { throw new Error('denied') } }
      })
    ).not.toThrow()
  })
})
