import type { SourceHealth } from './types.js'

export type OverallSourceState = SourceHealth['state'] | 'partial'

/** The app-wide indicator reflects all enabled sources. */
export function overallSourceState(sources: (SourceHealth | null)[]): OverallSourceState
export function overallSourceState(mostaql: SourceHealth | null, khamsat: SourceHealth | null, khamsatEnabled: boolean): OverallSourceState
export function overallSourceState(first: (SourceHealth | null)[] | SourceHealth | null, khamsat?: SourceHealth | null, khamsatEnabled?: boolean): OverallSourceState {
  const sources = Array.isArray(first) ? first : [first, ...(khamsatEnabled ? [khamsat ?? null] : [])]
  if (sources.length === 0 || sources.every(s => !s)) return 'initializing'
  if (sources.every(s => s?.paused)) return 'paused'
  if (sources.every(s => s?.state === 'watching')) return 'watching'
  if (sources.some(s => s?.state === 'watching' || s?.paused)) return 'partial'
  if (sources.some(s => !s || s.state === 'initializing')) return 'initializing'
  if (sources.every(s => s?.state === 'backing-off')) return 'backing-off'
  if (sources.some(s => s?.state === 'needs-review')) return 'needs-review'
  if (sources.some(s => s?.state === 'error' || s?.state === 'offline')) return 'error'
  return 'backing-off'
}
