export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
export type UpdateMode = 'install' | 'open-installer' | 'notify'
export interface UpdateState {
  phase: UpdatePhase
  mode: UpdateMode
  currentVersion: string
  version: string | null
  notes: string
  percent: number
  transferred: number
  total: number
  checkedAt: string | null
  error: 'check' | 'download' | 'install' | null
}
