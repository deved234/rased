import { existsSync } from 'node:fs'
import { shell } from 'electron'
import { AppImageUpdater, BaseUpdater, DebUpdater, NsisUpdater } from 'electron-updater'
import type { AllPublishOptions } from 'builder-util-runtime'
import type { DownloadUpdateOptions } from 'electron-updater/out/AppUpdater.js'
import { findFile } from 'electron-updater/out/providers/Provider.js'
import type { InstallOptions } from 'electron-updater/out/BaseUpdater.js'
import type { UpdaterPort } from '../updates.js'
import type { UpdateMode } from '../../shared/updates.js'

export class DmgUpdater extends BaseUpdater {
  constructor(options?: AllPublishOptions | null, app?: unknown) {
    super(options, app as never)
  }
  /** @private */
  protected async doDownloadUpdate(downloadUpdateOptions: DownloadUpdateOptions): Promise<Array<string>> {
    const provider = downloadUpdateOptions.updateInfoAndProvider.provider
    const fileInfo = findFile(provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info), 'dmg')
    // findFile falls back to the first file when no dmg exists; never hand that to the installer.
    if (!fileInfo || !fileInfo.url.pathname.toLowerCase().endsWith('.dmg')) throw Error('No DMG file found in release')
    return this.executeDownload({
      fileExtension: 'dmg',
      fileInfo,
      downloadUpdateOptions,
      task: async (updateFile, downloadOptions) => {
        await (this as unknown as { httpExecutor: { download: (url: URL, dest: string, options: unknown) => Promise<void> } }).httpExecutor.download(fileInfo.url, updateFile, downloadOptions)
      }
    })
  }
  protected doInstall(options: InstallOptions): boolean {
    void options
    const file = this.installerPath
    if (!file || !existsSync(file)) return false
    void shell.openPath(file)
    return true
  }
}

export function createUpdaterPort(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { port: UpdaterPort; mode: UpdateMode } | null {
  if (platform === 'win32') return { port: new NsisUpdater() as unknown as UpdaterPort, mode: 'install' }
  if (platform === 'linux') {
    if (env.APPIMAGE) return { port: new AppImageUpdater() as unknown as UpdaterPort, mode: 'install' }
    return { port: new DebUpdater() as unknown as UpdaterPort, mode: 'notify' }
  }
  if (platform === 'darwin') return { port: new DmgUpdater() as unknown as UpdaterPort, mode: 'open-installer' }
  return null
}
