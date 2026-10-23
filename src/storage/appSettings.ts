import type { Db } from './db.js'
import { getSettingRaw, setSettingRaw } from './repositories.js'
import { defaultSettings, sanitizeSettings, type AppSettings } from '../shared/types.js'

export function loadAppSettings(db: Db, currentVersion: string): AppSettings {
  const raw = getSettingRaw(db, 'app')
  if (raw === null) {
    const existing = db.prepare(`SELECT EXISTS(SELECT 1 FROM projects)
      OR EXISTS(SELECT 1 FROM proposal_drafts)
      OR EXISTS(SELECT 1 FROM settings WHERE key <> 'app') AS hasData`).get() as { hasData: number }
    const initial = { ...defaultSettings(), whatsNewSeen: existing.hasData ? null : currentVersion }
    setSettingRaw(db, 'app', JSON.stringify(initial))
    return initial
  }
  try { return sanitizeSettings(JSON.parse(raw) as unknown) }
  catch { return defaultSettings() }
}
