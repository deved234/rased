import { clearQuickConsent } from './quickConsent.js'
import type { Db } from './db.js'
import { getSettingRaw, listSavedFilters, runInTransaction, saveSavedFilterRow, setSettingRaw } from './repositories.js'
import { defaultSettings, sanitizeSavedFilter, sanitizeSettings, type AppSettings, type SavedFilter } from '../shared/types.js'
import { emptyProposalProfile, sanitizeProposalProfile, type ProposalProfile } from '../shared/proposals.js'
import { defaultAiSettings, sanitizeAiSettings, type AiSettings } from '../shared/ai.js'
import { defaultProfile, sanitizeProfileSet, type ProfileSet } from '../shared/proposalProfiles.js'
import { readProfileSet, writeProfileSetTx } from './proposalProfiles.js'
import { validQuickApply } from '../shared/quickApply.js'
import { isDeepStrictEqual } from 'node:util'

// Explicit allow-list: temporary DND and window coordinates stay on this device.
export const TRANSFER_SETTINGS_KEYS = [
  'language', 'pollIntervalMs', 'notificationsEnabled', 'soundEnabled', 'runAtStartup',
  'mostaqlEnabled', 'mostaqlNotificationsEnabled',
  'khamsatEnabled', 'khamsatNotificationsEnabled', 'khamsatKeywordsAny', 'khamsatExcludeKeywords',
  'nafezlyEnabled', 'nafezlyNotificationsEnabled', 'nafezlyKeywordsAny', 'nafezlyExcludeKeywords',
  'kafEnabled', 'kafNotificationsEnabled', 'kafKeywordsAny', 'kafExcludeKeywords',
  'notifyFilter', 'displayFilter', 'displayQuery', 'linkDisplayAndNotifyFilters',
  'notifyUncertainCategory', 'showUnreadOnly', 'quickApply', 'ui'
] as const satisfies readonly (keyof AppSettings)[]

export interface SettingsTransfer {
  format: 'rased-settings'
  version: 1 | 2 | 3
  settings: Partial<AppSettings>
  savedFilters: SavedFilter[]
  proposalProfiles?: ProfileSet
  quickTemplatePresent?: boolean
  proposalProfile?: ProposalProfile
  aiSettings?: AiSettings
}

export function settingsPayload(db: Db, settings?: AppSettings): SettingsTransfer {
  const read = (key: string): unknown => { try { return JSON.parse(getSettingRaw(db, key) ?? 'null') } catch { return null } }
  const state = readProfileSet(db)
  if (state.error) throw Error(state.error)
  const profile = defaultProfile(state.set)
  const stored = sanitizeSettings(settings ?? read('app'))
  stored.quickApply.template = profile.quickTemplate
  const { enabled, template, budgetPositionPercent, extraDays } = stored.quickApply
  stored.quickApply = { enabled, template, budgetPositionPercent, extraDays }
  return {
    format: 'rased-settings', version: 3,
    settings: Object.fromEntries(TRANSFER_SETTINGS_KEYS.map(key => [key, stored[key]])),
    savedFilters: listSavedFilters(db), proposalProfiles: state.set, proposalProfile: sanitizeProposalProfile(profile) ?? emptyProposalProfile(), aiSettings: sanitizeAiSettings(read('ai-settings')) ?? defaultAiSettings()
  }
}

export function parseSettingsTransfer(value: unknown): SettingsTransfer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('bad-schema')
  const v = value as Record<string, unknown>
  if (v.format !== 'rased-settings' || (v.version !== 1 && v.version !== 2 && v.version !== 3) || !Array.isArray(v.savedFilters) || v.savedFilters.length > 1000 || !v.settings || typeof v.settings !== 'object' || Array.isArray(v.settings)) throw Error('bad-schema')
  const proposalProfiles = v.version === 3 && Object.hasOwn(v, 'proposalProfiles') ? sanitizeProfileSet(v.proposalProfiles) : undefined
  if (proposalProfiles === null) throw Error('bad-schema')
  const raw = { ...v.settings as Record<string, unknown> }
  const quick = raw.quickApply
  const quickTemplatePresent = !!quick && typeof quick === 'object' && Object.hasOwn(quick, 'template')
  if (quick && typeof quick === 'object' && !Array.isArray(quick)) raw.quickApply = { ...quick, ...(proposalProfiles || !quickTemplatePresent ? { template: '' } : {}) }
  if (['ai-quick-consent', 'aiQuickConsent', 'quickConsent'].some(key => Object.hasOwn(v, key) || Object.hasOwn(raw, key))) throw Error('bad-schema')
  const defaults = defaultSettings()
  for (const key of TRANSFER_SETTINGS_KEYS) {
    if (!(key in raw)) continue
    const val = raw[key], base = defaults[key]
    if (typeof base === 'boolean' && typeof val !== 'boolean') throw Error('bad-schema')
    if (Array.isArray(base) && (!Array.isArray(val) || val.length > 100 || val.some(x => typeof x !== 'string' || x.length > 120))) throw Error('bad-schema')
    if (key === 'language' && val !== 'ar' && val !== 'en') throw Error('bad-schema')
    if (key === 'pollIntervalMs' && ![2000, 5000, 15000].includes(val as number)) throw Error('bad-schema')
    if (key === 'quickApply' && !validQuickApply(val)) throw Error('bad-schema')
    if (['notifyFilter', 'displayFilter', 'displayQuery', 'ui'].includes(key) && (!val || typeof val !== 'object' || Array.isArray(val))) throw Error('bad-schema')
  }
  const sanitized = sanitizeSettings(raw)
  const { enabled, template, budgetPositionPercent, extraDays } = sanitized.quickApply
  sanitized.quickApply = { enabled, template, budgetPositionPercent, extraDays }
  const validKnownFields = (input: unknown, normalized: unknown): boolean => {
    if (input && normalized && typeof input === 'object' && typeof normalized === 'object' && !Array.isArray(input) && !Array.isArray(normalized)) {
      return Object.entries(input).every(([key, val]) => !Object.hasOwn(normalized, key) || validKnownFields(val, (normalized as Record<string, unknown>)[key]))
    }
    return isDeepStrictEqual(input, normalized)
  }
  if (v.version !== 1) for (const key of TRANSFER_SETTINGS_KEYS) {
    if (Object.hasOwn(raw, key) && !validKnownFields(raw[key], sanitized[key])) throw Error('bad-schema')
  }
  const settings = Object.fromEntries(TRANSFER_SETTINGS_KEYS.filter(key => Object.hasOwn(raw, key)).map(key => [key, sanitized[key]]))
  const savedFilters = v.savedFilters.map(item => {
    const filter = sanitizeSavedFilter(item)
    if (!filter) throw Error('bad-schema')
    return filter
  })
  if (new Set(savedFilters.map(f => f.id)).size !== savedFilters.length) throw Error('bad-schema')
  let proposalProfile: ProposalProfile | undefined, aiSettings: AiSettings | undefined
  if (!proposalProfiles && Object.hasOwn(v, 'proposalProfile')) {
    proposalProfile = sanitizeProposalProfile(v.proposalProfile) ?? undefined
    if (!proposalProfile) throw Error('bad-schema')
  }
  if (v.version !== 1 && v.aiSettings !== undefined) {
    aiSettings = sanitizeAiSettings(v.aiSettings) ?? undefined
    if (!aiSettings) throw Error('bad-schema')
  }
  return { format: 'rased-settings', version: v.version, settings, savedFilters, proposalProfile, proposalProfiles: proposalProfiles ?? undefined, quickTemplatePresent, aiSettings }
}

export function importSettings(db: Db, current: AppSettings, payload: SettingsTransfer, mode: 'merge' | 'replace', applyStartup: boolean): AppSettings {
  const partial = { ...payload.settings }
  if (!applyStartup) delete partial.runAtStartup
  const state = readProfileSet(db)
  const changesProfiles = !!payload.proposalProfiles || !!payload.proposalProfile || (!!partial.quickApply && payload.quickTemplatePresent !== false)
  if (state.error && changesProfiles) throw Error(state.error)
  const set = payload.proposalProfiles ?? state.set
  const profile = defaultProfile(set)
  if (!payload.proposalProfiles) {
    if (payload.proposalProfile) Object.assign(profile, payload.proposalProfile)
    if (partial.quickApply && payload.quickTemplatePresent !== false) profile.quickTemplate = partial.quickApply.template
  }
  if (partial.quickApply) partial.quickApply = { ...partial.quickApply, template: profile.quickTemplate }
  const next = sanitizeSettings({ ...current, ...partial })
  next.quickApply.template = profile.quickTemplate
  if (next.linkDisplayAndNotifyFilters && next.displayQuery.source === 'mostaql') next.notifyFilter = next.displayQuery.categoryFilter
  next.displayFilter = next.displayQuery.categoryFilter
  runInTransaction(db, () => {
    clearQuickConsent(db)
    setSettingRaw(db, 'app', JSON.stringify(next))
    if (mode === 'replace') db.exec('DELETE FROM saved_filters')
    for (const filter of payload.savedFilters) saveSavedFilterRow(db, filter)
    if (!state.error) writeProfileSetTx(db, set)
    if (payload.aiSettings) setSettingRaw(db, 'ai-settings', JSON.stringify(payload.aiSettings))
  })
  return next
}
