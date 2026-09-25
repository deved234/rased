// Preload: the ONLY bridge. Narrow, typed, no Node/SQL/fetch exposure.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels.js'
import type { RasedApi } from '../shared/api.js'
import type {
  AppSettings,
  DiagnosticEntry,
  Project,
  ProjectQuery,
  RefreshResult,
  RendererProjectEvent,
  SourceHealth,
  OpenProjectResult
} from '../shared/types.js'

function sub<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, fn as never)
  return () => ipcRenderer.removeListener(channel, fn as never)
}

const api: RasedApi = {
  getProjects: (q: ProjectQuery) => ipcRenderer.invoke(IPC.getProjects, q) as Promise<Project[]>,
  getProjectCount: (q) => ipcRenderer.invoke(IPC.getProjectCount, q) as Promise<{ total: number; unread: number }>,
  setReadState: (id, read) => ipcRenderer.invoke(IPC.setReadState, { id, read }) as Promise<void>,
  markAllRead: () => ipcRenderer.invoke(IPC.markAllRead) as Promise<number>,
  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<AppSettings>,
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.updateSettings, patch) as Promise<AppSettings>,
  getHealth: () => ipcRenderer.invoke(IPC.getHealth) as Promise<SourceHealth>,
  pause: () => ipcRenderer.invoke(IPC.pause) as Promise<SourceHealth>,
  resume: () => ipcRenderer.invoke(IPC.resume) as Promise<SourceHealth>,
  refresh: () => ipcRenderer.invoke(IPC.refresh) as Promise<RefreshResult>,
  openProject: (id) => ipcRenderer.invoke(IPC.openProject, { id }) as Promise<OpenProjectResult>,
  getDiagnostics: (limit) => ipcRenderer.invoke(IPC.getDiagnostics, { limit }) as Promise<DiagnosticEntry[]>,
  onProjectsChanged: (cb: (e: RendererProjectEvent) => void) => sub(IPC.projectsChanged, cb),
  onHealthChanged: (cb: (h: SourceHealth) => void) => sub(IPC.healthChanged, cb),
  onSettingsChanged: (cb: (s: AppSettings) => void) => sub(IPC.settingsChanged, cb),
  onPlayBeep: (cb: () => void) => sub(IPC.playBeep, cb),
  onOpenSettings: (cb: () => void) => sub('rased:open-settings', cb)
}

contextBridge.exposeInMainWorld('rased', api)
