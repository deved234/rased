import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface AutoStartFs {
  mkdirSync(path: string, options: { recursive: true }): unknown
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
  unlinkSync(path: string): void
}

export interface AutoStartLoginItemPort {
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

export interface AutoStartOptions {
  platform: NodeJS.Platform
  packaged: boolean
  testHarness: boolean
  openAtLogin: boolean
  loginItem: AutoStartLoginItemPort
  env?: NodeJS.ProcessEnv
  paths?: {
    execPath?: string
    homeDir?: string
    join?: (...paths: string[]) => string
    isAbsolute?: (path: string) => boolean
  }
  fs?: AutoStartFs
}

/**
 * Quote and escape an executable path for a Desktop Entry `Exec=` value.
 * Applies Desktop Entry `Exec` double-quote escaping followed by desktop string
 * backslash escaping, since string unescaping runs before `Exec` tokenization.
 */
export function quoteDesktopExec(executable: string): string {
  const execEscaped = executable
    .replace(/%/g, '%%')
    .replace(/[\\"$`]/g, '\\$&')
  const stringEscaped = execEscaped.replace(/\\/g, '\\\\')
  return `"${stringEscaped}"`
}

/** Build the XDG autostart `.desktop` file content for RASED on Linux. */
export function buildDesktopEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RASED',
    `Exec=${quoteDesktopExec(executable)}`,
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=false',
    ''
  ].join('\n')
}

/** Apply the user's startup-launch setting for the active desktop platform. */
export function applyAutoStart(options: AutoStartOptions): void {
  if (options.testHarness) return
  if (options.platform === 'win32' || options.platform === 'darwin') {
    try {
      options.loginItem.setLoginItemSettings({ openAtLogin: options.openAtLogin })
    } catch {
      /* best effort; surfaced in README as manual fallback */
    }
    return
  }
  if (options.platform !== 'linux' || !options.packaged) return

  const env = options.env ?? process.env
  const joinPath = options.paths?.join ?? join
  const checkAbsolute = options.paths?.isAbsolute ?? isAbsolute
  const homeDir = options.paths?.homeDir || env['HOME'] || homedir()
  const xdgConfigHome = env['XDG_CONFIG_HOME']
  const configDir = xdgConfigHome && checkAbsolute(xdgConfigHome) ? xdgConfigHome : joinPath(homeDir, '.config')
  const autostartDir = joinPath(configDir, 'autostart')
  const desktopPath = joinPath(autostartDir, 'rased.desktop')
  const fsOps = options.fs ?? { mkdirSync, writeFileSync, unlinkSync }

  try {
    if (options.openAtLogin) {
      const executable = env['APPIMAGE'] || options.paths?.execPath || process.execPath
      if (!executable) return
      fsOps.mkdirSync(autostartDir, { recursive: true })
      fsOps.writeFileSync(desktopPath, buildDesktopEntry(executable), 'utf8')
    } else {
      fsOps.unlinkSync(desktopPath)
    }
  } catch {
    /* best effort */
  }
}
