export interface ProjectFactValues {
  budgetMin: number | null
  budgetMax: number | null
  budgetRaw: string | null
  currency: string | null
  durationDays: number | null
  durationRaw: string | null
}
export interface ProjectFacts extends ProjectFactValues {
  projectId: number
  status: 'not_requested' | 'loading' | 'ready' | 'failed' | 'deferred' | 'unsupported'
  fetchedAt: string | null
  errorCode: string | null
  deferredReason?: 'paused' | 'disabled' | 'cooldown'
}
export const FACTS_TTL_MS = 24 * 60 * 60 * 1000
export const FACTS_RETRY_MS = 60_000
