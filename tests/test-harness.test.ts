import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isolatedTestHarness } from '../src/main/testHarness.js'
import { loadAppSettings } from '../src/storage/appSettings.js'
import { openDatabase } from '../src/storage/db.js'
import { getSettingRaw, setSettingRaw } from '../src/storage/repositories.js'
import { defaultSettings, sanitizeSettings, type AppSettings } from '../src/shared/types.js'
import { selectWhatsNew } from '../src/shared/whatsNew.js'

const profiles: string[] = []
const marker = 'RASED isolated integration test'

function newProfile(): string {
  const profile = mkdtempSync(join(tmpdir(), 'rased-test-harness-'))
  profiles.push(profile)
  writeFileSync(join(profile, '.rased-test-profile'), marker)
  return profile
}

afterEach(() => {
  for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true })
})

describe('isolated harness What’s New opt-in', () => {
  it.each([null, '0.10.0'])('persists the current version over %j before subsequent settings merges', seen => {
    const harness = isolatedTestHarness(newProfile(), ['--rased-test'])!
    const db = openDatabase(':memory:')
    try {
      setSettingRaw(db, 'app', JSON.stringify({ ...defaultSettings(), language: 'en', whatsNewSeen: seen }))
      const save = vi.fn((settings: AppSettings) => setSettingRaw(db, 'app', JSON.stringify(settings)))
      harness.initializeSettings(loadAppSettings(db, '0.11.0'), '0.11.0', save)
      expect(save).toHaveBeenCalledTimes(1)
      expect(JSON.parse(getSettingRaw(db, 'app')!).whatsNewSeen).toBe('0.11.0')
      // Model a later settings save that reads and sanitizes the stored app row.
      const merged = sanitizeSettings({ ...JSON.parse(getSettingRaw(db, 'app')!), soundEnabled: false })
      setSettingRaw(db, 'app', JSON.stringify(merged))
      const reloaded = loadAppSettings(db, '0.11.0')
      expect(reloaded.language).toBe('en')
      expect(reloaded.soundEnabled).toBe(false)
      expect(reloaded.whatsNewSeen).toBe('0.11.0')
      expect(selectWhatsNew(reloaded.whatsNewSeen, '0.11.0')).toEqual([])
      harness.initializeSettings(reloaded, '0.11.0', save)
      expect(save).toHaveBeenCalledTimes(1)
    } finally { db.close() }
  })

  it('suppresses automatic upgrade dialogs without a fixture', () => {
    const harness = isolatedTestHarness(newProfile(), ['--rased-test'])
    expect(harness?.suppressWhatsNew).toBe(true)
    expect(harness?.appVersion).toBeUndefined()
  })

  it('preserves fixture behavior on initial launch and restart', () => {
    const profile = newProfile()
    writeFileSync(join(profile, 'whats-new-fixture.json'), JSON.stringify({ version: '0.11.0' }))
    for (let launch = 0; launch < 2; launch++) {
      const harness = isolatedTestHarness(profile, ['--rased-test'])
      expect(harness?.suppressWhatsNew).toBe(false)
      expect(harness?.appVersion).toBe('0.11.0')
      const save = vi.fn()
      harness?.initializeSettings(defaultSettings(), '0.11.0', save)
      expect(save).not.toHaveBeenCalled()
    }
  })

  it('does not suppress explicit fixtures with an invalid version', () => {
    const profile = newProfile()
    writeFileSync(join(profile, 'whats-new-fixture.json'), JSON.stringify({ version: 'invalid' }))
    const harness = isolatedTestHarness(profile, ['--rased-test'])
    expect(harness?.suppressWhatsNew).toBe(false)
    expect(harness?.appVersion).toBeUndefined()
    const save = vi.fn()
    harness?.initializeSettings(defaultSettings(), '0.11.0', save)
    expect(save).not.toHaveBeenCalled()
  })

  it('requires both the test argument and the valid TEMP marker', () => {
    const profile = newProfile()
    expect(isolatedTestHarness(profile, [])).toBeNull()
    writeFileSync(join(profile, '.rased-test-profile'), 'invalid')
    expect(isolatedTestHarness(profile, ['--rased-test'])).toBeNull()
    rmSync(join(profile, '.rased-test-profile'))
    expect(isolatedTestHarness(profile, ['--rased-test'])).toBeNull()
  })
})
