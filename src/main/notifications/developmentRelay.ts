// A source build needs an app entry when Windows launches its COM server.
// This host receives the native callback without acquiring RASED's singleton
// lock, then hands the capability to the correct source app/profile.
import { app, Notification, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { notificationActivationUrl, parseNotificationActivation } from '../../shared/notificationActivation.js'
import { ensureDevelopmentComRegistration, validDevelopmentActivation, windowsRegistrationPort } from './developmentRegistration.js'

async function run(): Promise<void> {
  const args = process.argv.filter(arg => arg.startsWith('--rased-relay-config='))
  if (args.length !== 1) throw Error('missing-relay-config')
  const file = args[0]!.slice('--rased-relay-config='.length)
  const config: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!validDevelopmentActivation(config) || config.executable.toLowerCase() !== process.execPath.toLowerCase()) throw Error('invalid-relay-config')
  app.setPath('userData', config.userData)
  app.setName('RASED Development')
  app.setAppUserModelId(config.appId)
  app.setToastActivatorCLSID(config.clsid)
  const timeout = setTimeout(() => app.quit(), 15000)
  const seen = new Set<string>(), pending = new Set<Promise<void>>()
  let exitTimer: NodeJS.Timeout | null = null
  const ready = app.whenReady().then(async () => {
    if (!Notification.isSupported()) throw Error('notifications-unavailable')
    // Electron refreshes LocalServer32 here too. Keep subsequent old-toast
    // activations pointing at this explicit source entry.
    await ensureDevelopmentComRegistration(config, file, join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), windowsRegistrationPort(() => app.toastActivatorCLSID, path => shell.readShortcutLink(path)))
  })
  Notification.handleActivation(details => {
    const token = parseNotificationActivation(details.arguments, 'rased-dev')
    if (!token || seen.has(token) || seen.size >= 10) return
    seen.add(token)
    if (exitTimer) clearTimeout(exitTimer)
    const work = ready.then(async () => {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      await new Promise<void>((resolve, reject) => {
        const child = spawn(config.executable, [config.appPath, '--user-data-dir=' + config.userData, notificationActivationUrl(token, 'rased-dev')], { env, windowsHide: true, detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    }).catch(() => {})
    pending.add(work)
    void work.finally(() => {
      pending.delete(work)
      if (!pending.size) {
        clearTimeout(timeout)
        exitTimer = setTimeout(() => app.quit(), 100)
      }
    })
  })
  await ready
}
void run().catch(() => app.quit())
