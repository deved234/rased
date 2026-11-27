import { beforeEach, describe, expect, it, vi } from 'vitest'

const constructed = vi.hoisted(() => [] as string[])
vi.mock('electron', () => ({ shell: { openPath: vi.fn(async () => '') } }))
vi.mock('electron-updater', () => {
  class FakeBase {
    autoDownload = true; autoInstallOnAppQuit = true; allowPrerelease = true; allowDowngrade = true
    on() { return this }
    removeListener() { return this }
    async checkForUpdates() { return null }
    async downloadUpdate() { return null }
    quitAndInstall() {}
    protected async executeDownload() { return [] as string[] }
    protected get installerPath(): string | null { return null }
    protected get httpExecutor() { return { download: async () => {} } }
  }
  class FakeNsis extends FakeBase { constructor() { super(); constructed.push('nsis') } }
  class FakeAppImage extends FakeBase { constructor() { super(); constructed.push('appimage') } }
  class FakeDeb extends FakeBase { constructor() { super(); constructed.push('deb') } }
  return { BaseUpdater: FakeBase, NsisUpdater: FakeNsis, AppImageUpdater: FakeAppImage, DebUpdater: FakeDeb }
})

import { AppImageUpdater, DebUpdater, NsisUpdater } from 'electron-updater'
import { DmgUpdater, createUpdaterPort } from '../src/main/platform/updater.js'

describe('platform updater selection', () => {
  beforeEach(() => { constructed.length = 0 })
  it('selects the expected updater and mode per platform', () => {
    const win = createUpdaterPort('win32', {})
    expect(win?.mode).toBe('install')
    expect(win?.port).toBeInstanceOf(NsisUpdater)

    constructed.length = 0
    const appImage = createUpdaterPort('linux', { APPIMAGE: '/tmp/Rased.AppImage' })
    expect(appImage?.mode).toBe('install')
    expect(appImage?.port).toBeInstanceOf(AppImageUpdater)

    constructed.length = 0
    const deb = createUpdaterPort('linux', {})
    expect(deb?.mode).toBe('notify')
    expect(deb?.port).toBeInstanceOf(DebUpdater)

    constructed.length = 0
    const mac = createUpdaterPort('darwin', {})
    expect(mac?.mode).toBe('open-installer')
    expect(mac?.port).toBeInstanceOf(DmgUpdater)

    expect(createUpdaterPort('freebsd' as NodeJS.Platform, {})).toBeNull()
  })
  it('constructs only the selected updater', () => {
    createUpdaterPort('win32', {})
    expect(constructed).toEqual(['nsis'])
    constructed.length = 0
    createUpdaterPort('linux', { APPIMAGE: '/x' })
    expect(constructed).toEqual(['appimage'])
    constructed.length = 0
    createUpdaterPort('linux', {})
    expect(constructed).toEqual(['deb'])
    constructed.length = 0
    createUpdaterPort('darwin', {})
    expect(constructed).toEqual([])
  })
})
