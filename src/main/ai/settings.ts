import type { Db } from '../../storage/db.js'
import { getSettingRaw, setSettingRaw } from '../../storage/repositories.js'
import { AI_PROVIDERS, defaultAiSettings, sanitizeAiSettings, type AiCatalog, type AiProviderId, type AiSelection, type AiSetup, type AiVerification } from '../../shared/ai.js'
import { keyStatus } from './keyStore.js'
import { modelCapabilities, type ModelCapabilities } from './providers.js'

function read<T>(db: Db, key: string): T | null { try { return JSON.parse(getSettingRaw(db, key) ?? 'null') as T | null } catch { return null } }
export function getAiSettings(db: Db): ReturnType<typeof defaultAiSettings> { return sanitizeAiSettings(read(db, 'ai-settings')) ?? defaultAiSettings() }
export function saveAiSettings(db: Db, value: unknown): boolean {
  const settings = sanitizeAiSettings(value)
  if (!settings) return false
  setSettingRaw(db, 'ai-settings', JSON.stringify(settings)); return true
}
export function getAiSetup(db: Db, userData: string): AiSetup {
  const providers = {} as AiSetup['providers']
  for (const provider of AI_PROVIDERS) {
    const status = keyStatus(userData, provider)
    const stored = read<AiCatalog & { revision: string }>(db, `ai-catalog-${provider}`)
    const catalog = stored && stored.revision === status.revision && Array.isArray(stored.models) && typeof stored.fetchedAt === 'string' ? { models: stored.models, fetchedAt: stored.fetchedAt } : null
    const verification = read<AiVerification>(db, `ai-verification-${provider}`)
    providers[provider] = { ...status, catalog, verification: verification?.revision === status.revision ? verification : null }
  }
  return { settings: getAiSettings(db), providers }
}
export function saveCatalog(db: Db, provider: AiProviderId, catalog: AiCatalog, revision: string): void { setSettingRaw(db, `ai-catalog-${provider}`, JSON.stringify({ ...catalog, revision })) }
export function saveVerification(db: Db, provider: AiProviderId, verification: AiVerification): void { setSettingRaw(db, `ai-verification-${provider}`, JSON.stringify(verification)) }
export function getCapabilities(db: Db, userData: string, selection: AiSelection): ModelCapabilities {
  const listed = getAiSetup(db, userData).providers[selection.provider].catalog?.models.find(m => m.id === selection.model)
  return modelCapabilities(selection, listed)
}
