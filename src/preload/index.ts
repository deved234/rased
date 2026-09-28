// Preload: the ONLY bridge. Narrow, typed, no Node/SQL/fetch exposure.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels.js'
import type { AppInfo, ImportSummary, PurgePreview, RasedApi } from '../shared/api.js'
import type { UpdateState } from '../shared/updates.js'
import type {
  AppSettings,
  DetailsChangedEvent,
  DiagnosticEntry,
  MutationResult,
  NavigateEvent,
  OpenProjectResult,
  PageResult,
  Project,
  ProjectDetails,
  ProjectFull,
  ProjectQuery,
  RefreshResult,
  RendererProjectEvent,
  SavedFilter,
  SourceHealth
} from '../shared/types.js'

function sub<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, fn as never)
  return () => ipcRenderer.removeListener(channel, fn as never)
}

const api: RasedApi = {
  getProposalSetup: () => ipcRenderer.invoke(IPC.getProposalSetup),
  saveGeminiKey: (key) => ipcRenderer.invoke(IPC.saveGeminiKey, { key }),
  deleteGeminiKey: () => ipcRenderer.invoke(IPC.deleteGeminiKey),
  saveProposalProfile: (profile) => ipcRenderer.invoke(IPC.saveProposalProfile, { profile }),
  getProposalPreview: (id, projectNotes) => ipcRenderer.invoke(IPC.getProposalPreview, { id, projectNotes }),
  generateProposal: (id, projectNotes, fingerprint) => ipcRenderer.invoke(IPC.generateProposal, { id, projectNotes, fingerprint }),
  cancelProposal: () => ipcRenderer.invoke(IPC.cancelProposal),
  getProposalDraft: (id) => ipcRenderer.invoke(IPC.getProposalDraft, { id }),
  saveProposalDraft: (draft) => ipcRenderer.invoke(IPC.saveProposalDraft, { draft }),
  deleteProposalDraft: (id) => ipcRenderer.invoke(IPC.deleteProposalDraft, { id }),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState) as Promise<UpdateState>,
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate) as Promise<MutationResult>,
  downloadUpdate: () => ipcRenderer.invoke(IPC.downloadUpdate) as Promise<MutationResult>,
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate) as Promise<MutationResult>,
  confirmUpdateInstall: () => ipcRenderer.invoke(IPC.confirmUpdateInstall) as Promise<MutationResult>,
  onUpdateState: (cb) => sub(IPC.updateState, cb),
  onRequestUpdateInstall: (cb) => sub(IPC.requestUpdateInstall, cb),
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
  openProjectExternal: (id) => ipcRenderer.invoke(IPC.openProjectExternal, { id }) as Promise<OpenProjectResult>,
  getDiagnostics: (limit) => ipcRenderer.invoke(IPC.getDiagnostics, { limit }) as Promise<DiagnosticEntry[]>,
  getProject: (id) => ipcRenderer.invoke(IPC.getProject, { id }) as Promise<ProjectFull | null>,
  getProjectDetails: (id) => ipcRenderer.invoke(IPC.getProjectDetails, { id }) as Promise<ProjectDetails | null>,
  requestProjectDetails: (id, force) => ipcRenderer.invoke(IPC.requestProjectDetails, { id, force: force === true }) as Promise<ProjectDetails | null>,
  updateProjectUserState: (id, patch) => ipcRenderer.invoke(IPC.updateProjectUserState, { id, patch }) as Promise<MutationResult>,
  getSavedFilters: () => ipcRenderer.invoke(IPC.getSavedFilters) as Promise<SavedFilter[]>,
  createSavedFilter: (name, definition) => ipcRenderer.invoke(IPC.createSavedFilter, { name, definition }) as Promise<MutationResult & { id?: string }>,
  updateSavedFilter: (id, name, definition) => ipcRenderer.invoke(IPC.updateSavedFilter, { id, name, definition }) as Promise<MutationResult>,
  deleteSavedFilter: (id) => ipcRenderer.invoke(IPC.deleteSavedFilter, { id }) as Promise<MutationResult>,
  previewFilterCount: (definition) => ipcRenderer.invoke(IPC.previewFilterCount, { definition }) as Promise<{ total: number; unread: number }>,
  queryProjectsPage: (definition, limit, offset) => ipcRenderer.invoke(IPC.queryProjectsPage, { definition, limit, offset }) as Promise<PageResult>,
  testNotification: () => ipcRenderer.invoke(IPC.testNotification) as Promise<OpenProjectResult>,
  openWindowsNotificationSettings: () => ipcRenderer.invoke(IPC.openWindowsNotificationSettings) as Promise<MutationResult>,
  testSound: () => ipcRenderer.invoke(IPC.testSound) as Promise<void>,
  setDnd: (untilIso) => ipcRenderer.invoke(IPC.setDnd, { untilIso }) as Promise<AppSettings>,
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder) as Promise<MutationResult>,
  exportSettings: () => ipcRenderer.invoke(IPC.exportSettings) as Promise<MutationResult & { path?: string }>,
  validateImport: () => ipcRenderer.invoke(IPC.validateImport) as Promise<ImportSummary>,
  applyImport: (mode, applyStartup) => ipcRenderer.invoke(IPC.applyImport, { mode, applyStartup }) as Promise<ImportSummary>,
  purgeHistoryPreview: (cutoffIso) => ipcRenderer.invoke(IPC.purgeHistoryPreview, { cutoffIso }) as Promise<PurgePreview>,
  purgeHistoryApply: (cutoffIso) => ipcRenderer.invoke(IPC.purgeHistoryApply, { cutoffIso }) as Promise<PurgePreview & { deleted?: number }>,
  openCompact: () => ipcRenderer.invoke(IPC.openCompact) as Promise<void>,
  closeCompact: () => ipcRenderer.invoke(IPC.closeCompact) as Promise<void>,
  setAlwaysOnTop: (on) => ipcRenderer.invoke(IPC.setAlwaysOnTop, { on }) as Promise<void>,
  showProjectInMain: (id) => ipcRenderer.invoke(IPC.showProjectInMain, { id }) as Promise<void>,
  openAboutLink: (link) => ipcRenderer.invoke(IPC.openAboutLink, { link }) as Promise<MutationResult>,
  windowControl: (action) => ipcRenderer.invoke(IPC.windowControl, { action }) as Promise<void>,
  getWindowState: () => ipcRenderer.invoke(IPC.getWindowState) as Promise<{ maximized: boolean; minimized: boolean }>,
  onWindowState: (cb) => sub(IPC.windowState, cb),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo) as Promise<AppInfo>,
  confirmClose: (quit) => ipcRenderer.invoke(IPC.confirmClose, { quit }) as Promise<void>,
  onRequestClose: (cb) => sub(IPC.requestClose, cb),
  onProjectsChanged: (cb: (e: RendererProjectEvent) => void) => sub(IPC.projectsChanged, cb),
  onHealthChanged: (cb: (h: SourceHealth) => void) => sub(IPC.healthChanged, cb),
  onSettingsChanged: (cb: (s: AppSettings) => void) => sub(IPC.settingsChanged, cb),
  onDetailsChanged: (cb: (e: DetailsChangedEvent) => void) => sub(IPC.detailsChanged, cb),
  onNavigate: (cb: (e: NavigateEvent) => void) => sub(IPC.navigate, cb),
  onPlayBeep: (cb: () => void) => sub(IPC.playBeep, cb),
  onOpenSettings: (cb: () => void) => sub(IPC.openSettings, cb)
}

contextBridge.exposeInMainWorld('rased', api)
