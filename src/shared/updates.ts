export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  version: string | null
  notes: string
  percent: number
  transferred: number
  total: number
  checkedAt: string | null
  error: 'check' | 'download' | 'install' | null
}
