import { describe, expect, it } from 'vitest'
import { defaultSettings, sanitizeSettings } from '../src/shared/types.js'

describe('compact filter preference compatibility', () => {
  it('keeps all sources for old installations and preserves their other preferences', () => {
    const old = { ...defaultSettings(), ui: { theme: 'light', textScale: 125, previewRatio: 0.4, compactAlwaysOnTop: true } }
    const result = sanitizeSettings(old)
    expect(result.ui.compactUseDisplayFilter).toBe(false)
    expect(result.ui.theme).toBe('light')
    expect(result.ui.compactAlwaysOnTop).toBe(true)
    expect(result.ui.textScale).toBe(125)
  })
  it('round trips an explicit opt-in without accepting truthy malformed values', () => {
    const settings = defaultSettings()
    settings.ui.compactUseDisplayFilter = true
    expect(sanitizeSettings(JSON.parse(JSON.stringify(settings))).ui.compactUseDisplayFilter).toBe(true)
    expect(sanitizeSettings({ ui: { compactUseDisplayFilter: 'true' } }).ui.compactUseDisplayFilter).toBe(false)
  })
})
