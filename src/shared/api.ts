import type { ProfileSet, ProfileSetState } from './proposalProfiles.js'
import type { AboutLink } from './about.js'
import type { AnalyticsStatus, UiSurface } from './telemetry.js'
import type { ExtensionStatus } from './extension/protocol.js'
export type ExtensionAction = { action:'prepare'|'folder'|'copy-path'|'chrome-extensions'|'cancel' } | { action:'approve'; id:string; code:string; label:string } | { action:'select'|'revoke'; id:string }
import type { UpdateState } from './updates.js'
import type { ProposalDraft, ProposalPreview, ProposalProfile, ProposalResult } from './proposals.js'
import type { AiOperationResult, AiProviderId, AiSelection, AiSettings, AiSetup } from './ai.js'
import type { BackupPreferences, DataStatus, RestorePreview } from './data.js'
import type { SourceId } from './sources.js'
import type { ProjectFacts } from './projectFacts.js'
import { type QuickTextSource, type QuickApplyResult, type QuickAssistantResult } from './quickApply.js'
// Typed renderer<->main contract. Implemented in preload, consumed by the
// renderer through `window.rased`. Keep in shared so both sides agree.

import type {
  AppSettings,
  DetailsChangedEvent,
  DiagnosticEntry,
  FilterDefinition,
  MutationResult,
  NavigateEvent,
  NotifyEvent,
  OpenProjectResult,
  PageResult,
  Project,
  ProjectDetails,
  ProjectFull,
  ProjectQuery,
  QueryWindow,
  ProjectUserState,
  RefreshResult,
  RendererProjectEvent,
  SavedFilter,
  SourceHealth
} from './types.js'

export interface ImportSummary {
  ok: boolean
  error?: string
  settingsKeys?: string[]
  filtersAdded?: number
  filtersReplaced?: number
  startupRequested?: boolean
  startupIncluded?: boolean
  profileIncluded?: boolean
  aiIncluded?: boolean
  legacy?: boolean
}

export interface PurgePreview {
  ok: boolean
  error?: string
  affected?: number
  backupPath?: string | null
}

export interface AppInfo {
  version: string
  platform: string
  arch: string
}

export interface RasedApi {
  databaseReady(): Promise<boolean>
  getSidebarCounts(): Promise<{ unread: number; saved: number }>
  matchProjectIds(definition: FilterDefinition, ids: number[]): Promise<number[]>
  getAnalyticsStatus(): Promise<AnalyticsStatus | null>
  analyticsConsent(action: 'enable' | 'disable' | 'later' | 'forget'): Promise<MutationResult>
  analyticsAction(action: 'copy-reference' | 'contact'): Promise<MutationResult>
  recordUiUsage(surface: UiSurface): Promise<void>
  onAnalyticsChanged(cb: (status: AnalyticsStatus) => void): () => void
  getExtensionStatus():Promise<ExtensionStatus>
  extensionAction(action:ExtensionAction):Promise<MutationResult>
  quickApplyProject(id:number, mode?:QuickTextSource, expectedText?:string):Promise<QuickApplyResult>
  quickApplyAssistant(id:number):Promise<QuickAssistantResult>
  cancelQuickAssistant(operationId:string):Promise<void>
  setQuickConsent(enabled:boolean, selection?:AiSelection):Promise<MutationResult>
  onExtensionStatus(cb:(status:ExtensionStatus)=>void):()=>void
  getProposalSetup(): Promise<{ hasKey: boolean; profile: ProposalProfile }>
  getProfileSet(): Promise<ProfileSetState>
  saveProfileSet(set: ProfileSet): Promise<MutationResult>
  recoverProfileSet(): Promise<MutationResult>
  getAiSetup(): Promise<AiSetup>
  saveAiSettings(settings: AiSettings): Promise<MutationResult>
  saveAiKey(provider: AiProviderId, key: string): Promise<MutationResult>
  deleteAiKey(provider: AiProviderId): Promise<MutationResult>
  listAiModels(provider: AiProviderId): Promise<AiOperationResult>
  testAiModel(selection: AiSelection): Promise<AiOperationResult>
  saveProposalProfile(profile: ProposalProfile): Promise<MutationResult>
  getProposalPreview(id: number, projectNotes: string, selection?: AiSelection, profileId?: string): Promise<ProposalPreview | null>
  generateProposal(id: number, projectNotes: string, fingerprint: string, selection?: AiSelection, profileId?: string): Promise<ProposalResult>
  cancelProposal(): Promise<void>
  getProposalDraft(id: number): Promise<ProposalDraft | null>
  saveProposalDraft(draft: ProposalDraft): Promise<MutationResult>
  deleteProposalDraft(id: number): Promise<MutationResult>
  getUpdateState(): Promise<UpdateState>
  checkUpdate(): Promise<MutationResult>
  downloadUpdate(): Promise<MutationResult>
  installUpdate(): Promise<MutationResult>
  confirmUpdateInstall(): Promise<MutationResult>
  onUpdateState(cb: (state: UpdateState) => void): () => void
  onRequestUpdateInstall(cb: () => void): () => void
  getProjects(q: ProjectQuery): Promise<Project[]>
  getProjectCount(q: Omit<ProjectQuery, 'limit' | 'offset'>): Promise<{ total: number; unread: number }>
  setReadState(id: number, read: boolean): Promise<void>
  markAllRead(): Promise<number>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getHealth(): Promise<SourceHealth>
  getKhamsatHealth(): Promise<SourceHealth>
  getNafezlyHealth(): Promise<SourceHealth>
  getKafHealth(): Promise<SourceHealth>
  acknowledgeSourceGap(source: SourceId): Promise<MutationResult>
  copyMonitoringReport(): Promise<MutationResult>
  pause(): Promise<SourceHealth>
  resume(): Promise<SourceHealth>
  pauseKhamsat(): Promise<SourceHealth>
  resumeKhamsat(): Promise<SourceHealth>
  pauseNafezly(): Promise<SourceHealth>
  pauseKaf(): Promise<SourceHealth>
  resumeNafezly(): Promise<SourceHealth>
  resumeKaf(): Promise<SourceHealth>
  refresh(): Promise<RefreshResult>
  openProject(id: number): Promise<OpenProjectResult>
  openProjectExternal(id: number): Promise<OpenProjectResult>
  getDiagnostics(limit?: number): Promise<DiagnosticEntry[]>
  // v2
  getProject(id: number): Promise<ProjectFull | null>
  getProjectDetails(id: number): Promise<ProjectDetails | null>
  getProjectFacts(id: number): Promise<ProjectFacts | null>
  requestProjectFacts(id: number, force?: boolean): Promise<ProjectFacts | null>
  requestProjectDetails(id: number, force?: boolean): Promise<ProjectDetails | null>
  updateProjectUserState(id: number, patch: Partial<Pick<ProjectUserState, 'status'>> & { saved?: boolean; hidden?: boolean; note?: string }): Promise<MutationResult>
  getSavedFilters(): Promise<SavedFilter[]>
  createSavedFilter(name: string, definition: FilterDefinition): Promise<MutationResult & { id?: string }>
  updateSavedFilter(id: string, name: string, definition: FilterDefinition): Promise<MutationResult>
  deleteSavedFilter(id: string): Promise<MutationResult>
  previewFilterCount(definition: FilterDefinition): Promise<{ total: number; unread: number }>
  queryProjectsPage(definition: FilterDefinition, limit: number, offset: number, window?: QueryWindow): Promise<PageResult>
  testNotification(): Promise<OpenProjectResult>
  openWindowsNotificationSettings(): Promise<MutationResult>
  testSound(): Promise<void>
  setDnd(untilIso: string | null): Promise<AppSettings>
  openDataFolder(): Promise<MutationResult>
  getDataStatus(): Promise<DataStatus>
  setBackupPreferences(preferences: BackupPreferences): Promise<MutationResult>
  createBackup(): Promise<MutationResult & { path?: string }>
  validateRestore(): Promise<RestorePreview>
  cancelRestore(): Promise<void>
  applyRestore(token: string, applyStartup: boolean): Promise<MutationResult>
  openBackupFolder(): Promise<MutationResult>
  exportSettings(): Promise<MutationResult & { path?: string }>
  validateImport(): Promise<ImportSummary>
  applyImport(mode: 'merge' | 'replace', applyStartup: boolean): Promise<ImportSummary>
  purgeHistoryPreview(cutoffIso: string): Promise<PurgePreview>
  purgeHistoryApply(cutoffIso: string): Promise<PurgePreview & { deleted?: number }>
  openCompact(): Promise<void>
  closeCompact(): Promise<void>
  setAlwaysOnTop(on: boolean): Promise<void>
  showProjectInMain(id: number): Promise<void>
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  getWindowState(): Promise<{ maximized: boolean; minimized: boolean }>
  onWindowState(cb: (state: { maximized: boolean }) => void): () => void
  getAppInfo(): Promise<AppInfo>
  openAboutLink(link: AboutLink): Promise<MutationResult>
  confirmClose(quit: boolean): Promise<void>
  onRequestClose(cb: (e: { quit: boolean }) => void): () => void
  onProjectsChanged(cb: (e: RendererProjectEvent) => void): () => void
  onHealthChanged(cb: (h: SourceHealth) => void): () => void
  onKhamsatHealthChanged(cb: (h: SourceHealth) => void): () => void
  onNafezlyHealthChanged(cb: (h: SourceHealth) => void): () => void
  onKafHealthChanged(cb: (h: SourceHealth) => void): () => void
  onSettingsChanged(cb: (s: AppSettings) => void): () => void
  onSettingsImported(cb: (s: AppSettings) => void): () => void
  onDetailsChanged(cb: (e: DetailsChangedEvent) => void): () => void
  onNavigate(cb: (e: NavigateEvent) => void): () => void
  onPlayBeep(cb: () => void): () => void
  onOpenSettings(cb: (section?: 'ai') => void): () => void
}

export type { NotifyEvent }
