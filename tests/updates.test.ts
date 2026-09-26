import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { UpdateController, type UpdaterPort } from '../src/main/updates.js'

class Port extends EventEmitter implements UpdaterPort {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checks = 0
  downloads = 0
  installs: boolean[][] = []
  check: () => Promise<void> = async () => { this.emit('update-available', { version: '0.3.0', releaseNotes: '<h2>Changes</h2>\nNew feature' }) }
  download: () => Promise<void> = async () => { this.emit('download-progress', { percent: 42, total: 100, transferred: 42 }); this.emit('update-downloaded', { version: '0.3.0' }) }
  async checkForUpdates(): Promise<void> { this.checks++; await this.check() }
  async downloadUpdate(): Promise<void> { this.downloads++; await this.download() }
  quitAndInstall(silent: boolean, relaunch: boolean): void { this.installs.push([silent, relaunch]) }
}
describe('Update lifecycle', () => {
  it('disables automatic downloads/quit installation, prereleases and downgrades', () => {
    const port = new Port(); new UpdateController(port, '0.2.5', () => {})
    expect([port.autoDownload, port.autoInstallOnAppQuit, port.allowPrerelease, port.allowDowngrade]).toEqual([false, false, false, false])
  })
  it('requires explicit download and one install; preserves a download on repeated checks', async () => {
    const port = new Port(), controller = new UpdateController(port, '0.2.5', () => {})
    expect(controller.install().ok).toBe(false); expect((await controller.download()).ok).toBe(false)
    await controller.check(); expect(port.downloads).toBe(0)
    expect(controller.snapshot().notes).toBe('Changes\nNew feature')
    expect((await controller.download()).ok).toBe(true)
    expect(controller.snapshot().percent).toBe(100)
    expect((await controller.check()).ok).toBe(false)
    expect(controller.install().ok).toBe(true); expect(controller.install().ok).toBe(false)
    expect(port.installs).toEqual([[true, true]])
  })
  it('serializes requests and clamps invalid progress', async () => {
    const port = new Port(), controller = new UpdateController(port, '0.2.5', () => {})
    let complete!: () => void
    port.check = () => new Promise(resolve => { complete = () => { port.emit('update-available', { version: '0.3.0' }); resolve() } })
    const checking = controller.check()
    expect((await controller.check()).ok).toBe(false); expect((await controller.download()).ok).toBe(false)
    complete(); await checking
    port.download = async () => {
      port.emit('download-progress', { percent: 700, total: NaN, transferred: -5 })
      expect(controller.snapshot()).toMatchObject({ percent: 100, total: 0, transferred: 0 })
      expect((await controller.check()).ok).toBe(false)
      port.emit('update-downloaded', { version: '0.3.0' })
    }
    await controller.download(); expect(port.checks).toBe(1)
  })
  it('recovers from offline checks and checksum failures without installing', async () => {
    const port = new Port(), controller = new UpdateController(port, '0.2.5', () => {})
    port.check = async () => { throw Error('offline') }
    expect((await controller.check()).ok).toBe(false); expect(controller.snapshot().error).toBe('check')
    port.check = async () => { port.emit('update-available', { version: '0.3.0' }) }
    await controller.check()
    port.download = async () => { throw Error('checksum mismatch') }
    await controller.download(); expect(controller.snapshot()).toMatchObject({ phase: 'error', error: 'download', version: '0.3.0' })
    expect(controller.install().ok).toBe(false)
    port.download = async () => { port.emit('update-downloaded', { version: '0.3.0' }) }
    expect((await controller.download()).ok).toBe(true); expect(port.installs).toEqual([])
  })
  it('handles no update, disabled development, malformed metadata and cleanup', async () => {
    const disabled = new UpdateController(null, '0.2.5', () => {})
    expect((await disabled.check()).error).toBe('disabled'); expect(disabled.install().ok).toBe(false)
    const port = new Port(), controller = new UpdateController(port, '0.2.5', () => {})
    port.check = async () => { port.emit('update-available', { version: '<script>' }) }
    await controller.check(); expect(controller.snapshot().phase).toBe('error')
    port.check = async () => { port.emit('update-not-available', { version: '0.2.5' }) }
    await controller.check(); expect(controller.snapshot()).toMatchObject({ phase: 'idle', version: null, error: null })
    controller.dispose(); expect(port.listenerCount('update-available')).toBe(0)
    expect(() => port.emit('error', Error('late request failure during quit'))).not.toThrow()
  })
  it('does not claim successful installation after an installer error', async () => {
    const port = new Port(), controller = new UpdateController(port, '0.2.5', () => {})
    await controller.check(); await controller.download()
    port.quitAndInstall = () => { port.emit('error', Error('installer missing')) }
    expect(controller.install().ok).toBe(false); expect(controller.snapshot().error).toBe('install')
  })
})
