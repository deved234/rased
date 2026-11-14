import { WATCH_ORIGINS, type WatchOrigin } from '../shared/projectWatch.js'

export interface ValidatedWatchSetPayload {
  projectId: number
  want: 'on' | 'off'
  expectVersion: number | null
  entry: WatchOrigin
}

export interface ValidatedWatchReplacePayload {
  projectId: number
  victimId: number
  expectVersions: {
    project: number | null
    victim: number
  }
  entry: WatchOrigin
}

export function validateWatchSetPayload(raw: unknown): ValidatedWatchSetPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (!Number.isInteger(v.projectId) || (v.projectId as number) <= 0) return null
  if (v.want !== 'on' && v.want !== 'off') return null
  if (v.expectVersion !== null && !Number.isInteger(v.expectVersion)) return null
  if (typeof v.entry !== 'string' || !(WATCH_ORIGINS as readonly string[]).includes(v.entry)) return null
  return {
    projectId: v.projectId as number,
    want: v.want,
    expectVersion: v.expectVersion as number | null,
    entry: v.entry as WatchOrigin
  }
}

export function validateWatchReplacePayload(raw: unknown): ValidatedWatchReplacePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (!Number.isInteger(v.projectId) || (v.projectId as number) <= 0) return null
  if (!Number.isInteger(v.victimId) || (v.victimId as number) <= 0) return null
  if (!v.expectVersions || typeof v.expectVersions !== 'object') return null
  const ev = v.expectVersions as Record<string, unknown>
  if (ev.project !== null && !Number.isInteger(ev.project)) return null
  if (!Number.isInteger(ev.victim)) return null
  if (typeof v.entry !== 'string' || !(WATCH_ORIGINS as readonly string[]).includes(v.entry)) return null
  return {
    projectId: v.projectId as number,
    victimId: v.victimId as number,
    expectVersions: {
      project: ev.project as number | null,
      victim: ev.victim as number
    },
    entry: v.entry as WatchOrigin
  }
}
