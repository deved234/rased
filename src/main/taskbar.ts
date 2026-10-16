import { win32 } from 'node:path'
import type { AppDetailsOptions, ShortcutDetails } from 'electron'

export const RASED_APP_ID = 'com.rased.app'
export const RASED_DEV_APP_ID = 'com.rased.app.development'

function quoteArgument(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}

export function taskbarDetails(packaged: boolean, executable: string, mainFile: string, icon: string): AppDetailsOptions {
  return {
    appId: packaged ? RASED_APP_ID : RASED_DEV_APP_ID,
    appIconPath: icon,
    appIconIndex: 0,
    // Windows requires the relaunch command and display name together. Never
    // replay --updated, notification links or temporary test/profile arguments.
    relaunchCommand: packaged ? quoteArgument(executable) : `${quoteArgument(executable)} ${quoteArgument(mainFile)}`,
    relaunchDisplayName: 'RASED'
  }
}

type ShortcutPort = {
  readShortcutLink(path: string): ShortcutDetails
  writeShortcutLink(path: string, operation: 'update', options: ShortcutDetails): boolean
}

/** Older development notifications registered Electron under the installed ID. */
export function repairLegacyDevShortcut(path: string, shell: ShortcutPort): boolean {
  try {
    const shortcut = shell.readShortcutLink(path)
    const executable = win32.basename(shortcut.target ?? '').toLowerCase()
    if (shortcut.appUserModelId !== RASED_APP_ID || !['electron.exe', 'rased-development.exe'].includes(executable)) return false
    // Keep the user's target, arguments, icon and pin; change only its grouping.
    return shell.writeShortcutLink(path, 'update', { ...shortcut, appUserModelId: RASED_DEV_APP_ID })
  } catch {
    // An unreadable shortcut must never prevent the application from opening.
    return false
  }
}
