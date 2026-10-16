import { describe, expect, it, vi } from 'vitest'
import { repairLegacyDevShortcut, RASED_APP_ID, RASED_DEV_APP_ID, taskbarDetails } from '../src/main/taskbar.js'

describe('Windows taskbar identity', () => {
  it('pairs the installed relaunch name/command with an explicit branded icon', () => {
    expect(taskbarDetails(true, 'F:\\New folder (2)\\RASED\\RASED.exe', 'unused', 'F:\\RASED\\branding\\icon.ico')).toEqual({
      appId: RASED_APP_ID, appIconPath: 'F:\\RASED\\branding\\icon.ico', appIconIndex: 0,
      relaunchCommand: '"F:\\New folder (2)\\RASED\\RASED.exe"', relaunchDisplayName: 'RASED'
    })
  })

  it('keeps source launches separate and includes the compiled entry point', () => {
    const details = taskbarDetails(false, 'D:\\My project\\RASED-Development.exe', 'D:\\My project\\out\\main\\index.js', 'icon.ico')
    expect(details.appId).toBe(RASED_DEV_APP_ID)
    expect(details.relaunchCommand).toBe('"D:\\My project\\RASED-Development.exe" "D:\\My project\\out\\main\\index.js"')
  })

  it.each(['electron.exe', 'RASED-Development.exe'])('repairs only the mistaken installed identity on %s', executable => {
    const shortcut = { target: `D:\\project\\${executable}`, args: '--existing', icon: 'original.ico', appUserModelId: RASED_APP_ID }
    const port = { readShortcutLink: () => shortcut, writeShortcutLink: vi.fn(() => true) }
    expect(repairLegacyDevShortcut('old.lnk', port)).toBe(true)
    expect(port.writeShortcutLink).toHaveBeenCalledWith('old.lnk', 'update', { ...shortcut, appUserModelId: RASED_DEV_APP_ID })
  })

  it.each([
    { target: 'F:\\RASED\\RASED.exe', appUserModelId: RASED_APP_ID },
    { target: 'D:\\electron.exe', appUserModelId: 'another.app' },
    { target: 'D:\\electron.exe', appUserModelId: RASED_DEV_APP_ID }
  ])('preserves installed and unrelated shortcuts: $target / $appUserModelId', shortcut => {
    const port = { readShortcutLink: () => shortcut, writeShortcutLink: vi.fn(() => true) }
    expect(repairLegacyDevShortcut('shortcut.lnk', port)).toBe(false)
    expect(port.writeShortcutLink).not.toHaveBeenCalled()
  })

  it('tolerates broken shortcuts and failed Windows updates', () => {
    const writeShortcutLink = vi.fn(() => false)
    expect(repairLegacyDevShortcut('broken.lnk', { readShortcutLink: () => { throw Error('unreadable') }, writeShortcutLink })).toBe(false)
    expect(writeShortcutLink).not.toHaveBeenCalled()
    expect(repairLegacyDevShortcut('old.lnk', { readShortcutLink: () => ({ target: 'electron.exe', appUserModelId: RASED_APP_ID }), writeShortcutLink })).toBe(false)
  })
})
