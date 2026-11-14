// Project-watch contract: constants and snapshot types shared by the watcher,
// storage, notifications and UI. See docs/PROJECT_WATCH.md.

export const WATCH_ENABLED = true
export const WATCH_SLOT_MS = 10_000
export const WATCH_SLOT_MAX_MS = 300_000
export const WATCH_CAP_PER_SOURCE = 10
export const WATCH_IDLE_AFTER_MS = 24 * 60 * 60 * 1000
export const WATCH_IDLE_SLOT_MS = 600_000
export const WATCH_EXPIRE_MS = 14 * 24 * 60 * 60 * 1000
export const WATCH_BLOCK_PAUSE_MS = 30 * 60 * 1000
export const WATCH_OFFERS_PAGE_CAP = 50
export const WATCH_SOURCES = ['mostaql', 'nafezly', 'kaf'] as const
export type WatchSource = typeof WATCH_SOURCES[number]
export type WatchPlatformStatus = 'open' | 'in_progress' | 'closed' | 'completed' | 'unknown'
export interface WatchSnapshot {
  /** null = the status row/label is not present in this response. */
  status: WatchPlatformStatus | null
  offers: number | null
  /** true only for mostaql when offers === WATCH_OFFERS_PAGE_CAP. */
  offersCapped: boolean
  /** mostaql only; null elsewhere. */
  contacts: number | null
  /** mostaql only. */
  clientOpen: number | null
  /** mostaql only. */
  clientInProgress: number | null
}
export type WatchPage =
  | { kind: 'snapshot'; snapshot: WatchSnapshot }
  | { kind: 'challenge' }
  | { kind: 'private' }
  | { kind: 'gone' }
  | { kind: 'invalid' }
export type ContactAttribution = 'sure' | 'maybe'

/** A contact count is trustworthy only for an open project whose client is idle elsewhere. */
export function contactAttribution(s: WatchSnapshot): ContactAttribution {
  return s.status === 'open' && s.clientOpen === 1 && s.clientInProgress === 0 ? 'sure' : 'maybe'
}

export type WatchState = 'active' | 'waiting' | 'stopped'
export type WatchOrigin = 'list' | 'preview' | 'detail' | 'compact' | 'watch_view' | 'auto_submitted'
export type WatchStopReason = 'manual' | 'replaced' | 'closed' | 'expired' | 'ignored' | 'gone' | 'source_disabled'
export const WATCH_ORIGINS: readonly WatchOrigin[] = [
  'list',
  'preview',
  'detail',
  'compact',
  'watch_view',
  'auto_submitted'
] as const

export interface WatchRow {
  projectId: number
  state: WatchState
  origin: WatchOrigin
  version: number
  generation: number
  revision: number
  waitingSince: string | null
  startedAt: string | null
  stoppedAt: string | null
  stopReason: WatchStopReason | null
  autoStartBlocked: boolean
  status: WatchPlatformStatus | null
  offers: number | null
  offersCapped: boolean
  contacts: number | null
  clientOpen: number | null
  clientInProgress: number | null
  statusSeenAt: string | null
  detailSeenAt: string | null
  lastAttemptAt: string | null
  lastChangedAt: string | null
  nextDueAt: string | null
  failures: number
  lastError: string | null
}

export type WatchSetResult =
  | { ok: true; row: WatchRow | null; changed: boolean; promoted: number | null }
  | { ok: false; error: 'stale' | 'unknown-project' | 'unsupported-source' | 'bad-origin' }

export type WatchReplaceResult =
  | { ok: true; row: WatchRow; victim: WatchRow }
  | {
      ok: false
      error:
        | 'stale'
        | 'unknown-project'
        | 'unsupported-source'
        | 'bad-origin'
        | 'same-project'
        | 'different-source'
        | 'victim-not-active'
        | 'already-watching'
    }

export type WatchEventKind = 'watch_status' | 'watch_contact'
export interface WatchStatusPayload {
  v: 1
  from: WatchPlatformStatus
  to: WatchPlatformStatus
}
export interface WatchContactPayload {
  v: 1
  from: number
  to: number
  attribution: ContactAttribution
  clientOpen: number | null
}
export interface WatchSnapshotResult {
  applied: boolean // false when the row was not active or the generation did not match
  events: { id: number; kind: WatchEventKind }[]
  stopped: WatchStopReason | null // 'closed' when this snapshot ended the watch
  promoted: number | null // project id promoted from waiting because a slot was freed
  row: WatchRow | null
}

export interface WatchSourceState {
  source: WatchSource
  slotMs: number
  successStreak: number
  pausedUntil: string | null
  blockedAt: string | null
  needsPollSuccess: boolean
}
export type WatchPickPreference = 'submitted' | 'other'

