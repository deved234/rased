// Typed renderer<->main contract. Implemented in preload, consumed by the
// renderer through `window.rased`. Keep in shared so both sides agree.

import type {
  DiagnosticEntry,
  NotifyEvent,
  OpenProjectResult,
  Project,
  ProjectQuery,
  RefreshResult,
  RendererProjectEvent,
  SourceHealth,
  AppSettings
} from './types.js'

export interface RasedApi {
  getProjects(q: ProjectQuery): Promise<Project[]>
  getProjectCount(q: Omit<ProjectQuery, 'limit' | 'offset'>): Promise<{ total: number; unread: number }>
  setReadState(id: number, read: boolean): Promise<void>
  markAllRead(): Promise<number>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getHealth(): Promise<SourceHealth>
  pause(): Promise<SourceHealth>
  resume(): Promise<SourceHealth>
  refresh(): Promise<RefreshResult>
  openProject(id: number): Promise<OpenProjectResult>
  getDiagnostics(limit?: number): Promise<DiagnosticEntry[]>
  onProjectsChanged(cb: (e: RendererProjectEvent) => void): () => void
  onHealthChanged(cb: (h: SourceHealth) => void): () => void
  onSettingsChanged(cb: (s: AppSettings) => void): () => void
  onPlayBeep(cb: () => void): () => void
  onOpenSettings(cb: () => void): () => void
}

export type { NotifyEvent }
