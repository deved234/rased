import type { Db } from './db.js'
import { getSettingRaw, setSettingRaw } from './repositories.js'
import { emptyProposalProfile, sanitizeProposalProfile, type ProposalProfile } from '../shared/proposals.js'
import { defaultProfile, LEGACY_PROFILE_ID, sanitizeProfileSet, type ProfileSet, type ProfileSetState } from '../shared/proposalProfiles.js'
import { sanitizeSettings, type AppSettings } from '../shared/types.js'

function read(db: Db, key: string): unknown {
  try { return JSON.parse(getSettingRaw(db, key) ?? 'null') } catch { return null }
}

export function legacyProfileSet(db: Db): ProfileSet {
  const profile = sanitizeProposalProfile(read(db, 'proposal-profile')) ?? emptyProposalProfile()
  const app = sanitizeSettings(read(db, 'app'))
  return { version: 1, defaultId: LEGACY_PROFILE_ID, profiles: [{ ...profile, id: LEGACY_PROFILE_ID, name: app.language === 'ar' ? 'الافتراضي' : 'Default', quickTemplate: app.quickApply.template }] }
}

/** Reads never repair storage. Differences in mirrors are edits from an older app. */
export function readProfileSet(db: Db): ProfileSetState {
  const raw = getSettingRaw(db, 'proposal-profiles')
  const legacy = legacyProfileSet(db)
  if (raw === null) return { set: legacy, error: null }
  const set = sanitizeProfileSet(read(db, 'proposal-profiles'))
  if (!set) return { set: legacy, error: 'invalid-profile-set' }
  const profile = defaultProfile(set)
  const facts = sanitizeProposalProfile(read(db, 'proposal-profile'))
  if (facts) Object.assign(profile, facts)
  const app = read(db, 'app') as { quickApply?: { template?: unknown } } | null
  if (typeof app?.quickApply?.template === 'string' && app.quickApply.template.length <= 10000) profile.quickTemplate = app.quickApply.template
  return { set, error: null }
}

/** Caller owns the transaction; read app here to preserve unrelated settings. */
export function writeProfileSetTx(db: Db, value: ProfileSet): AppSettings {
  const set = sanitizeProfileSet(value)
  if (!set) throw Error('invalid-profile-set')
  const profile = defaultProfile(set)
  const facts = sanitizeProposalProfile(profile)!
  const app = sanitizeSettings(read(db, 'app'))
  app.quickApply.template = profile.quickTemplate
  setSettingRaw(db, 'proposal-profiles', JSON.stringify(set))
  setSettingRaw(db, 'proposal-profile', JSON.stringify(facts))
  setSettingRaw(db, 'app', JSON.stringify(app))
  return app
}

export function selectedProfile(db: Db, id?: string): { id: string; profile: ProposalProfile } | null {
  const { set } = readProfileSet(db)
  const entry = set.profiles.find(p => p.id === (id ?? set.defaultId))
  return entry ? { id: entry.id, profile: sanitizeProposalProfile(entry)! } : null
}
