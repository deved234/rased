import { sanitizeProposalProfile, type ProposalProfile } from './proposals.js'

export interface ProfileEntry extends ProposalProfile { id: string; name: string; quickTemplate: string }
export interface ProfileSet { version: 1; defaultId: string; profiles: ProfileEntry[] }
export interface ProfileSetState { set: ProfileSet; error: 'invalid-profile-set' | null }
export const LEGACY_PROFILE_ID = '0'.repeat(32)
export function validProfileId(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) }

export function sanitizeProfileSet(value: unknown): ProfileSet | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.version !== 1 || !validProfileId(v.defaultId) || !Array.isArray(v.profiles) || v.profiles.length < 1 || v.profiles.length > 10) return null
  const profiles: ProfileEntry[] = []
  for (const item of v.profiles) {
    const profile = sanitizeProposalProfile(item)
    if (!profile || !validProfileId(item.id) || profiles.some(p => p.id === item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || typeof item.quickTemplate !== 'string' || item.quickTemplate.length > 10000) return null
    profiles.push({ ...profile, id: item.id, name: item.name.trim(), quickTemplate: item.quickTemplate })
  }
  return profiles.some(p => p.id === v.defaultId) ? { version: 1, defaultId: v.defaultId, profiles } : null
}

export function defaultProfile(set: ProfileSet): ProfileEntry { return set.profiles.find(p => p.id === set.defaultId)! }
